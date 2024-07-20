import {
  BanchoClient,
  BanchoLobbyTeams,
  BanchoMultiplayerChannel,
} from "bancho.js";
import { SupabaseClient } from "@supabase/supabase-js";
import { matchEnded } from "../events/matchEnded.ts";
import { matchStarted } from "../events/matchStarted.ts";
import { message } from "../events/message.ts";
import { playerReady } from "../events/playerReady.ts";
import type { Score } from "osu-api-extended/dist/types/v2/matches_detaIls";

async function getMatch(supabase: SupabaseClient, id: number) {
  const match = await supabase
    .from("matches")
    .select(
      `
      *,
      rounds(
        *,
        events(
          *,
          event_groups(
            *
          )
        )
      ),
      match_participants(
        *,
        match_participant_players(
          *,
          match_participant_player_states(
            *
          ),
          team_members(
            *,
            user_profiles(
              *,
              user_platforms(*, platforms(name))
            )
          )
        ),
        participants(*,
          teams(*, team_members(user_profiles(user_id)))
        )
      ),
      match_maps(*,
        map_pool_maps(*,
          maps(*,
            mapsets(*)
          )
        ),
        scores(*,
          match_participant_players(*)
        )
      ),
      match_bans(*,
        match_participants(*,
          participants(*,
            teams(name)
          )
        )
      ),
      map_pools(
        *,          
        map_pool_maps(
          *,
          maps(
            *,
            mapsets(
              *
            )
          ),
          map_pool_map_mods(
            *,
            mods(
              *
            )
          )
        )
      )
      `
    )
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
  for (const [
    index,
    matchParticipant,
  ] of match.data.match_participants.entries()) {
    for (const matchParticipantPlayer of matchParticipant.match_participant_players) {
      const matchParticipantPlayerState = await supabase
        .from("match_participant_players")
        .select("state")
        .eq("id", matchParticipantPlayer.id)
        .single();

      const osuId =
        matchParticipantPlayer.team_members.user_profiles.user_platforms.find(
          (pf: any) => pf.platforms.name === "osu!"
        )?.value;

      console.log("Checking player: ", osuId);

      const lobbyPlayer = await channel.lobby.getPlayerById(osuId);

      // await channel.lobby.changeTeam(
      //   lobbyPlayer,
      //   index % 2 === 0 ? BanchoLobbyTeams.Red : BanchoLobbyTeams.Blue
      // );
      // await channel.lobby.movePlayer(lobbyPlayer, 0);

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
          const whois = await lobbyPlayer.user.whois();

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

  channel = await banchoClient.createLobby(
    `${"VASH"}: (${
      match.data.match_participants[0].participants.teams.name
    }) vs (${match.data.match_participants[1].participants.teams.name})`,
    true
  );

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
  const scores = channel.lobby.scores;

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

  if (matchMaps.data[0].status == "waiting") {
    console.log("Match map is still waiting for players to ready up");
    return;
  }

  for (const score of scores) {
    const playerId = score.player.user.id;

    // Fetch the latest score entry for the current map and player
    const vashScores = await supabase
      .from("scores")
      .select(
        `id,
        score,
        match_map_id,
        match_participant_players!inner(
          match_participants!inner(
            match_id, participants(
              team_id
            )
          )
        ,team_members(
          user_profiles(
            user_platforms(value, platforms(name)))))`
      )
      .eq(
        "match_participant_players.team_members.user_profiles.user_platforms.value",
        playerId
      )
      .eq(
        "match_participant_players.team_members.user_profiles.user_platforms.platforms.name",
        "osu!"
      )
      .eq("match_map_id", matchMaps.data[0].id)
      .order("created_at", { ascending: false });

    if (vashScores.error) {
      throw vashScores.error;
    }

    if (vashScores.data.length === 0) {
      console.log(
        "No score entry found for player:",
        playerId,
        "for map:",
        matchMaps.data[0].id
      );
      continue;
    }

    // Update the latest score entry if it exists and the score is different
    if (vashScores.data[0].score != score.score) {
      await supabase
        .from("scores")
        .update({ score: score.score, failed: !score.pass })
        .eq("id", vashScores.data[0].id);
    }
  }

  console.log("Finished updating scores for match map:", matchMaps.data[0].id);
}

export async function checkSettings(
  channel: BanchoMultiplayerChannel,
  supabase: SupabaseClient,
  match: any
) {
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

  if (matchMap.data.map_pool_maps.maps.osu_id == channel.lobby.beatmapId) {
    return;
  }

  await channel.lobby.setMap(matchMap.data.map_pool_maps.maps.osu_id);
  await channel.lobby.setMods(
    matchMap.data.map_pool_maps.map_pool_map_mods[0].mods.code,
    matchMap.data.map_pool_maps.map_pool_map_mods[0].mods.code == "FM"
  );
  console.log("Checked settings");
}

export async function createMatch(
  id: number,
  banchoClient: BanchoClient,
  supabase: SupabaseClient
) {
  console.log("Creating match: ", id);

  await clearMatchQueue(id, supabase);

  const match = await getMatch(supabase, id);

  let channel = await getOrMakeChannel(supabase, banchoClient, match);
  // if (!channel) {
  //   return console.error("Failed to create or join channel");
  // }

  setInterval(() => checkMatchParticipants(match, supabase, channel), 3000);
  setInterval(() => checkScores(channel, supabase, match), 5000);
  setInterval(() => checkSettings(channel, supabase, match), 10000);

  channel.lobby.on("matchAborted", () => {
    matchEnded(supabase, channel, match);
  });

  channel.lobby.on("matchFinished", () => {
    matchEnded(supabase, channel, match);
  });

  channel.lobby.on("playing", () => {
    matchStarted(supabase, match.data.id);
  });

  channel.on("message", async (msg) => {
    message(msg, channel, supabase, match.data.id);
  });

  channel.lobby.on("allPlayersReady", async () => {
    playerReady(channel);
  });
}
