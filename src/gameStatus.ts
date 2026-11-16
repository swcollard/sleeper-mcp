import type { PlayerInfo } from "./players.js";
import type { ScheduleGame } from "./sleeper.js";

/**
 * Why a player has the points they have, as far as the schedule and the
 * player's status can tell. It exists because Sleeper reports 0 points for all of these:
 *
 * - `bye`: the player's team doesn't play this week
 * - `not_started`: the game hasn't kicked off
 * - `in_progress`: the game is on, so points can still change
 * - `final`: the game is over, so points are final (a 0 is real)
 * - `out`: ruled out by injury, so a 0 is expected
 * - `inactive`: not on an NFL team, or on IR, the practice squad, suspended...
 */
export const GAME_STATES = [
  "bye",
  "not_started",
  "in_progress",
  "final",
  "out",
  "inactive",
] as const;

export type GameState = (typeof GAME_STATES)[number];

export type GameStatus = {
  status: GameState;
  /** ISO 8601 kickoff; only for games that aren't over, when it's known */
  kickoff?: string;
};

type GameProgress = "not_started" | "in_progress" | "final" | "unknown";

export type ScheduledGame = {
  progress: GameProgress;
  /** ms since the epoch */
  kickoff: number | null;
};

/** The season's games, indexed for lookup by week and team. */
export type Schedule = {
  /** Weeks that have at least one game */
  weeks: ReadonlySet<number>;
  /** Teams that play at least once */
  teams: ReadonlySet<string>;
  game(week: number, team: string): ScheduledGame | undefined;
};

/** Sleeper's player and schedule data don't always agree on these. */
const TEAM_ALIASES: Record<string, string> = {
  JAC: "JAX",
  WSH: "WAS",
  LA: "LAR",
};

function normalizeTeam(team: string): string {
  const upper = team.trim().toUpperCase();
  return TEAM_ALIASES[upper] ?? upper;
}

function progressOf(status: unknown): GameProgress {
  if (typeof status !== "string") return "unknown";
  switch (
    status
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_")
  ) {
    case "complete":
    case "completed":
    case "final":
    case "post_game":
      return "final";
    case "in_game":
    case "in_progress":
    case "inprogress":
    case "live":
      return "in_progress";
    case "pre_game":
    case "pregame":
    case "not_started":
    case "scheduled":
      return "not_started";
    default:
      return "unknown";
  }
}

function kickoffOf(start: unknown): number | null {
  let ms: number;
  if (typeof start === "number") {
    // Epoch seconds are below 1e12 until the year 33658
    ms = start < 1e12 ? start * 1000 : start;
  } else if (typeof start === "string") {
    ms = Date.parse(start);
  } else {
    return null;
  }
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Indexes Sleeper's schedule response. Games that lack a week or both teams
 * are skipped, and undefined means nothing usable was found (not an array,
 * or no valid games), so callers can treat the schedule as unavailable.
 */
export function parseSchedule(raw: unknown): Schedule | undefined {
  if (!Array.isArray(raw)) return undefined;

  const weeks = new Set<number>();
  const teams = new Set<string>();
  const games = new Map<string, ScheduledGame>();
  for (const item of raw as (ScheduleGame | null)[]) {
    if (
      !item ||
      !Number.isInteger(item.week) ||
      typeof item.home !== "string" ||
      typeof item.away !== "string" ||
      !item.home ||
      !item.away
    ) {
      continue;
    }
    const week = item.week as number;
    const game: ScheduledGame = {
      progress: progressOf(item.status),
      kickoff: kickoffOf(item.start_time),
    };
    weeks.add(week);
    for (const team of [item.home, item.away].map(normalizeTeam)) {
      teams.add(team);
      games.set(`${week}:${team}`, game);
    }
  }
  if (weeks.size === 0) return undefined;

  return {
    weeks,
    teams,
    game: (week, team) => games.get(`${week}:${normalizeTeam(team)}`),
  };
}

/** The player fields gameStatusFor reads. */
export type StatusPlayer = Pick<
  PlayerInfo,
  "player_id" | "position" | "team" | "status" | "injury_status"
>;

function resolveProgress(game: ScheduledGame, now: number): GameProgress {
  if (game.progress !== "unknown") return game.progress;
  // Sleeper gave no status we know: a kickoff still ahead is the one thing
  // we can be sure of
  return game.kickoff !== null && game.kickoff > now
    ? "not_started"
    : "unknown";
}

/**
 * The game status of a player for a week, or undefined when it can't be told:
 * an unknown player, a week or team the schedule doesn't cover, or a game
 * whose progress is unclear. Never guesses a bye for a team the schedule
 * doesn't know, so a team abbreviation mismatch can't mark a whole team out.
 *
 * Final games win over the player's current injury or roster status, which
 * describes now, not the week asked about.
 */
export function gameStatusFor(
  player: StatusPlayer | undefined,
  week: number,
  schedule: Schedule | undefined,
  now: number,
): GameStatus | undefined {
  if (!player || !schedule || !schedule.weeks.has(week)) return undefined;

  // A team defense's id is its team abbreviation
  const team =
    player.team || (player.position === "DEF" ? player.player_id : null);
  if (!team) return { status: "inactive" };
  if (!schedule.teams.has(normalizeTeam(team))) return undefined;

  const game = schedule.game(week, team);
  if (!game) return { status: "bye" };

  const progress = resolveProgress(game, now);
  if (progress === "final") return { status: "final" };

  const kickoff =
    game.kickoff === null
      ? {}
      : { kickoff: new Date(game.kickoff).toISOString() };
  if (player.status && player.status !== "Active") {
    return { status: "inactive" };
  }
  if (player.injury_status === "Out") return { status: "out", ...kickoff };
  if (progress === "unknown") return undefined;
  return { status: progress, ...kickoff };
}
