import type { SupabaseClient } from "@supabase/supabase-js";

export async function changeAllPlayersState(
  state: number,
  matchId: number,
  supabase: SupabaseClient
) {
  const players = await supabase
    .from("match_participant_players")
    .select("id, match_participants(match_id)")
    .eq("match_participants.match_id", matchId);

  if (players.error) {
    throw players.error;
  }

  await supabase
    .from("match_participant_players")
    .update({ state: state })
    .in(
      "id",
      players.data.map((player) => player.id)
    );
}

export async function changeStateByUsername(
  id: number,
  state: number,
  matchId: number,
  supabase: SupabaseClient
) {
  const players = await supabase
    .from("match_participant_players")
    .select(
      "id, team_members(user_profiles(user_platforms(platform_id, value))), match_participants!inner(match_id)"
    )
    .eq("team_members.user_profiles.user_platforms.value", id)
    .eq("team_members.user_profiles.user_platforms.platform_id", 1)
    .eq("match_participants.match_id", matchId);

  if (players.error) {
    throw players.error;
  }

  await supabase
    .from("match_participant_players")
    .update({ state: state })
    .in(
      "id",
      players.data.map((player) => player.id)
    )
    .select();
}
