import { z } from "zod";
import type { PlayerDirectory } from "../players.js";
import { SLEEPER_API, type NflState } from "../sleeper.js";

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

/** What every tool module gets; see createMcpServer. */
export type ToolContext = {
  /** Cached JSON GET helper, see createApiClient. */
  callApi: (url: string) => Promise<any>;
  /** Resolves player lookups; may load them lazily. */
  getPlayers: () => Promise<PlayerDirectory>;
  /**
   * Fetches a league, or a sub-resource of it like "rosters". Sleeper answers
   * an unknown league id with 200 and a `null` body, so this throws instead.
   */
  callLeagueApi: (league_id: string, path?: string) => Promise<any>;
  /** The current NFL week and season, for tools whose week or season is optional. */
  getNflState: () => Promise<NflState>;
  /**
   * The `league_id` input for league tools. It's optional: when omitted,
   * resolveLeagueId falls back to the default league.
   */
  leagueIdInput: z.ZodOptional<typeof leagueIdSchema>;
  /** Returns the given league id, else the default league, else throws. */
  resolveLeagueId: (league_id: string | undefined) => string;
};

/**
 * Builds the ToolContext. defaultLeagueId comes from the client's
 * `?league_id=` or the server's DEFAULT_LEAGUE_ID, so it is checked like
 * model input; an invalid one makes league tools fail without a league_id.
 */
export function createToolContext({
  callApi,
  getPlayers,
  defaultLeagueId,
}: {
  callApi: ToolContext["callApi"];
  getPlayers: ToolContext["getPlayers"];
  defaultLeagueId?: string | undefined;
}): ToolContext {
  const callLeagueApi = async (league_id: string, path?: string) => {
    const data = await callApi(
      `${SLEEPER_API}/league/${encodeURIComponent(league_id)}${path ? `/${path}` : ""}`,
    );
    if (data == null) {
      throw new Error(`Could not find league ${league_id}`);
    }
    return data;
  };

  const getNflState = (): Promise<NflState> =>
    callApi(`${SLEEPER_API}/state/nfl`);

  const validDefault =
    defaultLeagueId === undefined
      ? undefined
      : leagueIdSchema.safeParse(defaultLeagueId).data;
  if (defaultLeagueId !== undefined && validDefault === undefined) {
    console.error(`Ignoring invalid default league id: ${defaultLeagueId}`);
  }

  const leagueIdInput = leagueIdSchema
    .optional()
    .describe(
      validDefault
        ? `The Sleeper league id. Omit it to use the user's default league (${validDefault}).`
        : "The Sleeper league id. Ask the user for it, or find it from their Sleeper username with find_user_leagues.",
    );

  const resolveLeagueId = (league_id: string | undefined) => {
    const resolved = league_id ?? validDefault;
    if (!resolved) {
      throw new Error(
        defaultLeagueId === undefined
          ? "No league_id given and no default league is configured. Ask the user for it, or find it from their Sleeper username with find_user_leagues."
          : `No league_id given, and the configured default league id "${defaultLeagueId}" is invalid. Ask the user for it, or find it from their Sleeper username with find_user_leagues.`,
      );
    }
    return resolved;
  };

  return {
    callApi,
    getPlayers,
    callLeagueApi,
    getNflState,
    leagueIdInput,
    resolveLeagueId,
  };
}
