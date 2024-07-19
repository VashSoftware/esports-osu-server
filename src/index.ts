import { BanchoClient } from "bancho.js";
import express from "express";
import type { Request, Response } from "express";
import { createMatch } from "./endpoints/createMatch.ts";
import { sendMessages } from "./endpoints/sendMessages.ts";
import { invitePlayer } from "./endpoints/invitePlayer.ts";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

console.log("Starting osu! server.");

const banchoClient = new BanchoClient({
  username: process.env.OSU_USERNAME!,
  password: process.env.OSU_IRC_KEY!,
  apiKey: process.env.OSU_API_KEY!,
});
await banchoClient.connect();

console.log("Connected to Bancho");

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

const ongoingMatches = await supabase
  .from("matches")
  .select("*")
  .eq("ongoing", true);

for (const match of ongoingMatches.data) {
  createMatch(match.id, banchoClient, supabase);
}

async function canMakeMatch(
  match_id: any,
  banchoClient: BanchoClient,
  supabase: SupabaseClient<any, "public", any>
) {
  const matches = await supabase
    .from("matches")
    .select("*")
    .eq("ongoing", true);

  if (matches.data?.length > 3) {
    return false;
  }

  return true;
}

supabase
  .channel("schema-db-changes")
  .on(
    "postgres_changes",
    { event: "*", schema: "public", table: "match_queue" },
    async (payload) => {
      if (payload.new?.positiion !== 1) {
        return;
      }

      if (
        !(await canMakeMatch(payload.new?.match_id, banchoClient, supabase))
      ) {
        return;
      }

      createMatch(payload.new?.match_id, banchoClient, supabase);
    }
  )
  .subscribe();

// Polling function to check for matches
async function pollMatches() {
  console.log("Polling for matches...");
  const { data, error } = await supabase
    .from("match_queue")
    .select("*")
    .eq("position", 1)
    .maybeSingle();

  if (!data) {
    return;
  }

  if (!canMakeMatch(data.match_id, banchoClient, supabase)) {
    return;
  }

  createMatch(data.match_id, banchoClient, supabase);
}

setInterval(pollMatches, 5000);

const app = express();
const port = 3000;
app.use(express.json());

app.post("/send-messages", async (req: Request, res: Response) => {
  await sendMessages(req.body.messages, req.body.channelId, banchoClient);

  return res.json({ success: true });
});
app.post("/invite-player", async (req: Request, res: Response) => {
  await invitePlayer(req.body.playerOsuId, req.body.channelId, banchoClient);

  return res.json({ success: true });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
