import { describe, it, expect } from "vitest";
import { NpcShipSprite, type SystemBounds } from "@/presentation/NpcShipSprite";
import { NpcShip } from "@/domain/NpcShip";
import { NpcRole, NpcState, FactionType } from "@/types";
import { Faction } from "@/types/faction";
import { SYSTEM_GEOMETRY, GAME_BALANCE } from "@/config/balance";

function makeNpc(id: string, role: NpcRole = NpcRole.TRADER): NpcShip {
  return new NpcShip({
    id,
    name: id,
    race: FactionType.OUTLANDERS,
    faction: Faction.INDEPENDENT,
    role,
    hullHP: 100,
    maxHull: 100,
    shields: 40,
    speed: 0.1,
    damage: 20,
    currentSystemId: "sys_a",
    state: NpcState.PATROLLING,
    goal: null,
    destinationSystemId: null,
    daysToArrival: 0,
    credits: 0,
    reputation: 0,
  });
}

// Real system geometry: the star sits at the bounds centre, and every
// legitimate NPC waypoint (planet / lane point) lives at radius >= rInner,
// which is already outside the star's exclusion ring.
const BOUNDS: SystemBounds = {
  cx: 0,
  cy: 0,
  rInner: SYSTEM_GEOMETRY.innerRadius,
  rOuter: SYSTEM_GEOMETRY.outerRadius,
  boundary: SYSTEM_GEOMETRY.boundaryRadius,
};

describe("NpcShipSprite sun avoidance", () => {
  it("never cuts through the star's contact-damage radius when the straight leg would clip it", () => {
    // Ship starts on one side of the star at rInner, destination is a planet
    // directly opposite — the naive straight line passes right through the
    // star centre.
    const startX = BOUNDS.rInner;
    const sprite = new NpcShipSprite(makeNpc("trader_sun"), startX, 0, BOUNDS);
    sprite.setTargetProvider(() => ({ x: -BOUNDS.rInner, y: 0 }));

    let minDistToStar = Math.hypot(sprite.x - BOUNDS.cx, sprite.y - BOUNDS.cy);
    // Advance in small, real-frame-sized steps until the ship reaches the far
    // side (or a generous step budget elapses).
    for (let i = 0; i < 5000; i++) {
      sprite.update(16);
      const d = Math.hypot(sprite.x - BOUNDS.cx, sprite.y - BOUNDS.cy);
      minDistToStar = Math.min(minDistToStar, d);
      if (sprite.x < -BOUNDS.rInner + 10 && Math.abs(sprite.y) < 10) break;
    }

    // The star's actual contact-damage radius (GAME_BALANCE.starRadius) must
    // never be entered — the ship should stay clear of the whole exclusion
    // ring, which is well outside the visual star.
    expect(minDistToStar).toBeGreaterThan(GAME_BALANCE.starRadius);
  });

  it("still travels in a straight line when the leg does not clip the star", () => {
    // Both points on the same side, far from the star — no bypass needed.
    const sprite = new NpcShipSprite(
      makeNpc("trader_clear"),
      BOUNDS.rInner,
      0,
      BOUNDS,
    );
    sprite.setTargetProvider(() => ({ x: BOUNDS.rInner, y: 400 }));
    const x0 = sprite.x;
    const y0 = sprite.y;
    sprite.update(16);
    // Straight-line heading toward (rInner, 400): moving mostly in +y.
    expect(sprite.y).toBeGreaterThan(y0);
    expect(Math.abs(sprite.x - x0)).toBeLessThan(50);
  });
});
