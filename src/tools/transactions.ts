import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PlayerDirectory } from "../players.js";
import type { Roster, Transaction, User } from "../sleeper.js";
import { teamNamesByRoster } from "../rosterOwners.js";
import { summarizeTransactions, TRANSACTION_TYPES } from "../transactions.js";
import { jsonResult, type ToolContext } from "./context.js";

const teamSchema = z.string().describe("Team name");

export function registerTransactionTools(server: McpServer, ctx: ToolContext) {
  server.registerTool(
    "get_league_transactions",
    {
      title: "Get Transactions for Sleeper Fantasy League",
      description:
        "Fetches a week's trades, waiver claims, free agent pickups and commissioner moves in a Sleeper league, newest first, with team and player names. Includes failed waiver claims (status failed).",
      inputSchema: {
        league_id: ctx.leagueIdInput,
        week: z
          .number()
          .int()
          .min(1)
          .max(18)
          .optional()
          .describe("The week to fetch. Defaults to the current NFL week."),
        type: z
          .enum(TRANSACTION_TYPES)
          .optional()
          .describe("Only return transactions of this type."),
      },
      outputSchema: {
        week: z.number(),
        transactions: z.array(
          z.object({
            type: z.string(),
            status: z
              .string()
              .describe(
                "complete, failed (e.g. a waiver claim that lost to another team) or pending",
              ),
            created: z.string().describe("ISO 8601 time"),
            teams: z.array(
              z.object({
                team: teamSchema,
                adds: z.array(z.string()).optional().describe("Player names"),
                drops: z.array(z.string()).optional().describe("Player names"),
              }),
            ),
            waiver_bid: z
              .number()
              .optional()
              .describe("FAAB bid, on waiver claims"),
            draft_picks: z
              .array(
                z.object({
                  season: z.string(),
                  round: z.number(),
                  original_team: teamSchema,
                  from_team: teamSchema,
                  to_team: teamSchema,
                }),
              )
              .optional()
              .describe("Draft picks traded"),
            faab: z
              .array(
                z.object({
                  from_team: teamSchema,
                  to_team: teamSchema,
                  amount: z.number(),
                }),
              )
              .optional()
              .describe("FAAB traded"),
            notes: z.string().optional(),
          }),
        ),
      },
    },
    async (args) => {
      const league_id = ctx.resolveLeagueId(args.league_id);
      const week = await ctx.resolveWeek(args.week);
      const [transactions, users, rosters, players]: [
        Transaction[],
        User[],
        Roster[],
        PlayerDirectory | undefined,
      ] = await Promise.all([
        ctx.callLeagueApi(league_id, `transactions/${week}`),
        ctx.callLeagueApi(league_id, "users"),
        ctx.callLeagueApi(league_id, "rosters"),
        ctx.tryGetPlayers(),
      ]);

      const result = {
        week,
        transactions: summarizeTransactions(
          transactions,
          teamNamesByRoster(users, rosters),
          players?.idToName ?? new Map(),
          args.type,
        ),
      };
      return jsonResult(result);
    },
  );
}
