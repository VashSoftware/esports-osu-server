import { BanchoClient } from "bancho.js";
import { SupabaseClient } from "@supabase/supabase-js";
import { matchEnded } from "../events/matchEnded.ts";
import { matchStarted } from "../events/matchStarted.ts";
import { message } from "../events/message.ts";
import { playerJoined } from "../events/playerJoined.ts";
import { playerLeft } from "../events/playerLeft.ts";
import { playerReady } from "../events/playerReady.ts";
import type { Score } from "osu-api-extended/dist/types/v2/matches_detaIls";

export async function createMatch(
  id: number,
  banchoClient: BanchoClient,
  supabase: SupabaseClient
) {
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
              user_platforms(*)
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

  let channel: BanchoMultiplayerChannel;

  try {
    channel = await banchoClient.createLobby(
      `${"VASH"}: (${
        match.data.match_participants[0].participants.teams.name
      }) vs (${match.data.match_participants[1].participants.teams.name})`,
      true
    );
  } catch (e) {
    console.log(e);
  }

  channel.lobby.on("matchAborted", () => {
    matchEnded([], supabase, channel, match);
  });

  //@ts-ignore
  channel.lobby.on("matchFinished", (scores: Score[]) => {
    matchEnded(scores, supabase, channel, match);
  });

  channel.lobby.on("playing", () => {
    matchStarted(supabase, match.data.id);
  });

  channel.on("message", async (msg) => {
    message(msg, channel, supabase, match.data.id);
  });

  channel.lobby.on("playerJoined", async (user) => {
    playerJoined(user, supabase, match.data.id);
  });

  channel.lobby.on("playerLeft", async (user) => {
    playerLeft(user, supabase, match.data.id);
  });

  // Player moved

  channel.lobby.on("allPlayersReady", async () => {
    playerReady(channel);
  });

  await supabase
    .from("matches")
    .update({ lobby_id: "#mp_" + channel.lobby.id })
    .eq("id", id);

  await channel.lobby.setSettings(2, 3, match.data.match_participants.length);
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
            (pf: any) => pf.platform_id == 10
          )[0].value
        )
      );

      console.log("Invited player: ", player.team_members.user_profiles.name);
    });
  });

  await channel.lobby.addRef("Stan");
  console.log("Added ref: ", "Stan");
}
