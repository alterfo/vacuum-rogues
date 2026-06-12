import { describe, it, expect } from "vitest";
import { NpcRole } from "@/types";
import {
  pickNpcDestination,
  type NpcBehaviorCtx,
} from "@/presentation/flight/npcBehavior";
import type { SystemBounds } from "@/presentation/NpcShipSprite";

const BOUNDS: SystemBounds = {
  cx: 400,
  cy: 300,
  rInner: 600,
  rOuter: 2500,
  boundary: 2800,
};

const PLANETS = [
  { x: 800, y: 300 },
  { x: 400, y: 900 },
  { x: 200, y: 600 },
];

const CTX: NpcBehaviorCtx = { bounds: BOUNDS, planets: PLANETS };

describe("pickNpcDestination", () => {
  it("TRADER returns a planet-anchored visit_planet target", () => {
    const dest = pickNpcDestination(NpcRole.TRADER, "trader_1", 0, CTX);
    expect(dest.intent).toBe("visit_planet");
    const matched = PLANETS.some((p) => p.x === dest.x && p.y === dest.y);
    expect(matched).toBe(true);
  });

  it("RANGER returns a planet-anchored visit_planet target", () => {
    const dest = pickNpcDestination(NpcRole.RANGER, "ranger_1", 0, CTX);
    expect(dest.intent).toBe("visit_planet");
    const matched = PLANETS.some((p) => p.x === dest.x && p.y === dest.y);
    expect(matched).toBe(true);
  });

  it("PATROL returns a patrol_station target at a planet position", () => {
    const dest = pickNpcDestination(NpcRole.PATROL, "patrol_1", 0, CTX);
    expect(dest.intent).toBe("patrol_station");
    const matched = PLANETS.some((p) => p.x === dest.x && p.y === dest.y);
    expect(matched).toBe(true);
  });

  it("PIRATE returns hunt intent when traders are present", () => {
    const traders = [
      { x: 900, y: 400 },
      { x: 1200, y: 600 },
    ];
    const dest = pickNpcDestination(NpcRole.PIRATE, "pirate_1", 0, {
      ...CTX,
      traders,
    });
    expect(dest.intent).toBe("hunt");
    const matched = traders.some((t) => t.x === dest.x && t.y === dest.y);
    expect(matched).toBe(true);
  });

  it("PIRATE falls back to lane_point when traders array is explicitly empty", () => {
    // Distinct from the undefined-traders case — exercises the length > 0 branch.
    const dest = pickNpcDestination(NpcRole.PIRATE, "pirate_1", 0, {
      ...CTX,
      traders: [],
    });
    expect(dest.intent).toBe("lane_point");
    const dx = dest.x - BOUNDS.cx;
    const dy = dest.y - BOUNDS.cy;
    const r = Math.sqrt(dx * dx + dy * dy);
    expect(r).toBeGreaterThanOrEqual(BOUNDS.rInner - 0.01);
    expect(r).toBeLessThanOrEqual(BOUNDS.rOuter + 0.01);
  });

  it("PIRATE returns a lane_point when no traders are present", () => {
    const dest = pickNpcDestination(NpcRole.PIRATE, "pirate_1", 0, CTX);
    expect(dest.intent).toBe("lane_point");
    const dx = dest.x - BOUNDS.cx;
    const dy = dest.y - BOUNDS.cy;
    const r = Math.sqrt(dx * dx + dy * dy);
    expect(r).toBeGreaterThanOrEqual(BOUNDS.rInner - 0.01);
    expect(r).toBeLessThanOrEqual(BOUNDS.rOuter + 0.01);
  });

  it("is deterministic: same (role, shipId, seq, ctx) always yields the same result", () => {
    const d1 = pickNpcDestination(NpcRole.PIRATE, "pirate_42", 5, CTX);
    const d2 = pickNpcDestination(NpcRole.PIRATE, "pirate_42", 5, CTX);
    expect(d1.x).toBe(d2.x);
    expect(d1.y).toBe(d2.y);
    expect(d1.intent).toBe(d2.intent);
  });

  it("varies with seq so successive waypoints differ", () => {
    const d0 = pickNpcDestination(NpcRole.PIRATE, "pirate_1", 0, CTX);
    const d1 = pickNpcDestination(NpcRole.PIRATE, "pirate_1", 1, CTX);
    expect(d0.x === d1.x && d0.y === d1.y).toBe(false);
  });

  it("PATROL cycles through different planets on successive calls", () => {
    const visited = new Set<string>();
    for (let i = 0; i < 9; i++) {
      const d = pickNpcDestination(NpcRole.PATROL, "patrol_x", i, CTX);
      visited.add(`${d.x},${d.y}`);
    }
    expect(visited.size).toBeGreaterThan(1);
  });

  it("TRADER with no planets falls back to a lane_point within the ring", () => {
    const noPlanets: NpcBehaviorCtx = { bounds: BOUNDS, planets: [] };
    const dest = pickNpcDestination(NpcRole.TRADER, "trader_fb", 0, noPlanets);
    expect(dest.intent).toBe("lane_point");
    const dx = dest.x - BOUNDS.cx;
    const dy = dest.y - BOUNDS.cy;
    const r = Math.sqrt(dx * dx + dy * dy);
    expect(r).toBeGreaterThanOrEqual(BOUNDS.rInner - 0.01);
    expect(r).toBeLessThanOrEqual(BOUNDS.rOuter + 0.01);
  });
});
