import type { PlayerInfo } from "./players.js";
import type { Roster, Transaction } from "./sleeper.js";

/**
 * The player positions each lineup slot accepts. Slots not listed (BN, IR,
 * TAXI) hold any rostered player, so they don't make a position eligible.
 */
const SLOT_POSITIONS: Record<string, readonly string[]> = {
  QB: ["QB"],
  RB: ["RB"],
  WR: ["WR"],
  TE: ["TE"],
  K: ["K"],
  DEF: ["DEF"],
  DL: ["DL"],
  LB: ["LB"],
  DB: ["DB"],
  FLEX: ["RB", "WR", "TE"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
  REC_FLEX: ["WR", "TE"],
  WRRB_FLEX: ["WR", "RB"],
  IDP_FLEX: ["DL", "LB", "DB"],
};

/** Sleeper's search_rank for unranked players. */
const UNRANKED = 9999999;

/** The positions a lineup slot accepts; empty for BN, IR, TAXI and unknown slots. */
export function slotPositions(slot: string): readonly string[] {
  return SLOT_POSITIONS[slot] ?? [];
}

/** Every position that can start in a league with these roster_positions. */
export function leaguePositions(roster_positions: string[]): Set<string> {
  return new Set(roster_positions.flatMap(slotPositions));
}

/** Maps every rostered player id (players, reserve and taxi) to its roster_id. */
export function rosterIdsByPlayer(rosters: Roster[]): Map<string, number> {
  const owners = new Map<string, number>();
  for (const r of rosters) {
    for (const id of [
      ...(r.players ?? []),
      ...(r.reserve ?? []),
      ...(r.taxi ?? []),
    ]) {
      owners.set(id, r.roster_id);
    }
  }
  return owners;
}

/** Player ids dropped in completed transactions, which may be on waivers. */
export function droppedPlayerIds(transactions: Transaction[]): Set<string> {
  return new Set(
    transactions
      .filter((t) => t.status === "complete")
      .flatMap((t) => Object.keys(t.drops ?? {})),
  );
}

export type FreeAgent = {
  name: string;
  position: string | null;
  team: string | null;
  injury_status: string | null;
  /** Sleeper's overall ranking, lower is better; null when unranked */
  search_rank: number | null;
  may_be_on_waivers: boolean;
};

export type FreeAgentOptions = {
  roster_positions: string[];
  rosters: Roster[];
  /** Players dropped recently, see droppedPlayerIds */
  recentlyDropped: ReadonlySet<string>;
  /**
   * Only players at this position, ignoring case. A flex slot like "FLEX"
   * means any of its positions.
   */
  position?: string | undefined;
  limit: number;
};

/**
 * The positions findFreeAgents considers: the league's starting positions,
 * narrowed to the position filter if given.
 */
export function freeAgentPositions(
  roster_positions: string[],
  position?: string,
): Set<string> {
  const eligible = leaguePositions(roster_positions);
  if (position === undefined) return eligible;
  const wanted = position.trim().toUpperCase();
  const filter = SLOT_POSITIONS[wanted] ?? [wanted];
  return new Set(filter.filter((p) => eligible.has(p)));
}

/**
 * Finds the best available players in a league: active players with an NFL
 * team who can start in one of the league's lineup slots and aren't on any
 * roster (including reserve and taxi), best search_rank first.
 */
export function findFreeAgents(
  players: Iterable<PlayerInfo>,
  {
    roster_positions,
    rosters,
    recentlyDropped,
    position,
    limit,
  }: FreeAgentOptions,
): FreeAgent[] {
  const positions = freeAgentPositions(roster_positions, position);
  const rostered = rosterIdsByPlayer(rosters);
  const rank = (p: PlayerInfo) =>
    p.search_rank == null || p.search_rank >= UNRANKED
      ? Infinity
      : p.search_rank;

  return (
    [...players]
      .filter(
        (p) =>
          p.active &&
          p.team &&
          !rostered.has(p.player_id) &&
          p.fantasy_positions.some((fp) => positions.has(fp)),
      )
      // Two unranked players give NaN, which counts as a tie
      .sort((a, b) => rank(a) - rank(b) || 0)
      .slice(0, limit)
      .map((p) => ({
        name: p.name,
        position: p.position,
        team: p.team,
        injury_status: p.injury_status,
        search_rank: rank(p) === Infinity ? null : p.search_rank,
        may_be_on_waivers: recentlyDropped.has(p.player_id),
      }))
  );
}
