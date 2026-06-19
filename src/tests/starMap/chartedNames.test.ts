import { describe, it, expect } from "vitest";
import { getSystemVisibility } from "@/utils/starMapUtils";

/**
 * Regression: buying a star chart sets `explored = true` so the dot + warp
 * lanes render, but the name used to be gated by visited-only visibility — a
 * charted-but-unvisited system rendered as "?". A charted system must resolve
 * to a named tier so its name shows.
 */
describe("getSystemVisibility — charted (explored) systems", () => {
  // A — B — C linear chain; D is isolated.
  const systems = [
    { id: "A", connections: [{ toSystemId: "B" }] },
    { id: "B", connections: [{ toSystemId: "A" }, { toSystemId: "C" }] },
    { id: "C", connections: [{ toSystemId: "B" }] },
    { id: "D", connections: [] },
  ];

  it("resolves a charted (explored) system to the named 'charted' tier", () => {
    // C is charted (chart purchase) but not visited and not adjacent to a
    // visited system — previously this fell through to "unknown" → "?".
    expect(getSystemVisibility("C", [], systems, ["C"])).toBe("charted");
  });

  it("keeps a genuinely uncharted, unvisited, non-adjacent system as '?' (unknown)", () => {
    expect(getSystemVisibility("D", [], systems, [])).toBe("unknown");
    // Still unknown even when other systems are charted, as long as D is not.
    expect(getSystemVisibility("D", [], systems, ["A", "C"])).toBe("unknown");
  });

  it("leaves visited systems unchanged (visited outranks charted)", () => {
    expect(getSystemVisibility("A", ["A"], systems, ["A"])).toBe("visited");
  });

  it("charted outranks neighbor (named) but neighbor still names uncharted", () => {
    // B is a neighbor of visited A and is also charted → still named tier.
    expect(getSystemVisibility("B", ["A"], systems, ["B"])).toBe("charted");
    // B is a neighbor of visited A but NOT charted → neighbor (still named).
    expect(getSystemVisibility("B", ["A"], systems, [])).toBe("neighbor");
  });

  it("defaults to no charted systems when the 4th arg is omitted (back-compat)", () => {
    expect(getSystemVisibility("C", [], systems)).toBe("unknown");
    expect(getSystemVisibility("B", ["A"], systems)).toBe("neighbor");
    expect(getSystemVisibility("A", ["A"], systems)).toBe("visited");
  });
});
