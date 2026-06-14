/**
 * Task 2 regression — unnamed systems on galaxy map after warp.
 *
 * Two bugs addressed here:
 *
 * 1. Label-placement fallback: when all 4 smart positions are blocked (by
 *    warp lines, nearby stars, or previously-placed labels), `pickLabelPosition`
 *    must fall back to the first position rather than returning null — which
 *    would leave the system as an unlabelled dot.
 *
 * 2. Migration gap: loading a save that pre-dates visitedSystems tracking
 *    (visitedSystems === []) used to seed only the current system. Systems
 *    the player had visited but that are 2+ hops from the current system
 *    were therefore rendered as "unknown" (?). The fix widens the seed to
 *    all explored systems.
 */
import { describe, it, expect } from "vitest";
import { getSystemVisibility, pickLabelPosition } from "@/utils/starMapUtils";

// ── getSystemVisibility transitions ─────────────────────────────────────────

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
    // A (visited) → B
    const systems = [makeRef("A", ["B"]), makeRef("B")];
    expect(getSystemVisibility("B", ["A"], systems)).toBe("neighbor");
  });

  it("returns 'neighbor' when the system itself connects to a visited system", () => {
    // B → A (visited)
    const systems = [makeRef("A"), makeRef("B", ["A"])];
    expect(getSystemVisibility("B", ["A"], systems)).toBe("neighbor");
  });

  it("2-hop system is 'unknown' when only the 1-hop current is in visitedSystems (migration scenario)", () => {
    // A → B → C (current). After migration only C is seeded.
    // A must remain 'unknown' for the old code; after the fix the migration
    // seeds A too and it would be 'visited'.
    const systems = [
      makeRef("A", ["B"]),
      makeRef("B", ["A", "C"]),
      makeRef("C", ["B"]),
    ];
    expect(getSystemVisibility("A", ["C"], systems)).toBe("unknown");
    // With all explored systems seeded, A is 'visited':
    expect(getSystemVisibility("A", ["A", "B", "C"], systems)).toBe("visited");
  });
});

// ── pickLabelPosition — label placement with fallback ────────────────────────

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
    // Block the right slot only → should return the left slot.
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
    // A single giant label-bound that covers every candidate position.
    const blockAll = [{ x: -200, y: -200, w: 1000, h: 1000 }];
    const pos = pickLabelPosition(
      positions,
      blockAll,
      STAR_POSITIONS,
      WARP_LINES,
      LABEL_W,
      LABEL_H,
    );
    // Without the fallback this returns null and the system name is never rendered.
    expect(pos).not.toBeNull();
    expect(pos).toEqual(positions[0]);
  });
});
