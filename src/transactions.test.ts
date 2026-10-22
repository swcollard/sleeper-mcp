import { describe, expect, it } from "vitest";
import { teamNamesByRoster } from "./rosterOwners.js";
import type { Roster, Transaction, User } from "./sleeper.js";
import { summarizeTransactions } from "./transactions.js";

const users: User[] = [
  {
    user_id: "u1",
    username: "alice",
    display_name: "Alice",
    metadata: { team_name: "Alice's Aces" },
  },
  // no team name set
  { user_id: "u2", username: "bob", display_name: "Bob" },
];

const roster = (roster_id: number, owner_id: string | null): Roster => ({
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

const teamNames = teamNamesByRoster(users, [
  roster(1, "u1"),
  roster(2, "u2"),
  roster(3, null),
]);

const playerNames = new Map([
  ["4046", "Patrick Mahomes"],
  ["6794", "Justin Jefferson"],
  ["KC", "Kansas City Chiefs"],
]);

const transaction = (overrides: Partial<Transaction>): Transaction => ({
  transaction_id: "t",
  type: "free_agent",
  status: "complete",
  leg: 3,
  created: Date.UTC(2026, 8, 20, 12),
  status_updated: Date.UTC(2026, 8, 20, 12),
  creator: "u1",
  roster_ids: [1],
  consenter_ids: [1],
  adds: null,
  drops: null,
  draft_picks: [],
  waiver_budget: [],
  settings: null,
  metadata: null,
  ...overrides,
});

describe("summarizeTransactions", () => {
  it("groups a free agent move's adds and drops by team, with names", () => {
    const [summary] = summarizeTransactions(
      [
        transaction({
          adds: { "4046": 1 },
          drops: { KC: 1, "999": 1 },
          settings: { seq: 0 },
        }),
      ],
      teamNames,
      playerNames,
    );

    expect(summary).toEqual({
      type: "free_agent",
      status: "complete",
      created: "2026-09-20T12:00:00.000Z",
      // Unknown players fall back to their id (JS orders numeric keys first)
      teams: [
        {
          team: "Alice's Aces",
          adds: ["Patrick Mahomes"],
          drops: ["999", "Kansas City Chiefs"],
        },
      ],
    });
  });

  it("includes waiver bids and keeps failed claims with Sleeper's note", () => {
    const summaries = summarizeTransactions(
      [
        transaction({
          type: "waiver",
          status: "failed",
          roster_ids: [2],
          adds: { "6794": 2 },
          settings: { waiver_bid: 12, seq: 1 },
          metadata: { notes: "This player was claimed by another owner." },
        }),
        transaction({
          type: "waiver",
          // a $0 bid is still a bid
          settings: { waiver_bid: 0 },
          adds: { "4046": 1 },
        }),
      ],
      teamNames,
      playerNames,
    );

    expect(summaries.map((s) => [s.status, s.waiver_bid, s.notes])).toEqual([
      ["failed", 12, "This player was claimed by another owner."],
      ["complete", 0, undefined],
    ]);
    expect(summaries[0]!.teams).toEqual([
      { team: "Bob", adds: ["Justin Jefferson"] },
    ]);
  });

  it("describes trades, including draft picks and FAAB", () => {
    const [summary] = summarizeTransactions(
      [
        transaction({
          type: "trade",
          roster_ids: [1, 2, 3],
          adds: { "4046": 2, "6794": 1 },
          drops: { "4046": 1, "6794": 2 },
          draft_picks: [
            // Team 3's pick, which Bob held, goes to Alice
            {
              season: "2027",
              round: 2,
              roster_id: 3,
              previous_owner_id: 2,
              owner_id: 1,
            },
          ],
          waiver_budget: [{ sender: 1, receiver: 2, amount: 15 }],
        }),
      ],
      teamNames,
      playerNames,
    );

    expect(summary).toEqual({
      type: "trade",
      status: "complete",
      created: "2026-09-20T12:00:00.000Z",
      teams: [
        {
          team: "Alice's Aces",
          adds: ["Justin Jefferson"],
          drops: ["Patrick Mahomes"],
        },
        { team: "Bob", adds: ["Patrick Mahomes"], drops: ["Justin Jefferson"] },
        // Involved, but only through the pick
        { team: "Team 3" },
      ],
      draft_picks: [
        {
          season: "2027",
          round: 2,
          original_team: "Team 3",
          from_team: "Bob",
          to_team: "Alice's Aces",
        },
      ],
      faab: [{ from_team: "Alice's Aces", to_team: "Bob", amount: 15 }],
    });
  });

  it("sorts newest first and filters by type", () => {
    const transactions = [
      transaction({ transaction_id: "old", created: 1000 }),
      transaction({ transaction_id: "new", type: "waiver", created: 3000 }),
      transaction({
        transaction_id: "mid",
        type: "commissioner",
        created: 2000,
      }),
    ];
    const created = (type?: Transaction["type"]) =>
      summarizeTransactions(transactions, teamNames, playerNames, type).map(
        (s) => [s.type, s.created],
      );

    expect(created()).toEqual([
      ["waiver", "1970-01-01T00:00:03.000Z"],
      ["commissioner", "1970-01-01T00:00:02.000Z"],
      ["free_agent", "1970-01-01T00:00:01.000Z"],
    ]);
    expect(created("commissioner")).toEqual([
      ["commissioner", "1970-01-01T00:00:02.000Z"],
    ]);
  });

  it("names teams it doesn't know by roster id", () => {
    const [summary] = summarizeTransactions(
      [transaction({ roster_ids: [9], adds: { "4046": 9 } })],
      new Map(),
      new Map(),
    );
    expect(summary!.teams).toEqual([{ team: "Team 9", adds: ["4046"] }]);
  });
});
