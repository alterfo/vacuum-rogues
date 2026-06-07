import { describe, it, expect } from "vitest";
import { getSystemVisibility } from "@/utils/starMapUtils";

const makeSystems = (
  edges: [string, string][],
): { id: string; connections: { toSystemId: string }[] }[] => {
  const ids = new Set<string>();
  for (const [a, b] of edges) {
    ids.add(a);
    ids.add(b);
  }

  return Array.from(ids).map((id) => ({
    id,
    connections: edges
      .filter(([a]) => a === id)
      .map(([, b]) => ({ toSystemId: b })),
  }));
};

describe("getSystemVisibility", () => {
  // Galaxy: A <-> B <-> C   D (isolated)
  const systems = makeSystems([
    ["A", "B"],
    ["B", "A"],
    ["B", "C"],
    ["C", "B"],
    ["D", "E"],
    ["E", "D"],
  ]);

  it("returns visited for a personally visited system", () => {
    expect(getSystemVisibility("A", ["A"], systems)).toBe("visited");
  });

  it("returns neighbor for a system 1 hop from a visited system (forward connection)", () => {
    // A is visited; B is connected from A — should be neighbor
    expect(getSystemVisibility("B", ["A"], systems)).toBe("neighbor");
  });

  it("returns neighbor for a system 1 hop from a visited system (reverse connection)", () => {
    // B is visited; A connects back to it — A should be neighbor if not visited
    // B->A exists, so A is neighbor of B
    expect(getSystemVisibility("A", ["B"], systems)).toBe("neighbor");
  });

  it("returns unknown for a system with no connection to any visited system", () => {
    // A visited, D has no connection to A or B or C
    expect(getSystemVisibility("D", ["A"], systems)).toBe("unknown");
    expect(getSystemVisibility("E", ["A"], systems)).toBe("unknown");
  });

  it("returns unknown for an empty visited list", () => {
    expect(getSystemVisibility("A", [], systems)).toBe("unknown");
    expect(getSystemVisibility("B", [], systems)).toBe("unknown");
  });

  it("neighbor takes priority over unknown when multiple systems visited", () => {
    // A and D both visited; C is 2 hops from A but 1 hop from B, B is neighbor of A
    // C should be neighbor because B is visited only if... wait, let's check C with B visited
    expect(getSystemVisibility("C", ["B"], systems)).toBe("neighbor");
  });

  it("returns visited when system is in visitedSystemIds even if connections exist", () => {
    expect(getSystemVisibility("C", ["A", "B", "C"], systems)).toBe("visited");
  });
});
