import type { BanchoLobbyPlayer } from "bancho.js";
import { changeStateByUsername } from "../utils/states";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function playerLeft(
  user: BanchoLobbyPlayer,
  supabase: SupabaseClient,
  matchId: number
) {
  console.log(`${user.user.username} left the lobby`);

  await changeStateByUsername(user.user.id, 2, matchId, supabase);
}
