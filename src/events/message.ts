import type { SupabaseClient } from "@supabase/supabase-js";
import { changeAllPlayersState } from "../utils/states";
import type { BanchoMessage, BanchoMultiplayerChannel } from "bancho.js";

export async function message(
  message: BanchoMessage,
  channel: BanchoMultiplayerChannel,
  supabase: SupabaseClient
) {
  if (message.message.startsWith("close")) {
    await channel.lobby.closeLobby();

    await changeAllPlayersState(1, supabase);

    process.exit();
  }
}
