import type { BanchoLobbyPlayer } from "bancho.js";
import { changeStateById } from "../utils/states";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Socket } from "socket.io-client";

export async function playerJoined(
  { player }: { player: BanchoLobbyPlayer },
  supabase: SupabaseClient,
  matchId: number,
  socket: Socket
) {
  console.log(`${player.user.username} joined the lobby`);

  await changeStateById(player.user.id, 3, matchId, supabase, socket);
}
