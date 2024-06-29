import { createClient } from "@supabase/supabase-js";
import { BanchoClient } from "bancho.js";
import type { Score } from "osu-api-extended/dist/types/v2/matches_detaIls";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!,
);

const banchoClient = new BanchoClient({
  username: "jollyWudchip",
  password: process.env.OSU_IRC_KEY!,
  apiKey: process.env.OSU_API_KEY!,
});

console.log("Connecting to Bancho");
await banchoClient.connect();
console.log("Connected to Bancho");

let match = await supabase
  .from("matches")
  .select(
    `*, 
      rounds (*, 
        map_pools(*,
          map_pool_mods(*,
            map_pool_mod_mods(*,
              mods(*
              )
            ),
            map_pool_maps(*,
              maps(*, 
                mapsets(*
                )
              )
            )
          )
        ),
        events(*, event_groups(*))
      ),
      match_participants(*,
        match_participant_players(*,
          match_participant_player_states(*
          ),
          team_members(*, 
            user_profiles(*,
              user_platforms(*)
            )
          )
        ),
        participants(*, 
          teams(*
          )
        )
      ),
      match_maps(*, map_pool_maps(*, maps(*, mapsets(*))), scores(*, match_participant_players(*))),
      match_bans(*, match_participants(*, participants(*, teams(name))))`,
  )
  .eq("id", process.env.MATCH_ID)
  .single();

if (match.error) {
  throw match.error;
}

const channel = await banchoClient.createLobby(
  `${"VASH"}: (${
    match.data.match_participants[0].participants.teams.name
  }) vs (${match.data.match_participants[1].participants.teams.name})`,
  true,
);

await supabase
  .from("matches")
  .update({ lobby_id: "#mp_" + channel.lobby.id })
  .eq(
    "id",
    process.env.MATCH_ID,
  );

await channel.lobby.setSettings(2, 3, match.data.match_participants.length);
console.log("Set lobby settings: ", 2, 3, match.data.match_participants.length);

match.data.match_participants.forEach(
  (
    matchParticipant: any,
  ) => {
    matchParticipant.match_participant_players.forEach(async (player: any) => {
      await channel.lobby.invitePlayer(
        String(
          player.team_members.user_profiles.user_platforms.filter((pf: any) =>
            pf.platform_id == 10
          )[0].value,
        ),
      );

      console.log(
        "Invited player: ",
        player.team_members.user_profiles.name,
      );
    });
  },
);

await channel.lobby.addRef(
  match.data.match_participants[0].match_participant_players[0]
    .team_members.user_profiles.name,
);
console.log(
  "Added ref: ",
  match.data.match_participants[0].match_participant_players[0].team_members
    .user_profiles.name,
);

async function changeAllPlayersState(state: number) {
  const players = await supabase
    .from("match_participant_players")
    .select("id, match_participants(match_id)")
    .eq(
      "match_participants.match_id",
      process.env.MATCH_ID,
    );

  if (players.error) {
    throw players.error;
  }

  await supabase.from("match_participant_players")
    .update({ state: state })
    .in(
      "id",
      players.data.map((player) => player.id),
    );
}

async function changeStateByUsername(id: number, state: number) {
  const players = await supabase
    .from("match_participant_players")
    .select(
      "id, team_members(user_profiles(user_platforms(platform_id, value))), match_participants!inner(match_id)",
    )
    .eq(
      "team_members.user_profiles.user_platforms.value",
      id,
    )
    .eq(
      "team_members.user_profiles.user_platforms.platform_id",
      1,
    )
    .eq(
      "match_participants.match_id",
      process.env.MATCH_ID,
    );

  if (players.error) {
    throw players.error;
  }

  await supabase.from("match_participant_players")
    .update({ state: 3 }).in(
      "id",
      players.data.map((player) => player.id),
    ).select();
}

channel.lobby.on(
  "playerJoined",
  async (user) => {
    console.log(`${user.player.user.username} joined the lobby`);

    await changeStateByUsername(user.player.user.id, 3);
  },
);

channel.lobby.on(
  "playerLeft",
  async (user) => {
    console.log(`${user.user.username} left the lobby`);

    await changeStateByUsername(user.user.id, 2);
  },
);

channel.lobby.on(
  "allPlayersReady",
  async () => {
    console.log("All players are ready");

    channel.lobby.startMatch();
  },
);

channel.lobby.on(
  "playing",
  async () => {
    console.log("Match is now playing");

    await changeAllPlayersState(5);
  },
);

async function checkForMatchEnd() {
  const matchMaps = await supabase
    .from("match_maps")
    .select(
      "scores(match_participant_players(match_participant_id))",
    )
    .eq("match_id", process.env.MATCH_ID);

  if (matchMaps.error) {
    throw matchMaps.error;
  }

  const pointsTeam1 = matchMaps.data.filter(
    (match_map) =>
      match_map.scores
        .filter(
          (score) =>
            score.match_participant_players.match_participant_id ==
              match.data.match_participants[0].id,
        )
        .reduce((sum, score) => sum + score.score, 0) >
        match_map.scores
          .filter(
            (score) =>
              score.match_participant_players.match_participant_id ==
                match.data.match_participants[1].id,
          )
          .reduce((sum, score) => sum + score.score, 0),
  ).length;

  const pointsTeam2 = matchMaps.data.filter(
    (match_map) =>
      match_map.scores
        .filter(
          (score) =>
            score.match_participant_players.match_participant_id ==
              match.data.match_participants[1].id,
        )
        .reduce((sum, score) => sum + score.score, 0) >
        match_map.scores
          .filter(
            (score) =>
              score.match_participant_players.match_participant_id ==
                match.data.match_participants[0].id,
          )
          .reduce((sum, score) => sum + score.score, 0),
  ).length;

  if (pointsTeam1 > match.data.rounds.best_of / 2) {
    await handleMatchWin(0);
  }

  if (pointsTeam2 > match.data.rounds.best_of / 2) {
    await handleMatchWin(1);
  }
}

async function handleMatchWin(matchParticipantPlayerIndex: number) {
  const matchParticipantPlayer =
    match.data.match_participants[matchParticipantPlayerIndex]
      .match_participant_players[0];

  await channel.sendMessage(
    `The match has been won by ${matchParticipantPlayer.team_members.user_profiles.name}`,
  );

  await channel.lobby.closeLobby();

  await changeAllPlayersState(1);

  process.exit();
}

async function handleMatchEnd(scores: Score[]) {
  console.log("Match finished");

  for (const score of scores) {
    await changeAllPlayersState(4);

    const matchMap = await supabase
      .from("match_maps")
      .select("id")
      .eq("match_id", process.env.MATCH_ID)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (matchMap.error) {
      throw matchMap.error;
    }

    const scores = await supabase
      .from("scores")
      .select(
        `id,
        match_map_id,
        match_participant_players!inner(
          match_participants!inner(
            match_id, participants(
              team_id
            )
          )
        ,team_members(
          user_profiles(
            user_platforms(value, platform_id))))`,
      )
      .eq(
        "match_participant_players.team_members.user_profiles.user_platforms.value",
        score.user_id,
      )
      .eq(
        "match_participant_players.team_members.user_profiles.user_platforms.platform_id",
        1,
      )
      .eq(
        "match_participant_players.match_participants.match_id",
        process.env.MATCH_ID,
      )
      .eq("match_map_id", matchMap.data.id);

    if (scores.error) {
      throw scores.error;
    }

    if (
      scores.data.length > 1
    ) {
      console.log("Adding extra point to Stan 2.");

      await supabase
        .from("scores")
        .update({ score: score.score + 1, failed: !score.passed })
        .eq("id", scores.data[0].id);

      await supabase
        .from("scores")
        .update({ score: score.score, failed: !score.passed })
        .eq("id", scores.data[1].id);
    } else {
      await supabase
        .from("scores")
        .update({ score: score.score, failed: !score.passed })
        .in("id", scores.data.map((score) => score.id));
    }

    await checkForMatchEnd();
  }
}

channel.lobby.on(
  "matchAborted",
  async () => {
    await handleMatchEnd([]);
  },
);

channel.lobby.on(
  "matchFinished",
  async (scores: Score[]) => {
    await handleMatchEnd(scores);
  },
);

channel.on(
  "message",
  async (message) => {
    if (message.message.startsWith("close")) {
      await channel.lobby.closeLobby();

      await changeAllPlayersState(1);

      process.exit();
    }
  },
);
