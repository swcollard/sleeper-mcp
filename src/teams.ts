import type { PlayerInfo } from "./players.js";
import { buildRosterOwners } from "./rosterOwners.js";
import type { Roster, User } from "./sleeper.js";

/** Sleeper's placeholder in `starters` for a lineup slot with no player. */
export const EMPTY_SLOT = "0";

export type TeamPlayer = {
  player_id: string;
  name: string;
  position: string | null;
  team: string | null;
  injury_status: string | null;
};

export type LeagueTeam = {
  roster_id: number;
  owner_name: string;
  team_name: string;
  record: { wins: number; losses: number; ties: number };
  points_for: number;
  points_against: number;
  /** In lineup slot order; null for an empty slot. */
  starters: (TeamPlayer | null)[];
  bench: TeamPlayer[];
  reserve: TeamPlayer[];
  taxi: TeamPlayer[];
};

/**
 * Sleeper splits points into a whole part and hundredths. A new league's
 * rosters can lack the fields, so they default to 0.
 */
function points(whole: number | undefined, hundredths: number | undefined) {
  // Rounded so float error doesn't leak out (120 + 0.34 isn't always 120.34)
  return Math.round((whole ?? 0) * 100 + (hundredths ?? 0)) / 100;
}

/**
 * Combines a league's users and rosters into teams: each roster joined to its
 * owner's name and team name, with its record, points, and players split into
 * starters, bench, reserve (IR) and taxi. Player ids are swapped for player
 * details, falling back to the id as the name if unknown. Bench is everyone
 * on the roster who isn't in one of the other groups. Teams are ordered by
 * roster_id.
 */
export function buildLeagueTeams(
  users: User[],
  rosters: Roster[],
  players: ReadonlyMap<string, PlayerInfo>,
): LeagueTeam[] {
  const owners = buildRosterOwners(users, rosters);

  const toPlayer = (player_id: string): TeamPlayer => {
    const p = players.get(player_id);
    return {
      player_id,
      name: p?.name ?? player_id,
      position: p?.position ?? null,
      team: p?.team ?? null,
      injury_status: p?.injury_status ?? null,
    };
  };

  return rosters
    .toSorted((a, b) => a.roster_id - b.roster_id)
    .map((r) => {
      // All of these are null before the draft
      const starters = r.starters ?? [];
      const reserve = r.reserve ?? [];
      const taxi = r.taxi ?? [];
      const placed = new Set([...starters, ...reserve, ...taxi]);
      const owner = owners.get(r.roster_id);
      const s = r.settings;
      return {
        roster_id: r.roster_id,
        owner_name: owner?.owner_name ?? "",
        team_name: owner?.team_name ?? "",
        record: { wins: s.wins, losses: s.losses, ties: s.ties },
        points_for: points(s.fpts, s.fpts_decimal),
        points_against: points(s.fpts_against, s.fpts_against_decimal),
        starters: starters.map((id) =>
          id === EMPTY_SLOT ? null : toPlayer(id),
        ),
        bench: (r.players ?? [])
          .filter((id) => id !== EMPTY_SLOT && !placed.has(id))
          .map(toPlayer),
        reserve: reserve.map(toPlayer),
        taxi: taxi.map(toPlayer),
      };
    });
}
