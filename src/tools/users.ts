import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { summarizeLeague } from "../leagues.js";
import { SLEEPER_API, type League, type SleeperUser } from "../sleeper.js";
import { jsonResult, type ToolContext } from "./context.js";

// Both go into request paths, so only safe characters are allowed. Sleeper
// usernames are letters, digits and underscores; user ids are numeric.
const usernameSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9_]{1,40}$/,
    "username must be 1-40 letters, digits or underscores",
  )
  .describe("The user's Sleeper username (or user id)");

const seasonSchema = z
  .string()
  .regex(/^\d{4}$/, "season must be a 4-digit year")
  .optional()
  .describe(
    'The season year, e.g. "2025". Defaults to the season leagues are currently being played or created for.',
  );

/** The fields find_user_leagues and get_league share; see summarizeLeague. */
export const leagueSummaryFields = {
  league_id: z.string(),
  name: z.string(),
  season: z.string(),
  status: z
    .string()
    .describe('"pre_draft", "drafting", "in_season" or "complete"'),
  total_rosters: z.number().describe("Number of teams"),
  scoring_type: z
    .string()
    .describe(
      'From points per reception: "ppr", "half_ppr", "standard", or "custom (N per reception)"',
    ),
};

export function registerUserTools(server: McpServer, ctx: ToolContext) {
  server.registerTool(
    "find_user_leagues",
    {
      title: "Find a Sleeper User's Leagues",
      description:
        "Finds the NFL fantasy leagues a Sleeper user is in for a season, from their username. Use it to get the league_id the league tools need when the user doesn't know it.",
      inputSchema: {
        username: usernameSchema,
        season: seasonSchema,
      },
      outputSchema: {
        user: z.object({
          user_id: z
            .string()
            .describe("Matches owner_id on the user's league rosters"),
          username: z.string(),
          display_name: z.string(),
        }),
        season: z.string(),
        leagues: z.array(z.object(leagueSummaryFields)),
      },
    },
    async ({ username, season }) => {
      const [user, resolvedSeason]: [SleeperUser | null, string] =
        await Promise.all([
          ctx.callApi(`${SLEEPER_API}/user/${encodeURIComponent(username)}`),
          season ?? ctx.getNflState().then((state) => state.league_season),
        ]);
      if (user == null) {
        throw new Error(
          `Could not find Sleeper user ${username}. Check the spelling with the user.`,
        );
      }
      const leagues: League[] | null = await ctx.callApi(
        `${SLEEPER_API}/user/${encodeURIComponent(user.user_id)}/leagues/nfl/${encodeURIComponent(resolvedSeason)}`,
      );

      const result = {
        user: {
          user_id: user.user_id,
          username: user.username,
          display_name: user.display_name,
        },
        season: resolvedSeason,
        leagues: (leagues ?? []).map(summarizeLeague),
      };
      return jsonResult(result);
    },
  );
}
