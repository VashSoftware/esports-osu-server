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

      await channel.lobby.changeTeam(
        lobbyPlayer,
        index % 2 === 0 ? BanchoLobbyTeams.Red : BanchoLobbyTeams.Blue
      );
      await channel.lobby.movePlayer(lobbyPlayer, 0);

      if (
        channel.lobby.slots.some((slot) => {
          return slot?.user.id == osuId;
        })
      ) {
        if (matchParticipantPlayerState.data!.state !== 3) {
          await supabase
            .from("match_participant_players")
            .update({ state: 3 })
            .eq("id", matchParticipantPlayer.id);

          console.log("Player is in the lobby:", osuId);
        }
      } else {
        try {
          const whois = await lobbyPlayer.user.whois();

          if (matchParticipantPlayerState.data!.state !== 2) {
            await supabase
              .from("match_participant_players")
              .update({ state: 2 })
              .eq("id", matchParticipantPlayer.id);

            console.log("Player is not in the lobby:", osuId);
          }
        } catch (e) {
          if (matchParticipantPlayerState.data!.state !== 1) {
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
    } catch (e) {
      console.log(e);
    }
  } else {
    try {
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

      await channel.lobby.setSettings(
        2,
        3,
        match.data.match_participants.length
      );

      await channel.lobby.lockSlots();

      console.log(
        "Set lobby settings: ",
        2,
        3,
        match.data.match_participants.length
      );

      match.data.match_participants.forEach((matchParticipant: any) => {
        matchParticipant.match_participant_players.forEach(
          async (player: any) => {
            await channel.lobby.invitePlayer(
              String(
                player.team_members.user_profiles.user_platforms.filter(
                  (pf: any) => pf.platforms.name == "osu! (username)"
                )[0].value
              )
            );

            console.log(
              "Invited player: ",
              player.team_members.user_profiles.name
            );
          }
        );
      });

      await channel.lobby.addRef("Stan");
      console.log("Added ref: ", "Stan");
    } catch (e) {
      console.log(e);
    }
  }

  return channel!;
}

export async function checkScores(
  channel: BanchoMultiplayerChannel,
  supabase: SupabaseClient,
  match: any
) {
  const scores = channel.lobby.scores;

  const matchMap = await supabase
    .from("match_maps")
    .select("id")
    .eq("match_id", match.data.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (matchMap.error) {
    throw matchMap.error;
  }

  for (const score of scores) {
    const scores = await supabase
      .from("scores")
      .select(
        `id,
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
        score.player.user.id
      )
      .eq(
        "match_participant_players.team_members.user_profiles.user_platforms.platforms.name",
        "osu!"
      )
      .eq(
        "match_participant_players.match_participants.match_id",
        match.data.id
      )
      .eq("match_map_id", matchMap.data.id);

    if (scores.error) {
      throw scores.error;
    }

    if (scores.data.length > 1) {
      console.log("Adding extra point to Stan 2.");

      await supabase
        .from("scores")
        .update({ score: score.score + 1, failed: !score.pass })
        .eq("id", scores.data[0].id);

      await supabase
        .from("scores")
        .update({ score: score.score, failed: !score.pass })
        .eq("id", scores.data[1].id);
    } else {
      await supabase
        .from("scores")
        .update({ score: score.score, failed: !score.pass })
        .in(
          "id",
          scores.data.map((score) => score.id)
        );
    }
  }
}

async function checkLobbyExists() {
  return true;
}

export async function createMatch(
  id: number,
  banchoClient: BanchoClient,
  supabase: SupabaseClient
) {
  console.log("Creating match: ", id);

  await clearMatchQueue(id, supabase);

  const match = await getMatch(supabase, id);

  setInterval(() => checkLobbyExists(), 10000);

  let channel = await getOrMakeChannel(supabase, banchoClient, match);
  setInterval(() => checkMatchParticipants(match, supabase, channel), 3000);
  setInterval(() => checkScores(channel, supabase, match), 5000);

  channel.lobby.on("matchAborted", () => {
    matchEnded(supabase, channel, match);
  });

  //@ts-ignore
  channel.lobby.on("matchFinished", (scores: Score[]) => {
    matchEnded(supabase, channel, match);
  });

  channel.lobby.on("playing", () => {
    matchStarted(supabase, match.data.id);
  });

  channel.on("message", async (msg) => {
    message(msg, channel, supabase, match.data.id);
  });

  // Player moved

  channel.lobby.on("allPlayersReady", async () => {
    playerReady(channel);
  });
}
