import { z } from "zod";

// Sleeper league ids are numeric strings; restricting the charset keeps model
// input from rewriting the request path (e.g. "../state/nfl").
export const leagueIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9]+$/, "league_id must be alphanumeric");

export const weekSchema = z
  .number()
  .int()
  .min(1)
  .max(18)
  .describe(
    "The week of the league to fetch matchups for. The current week can be fetched from get_nfl_state if the user does not request a specific week.",
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
