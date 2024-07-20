import { SupabaseClient } from "@supabase/supabase-js";
import { changeAllPlayersState } from "../utils/states.ts";

export async function matchStarted(supabase: SupabaseClient, matchId: number) {
  console.log("Match is now playing");

  await changeAllPlayersState(5, matchId, supabase);

  const matchMaps = await supabase
    .from("match_maps")
    .select(
      "id, scores(score, match_participant_players(match_participant_id))"
    )
    .eq("match_id", matchId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  await supabase
    .from("match_maps")
    .update({ status: "playing" })
    .eq("id", matchMaps.data?.id);
}
