import { SupabaseClient } from "@supabase/supabase-js";
import { changeAllPlayersState } from "../utils/states.ts";

export async function matchStarted(supabase: SupabaseClient, matchId: number) {
  console.log("Match is now playing");

  await changeAllPlayersState(5, matchId, supabase);
}
