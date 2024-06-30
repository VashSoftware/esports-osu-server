import type { BanchoLobbyPlayer } from "bancho.js";
import { changeStateByUsername } from "../utils/states";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function playerJoined(
  { player }: { player: BanchoLobbyPlayer },
  supabase: SupabaseClient
) {
  console.log(`${player.user.username} joined the lobby`);

  await changeStateByUsername(player.user.id, 3, supabase);
}
