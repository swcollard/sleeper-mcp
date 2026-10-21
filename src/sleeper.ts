// Response types for the documented Sleeper API (https://docs.sleeper.com),
// limited to the fields the tools use. Sleeper answers an unknown id with 200
// and a `null` body rather than a 404.

export const SLEEPER_API = "https://api.sleeper.app/v1";

/** Sleeper's placeholder in `starters` for a lineup slot with no player. */
export const EMPTY_SLOT = "0";

/** GET /state/nfl */
export type NflState = {
  week: number;
  /** "pre", "regular" or "post" */
  season_type: string;
  season_start_date: string;
  season: string;
  previous_season: string;
  leg: number;
  /**
   * The season leagues are being created for. Ahead of `season` in the
   * offseason, so prefer it when listing a user's leagues.
   */
  league_season: string;
  league_create_season: string;
  display_week: number;
  season_has_scores: boolean;
};

/** GET /user/{username or user_id} */
export type SleeperUser = {
  user_id: string;
  username: string;
  display_name: string;
  avatar: string | null;
};

/** GET /league/{league_id}/users */
export type User = {
  user_id: string;
  username: string;
  display_name: string;
  /** Absent, or without team_name, when no team name is set */
  metadata?: {
    team_name?: string;
  };
};

/** GET /league/{league_id}, and each entry of GET /user/{user_id}/leagues/nfl/{season} */
export type League = {
  league_id: string;
  name: string;
  season: string;
  season_type: string;
  status: "pre_draft" | "drafting" | "in_season" | "complete";
  sport: string;
  total_rosters: number;
  /** Lineup slots, e.g. ["QB", "RB", "RB", "WR", "FLEX", "BN", "IR"] */
  roster_positions: string[];
  /** Points per stat, e.g. { rec: 1 } for PPR */
  scoring_settings: Record<string, number>;
  settings: Record<string, number | null>;
  draft_id: string | null;
  previous_league_id: string | null;
  avatar: string | null;
};

/** GET /league/{league_id}/rosters */
export type Roster = {
  roster_id: number;
  /** A user_id; null for orphaned teams */
  owner_id: string | null;
  /** Player ids; null before the draft */
  players: string[] | null;
  starters: string[] | null;
  /**
   * Points are split into a whole part and hundredths (fpts + fpts_decimal /
   * 100), and left out until the roster scores.
   */
  settings: {
    fpts?: number;
    fpts_decimal?: number;
    fpts_against?: number;
    fpts_against_decimal?: number;
    wins: number;
    losses: number;
    ties: number;
    total_moves: number;
    waiver_position: number;
    waiver_budget_used: number;
  };
  /** Player ids on IR */
  reserve?: string[] | null;
  /** Player ids on the taxi squad (dynasty) */
  taxi?: string[] | null;
  league_id: string;
};

/** GET /league/{league_id}/matchups/{week} */
export type MatchupEntry = {
  roster_id: number;
  /** Player ids; null before the draft */
  starters: string[] | null;
  players: string[] | null;
  points: number;
  /** Keyed by player id */
  players_points: Record<string, number>;
  /** Null when the roster has no opponent this week (e.g. eliminated in playoffs) */
  matchup_id: number | null;
};

/** A draft pick that changed hands, in a trade or GET /league/{league_id}/traded_picks */
export type DraftPick = {
  season: string;
  round: number;
  /** The roster the pick originally belonged to */
  roster_id: number;
  /** A roster_id, as is owner_id */
  previous_owner_id: number;
  owner_id: number;
};

/** GET /league/{league_id}/transactions/{round}, where round is the week */
export type Transaction = {
  transaction_id: string;
  type: "trade" | "free_agent" | "waiver" | "commissioner";
  status: "complete" | "failed" | "pending";
  /** The week the transaction happened in */
  leg: number;
  /** Milliseconds since the epoch */
  created: number;
  status_updated: number;
  /** A user_id */
  creator: string;
  roster_ids: number[];
  consenter_ids: number[] | null;
  /** Player id to the roster_id that added it */
  adds: Record<string, number> | null;
  /** Player id to the roster_id that dropped it */
  drops: Record<string, number> | null;
  draft_picks: DraftPick[];
  /** FAAB moved in a trade */
  waiver_budget: { sender: number; receiver: number; amount: number }[];
  /** waiver_bid is the FAAB bid on a waiver claim */
  settings: { waiver_bid?: number; seq?: number } | null;
  metadata: { notes?: string } | null;
};

/** GET /players/nfl/trending/{add|drop} */
export type TrendingPlayer = {
  player_id: string;
  /** Number of adds (or drops) over the lookback window */
  count: number;
};
