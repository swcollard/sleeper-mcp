import { z } from "zod";
import type { PlayerInfo } from "../players.js";

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
  .optional()
  .describe("The week to fetch. Defaults to the current NFL week.");

export const playerInfoSchema = z.object({
  player_id: z.string(),
  name: z.string(),
  position: z.string().nullable(),
  fantasy_positions: z
    .array(z.string())
    .describe("Positions the player can fill in fantasy lineups"),
  team: z.string().nullable().describe("NFL team abbreviation; null if none"),
  number: z.number().nullable(),
  status: z
    .string()
    .nullable()
    .describe('e.g. "Active", "Inactive", "Injured Reserve"'),
  injury_status: z
    .string()
    .nullable()
    .describe('e.g. "Questionable", "Out", "IR"; null when healthy'),
  injury_body_part: z.string().nullable(),
  age: z.number().nullable(),
  years_exp: z.number().nullable(),
  depth_chart_position: z.string().nullable(),
  depth_chart_order: z
    .number()
    .nullable()
    .describe("1 for the starter at depth_chart_position"),
  search_rank: z
    .number()
    .nullable()
    .describe("Sleeper's overall ranking, lower is better"),
  active: z.boolean(),
}) satisfies z.ZodType<PlayerInfo>;

/** The player fields tools include when listing players. */
export const playerSummarySchema = playerInfoSchema.pick({
  player_id: true,
  name: true,
  position: true,
  team: true,
  injury_status: true,
});

/** A roster's player ids, as Sleeper's rosters and matchups list them. */
export const lineupFields = {
  starters: z
    .array(z.string())
    .nullable()
    .describe(
      "Player ids in the starting lineup, in slot order; null before the draft. get_player_details gives their names.",
    ),
  players: z
    .array(z.string())
    .nullable()
    .describe(
      "Every player id on the roster; null before the draft. Those not in starters are on the bench.",
    ),
};

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
