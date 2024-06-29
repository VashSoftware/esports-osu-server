import { BanchoClient } from "bancho.js";
import { matchEnded } from "./matchEnded.ts";
import { matchStarted } from "./matchStarted.ts";
import { message } from "./message.ts";
import { playerJoined } from "./playerJoined.ts";
import { playerLeft } from "./playerLeft.ts";
import { playerMoved } from "./playerMoved.ts";
import { playerReady } from "./playerReady.ts";

export const setupEvents = (client: BanchoClient) => {
  client.on("matchEnded", matchEnded);
  client.on("matchStarted", matchStarted);
  client.on("message", message);
  client.on("playerJoined", playerJoined);
  client.on("playerLeft", playerLeft);
  client.on("playerMoved", playerMoved);
  client.on("playerReady", playerReady);
};
