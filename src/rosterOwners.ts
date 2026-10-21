import type { Roster, User } from "./sleeper.js";

/** Who a roster belongs to, as shown in Sleeper. */
export type RosterOwner = {
  /** The owner's display name; "" for an orphaned team or unknown owner. */
  owner_name: string;
  /** The owner's team name; "" if they haven't set one. */
  team_name: string;
};

/**
 * Joins a league's rosters to their owners, keyed by roster_id. Rosters with
 * no owner (orphaned), or whose owner isn't in the user list, get blank names;
 * roster ids not in the list aren't in the map.
 */
export function buildRosterOwners(
  users: User[],
  rosters: Roster[],
): Map<number, RosterOwner> {
  const usersById = new Map(users.map((u) => [u.user_id, u]));
  const owners = new Map<number, RosterOwner>();
  for (const r of rosters) {
    const user = r.owner_id ? usersById.get(r.owner_id) : undefined;
    owners.set(r.roster_id, {
      owner_name: user?.display_name || "",
      team_name: user?.metadata?.team_name || "",
    });
  }
  return owners;
}

/**
 * Maps roster ids to team names: the owner's team name, else their display
 * name, else "Team {roster_id}" (e.g. for orphaned teams).
 */
export function teamNamesByRoster(
  users: User[],
  rosters: Roster[],
): Map<number, string> {
  return new Map(
    [...buildRosterOwners(users, rosters)].map(([roster_id, owner]) => [
      roster_id,
      owner.team_name || owner.owner_name || `Team ${roster_id}`,
    ]),
  );
}
