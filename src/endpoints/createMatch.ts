import { BanchoClient, BanchoMultiplayerChannel } from "bancho.js";
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

  async function checkMatchParticipants() {
    for (const matchParticipant of match.data.match_participants) {
      for (const matchParticipantPlayer of matchParticipant.match_participant_players) {
        const osuUsername =
          matchParticipantPlayer.team_members.user_profiles.user_platforms.find(
            (pf: any) => pf.platforms.name === "osu! (username)"
          )?.value;

        if (!osuUsername) {
          console.error(
            "osu! username not found for participant",
            matchParticipantPlayer.id
          );
          continue;
        }

        const banchoUser = await banchoClient.getUser(String(osuUsername));

        const { data: matchParticipantPlayerState, error } = await supabase
          .from("match_participant_players")
          .select("*")
          .eq("id", matchParticipantPlayer.id)
          .single();

        if (error) {
          console.error("Error fetching participant state:", error);
          continue;
        }

        try {
          const whois = await banchoUser.whois();

          const isInLobby = whois.channels.some(
            (channel) => channel.name === match.data.lobby_id
          );

          if (isInLobby) {
            if (
              matchParticipantPlayerState?.state === 1 ||
              matchParticipantPlayerState?.state === 2
            ) {
              await supabase
                .from("match_participant_players")
                .update({ state: 3 })
                .eq("id", matchParticipantPlayer.id);

              console.log("Player is in the lobby:", banchoUser.username);
            }
          } else {
            if (matchParticipantPlayerState?.state === 1) {
              await supabase
                .from("match_participant_players")
                .update({ state: 2 })
                .eq("id", matchParticipantPlayer.id);
            }

            console.log("Player is not in the lobby:", banchoUser.username);
          }
        } catch (e) {
          console.error("Error in whois check for user:", osuUsername, e);
          await supabase
            .from("match_participant_players")
            .update({ state: 1 })
            .eq("id", matchParticipantPlayer.id);
        }

        console.log("Checked player:", banchoUser.username);
      }
    }
  }

  // Run the check periodically every minute
  setInterval(checkMatchParticipants, 5000); // 60000 ms = 1 minute

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
            (pf: any) => pf.platforms.name == "osu! (username)"
          )[0].value
        )
      );

      console.log("Invited player: ", player.team_members.user_profiles.name);
    });
  });

  await channel.lobby.addRef("Stan");
  console.log("Added ref: ", "Stan");
}
