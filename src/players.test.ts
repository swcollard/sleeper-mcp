import { describe, expect, it, vi } from "vitest";
import { buildPlayerDirectory, fetchPlayers } from "./players.js";

describe("buildPlayerDirectory", () => {
  it("maps ids to full names and back", () => {
    const { idToName, nameToId } = buildPlayerDirectory({
      "4046": { full_name: "Patrick Mahomes" },
    });

    expect(idToName.get("4046")).toBe("Patrick Mahomes");
    expect(nameToId.get("Patrick Mahomes")).toBe("4046");
  });

  it("names team defenses, which have no full_name, from first + last name", () => {
    const { idToName, nameToId } = buildPlayerDirectory({
      KC: { first_name: "Kansas City", last_name: "Chiefs" },
    });

    expect(idToName.get("KC")).toBe("Kansas City Chiefs");
    expect(nameToId.get("Kansas City Chiefs")).toBe("KC");
  });

  it("skips records with no name", () => {
    const { idToName, nameToId } = buildPlayerDirectory({ X: {} });

    expect(idToName.size).toBe(0);
    expect(nameToId.size).toBe(0);
  });
});

describe("fetchPlayers", () => {
  it("throws on a non-2xx response", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response("", { status: 503, statusText: "Service Unavailable" }),
    );

    await expect(fetchPlayers(fetchFn)).rejects.toThrow(
      "Failed to fetch NFL data: 503 Service Unavailable",
    );
  });
});
