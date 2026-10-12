export type User = {
  user_id: string;
  username: string;
  display_name: string;
  metadata: {
    team_name: string;
  };
};

export type Roster = {
  roster_id: number;
  owner_id: string; // user_id
  players: string[]; // player IDs
  starters: string[]; // player IDs
  settings: {
    fpts: number;
    fpts_decimal: number;
    fpts_against: number;
    fpts_against_decimal: number;
    wins: number;
    losses: number;
    ties: number;
    total_moves: number;
    waiver_position: number;
    waiver_budget_used: number;
  };
  reserve?: string[];
  league_id: string;
};

export type MatchupEntry = {
  roster_id: number;
  starters: string[];
  players: string[];
  points: number;
  players_points: Record<string, number>; // player id to points score
  matchup_id: number;
};

export type Matchup = {
  matchup_id: number;
  week: number;
  entries: ScoreBoardEntry[];
};

export type ScoreBoardEntry = {
  user_name: string;
  team_name: string;
  starters: string[];
  players: string[];
  total_points: number;
  players_points: Record<string, number>; // player name to points score
  starters_points: Record<string, number>; // starters name to points score
  matchup_id: number;
};

/**
 * Combines raw Sleeper users, rosters and matchup entries into a scoreboard:
 * entries are grouped by matchup_id, joined to their owner's name/team, and
 * player ids are swapped for player names (falling back to the id if unknown).
 */
export function buildScoreboard(
  users: User[],
  rosters: Roster[],
  matchupEntries: MatchupEntry[],
  playerIdToName: ReadonlyMap<string, string>,
  week: number,
): Matchup[] {
  const usersById: Record<string, User> = {};
  for (const u of users) {
    usersById[u.user_id] = u;
  }

  const rostersById: Record<number, Roster> = {};
  for (const r of rosters) {
    rostersById[r.roster_id] = r;
  }

  // Group entries into matchups by matchup_id
  const grouped: Record<number, ScoreBoardEntry[]> = {};
  for (const e of matchupEntries) {
    let matchupGroup = grouped[e.matchup_id];
    if (!matchupGroup) {
      matchupGroup = [];
      grouped[e.matchup_id] = matchupGroup;
    }
    const roster = rostersById[e.roster_id];
    const user = usersById[roster?.owner_id || ""];
    const score: ScoreBoardEntry = {
      user_name: user?.display_name || "",
      team_name: user?.metadata.team_name || "",
      starters: e.starters.map((id) => playerIdToName.get(id) || id),
      players: e.players.map((id) => playerIdToName.get(id) || id),
      total_points: e.points,
      players_points: Object.fromEntries(
        Object.entries(e.players_points).map(([id, points]) => [
          playerIdToName.get(id) || id,
          points,
        ]),
      ),
      starters_points: Object.fromEntries(
        Object.entries(e.players_points)
          .filter(([id, _]) => e.starters.includes(id))
          .map(([id, points]) => [playerIdToName.get(id) || id, points]),
      ),
      matchup_id: e.matchup_id,
    };

    matchupGroup.push(score);
  }

  const matchupList: Matchup[] = [];
  for (const mIdStr of Object.keys(grouped)) {
    const mId = parseInt(mIdStr, 10);
    matchupList.push({
      matchup_id: mId,
      week: week,
      entries: grouped[mId] || [],
    });
  }
  return matchupList;
}
