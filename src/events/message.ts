import type { SupabaseClient } from "@supabase/supabase-js";
import { changeAllPlayersState } from "../utils/states";
import type { BanchoMessage, BanchoMultiplayerChannel } from "bancho.js";

export async function message(
  message: BanchoMessage,
  channel: BanchoMultiplayerChannel,
  supabase: SupabaseClient,
  matchId: number
) {
  if (message.message.startsWith("close") && message.user.username == "Stan") {
    await channel.lobby.closeLobby();

    await changeAllPlayersState(1, matchId, supabase);

    await supabase.from("matches").update({ ongoing: false }).eq("id", matchId);
  }
}
