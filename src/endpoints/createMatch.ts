import { BanchoClient } from "bancho.js";
import { createClient } from "@supabase/supabase-js";
import process from "node:process";
import { matchEnded } from "../events/matchEnded.ts";
import { matchStarted } from "../events/matchStarted.ts";
import { message } from "../events/message.ts";
import { playerJoined } from "../events/playerJoined.ts";
import { playerLeft } from "../events/playerLeft.ts";
import { playerMoved } from "../events/playerMoved.ts";
import { playerReady } from "../events/playerReady.ts";
import type { Score } from "osu-api-extended/dist/types/v2/matches_detaIls";

export async function createMatch(id: number, banchoClient: BanchoClient) {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!
  );

  const match = await supabase
    .from("matches")
    .select(
      `*, 
      rounds (*, 
        map_pools(*,
          map_pool_mods(*,
            map_pool_mod_mods(*,
              mods(*
              )
            ),
            map_pool_maps(*,
              maps(*, 
                mapsets(*
                )
              )
            )
          )
        ),
        events(*, event_groups(*))
      ),
      match_participants(*,
        match_participant_players(*,
          match_participant_player_states(*
          ),
          team_members(*, 
            user_profiles(*,
              user_platforms(*)
            )
          )
        ),
        participants(*, 
          teams(*
          )
        )
      ),
      match_maps(*, map_pool_maps(*, maps(*, mapsets(*))), scores(*, match_participant_players(*))),
      match_bans(*, match_participants(*, participants(*, teams(name))))`
    )
    .eq("id", id)
    .single();

  if (match.error) {
    throw match.error;
  }

  const channel = await banchoClient.createLobby(
    `${"VASH"}: (${
      match.data.match_participants[0].participants.teams.name
    }) vs (${match.data.match_participants[1].participants.teams.name})`,
    true
  );

  channel.lobby.on("matchAborted", () => {
    matchEnded([], supabase, channel, match);
  });

  //@ts-ignore
  channel.lobby.on("matchFinished", (scores: Score[]) => {
    matchEnded(scores, supabase, channel, match);
  });

  channel.lobby.on("playing", () => {
    matchStarted(supabase);
  });

  channel.on("message", async (msg) => {
    message(msg, channel, supabase);
  });

  channel.lobby.on("playerJoined", async (user) => {
    playerJoined(user, supabase);
  });

  channel.lobby.on("playerLeft", async (user) => {
    playerLeft(user, supabase);
  });

  // Player moved

  channel.lobby.on("allPlayersReady", async () => {
    playerReady(channel);
  });

  await supabase
    .from("matches")
    .update({ lobby_id: "#mp_" + channel.lobby.id })
    .eq("id", process.env.MATCH_ID);

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

  await channel.lobby.addRef(
    match.data.match_participants[0].match_participant_players[0].team_members
      .user_profiles.name
  );
  console.log(
    "Added ref: ",
    match.data.match_participants[0].match_participant_players[0].team_members
      .user_profiles.name
  );
}
