import { describe, it, expect } from "vitest";
import { getSystemVisibility, pickLabelPosition } from "@/utils/starMapUtils";

function makeRef(id: string, connections: string[] = []) {
  return { id, connections: connections.map((t) => ({ toSystemId: t })) };
}

describe("getSystemVisibility — transitions", () => {
  it("returns 'unknown' when system not visited and no visited neighbour", () => {
    const systems = [makeRef("A"), makeRef("B", ["A"])];
    expect(getSystemVisibility("A", [], systems)).toBe("unknown");
  });

  it("returns 'visited' immediately after warp (system in visitedSystems)", () => {
    const systems = [makeRef("A"), makeRef("B")];
    expect(getSystemVisibility("A", ["A"], systems)).toBe("visited");
  });

  it("returns 'neighbor' when a visited system has an outgoing connection to it", () => {
    const systems = [makeRef("A", ["B"]), makeRef("B")];
    expect(getSystemVisibility("B", ["A"], systems)).toBe("neighbor");
  });

  it("returns 'neighbor' when the system itself connects to a visited system", () => {
    const systems = [makeRef("A"), makeRef("B", ["A"])];
    expect(getSystemVisibility("B", ["A"], systems)).toBe("neighbor");
  });

  it("2-hop system is 'unknown' when only the 1-hop current is in visitedSystems (migration scenario)", () => {
    const systems = [
      makeRef("A", ["B"]),
      makeRef("B", ["A", "C"]),
      makeRef("C", ["B"]),
    ];
    expect(getSystemVisibility("A", ["C"], systems)).toBe("unknown");
    expect(getSystemVisibility("A", ["A", "B", "C"], systems)).toBe("visited");
  });
});

const positions = [
  { x: 12, y: -6 }, // right
  { x: -72, y: -6 }, // left
  { x: -30, y: -24 }, // above
  { x: -30, y: 12 }, // below
];
const LABEL_W = 60;
const LABEL_H = 12;
const STAR_POSITIONS: { x: number; y: number; r: number }[] = [];
const WARP_LINES: { x1: number; y1: number; x2: number; y2: number }[] = [];

describe("pickLabelPosition — label placement fallback", () => {
  it("returns a position when all slots are clear", () => {
    const pos = pickLabelPosition(
      positions,
      [],
      STAR_POSITIONS,
      WARP_LINES,
      LABEL_W,
      LABEL_H,
    );
    expect(pos).not.toBeNull();
    expect(pos).toEqual(positions[0]); // right-of-star wins when clear
  });

  it("skips a position when it overlaps an already-placed label", () => {
    const blocked = [{ x: 12, y: -6, w: LABEL_W, h: LABEL_H }];
    const pos = pickLabelPosition(
      positions,
      blocked,
      STAR_POSITIONS,
      WARP_LINES,
      LABEL_W,
      LABEL_H,
    );
    expect(pos).toEqual(positions[1]); // left
  });

  it("falls back to positions[0] when all four positions are blocked — prevents unlabelled dots (regression)", () => {
    const blockAll = [{ x: -200, y: -200, w: 1000, h: 1000 }];
    const pos = pickLabelPosition(
      positions,
      blockAll,
      STAR_POSITIONS,
      WARP_LINES,
      LABEL_W,
      LABEL_H,
    );
    expect(pos).not.toBeNull();
    expect(pos).toEqual(positions[0]);
  });
});
