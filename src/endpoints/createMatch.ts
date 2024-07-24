import { SupabaseClient } from "@supabase/supabase-js";
import {
  BanchoClient,
  BanchoLobbyPlayerScore,
  BanchoLobbyPlayerStates,
  BanchoMultiplayerChannel,
} from "bancho.js";
import { checkMatchWin } from "../events/matchEnded.ts";
import { matchStarted } from "../events/matchStarted.ts";
import { message } from "../events/message.ts";
import { playerReady } from "../events/playerReady.ts";
import { changeAllPlayersState } from "../utils/states.ts";

async function getMatch(supabase: SupabaseClient, id: number) {
  const match = await supabase
    .from("matches")
    .select(`
      *,
      rounds(*, events(*, event_groups(*))),
      match_participants(
        *,
        match_participant_players(
          *,
          match_participant_player_states(*),
          team_members(
            *,
            user_profiles(*, user_platforms(*, platforms(name)))
          )
        ),
        participants(*, teams(*, team_members(user_profiles(user_id))))
      ),
      match_maps(*, map_pool_maps(*, maps(*, mapsets(*))), scores(*, match_participant_players(*))),
      match_bans(*, match_participants(*, participants(*, teams(name)))),
      map_pools(*, map_pool_maps(*, maps(*, mapsets(*)), map_pool_map_mods(*, mods(*))))
    `)
    .eq("id", id)
    .single();

  if (match.error) {
    throw match.error;
  }

  return match;
}

async function clearMatchQueue(id: number, supabase: SupabaseClient) {
  const matchQueue = await supabase
    .from("match_queue")
    .select("*")
    .eq("match_id", id)
    .maybeSingle();

  if (matchQueue.data?.position !== 1) {
    return;
  }

  await supabase
    .from("match_queue")
    .update({ position: null })
    .eq("match_id", id);
}

async function checkMatchParticipants(
  match: any,
  supabase: SupabaseClient,
  channel: BanchoMultiplayerChannel
) {
  for (const matchParticipant of match.data.match_participants) {
    for (const matchParticipantPlayer of matchParticipant.match_participant_players) {
      const osuId =
        matchParticipantPlayer.team_members.user_profiles.user_platforms.find(
          (pf: any) => pf.platforms.name === "osu!"
        )?.value;

      console.log("Checking player: ", osuId);

      const lobbyPlayer = await channel.lobby.getPlayerById(osuId);

      if (
        channel.lobby.slots.some((slot) => {
          return slot?.user.id == osuId;
        })
      ) {
        await supabase
          .from("match_participant_players")
          .update({ state: 3 })
          .eq("id", matchParticipantPlayer.id);

        console.log("Player is in the lobby:", osuId);
      } else {
        try {
          await lobbyPlayer.user.whois();

          await supabase
            .from("match_participant_players")
            .update({ state: 2 })
            .eq("id", matchParticipantPlayer.id);

          console.log("Player is not in the lobby:", osuId);
        } catch (e) {
          await supabase
            .from("match_participant_players")
            .update({ state: 1 })
            .eq("id", matchParticipantPlayer.id);

          console.log("Player is not in the lobby:", osuId);
        }
      }
    }
  }
}

async function getOrMakeChannel(
  supabase: SupabaseClient,
  banchoClient: BanchoClient,
  match: any
) {
  let channel: BanchoMultiplayerChannel;

  if (match.data.lobby_id) {
    try {
      channel = banchoClient.getChannel(
        match.data.lobby_id
      ) as BanchoMultiplayerChannel;
      await channel.join();
      return channel;
    } catch (e) {
      console.log(e);
    }
  }

  try {
    channel = await banchoClient.createLobby(
      `${"VASH"}: (${
        match.data.match_participants[0].participants.teams.name
      }) vs (${match.data.match_participants[1].participants.teams.name})`,
      true
    );
  } catch (e) {
    console.log(e);
    return;
  }

  await supabase
    .from("matches")
    .update({ lobby_id: "#mp_" + channel.lobby.id })
    .eq("id", match.data.id);

  await channel.lobby.setSettings(2, 3, match.data.match_participants.length);

  await channel.lobby.lockSlots();

  console.log(
    "Set lobby settings: ",
    2,
    3,
    match.data.match_participants.length
  );

  match.data.match_participants.forEach((matchParticipant: any) => {
    matchParticipant.match_participant_players.forEach(async (player: any) => {
      await channel.lobby.invitePlayer(
        String(
          player.team_members.user_profiles.user_platforms.filter(
            (pf: any) => pf.platforms.name == "osu! (username)"
          )[0].value
        )
      );

      console.log("Invited player: ", player.team_members.user_profiles.name);
    });
  });

  await channel.lobby.addRef("Stan");
  console.log("Added ref: ", "Stan");

  return channel;
}

export async function checkScores(
  channel: BanchoMultiplayerChannel,
  supabase: SupabaseClient,
  match: any
) {
  const lobbyScores: BanchoLobbyPlayerScore[] = channel.lobby.scores;

  const matchMaps = await supabase
    .from("match_maps")
    .select("id, status")
    .eq("match_id", match.data.id)
    .order("created_at", { ascending: false })
    .limit(2);

  if (matchMaps.error) {
    throw matchMaps.error;
  }

  if (matchMaps.data.length === 0) {
    console.log("No match maps found for match:", match.data.id);
    return;
  }

  if (matchMaps.data[0].status == "waiting" || channel.lobby.playing) {
    console.log("Match map is still waiting for players to ready up");
    return;
  }

  const matchMapId = matchMaps.data[0].id;

  const vashScores = await supabase
    .from("scores")
    .select(
      `*, match_participant_players!inner(team_members(user_profiles(user_platforms(*, platforms(name)))))`
    )
    .eq("match_map_id", matchMapId)
    .order("created_at", { ascending: false });

  for (const vashScore of vashScores.data!) {
    const player =
      vashScore.match_participant_players.team_members.user_profiles;

    // Find the osu! username instead of ID
    const osuUsername = player.user_platforms.find(
      (up: any) => up.platforms.name === "osu! (username)" // Filter by username
    )?.value;

    if (!osuUsername) {
      console.log(`No osu! username found for player: ${player.id}`);
      continue;
    }

    const osuScore = lobbyScores.find(
      (score) => score.player.user.username === osuUsername // Compare usernames
    );

    if (!osuScore) {
      console.log(
        `Player with osu! username ${osuUsername} not found in the lobby`
      );
      continue;
    }

    console.log(`Updating score for player ID ${osuUsername}:`, osuScore.score);

    await supabase
      .from("scores")
      .update({ score: osuScore.score, failed: !osuScore.pass })
      .eq("id", vashScore.id);
  }

  await supabase
    .from("match_maps")
    .update({ status: "finished" })
    .eq("id", matchMapId);

  await checkMatchWin(supabase, channel, match);

  console.log("Finished updating scores for match map:", matchMapId);
}

export async function checkSettings(
  channel: BanchoMultiplayerChannel,
  supabase: SupabaseClient,
  match: any
) {
  await channel.lobby.updateSettings();

  const matchMap = await supabase
    .from("match_maps")
    .select("id, map_pool_maps(maps(osu_id), map_pool_map_mods(mods(code)))")
    .eq("match_id", match.data.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!matchMap.data) {
    console.log("No match map found for match:", match.data.id);
    return;
  }

  if (channel.lobby.playing) {
    await matchStarted(supabase, match.data.id);
    return;
  }

  // @ts-ignore
  if (matchMap.data.map_pool_maps.maps.osu_id == channel.lobby.beatmapId) {
    return;
  }

  // @ts-ignore
  await channel.lobby.setMap(matchMap.data.map_pool_maps.maps.osu_id);
  await channel.lobby.setMods(
    // @ts-ignore
    "NF " + matchMap.data.map_pool_maps.map_pool_map_mods[0].mods.code,
    // @ts-ignore
    matchMap.data.map_pool_maps.map_pool_map_mods[0].mods.code == "FM"
  );

  const lobbyPlayers = channel.lobby.slots.filter((slot) => slot?.user);

  if (
    lobbyPlayers.length <
    match.data.match_participants.reduce(
      (acc: number, mp: any) => acc + mp.match_participant_players.length,
      0
    )
  ) {
    console.log("Not enough players in the lobby");
    return;
  }

  if (
    lobbyPlayers.some((slot) => slot?.state != BanchoLobbyPlayerStates.Ready)
  ) {
    console.log("Not all players are ready");
    return;
  }

  await playerReady(channel, supabase, match);

  console.log("Checked settings");
}

async function checkOngoingStatus(
  supabase: SupabaseClient,
  matchId: number
): Promise<boolean> {
  const { data, error } = await supabase
    .from("matches")
    .select("ongoing")
    .eq("id", matchId)
    .single();

  if (error) {
    console.error("Error checking match status:", error);
    return false;
  }

  return data.ongoing;
}

export async function createMatch(
  id: number,
  banchoClient: BanchoClient,
  supabase: SupabaseClient
) {
  console.log("Creating match: ", id);

  await clearMatchQueue(id, supabase);

  const match = await getMatch(supabase, id);

  let channel = (await getOrMakeChannel(supabase, banchoClient, match))!;

  const interval = setInterval(async () => {
    if (await checkOngoingStatus(supabase, match.data.id)) {
      await checkMatchParticipants(match, supabase, channel);
      await checkScores(channel, supabase, match);
      await checkSettings(channel, supabase, match);
    } else {
      clearInterval(interval);
      console.log(
        `Match ${match.data.id} is no longer ongoing, stopped all processes.`
      );
    }
  }, 5000);

  channel.lobby.on("matchAborted", async () => {
    changeAllPlayersState(4, match.data.id, supabase);
  });

  channel.lobby.on("matchFinished", async () => {
    changeAllPlayersState(4, match.data.id, supabase);
  });

  channel.on("message", async (msg) => {
    message(msg, channel, supabase, match.data.id);
  });
}
