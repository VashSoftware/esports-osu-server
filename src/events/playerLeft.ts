import type { BanchoLobbyPlayer } from "bancho.js";
import { changeStateById } from "../utils/states";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Socket } from "socket.io-client";

export async function playerLeft(
  user: BanchoLobbyPlayer,
  supabase: SupabaseClient,
  matchId: number,
  socket: Socket
) {
  console.log(`${user.user.username} left the lobby`);

  await changeStateById(user.user.id, 2, matchId, supabase, socket);
}
