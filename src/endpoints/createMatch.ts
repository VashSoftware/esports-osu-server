import { BanchoClient } from "bancho.js";
import { createClient } from "@supabase/supabase-js";
import { setupEvents } from "../events/index.ts";

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

  setupEvents(banchoClient);

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
