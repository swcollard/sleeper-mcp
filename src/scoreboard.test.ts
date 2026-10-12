import { describe, expect, it } from "vitest";
import {
  buildScoreboard,
  type MatchupEntry,
  type Roster,
  type User,
} from "./scoreboard.js";

const users: User[] = [
  {
    user_id: "u1",
    username: "alice",
    display_name: "Alice",
    metadata: { team_name: "Alice's Aces" },
  },
  {
    user_id: "u2",
    username: "bob",
    display_name: "Bob",
    metadata: { team_name: "Bob's Bruisers" },
  },
];

const roster = (roster_id: number, owner_id: string): Roster => ({
  roster_id,
  owner_id,
  players: [],
  starters: [],
  league_id: "L1",
  settings: {
    fpts: 0,
    fpts_decimal: 0,
    fpts_against: 0,
    fpts_against_decimal: 0,
    wins: 0,
    losses: 0,
    ties: 0,
    total_moves: 0,
    waiver_position: 0,
    waiver_budget_used: 0,
  },
});

const rosters: Roster[] = [roster(1, "u1"), roster(2, "u2"), roster(3, "u3")];

const playerNames = new Map([
  ["p1", "Patrick Mahomes"],
  ["p2", "Travis Kelce"],
  ["p3", "Josh Allen"],
]);

const entry = (overrides: Partial<MatchupEntry>): MatchupEntry => ({
  roster_id: 1,
  matchup_id: 1,
  starters: [],
  players: [],
  points: 0,
  players_points: {},
  ...overrides,
});

describe("buildScoreboard", () => {
  it("groups entries that share a matchup_id and tags them with the week", () => {
    const result = buildScoreboard(
      users,
      rosters,
      [
        entry({ roster_id: 1, matchup_id: 1 }),
        entry({ roster_id: 2, matchup_id: 1 }),
        entry({ roster_id: 3, matchup_id: 2 }),
      ],
      playerNames,
      7,
    );

    expect(result).toHaveLength(2);
    expect(result.map((m) => m.matchup_id)).toEqual([1, 2]);
    expect(result.every((m) => m.week === 7)).toBe(true);
    expect(result[0]?.entries).toHaveLength(2);
    expect(result[1]?.entries).toHaveLength(1);
  });

  it("joins each entry to its roster owner's display name and team name", () => {
    const [matchup] = buildScoreboard(
      users,
      rosters,
      [
        entry({ roster_id: 1, matchup_id: 1 }),
        entry({ roster_id: 2, matchup_id: 1 }),
      ],
      playerNames,
      1,
    );

    expect(matchup?.entries.map((e) => [e.user_name, e.team_name])).toEqual([
      ["Alice", "Alice's Aces"],
      ["Bob", "Bob's Bruisers"],
    ]);
  });

  it("leaves names blank when the roster or owner can't be resolved", () => {
    const [matchup] = buildScoreboard(
      users,
      rosters,
      [
        // roster 3 is owned by u3, who isn't in the league's user list
        entry({ roster_id: 3, matchup_id: 1 }),
        // roster 99 doesn't exist at all
        entry({ roster_id: 99, matchup_id: 1 }),
      ],
      playerNames,
      1,
    );

    for (const e of matchup?.entries ?? []) {
      expect(e.user_name).toBe("");
      expect(e.team_name).toBe("");
    }
  });

  it("replaces player ids with names, falling back to the id when unknown", () => {
    const [matchup] = buildScoreboard(
      users,
      rosters,
      [
        entry({
          starters: ["p1", "unknown"],
          players: ["p1", "p2", "unknown"],
          players_points: { p1: 20.5, p2: 3, unknown: 1 },
        }),
      ],
      playerNames,
      1,
    );

    const e = matchup!.entries[0]!;
    expect(e.starters).toEqual(["Patrick Mahomes", "unknown"]);
    expect(e.players).toEqual(["Patrick Mahomes", "Travis Kelce", "unknown"]);
    expect(e.players_points).toEqual({
      "Patrick Mahomes": 20.5,
      "Travis Kelce": 3,
      unknown: 1,
    });
  });

  it("only includes starters in starters_points, leaving bench players out", () => {
    const [matchup] = buildScoreboard(
      users,
      rosters,
      [
        entry({
          points: 23.5,
          starters: ["p1", "p2"],
          players: ["p1", "p2", "p3"],
          players_points: { p1: 20.5, p2: 3, p3: 15 },
        }),
      ],
      playerNames,
      1,
    );

    const e = matchup!.entries[0]!;
    expect(e.starters_points).toEqual({
      "Patrick Mahomes": 20.5,
      "Travis Kelce": 3,
    });
    expect(e.players_points).toHaveProperty("Josh Allen", 15);
    expect(e.total_points).toBe(23.5);
  });

  it("tolerates users with no metadata or no team_name", () => {
    const sparseUsers: User[] = [
      { user_id: "u1", username: "alice", display_name: "Alice" },
      {
        user_id: "u2",
        username: "bob",
        display_name: "Bob",
        metadata: {},
      },
    ];

    const [matchup] = buildScoreboard(
      sparseUsers,
      rosters,
      [
        entry({ roster_id: 1, matchup_id: 1 }),
        entry({ roster_id: 2, matchup_id: 1 }),
      ],
      playerNames,
      1,
    );

    expect(matchup?.entries.map((e) => [e.user_name, e.team_name])).toEqual([
      ["Alice", ""],
      ["Bob", ""],
    ]);
  });

  it("orders matchups by matchup_id regardless of input order", () => {
    const result = buildScoreboard(
      users,
      rosters,
      [
        entry({ roster_id: 1, matchup_id: 10 }),
        entry({ roster_id: 2, matchup_id: 2 }),
        entry({ roster_id: 3, matchup_id: 1 }),
      ],
      playerNames,
      1,
    );

    expect(result.map((m) => m.matchup_id)).toEqual([1, 2, 10]);
  });

  it("groups rosters with a null matchup_id together, last, instead of dropping them", () => {
    const result = buildScoreboard(
      users,
      rosters,
      [
        entry({ roster_id: 1, matchup_id: null, points: 0 }),
        entry({ roster_id: 2, matchup_id: 1 }),
        entry({ roster_id: 3, matchup_id: null, points: 0 }),
      ],
      playerNames,
      15,
    );

    expect(result.map((m) => m.matchup_id)).toEqual([1, null]);
    const noOpponent = result[1]!;
    expect(noOpponent.week).toBe(15);
    expect(noOpponent.entries.map((e) => e.user_name)).toEqual(["Alice", ""]);
    expect(noOpponent.entries.every((e) => e.matchup_id === null)).toBe(true);
  });

  it("returns an empty scoreboard when there are no matchup entries", () => {
    expect(buildScoreboard(users, rosters, [], playerNames, 1)).toEqual([]);
  });
});
