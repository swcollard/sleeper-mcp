import { buildRosterOwners } from "./rosterOwners.js";
import {
  EMPTY_SLOT,
  type MatchupEntry,
  type Roster,
  type User,
} from "./sleeper.js";

export type { MatchupEntry, Roster, User };

export type Matchup = {
  matchup_id: number | null;
  week: number;
  entries: ScoreBoardEntry[];
};

export type ScoreBoardEntry = {
  user_name: string;
  team_name: string;
  starters: string[];
  players: string[];
  total_points: number;
  /** Keyed by player name */
  players_points: Record<string, number>;
  starters_points: Record<string, number>;
  matchup_id: number | null;
};

/**
 * Combines raw Sleeper users, rosters and matchup entries into a scoreboard:
 * entries are grouped by matchup_id, joined to their owner's name/team, and
 * player ids are swapped for player names (falling back to the id if unknown).
 * Matchups are ordered by matchup_id; entries with no matchup_id (null) are
 * collected into a single group at the end.
 */
export function buildScoreboard(
  users: User[],
  rosters: Roster[],
  matchupEntries: MatchupEntry[],
  playerIdToName: ReadonlyMap<string, string>,
  week: number,
): Matchup[] {
  const owners = buildRosterOwners(users, rosters);

  const grouped = new Map<number | null, ScoreBoardEntry[]>();
  for (const e of matchupEntries) {
    let matchupGroup = grouped.get(e.matchup_id);
    if (!matchupGroup) {
      matchupGroup = [];
      grouped.set(e.matchup_id, matchupGroup);
    }
    const owner = owners.get(e.roster_id);
    const starters = (e.starters ?? []).filter((id) => id !== EMPTY_SLOT);
    const players = (e.players ?? []).filter((id) => id !== EMPTY_SLOT);
    const score: ScoreBoardEntry = {
      user_name: owner?.owner_name ?? "",
      team_name: owner?.team_name ?? "",
      starters: starters.map((id) => playerIdToName.get(id) || id),
      players: players.map((id) => playerIdToName.get(id) || id),
      total_points: e.points,
      players_points: Object.fromEntries(
        Object.entries(e.players_points).map(([id, points]) => [
          playerIdToName.get(id) || id,
          points,
        ]),
      ),
      starters_points: Object.fromEntries(
        Object.entries(e.players_points)
          .filter(([id]) => starters.includes(id))
          .map(([id, points]) => [playerIdToName.get(id) || id, points]),
      ),
      matchup_id: e.matchup_id,
    };

    matchupGroup.push(score);
  }

  return [...grouped.entries()]
    .sort(([a], [b]) => (a ?? Infinity) - (b ?? Infinity))
    .map(([matchup_id, entries]) => ({ matchup_id, week, entries }));
}
