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

const supabase: SupabaseClient = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

const ongoingMatches = await supabase
  .from("matches")
  .select("*")
  .eq("ongoing", true);

for (const match of ongoingMatches.data!) {
  createMatch(match.id, banchoClient, supabase);
}

async function canMakeMatch(supabase: SupabaseClient) {
  const matches = await supabase
    .from("matches")
    .select("*")
    .eq("ongoing", true);

  if (matches.data!.length >= 4) {
    return false;
  }

  return true;
}

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

  if (!canMakeMatch(supabase)) {
    return;
  }

  createMatch(data.match_id, banchoClient, supabase);
}

pollMatches();
setInterval(pollMatches, 5000);

async function pollQuickQueue() {
  console.log("Polling for solo queue...");
  const quickQueue = await supabase
    .from("quick_queue")
    .select(
      "*, teams(*, team_members(*, user_profiles(*, user_ratings(*, games(name)))))"
    )
    .order("position", { ascending: true })
    .not("position", "is", null);

  if (!quickQueue.data) {
    return;
  }

  if (quickQueue.data.length < 2) {
    return;
  }

  await supabase
    .from("quick_queue")
    .update({ position: null })
    .in(
      "position",
      quickQueue.data.map((qq) => qq.position)
    );

  type Team = {
    id: number;
    average_star_rating: number;
    name: string;
    team_members: {
      id: number;
      user_profiles: {
        id: number;
        user_platforms: {
          platforms: {
            id: number;
            name: string;
          };
          value: string;
        }[];
        user_ratings: {
          id: number;
          games: {
            id: number;
            name: string;
          };
          rating: number;
        }[];
      };
    }[];
  };

  const averageTeamRatingDifferences = [];
  for (const team1 of quickQueue.data as { position: number; teams: Team }[]) {
    for (const team2 of quickQueue.data as {
      position: number;
      teams: Team;
    }[]) {
      if (team1.position === team2.position) {
        continue;
      }

      const team1Ratings =
        team1.teams.team_members.reduce((acc, tm) => {
          const osuRating = tm.user_profiles.user_ratings.find(
            (ur) => ur.games.name === "osu!"
          );
          return acc + (osuRating ? osuRating.rating : 0);
        }, 0) / team1.teams.team_members.length;

      const team2Ratings =
        team2.teams.team_members.reduce((acc, tm) => {
          const osuRating = tm.user_profiles.user_ratings.find(
            (ur) => ur.games.name === "osu!"
          );
          return acc + (osuRating ? osuRating.rating : 0);
        }, 0) / team2.teams.team_members.length;

      averageTeamRatingDifferences.push({
        team1,
        team2,
        average_rating: Math.abs((team1Ratings + team2Ratings) / 2),
      });
    }
  }

  const sortedTeamMatchups = averageTeamRatingDifferences.sort(
    (a, b) => a.average_rating - b.average_rating
  );

  const mapPoolIdReq = await supabase.rpc("get_closest_map_pool_id", {
    average_star_rating: sortedTeamMatchups[0].average_rating,
  });

  console.log("Map pool ID:", mapPoolIdReq);

  if (mapPoolIdReq.error || !mapPoolIdReq.data) {
    console.error("Error fetching map pool ID:", mapPoolIdReq.error);
    return;
  }

  const mapPoolId: number = mapPoolIdReq.data;

  const mapPool = await supabase
    .from("map_pools")
    .select("*")
    .eq("id", mapPoolId)
    .single();

  if (!mapPool.data) {
    console.error("Error fetching map pool:", mapPool.error);
    return;
  }

  const insertData = async (table: string, data: object) => {
    const result = await supabase.from(table).insert(data).select("*");

    if (result.error) throw new Error(result.error.message);
    return result.data;
  };

  const event = await insertData("events", {
    name: `Quick Match: ${sortedTeamMatchups[0].team1.teams.name} vs ${sortedTeamMatchups[0].team2.teams.name}`,
    quick_event: true,
  });

  const round = await insertData("rounds", {
    event_id: event[0].id,
    best_of: mapPool.data.recommended_best_of,
    bans_per_match_participant: 0,
    name: `Quick Match: ${sortedTeamMatchups[0].team1.teams.name} vs ${sortedTeamMatchups[0].team2.teams.name}`,
  });

  const match = await insertData("matches", {
    ongoing: true,
    start_time: new Date(),
    round_id: round[0].id,
    type: "quick",
    map_pool_id: mapPoolId,
  });

  const participant_1 = await insertData("participants", {
    team_id: sortedTeamMatchups[0].team1.teams.id,
    event_id: event[0].id,
  });

  const participant_2 = await insertData("participants", {
    team_id: sortedTeamMatchups[0].team2.teams.id,
    event_id: event[0].id,
  });

  const match_participant_1 = await supabase
    .from("match_participants")
    .insert({
      match_id: match[0].id,
      participant_id: participant_1[0].id,
      surrendered_bans: true,
    })
    .select("*, participants(teams(team_members(*)))");

  const match_participant_2 = await supabase
    .from("match_participants")
    .insert({
      match_id: match[0].id,
      participant_id: participant_2[0].id,
      surrendered_bans: true,
    })
    .select("*, participants(teams(team_members(*)))");

  await insertData("match_participant_players", {
    match_participant_id: match_participant_1.data![0].id,
    team_member:
      match_participant_1.data![0].participants.teams.team_members[0].id,
    state: 1,
  });

  await insertData("match_participant_players", {
    match_participant_id: match_participant_2.data![0].id,
    team_member:
      match_participant_2.data![0].participants.teams.team_members[0].id,
    state: 1,
  });

  const matchQueue = await supabase
    .from("match_queue")
    .select("*")
    .gt("position", 0);

  await insertData("match_queue", {
    match_id: match[0].id,
    position: matchQueue.data!.length + 1,
  });
}

pollQuickQueue();
setInterval(pollQuickQueue, 30000);

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
