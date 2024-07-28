import type { SupabaseClient } from "@supabase/supabase-js";
import { changeAllPlayersState } from "../utils/states";
import type { BanchoMessage, BanchoMultiplayerChannel } from "bancho.js";
import type { Socket } from "socket.io-client";

export async function message(
  message: BanchoMessage,
  channel: BanchoMultiplayerChannel,
  supabase: SupabaseClient,
  matchId: number,
  socket: Socket
) {
  if (message.message.startsWith("close") && message.user.username == "Stan") {
    await channel.lobby.closeLobby();

    await changeAllPlayersState(1, matchId, supabase, socket);

    await supabase.from("matches").update({ ongoing: false }).eq("id", matchId);
  }
}
