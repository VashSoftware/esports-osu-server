import type { SupabaseClient } from "@supabase/supabase-js";
import type { BanchoMultiplayerChannel } from "bancho.js";
import { matchStarted } from "./matchStarted";

export async function playerReady(
  channel: BanchoMultiplayerChannel,
  supabase: SupabaseClient,
  match: any
) {
  console.log("All players are ready");

  const matchMaps = await supabase
    .from("match_maps")
    .select("status")
    .eq("match_id", match.data.id)
    .order("created_at", { ascending: false });

  if (matchMaps.error) {
    throw matchMaps.error;
  }

  if (matchMaps.data.length === 0) {
    console.log("No match maps found for match:", channel.lobby.id);
    return;
  }

  if (matchMaps.data[0].status != "waiting") {
    console.log("Match map has already started.");
    return;
  }

  channel.lobby.startMatch();
  await matchStarted(supabase, match.data.id);
}
