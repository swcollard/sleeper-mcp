import type { NflState, Roster, Transaction, User } from "./sleeper.js";

export const TRANSACTION_TYPES = [
  "trade",
  "waiver",
  "free_agent",
  "commissioner",
] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export type TransactionSummary = {
  type: string;
  /** "complete", "failed" (e.g. a waiver claim that lost) or "pending" */
  status: string;
  /** ISO 8601 */
  created: string;
  /** Every team involved, with the players it added and dropped */
  teams: { team: string; adds?: string[]; drops?: string[] }[];
  /** FAAB bid, on waiver claims */
  waiver_bid?: number;
  /** Draft picks that changed hands in a trade */
  draft_picks?: {
    season: string;
    round: number;
    original_team: string;
    from_team: string;
    to_team: string;
  }[];
  /** FAAB that changed hands in a trade */
  faab?: { from_team: string; to_team: string; amount: number }[];
  /** Sleeper's note, e.g. why a waiver claim failed */
  notes?: string;
};

/**
 * The week week-based tools default to. Sleeper's state week is 0 in the
 * preseason, and fantasy weeks end at 18, so it's clamped to 1–18.
 */
export function defaultWeek(state: NflState): number {
  return Math.min(18, Math.max(1, state.week || 1));
}

/**
 * Maps roster ids to team names: the owner's team name, else their display
 * name, else "Team {roster_id}" (e.g. for orphaned teams).
 */
export function teamNamesByRoster(
  users: User[],
  rosters: Roster[],
): Map<number, string> {
  const usersById = new Map(users.map((u) => [u.user_id, u]));
  return new Map(
    rosters.map((r) => {
      const user = r.owner_id ? usersById.get(r.owner_id) : undefined;
      return [
        r.roster_id,
        user?.metadata?.team_name ||
          user?.display_name ||
          `Team ${r.roster_id}`,
      ];
    }),
  );
}

/**
 * Turns raw Sleeper transactions into summaries with team and player names
 * (falling back to "Team {id}" and the player id), newest first, optionally
 * keeping only one type.
 */
export function summarizeTransactions(
  transactions: Transaction[],
  teamNames: ReadonlyMap<number, string>,
  playerNames: ReadonlyMap<string, string>,
  type?: TransactionType,
): TransactionSummary[] {
  const team = (roster_id: number) =>
    teamNames.get(roster_id) ?? `Team ${roster_id}`;
  const player = (player_id: string) => playerNames.get(player_id) ?? player_id;

  return transactions
    .filter((t) => !type || t.type === type)
    .sort((a, b) => b.created - a.created)
    .map((t) => {
      // Group adds and drops by team, starting with the teams Sleeper lists
      const moves = new Map<number, { adds: string[]; drops: string[] }>();
      const movesOf = (roster_id: number) => {
        let entry = moves.get(roster_id);
        if (!entry) {
          entry = { adds: [], drops: [] };
          moves.set(roster_id, entry);
        }
        return entry;
      };
      for (const roster_id of t.roster_ids ?? []) movesOf(roster_id);
      for (const [id, roster_id] of Object.entries(t.adds ?? {})) {
        movesOf(roster_id).adds.push(player(id));
      }
      for (const [id, roster_id] of Object.entries(t.drops ?? {})) {
        movesOf(roster_id).drops.push(player(id));
      }

      const summary: TransactionSummary = {
        type: t.type,
        status: t.status,
        created: new Date(t.created).toISOString(),
        teams: [...moves].map(([roster_id, { adds, drops }]) => ({
          team: team(roster_id),
          ...(adds.length > 0 && { adds }),
          ...(drops.length > 0 && { drops }),
        })),
      };
      const bid = t.settings?.waiver_bid;
      if (t.type === "waiver" && typeof bid === "number") {
        summary.waiver_bid = bid;
      }
      if (t.draft_picks?.length) {
        summary.draft_picks = t.draft_picks.map((p) => ({
          season: p.season,
          round: p.round,
          original_team: team(p.roster_id),
          from_team: team(p.previous_owner_id),
          to_team: team(p.owner_id),
        }));
      }
      if (t.waiver_budget?.length) {
        summary.faab = t.waiver_budget.map((w) => ({
          from_team: team(w.sender),
          to_team: team(w.receiver),
          amount: w.amount,
        }));
      }
      if (t.metadata?.notes) summary.notes = t.metadata.notes;
      return summary;
    });
}
