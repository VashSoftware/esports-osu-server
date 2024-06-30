import { BanchoClient } from "bancho.js";
import express from "express";
import type { Request, Response } from "express";
import { createMatch } from "./endpoints/createMatch.ts";
import { sendMessages } from "./endpoints/sendMessages.ts";
import { invitePlayer } from "./endpoints/invitePlayer.ts";

console.log("Starting osu! server.");

const banchoClient = new BanchoClient({
  username: process.env.OSU_USERNAME!,
  password: process.env.OSU_IRC_KEY!,
  apiKey: process.env.OSU_API_KEY!,
});
await banchoClient.connect();

console.log("Connected to Bancho");

const app = express();
const port = 3000;
app.use(express.json());

app.post("/create-match", async (req: Request, _res: Response) => {
  await createMatch(req.body.id, banchoClient);
});
app.post("/send-messages", async (req: Request, _res: Response) => {
  await sendMessages(req.body.messages, req.body.channelId, banchoClient);
});
app.post("/invite-player", async (req: Request, _res: Response) => {
  await invitePlayer(req.body.playerOsuId, req.body.channelId, banchoClient);
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
