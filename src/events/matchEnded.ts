import type { SupabaseClient } from "@supabase/supabase-js";
import type { BanchoMultiplayerChannel } from "bancho.js";
import type { Score } from "osu-api-extended/dist/types/v2/matches_detaIls";
import { changeAllPlayersState } from "../utils/states";

export async function matchEnded(
  scores: Score[],
  supabase: SupabaseClient,
  channel: BanchoMultiplayerChannel,
  match: any
) {
  async function checkForMatchEnd() {
    const matchMaps = await supabase
      .from("match_maps")
      .select("scores(score, match_participant_players(match_participant_id))")
      .eq("match_id", match.data.id);

    if (matchMaps.error) {
      throw matchMaps.error;
    }

    const pointsTeam1 = matchMaps.data.filter(
      (match_map) =>
        match_map.scores
          .filter(
            (score) =>
              score.match_participant_players.match_participant_id ==
              match.data.match_participants[0].id
          )
          .reduce((sum, score) => sum + score.score, 0) >
        match_map.scores
          .filter(
            (score) =>
              score.match_participant_players.match_participant_id ==
              match.data.match_participants[1].id
          )
          .reduce((sum, score) => sum + score.score, 0)
    ).length;

    const pointsTeam2 = matchMaps.data.filter(
      (match_map) =>
        match_map.scores
          .filter(
            (score) =>
              score.match_participant_players.match_participant_id ==
              match.data.match_participants[1].id
          )
          .reduce((sum, score) => sum + score.score, 0) >
        match_map.scores
          .filter(
            (score) =>
              score.match_participant_players.match_participant_id ==
              match.data.match_participants[0].id
          )
          .reduce((sum, score) => sum + score.score, 0)
    ).length;

    if (pointsTeam1 > match.data.rounds.best_of / 2) {
      await handleMatchWin(0);
    }

    if (pointsTeam2 > match.data.rounds.best_of / 2) {
      await handleMatchWin(1);
    }
  }

  async function handleMatchWin(matchParticipantPlayerIndex: number) {
    const matchParticipantPlayer =
      match.data.match_participants[matchParticipantPlayerIndex]
        .match_participant_players[0];

    await channel.sendMessage(
      `The match has been won by ${matchParticipantPlayer.team_members.user_profiles.name}`
    );

    await channel.lobby.closeLobby();

    await changeAllPlayersState(1, match.data.id, supabase);

    process.exit();
  }

  console.log("Match finished");

  for (const score of scores) {
    await changeAllPlayersState(4, match.data.id, supabase);

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
              user_platforms(value, platform_id))))`
      )
      .eq(
        "match_participant_players.team_members.user_profiles.user_platforms.value",
        score.user_id
      )
      .eq(
        "match_participant_players.team_members.user_profiles.user_platforms.platform_id",
        1
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
        .update({ score: score.score + 1, failed: !score.passed })
        .eq("id", scores.data[0].id);

      await supabase
        .from("scores")
        .update({ score: score.score, failed: !score.passed })
        .eq("id", scores.data[1].id);
    } else {
      await supabase
        .from("scores")
        .update({ score: score.score, failed: !score.passed })
        .in(
          "id",
          scores.data.map((score) => score.id)
        );
    }

    await checkForMatchEnd();
  }
}
