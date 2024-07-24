import type { BanchoLobbyPlayer } from "bancho.js";
import { changeStateById } from "../utils/states";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function playerJoined(
  { player }: { player: BanchoLobbyPlayer },
  supabase: SupabaseClient,
  matchId: number
) {
  console.log(`${player.user.username} joined the lobby`);

  await changeStateById(player.user.id, 3, matchId, supabase);
}
