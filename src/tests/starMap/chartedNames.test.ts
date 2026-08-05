import { describe, it, expect } from "vitest";
import { getSystemVisibility } from "@/utils/starMapUtils";

describe("getSystemVisibility — charted (explored) systems", () => {
  const systems = [
    { id: "A", connections: [{ toSystemId: "B" }] },
    { id: "B", connections: [{ toSystemId: "A" }, { toSystemId: "C" }] },
    { id: "C", connections: [{ toSystemId: "B" }] },
    { id: "D", connections: [] },
  ];

  it("resolves a charted (explored) system to the named 'charted' tier", () => {
    expect(getSystemVisibility("C", [], systems, ["C"])).toBe("charted");
  });

  it("keeps a genuinely uncharted, unvisited, non-adjacent system as '?' (unknown)", () => {
    expect(getSystemVisibility("D", [], systems, [])).toBe("unknown");
    expect(getSystemVisibility("D", [], systems, ["A", "C"])).toBe("unknown");
  });

  it("leaves visited systems unchanged (visited outranks charted)", () => {
    expect(getSystemVisibility("A", ["A"], systems, ["A"])).toBe("visited");
  });

  it("charted outranks neighbor (named) but neighbor still names uncharted", () => {
    expect(getSystemVisibility("B", ["A"], systems, ["B"])).toBe("charted");
    expect(getSystemVisibility("B", ["A"], systems, [])).toBe("neighbor");
  });

  it("defaults to no charted systems when the 4th arg is omitted (back-compat)", () => {
    expect(getSystemVisibility("C", [], systems)).toBe("unknown");
    expect(getSystemVisibility("B", ["A"], systems)).toBe("neighbor");
    expect(getSystemVisibility("A", ["A"], systems)).toBe("visited");
  });
});
