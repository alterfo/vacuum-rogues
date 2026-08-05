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

const BOUNDS: SystemBounds = {
  cx: 0,
  cy: 0,
  rInner: SYSTEM_GEOMETRY.innerRadius,
  rOuter: SYSTEM_GEOMETRY.outerRadius,
  boundary: SYSTEM_GEOMETRY.boundaryRadius,
};

describe("NpcShipSprite sun avoidance", () => {
  it("never cuts through the star's contact-damage radius when the straight leg would clip it", () => {
    const startX = BOUNDS.rInner;
    const sprite = new NpcShipSprite(makeNpc("trader_sun"), startX, 0, BOUNDS);
    sprite.setTargetProvider(() => ({ x: -BOUNDS.rInner, y: 0 }));

    let minDistToStar = Math.hypot(sprite.x - BOUNDS.cx, sprite.y - BOUNDS.cy);
    for (let i = 0; i < 5000; i++) {
      sprite.update(16);
      const d = Math.hypot(sprite.x - BOUNDS.cx, sprite.y - BOUNDS.cy);
      minDistToStar = Math.min(minDistToStar, d);
      if (sprite.x < -BOUNDS.rInner + 10 && Math.abs(sprite.y) < 10) break;
    }

    expect(minDistToStar).toBeGreaterThan(GAME_BALANCE.starRadius);
  });

  it("still travels in a straight line when the leg does not clip the star", () => {
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
    expect(sprite.y).toBeGreaterThan(y0);
    expect(Math.abs(sprite.x - x0)).toBeLessThan(50);
  });
});
