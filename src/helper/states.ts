async function changeAllPlayersState(state: number) {
  const players = await supabase
    .from("match_participant_players")
    .select("id, match_participants(match_id)")
    .eq("match_participants.match_id", process.env.MATCH_ID);

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

async function changeStateByUsername(id: number, state: number) {
  const players = await supabase
    .from("match_participant_players")
    .select(
      "id, team_members(user_profiles(user_platforms(platform_id, value))), match_participants!inner(match_id)"
    )
    .eq("team_members.user_profiles.user_platforms.value", id)
    .eq("team_members.user_profiles.user_platforms.platform_id", 1)
    .eq("match_participants.match_id", process.env.MATCH_ID);

  if (players.error) {
    throw players.error;
  }

  await supabase
    .from("match_participant_players")
    .update({ state: 3 })
    .in(
      "id",
      players.data.map((player) => player.id)
    )
    .select();
}
