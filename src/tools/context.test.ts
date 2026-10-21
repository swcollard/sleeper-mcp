import { describe, expect, it } from "vitest";
import type { NflState } from "../sleeper.js";
import { defaultWeek } from "./context.js";

describe("defaultWeek", () => {
  const state = (week: number) => ({ week }) as NflState;

  it("uses the state's week, kept within 1–18", () => {
    expect(defaultWeek(state(5))).toBe(5);
    // Sleeper reports week 0 in the preseason
    expect(defaultWeek(state(0))).toBe(1);
    expect(defaultWeek(state(19))).toBe(18);
  });
});
