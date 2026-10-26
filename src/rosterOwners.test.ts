import { describe, expect, it } from "vitest";
import { teamNamesByRoster } from "./rosterOwners.js";
import type { Roster, User } from "./sleeper.js";

const users: User[] = [
  {
    user_id: "u1",
    username: "alice",
    display_name: "Alice",
    metadata: { team_name: "Alice's Aces" },
  },
  { user_id: "u2", username: "bob", display_name: "Bob" },
];

const roster = (roster_id: number, owner_id: string | null): Roster => ({
  roster_id,
  owner_id,
  players: [],
  starters: [],
  league_id: "L1",
  settings: {
    wins: 0,
    losses: 0,
    ties: 0,
    total_moves: 0,
    waiver_position: 0,
    waiver_budget_used: 0,
  },
});

describe("teamNamesByRoster", () => {
  it("prefers the team name, then the display name, then the roster id", () => {
    expect(
      teamNamesByRoster(users, [
        roster(1, "u1"),
        roster(2, "u2"),
        roster(3, null),
        roster(4, "u3"),
      ]),
    ).toEqual(
      new Map([
        [1, "Alice's Aces"],
        [2, "Bob"],
        [3, "Team 3"],
        [4, "Team 4"],
      ]),
    );
  });
});
