import type { League } from "./sleeper.js";

/** A league as find_user_leagues lists it. */
export type LeagueSummary = {
  league_id: string;
  name: string;
  season: string;
  status: string;
  total_rosters: number;
  scoring_type: string;
};

/** A league's settings as get_league returns them. */
export type LeagueDetails = LeagueSummary & {
  roster_positions: string[];
  scoring_settings: Record<string, number>;
  playoff_teams: number | null;
  playoff_week_start: number | null;
  waiver_type: string | null;
  waiver_budget: number | null;
  trade_deadline: number | null;
};

/**
 * Names a league's scoring by its points per reception (`rec`): "ppr" for 1,
 * "half_ppr" for 0.5, "standard" for 0 or unset, and otherwise e.g.
 * "custom (0.25 per reception)". Other bonuses (like TE premium) are ignored.
 */
export function scoringType(scoring_settings: Record<string, number>): string {
  const rec = scoring_settings.rec ?? 0;
  if (rec === 0) return "standard";
  if (rec === 0.5) return "half_ppr";
  if (rec === 1) return "ppr";
  return `custom (${rec} per reception)`;
}

// Sleeper doesn't document settings.waiver_type. This mapping follows what
// open-source Sleeper clients use; unknown values are passed through.
const WAIVER_TYPES: Record<number, string> = {
  0: "rolling",
  1: "reverse_standings",
  2: "faab",
};

/** Names settings.waiver_type, e.g. 2 is "faab"; null when unset. */
export function waiverType(value: number | null | undefined): string | null {
  if (value == null) return null;
  return WAIVER_TYPES[value] ?? `unknown (${value})`;
}

export function summarizeLeague(league: League): LeagueSummary {
  return {
    league_id: league.league_id,
    name: league.name,
    season: league.season,
    status: league.status,
    total_rosters: league.total_rosters,
    scoring_type: scoringType(league.scoring_settings ?? {}),
  };
}

export function leagueDetails(league: League): LeagueDetails {
  const settings = league.settings ?? {};
  return {
    ...summarizeLeague(league),
    roster_positions: league.roster_positions ?? [],
    scoring_settings: league.scoring_settings ?? {},
    playoff_teams: settings.playoff_teams ?? null,
    playoff_week_start: settings.playoff_week_start ?? null,
    waiver_type: waiverType(settings.waiver_type),
    waiver_budget: settings.waiver_budget ?? null,
    trade_deadline: settings.trade_deadline ?? null,
  };
}
