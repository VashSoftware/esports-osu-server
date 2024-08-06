import { SupabaseClient } from "@supabase/supabase-js";
import {
  BanchoClient,
  BanchoLobbyPlayerStates,
  BanchoMultiplayerChannel,
} from "bancho.js";
import { checkMatchWin } from "../events/matchEnded.ts";
import { message } from "../events/message.ts";
import { changeAllPlayersState, changeStateById } from "../utils/states.ts";
import type { Socket } from "socket.io-client";
import type { PostgrestResponseSuccess } from "@supabase/postgrest-js";

async function getMatch(supabase: SupabaseClient, id: number) {
  const match = await supabase
    .from("matches")
    .select(
      `
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
      match_maps(*, map_pool_maps(*, map_pool_map_mods(*, mods(*)), maps(*, mapsets(*))), scores(*, match_participant_players(*))),
      match_bans(*, match_participants(*, participants(*, teams(name)))),
      map_pools(*, map_pool_maps(*, maps(*, mapsets(*)), map_pool_map_mods(*, mods(*))))
    `
    )
    .eq("id", id)
    .single();

  if (match.error) {
    throw match.error;
  }

  return match;
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
  match: any,
  socket: Socket
) {
  const lobbyScores = channel.lobby.scores;

  const matchMaps = match.data.match_maps
    .sort(
      (a: { created_at: Date }, b: { created_at: Date }) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    )
    .slice(-2);

  if (matchMaps.length === 0) {
    console.log("No match maps found for match:", match.data.id);
    return;
  }

  if (matchMaps[0].status != "finished") {
    console.log("Match map isn't finished yet.");
    return;
  }

  const matchMapId = matchMaps[0].id;

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

    const osuUsername = player.user_platforms.find(
      (up: any) => up.platforms.name === "osu! (username)"
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

  socket.emit("scores-update", { new: { id: match.data.id } });

  await checkMatchWin(supabase, channel, match);

  console.log("Finished updating scores for match map:", matchMapId);
}

export async function checkSettings(
  channel: BanchoMultiplayerChannel,
  supabase: SupabaseClient,
  match: any,
  socket: Socket
) {
  console.log("Checking settings");

  const matchMap = match.data.match_maps.sort(
    (a: { created_at: Date }, b: { created_at: Date }) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  )[match.data.match_maps.length - 1];

  if (!matchMap) {
    console.log("No match map found for match:", match.data.id);
    return;
  }

  if (channel.lobby.playing && matchMap.status == "waiting") {
    await changeAllPlayersState(5, match.data.id, supabase, socket);

    await supabase
      .from("match_maps")
      .update({ status: "playing" })
      .eq("id", matchMap.data?.id);

    return;
  }

  if (!channel.lobby.playing && matchMap.status == "playing") {
    await changeAllPlayersState(3, match.data.id, supabase, socket);

    await supabase
      .from("match_maps")
      .update({ status: "finished" })
      .eq("id", matchMap.id);

    return;
  }

  // @ts-ignore
  if (matchMap.map_pool_maps.maps.osu_id == channel.lobby.beatmapId) {
    return;
  }

  // @ts-ignore
  await channel.lobby.setMap(matchMap.map_pool_maps.maps.osu_id);
  await channel.lobby.setMods(
    // @ts-ignore
    "NF " + matchMap.map_pool_maps.map_pool_map_mods[0]?.mods.code,
    // @ts-ignore
    matchMap.map_pool_maps.map_pool_map_mods[0].mods.code == "FM"
  );
}

export async function checkReady(
  channel: BanchoMultiplayerChannel,
  supabase: SupabaseClient,
  match: any,
  socket: Socket
) {
  console.log("Checking ready state and started the match");

  const lobbyPlayers = channel.lobby.slots.filter((slot) => slot?.user);

  for (const lobbyPlayer of lobbyPlayers) {
    if (lobbyPlayer.state === BanchoLobbyPlayerStates.Ready) {
      await changeStateById(
        lobbyPlayer.user.id,
        4,
        match.data.id,
        supabase,
        socket
      );
    }
  }

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
    lobbyPlayers.some((slot) => slot.state !== BanchoLobbyPlayerStates.Ready)
  ) {
    await channel.sendMessage(
      "Not all players are ready. Map will start automatically once all players are ready."
    );
    return;
  }

  await channel.lobby.startMatch();
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
  channel: BanchoMultiplayerChannel,
  supabase: SupabaseClient,
  match: any,
  socket: Socket
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
        await changeStateById(
          matchParticipantPlayer.id,
          3,
          match.data.id,
          supabase,
          socket
        );

        console.log("Player is in the lobby:", osuId);
      } else {
        try {
          await lobbyPlayer.user.whois();

          await changeStateById(
            matchParticipantPlayer.id,
            2,
            match.data.id,
            supabase,
            socket
          );

          console.log("Player is not in the lobby:", osuId);
        } catch (e) {
          await changeStateById(
            matchParticipantPlayer.id,
            1,
            match.data.id,
            supabase,
            socket
          );

          console.log("Player is not in the lobby:", osuId);
        }
      }
    }
  }

  socket.emit("match-participant-players-update", {
    new: { id: match.data.id },
  });
}

export async function createMatch(
  id: number,
  banchoClient: BanchoClient,
  supabase: SupabaseClient,
  socket: Socket
) {
  console.log("Creating match: ", id);

  await clearMatchQueue(id, supabase);

  let match = await getMatch(supabase, id);

  let channel = (await getOrMakeChannel(supabase, banchoClient, match))!;

  if (!channel) {
    console.log("Failed to create channel for match:", id);
    return;
  }

  socket.emit("join-match", match.data.id);

  socket.emit("matches-update", match.data.id);

  socket.on("matches-update", async (payload) => {
    match = await getMatch(supabase, id);
  });

  socket.on("match-maps-update", async (payload) => {
    match = await getMatch(supabase, id);
  });

  channel.on("message", async (msg) => {
    message(msg, channel, supabase, match.data.id, socket);
  });

  const interval = setInterval(async () => {
    if (match.data.ongoing) {
      await channel.lobby.updateSettings();

      await checkSettings(channel, supabase, match, socket);
      await checkScores(channel, supabase, match, socket);
      await checkMatchParticipants(channel, supabase, match, socket);
      await checkReady(channel, supabase, match, socket);
    } else {
      clearInterval(interval);

      console.log(
        `Match ${match.data.id} is no longer ongoing, stopped all processes.`
      );
    }
  }, 5000);
}
