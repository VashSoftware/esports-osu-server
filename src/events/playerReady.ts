import type { BanchoMultiplayerChannel } from "bancho.js";

export async function playerReady(channel: BanchoMultiplayerChannel) {
  console.log("All players are ready");

  channel.lobby.startMatch();
}
