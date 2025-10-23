import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { z } from "zod";
import * as fs from "fs";
import { LRUCache } from "lru-cache";

interface CacheEntry {
  data: any;
  timestamp: number;
}

const cache = new LRUCache<string, CacheEntry>({
  max: 1000,
  ttl: 30 * 1000,
});

// Create an MCP server
const server = new McpServer({
  name: "sleeper-mcp-server",
  version: "1.0.0",
});

//----
// Types
//----

type Player = {
  status: string;
  full_name: string;
  team: string;
};

type User = {
  user_id: string;
  username: string;
  display_name: string;
  metadata: {
    team_name: string;
  };
};

type Roster = {
  roster_id: number;
  owner_id: string; // user_id
  players: string[]; // player IDs
  starters: string[]; // player IDs
  settings: {
    fpts: number;
    fpts_decimal: number;
    fpts_against: number;
    fpts_against_decimal: number;
    wins: number;
    losses: number;
    ties: number;
    total_moves: number;
    waiver_position: number;
    waiver_budget_used: number;
  };
  reserve?: string[];
  league_id: string;
};

type MatchupEntry = {
  roster_id: number;
  starters: string[];
  players: string[];
  points: number;
  players_points: Record<string, number>; // player id to points score
  matchup_id: number;
};

type Matchup = {
  matchup_id: number;
  week: number;
  entries: ScoreBoardEntry[];
};

type ScoreBoardEntry = {
  user_name: string;
  team_name: string;
  starters: string[];
  players: string[];
  total_points: number;
  players_points: Record<string, number>; // player name to points score
  starters_points: Record<string, number>; // starters name to points score
  matchup_id: number;
};

//----
// Load Player Data
//----

const playerNameToId: Map<string, string> = new Map();
const playerIdToName: Map<string, string> = new Map();

const PLAYER_DATA_FILE_PATH = "/tmp/nfl.json";
const PLAYER_DATA_URL = "https://api.sleeper.app/v1/players/nfl";

try {
  if (!fs.existsSync(PLAYER_DATA_FILE_PATH)) {
    const response = await fetch(PLAYER_DATA_URL);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch NFL data: ${response.status} ${response.statusText}`,
      );
    }
    const data = await response.json();
    fs.writeFileSync(PLAYER_DATA_FILE_PATH, JSON.stringify(data), "utf-8");
  }
  const rawData = fs.readFileSync(PLAYER_DATA_FILE_PATH, "utf-8");
  const parsedData: Record<string, Player> = JSON.parse(rawData); // Parse and cast to MyData interface

  for (const [key, playerData] of Object.entries(parsedData)) {
    playerNameToId.set(playerData.full_name, key);
    playerIdToName.set(key, playerData.full_name);
  }
} catch (error) {
  console.error("Error reading or parsing JSON file:", error);
}

async function callApi(url: string) {
  const cached = cache.get(url);
  if (cached) {
    console.log(`CACHED ${url}`);
    return cached.data;
  }
  console.log(`GET ${url}`);
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Failed to fetch data. HTTP status: ${response.status} ${response.statusText}`,
    );
  }
  const data = await response.json();

  cache.set(url, { data, timestamp: Date.now() });

  return data;
}

// Get NFL State
const NFL_STATE_URL = "https://api.sleeper.app/v1/state/nfl";

server.registerTool(
  "get_nfl_state",
  {
    title: "Get NFL State",
    description:
      "Fetches the current week, season, and related state information for the NFL from the Sleeper API.",
    inputSchema: {},
    outputSchema: {
      week: z.number(),
      season_type: z.string(),
      season_start_date: z.string(),
      season: z.string(),
      previous_season: z.string(),
      leg: z.number(),
      league_season: z.string(),
      league_create_season: z.string(),
      display_week: z.number(),
      season_has_scores: z.boolean(),
    },
  },
  async () => {
    const stateResponse = await callApi(NFL_STATE_URL);
    // Return the response in the expected tool output format
    return {
      content: [
        {
          type: "text",
          text: `${JSON.stringify(stateResponse, null, 2)}`,
        },
      ],
      structuredContent: stateResponse,
    };
  },
);

server.registerTool(
  "get_player_id",
  {
    title: "Get Player ID",
    description:
      "Given a players full name, fetches the player id used in sleeper",
    inputSchema: {
      name: z.string(),
    },
    outputSchema: {
      player_id: z.string(),
    },
  },
  async ({ name }) => {
    console.log(`get_player_id for ${name}`);
    const id = playerNameToId.get(name);

    if (!id) {
      // Handle not found error
      throw new Error(`Could not find player ${name}`);
    }
    // Return the response in the expected tool output format
    return {
      content: [
        {
          type: "text",
          text: id,
        },
      ],
      structuredContent: {
        player_id: id,
      },
    };
  },
);

server.registerTool(
  "get_player_name",
  {
    title: "Get Player Name",
    description: "Given a players ID, fetches their full name used in sleeper",
    inputSchema: {
      id: z.string(),
    },
    outputSchema: {
      player_name: z.string(),
    },
  },
  async ({ id }) => {
    console.log(`get_player_name for ${id}`);
    const name = playerIdToName.get(id);

    if (!name) {
      // Handle not found error
      throw new Error(`Could not find player with id ${id}`);
    }
    // Return the response in the expected tool output format
    return {
      content: [
        {
          type: "text",
          text: name,
        },
      ],
      structuredContent: {
        player_name: name,
      },
    };
  },
);

server.registerTool(
  "get_league_rosters",
  {
    title: "Get Rosters for Sleeper Fantasy League",
    description:
      "Fetches a list of fantasy football rosters from the Sleeper API for a given league id. Ask the user for their league id.",
    inputSchema: {
      league_id: z.string(),
    },
    outputSchema: {
      rosters: z.array(
        z.object({
          roster_id: z.number(),
          starters: z
            .array(z.string())
            .describe(
              "The list of player ids in the starting lineup. Can use get_player_name tool to swap with names",
            ),
          players: z
            .array(z.string())
            .describe(
              "The list of player ids in the roster. Can use get_player_name tool to swap with names. Any ID in players but not starters is assumed to be on the bench.",
            ),
          owner_id: z.string(),
          league_id: z.string(),
          settings: z.object({
            wins: z.number(),
            waiver_position: z.number(),
            waiver_budget_used: z.number(),
            total_moves: z.number(),
            ties: z.number(),
            losses: z.number(),
            fpts_decimal: z.number(),
            fpts_against_decimal: z.number(),
            fpts_against: z.number(),
            fpts: z.number(),
          }),
        }),
      ),
    },
  },
  async ({ league_id }) => {
    const rostersResponse = await callApi(
      `https://api.sleeper.app/v1/league/${league_id}/rosters`,
    );

    return {
      content: [
        {
          type: "text",
          text: `${JSON.stringify({ rosters: rostersResponse }, null, 3)}`,
        },
      ],
      structuredContent: { rosters: rostersResponse },
    };
  },
);

server.registerTool(
  "get_league_users",
  {
    title: "Get Users for Sleeper Fantasy League",
    description:
      "Fetches a list of fantasy football users from the Sleeper API for a given league id, this provides metatdata to be combined with the get_league_rosters tool to get a full picture of the existing league. Ask the user for their league id.",
    inputSchema: {
      league_id: z.string(),
    },
    outputSchema: {
      users: z.array(
        z.object({
          user_id: z.string(),
          display_name: z.string(),
          metadata: z.object({
            team_name: z.string(),
          }),
        }),
      ),
    },
  },
  async ({ league_id }) => {
    const usersResponse = await callApi(
      `https://api.sleeper.app/v1/league/${league_id}/users`,
    );

    return {
      content: [
        {
          type: "text",
          text: `${JSON.stringify({ users: usersResponse }, null, 3)}`,
        },
      ],
      structuredContent: { users: usersResponse },
    };
  },
);

server.registerTool(
  "get_league_matchups",
  {
    title: "Get Matchups for Sleeper Fantasy League",
    description:
      "Fetches a list of fantasy football matchups from the Sleeper API for a given league id. Rosters with the same matchup_id are going head to head. Ask the user for their league id. The week is provided by get_nfl_state.",
    inputSchema: {
      league_id: z.string(),
      week: z
        .number()
        .describe(
          "The week of the league to fetch matchups for. The current week can be fetched from get_nfl_state if the user does not request a specific week.",
        ),
    },
    outputSchema: {
      rosters: z.array(
        z.object({
          roster_id: z.number(),
          starters: z
            .array(z.string())
            .describe(
              "The list of player ids in the starting lineup. Can use get_player_name tool to swap with names",
            ),
          players: z
            .array(z.string())
            .describe(
              "The list of player ids in the roster. Can use get_player_name tool to swap with names. Any ID in players but not starters is assumed to be on the bench.",
            ),
          matchup_id: z.number(),
          points: z.number(),
          players_points: z
            .record(z.string(), z.number())
            .describe("A map of Player ID to their current number of points"),
        }),
      ),
    },
  },
  async ({ league_id, week }) => {
    const matchupResponse = await callApi(
      `https://api.sleeper.app/v1/league/${league_id}/matchups/${week}`,
    );

    return {
      content: [
        {
          type: "text",
          text: `${JSON.stringify({ rosters: matchupResponse }, null, 3)}`,
        },
      ],
      structuredContent: { rosters: matchupResponse },
    };
  },
);

//---------
// Rich tools
//---------
server.registerTool(
  "get_matchup_scoreboard",
  {
    title: "Get current weeks matchups and scores for a Sleeper Fantasy League",
    description:
      "Fetches a list of fantasy football matchups and their scores from the Sleeper API for a given league id. Ask the user for their league id. The week is provided by get_nfl_state.",
    inputSchema: {
      league_id: z.string(),
      week: z
        .number()
        .describe(
          "The week of the league to fetch matchups for. The current week can be fetched from get_nfl_state if the user does not request a specific week.",
        ),
    },
    outputSchema: {
      scoreboard: z.array(
        z.object({
          matchup_id: z.number(),
          week: z.number(),
          entries: z.array(
            z.object({
              user_name: z.string(),
              team_name: z.string(),
              starters: z.array(z.string()),
              players: z.array(z.string()),
              total_points: z.number(),
              players_points: z.record(z.number()),
              starters_points: z.record(z.number()),
              matchup_id: z.number(),
            }),
          ),
        }),
      ),
    },
  },
  async ({ league_id, week }) => {
    const usersResponse: User[] = await callApi(
      `https://api.sleeper.app/v1/league/${league_id}/users`,
    );
    const usersById: Record<string, User> = {};
    for (const u of usersResponse) {
      usersById[u.user_id] = u;
    }
    const rostersResponse: Roster[] = await callApi(
      `https://api.sleeper.app/v1/league/${league_id}/rosters`,
    );

    const rostersById: Record<number, Roster> = {};
    for (const r of rostersResponse) {
      rostersById[r.roster_id] = r;
    }

    const matchupResponse: MatchupEntry[] = await callApi(
      `https://api.sleeper.app/v1/league/${league_id}/matchups/${week}`,
    );

    // Group entries into matchups by matchup_id
    const grouped: Record<number, ScoreBoardEntry[]> = {};
    for (const e of matchupResponse) {
      let matchupGroup = grouped[e.matchup_id];
      if (!matchupGroup) {
        matchupGroup = [];
        grouped[e.matchup_id] = matchupGroup;
      }
      let roster = rostersById[e.roster_id];
      let user = usersById[roster?.owner_id || ""];
      let score: ScoreBoardEntry = {
        user_name: user?.display_name || "",
        team_name: user?.metadata.team_name || "",
        starters: e.starters.map((id) => playerIdToName.get(id) || id),
        players: e.players.map((id) => playerIdToName.get(id) || id),
        total_points: e.points,
        players_points: Object.fromEntries(
          Object.entries(e.players_points).map(([id, points]) => [
            playerIdToName.get(id) || id,
            points,
          ]),
        ),
        starters_points: Object.fromEntries(
          Object.entries(e.players_points)
            .filter(([id, _]) => e.starters.includes(id))
            .map(([id, points]) => [playerIdToName.get(id) || id, points]),
        ),
        matchup_id: e.matchup_id,
      };

      matchupGroup.push(score);
    }

    const matchupList: Matchup[] = [];
    for (const mIdStr of Object.keys(grouped)) {
      const mId = parseInt(mIdStr, 10);
      matchupList.push({
        matchup_id: mId,
        week: week,
        entries: grouped[mId] || [],
      });
    }

    // Return the response in the expected tool output format
    return {
      content: [
        {
          type: "text",
          text: `${JSON.stringify({ scoreboard: matchupList }, null, 5)}`,
        },
      ],
      structuredContent: { scoreboard: matchupList },
    };
  },
);

// Set up Express and HTTP transport
const app = express();
app.use(express.json());

app.post("/mcp", async (req, res) => {
  // Create a new transport for each request to prevent request ID collisions
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  res.on("close", () => {
    transport.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

const port = parseInt(process.env.PORT || "3000");
app
  .listen(port, () => {
    console.log(`Sleeper MCP Server running on http://localhost:${port}/mcp`);
  })
  .on("error", (error) => {
    console.error("Server error:", error);
    process.exit(1);
  });
