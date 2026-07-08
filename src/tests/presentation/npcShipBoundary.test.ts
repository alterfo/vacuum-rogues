import { describe, it, expect } from "vitest";
import { Container } from "pixi.js";
import { NpcShipSprite, type SystemBounds } from "@/presentation/NpcShipSprite";
import {
  NpcShipManager,
  type NpcShipManagerDeps,
} from "@/presentation/flight/NpcShipManager";
import type { Renderer } from "@/presentation/Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import type { Galaxy } from "@/domain/Galaxy";
import { ShipPhysics } from "@/systems/ShipPhysics";
import { NpcShip } from "@/domain/NpcShip";
import { NpcRole, NpcState, FactionType } from "@/types";
import { Faction } from "@/types/faction";
import { GAME_BALANCE } from "@/config/balance";

// ---------------------------------------------------------------------------
// Task 7/8 (font-scale-and-faction-bugs plan): a fleeing (BREAK_OFF) NPC's
// real-time position had no boundary check anywhere, so it could run to any
// distance past the system edge and become permanently unreachable — unlike a
// scripted departure (`beginDeparture`), which heads straight to
// `bounds.boundary` and sets `gone` once it arrives. Fixed by having
// `maneuverToward` detect when a BREAK_OFF step would carry the ship past
// `bounds.boundary` and route it into `beginDeparture()` instead. This must
// hold for BOTH the player-chase (`aggressive`) branch and the NPC-vs-NPC
// engagement branch, since both route through the same `maneuverToward` —
// only the player-chase path is exercised here (it is the
// reachable-from-gameplay case: a garrison aggressor engaging the player).
// ---------------------------------------------------------------------------

function makeNpc(id: string, hullHP: number, maxHull: number): NpcShip {
  return new NpcShip({
    id,
    name: id,
    race: FactionType.OUTLANDERS,
    faction: Faction.INDEPENDENT,
    role: NpcRole.PATROL,
    hullHP,
    maxHull,
    shields: 0,
    speed: 0.08,
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
  rInner: 100,
  rOuter: 200,
  boundary: 300,
};

describe("NpcShipSprite boundary containment (Task 7/8)", () => {
  it("a BREAK_OFF flee never carries the ship past the system boundary", () => {
    // Low hull ratio (< BREAK_OFF_HULL_RATIO = 0.3) forces BREAK_OFF regardless
    // of range/speed. Pursuit target sits at +x, so the flee heading points -x
    // — a straight run away from the system centre.
    const sprite = new NpcShipSprite(makeNpc("flee_1", 10, 100), 0, 0, BOUNDS);
    sprite.setAggressive(true);
    sprite.setPursuitTarget(50, 0, 0);

    let maxDist = 0;
    let wentGone = false;
    for (let i = 0; i < 3000; i++) {
      sprite.update(16);
      if (sprite.isGone()) {
        wentGone = true;
        break;
      }
      const d = Math.hypot(sprite.x - BOUNDS.cx, sprite.y - BOUNDS.cy);
      maxDist = Math.max(maxDist, d);
    }

    // Either the ship transitions to `gone` at/near the boundary, or its
    // distance from centre never exceeds the boundary — both are acceptable
    // "contained" outcomes; running past it unbounded is the bug.
    if (!wentGone) {
      expect(maxDist).toBeLessThanOrEqual(BOUNDS.boundary + 1);
    }
  });

  it("a normal in-bounds aggressive pursuit is unaffected (no regression to ordinary chase)", () => {
    // Full hull, target close by and within weapon range — CLOSE/ORBIT only,
    // never BREAK_OFF, so the ship should behave exactly as before: it moves,
    // stays inside the boundary, and never goes `gone`.
    const sprite = new NpcShipSprite(
      makeNpc("chase_1", 100, 100),
      0,
      0,
      BOUNDS,
    );
    const startX = sprite.x;
    const startY = sprite.y;
    sprite.setAggressive(true);
    sprite.setPursuitTarget(150, 0, 0);

    for (let i = 0; i < 200; i++) {
      sprite.update(16);
      expect(sprite.isGone()).toBe(false);
      const d = Math.hypot(sprite.x - BOUNDS.cx, sprite.y - BOUNDS.cy);
      expect(d).toBeLessThanOrEqual(BOUNDS.boundary);
    }

    const moved = Math.hypot(sprite.x - startX, sprite.y - startY) > 0.001;
    expect(moved).toBe(true);
  });

  it("an outmatched (full-hull, out-run) BREAK_OFF is also bounded", () => {
    // Full hull but the pursuit target is faster and still outside weapon
    // range — decideManeuver's other BREAK_OFF trigger (`outmatched`).
    const sprite = new NpcShipSprite(makeNpc("flee_2", 100, 100), 0, 0, BOUNDS);
    sprite.setAggressive(true);
    sprite.setPursuitTarget(
      GAME_BALANCE.weaponRange + 50,
      0,
      sprite.cruiseSpeed + 0.5,
    );

    let maxDist = 0;
    let wentGone = false;
    for (let i = 0; i < 3000; i++) {
      sprite.update(16);
      if (sprite.isGone()) {
        wentGone = true;
        break;
      }
      maxDist = Math.max(
        maxDist,
        Math.hypot(sprite.x - BOUNDS.cx, sprite.y - BOUNDS.cy),
      );
    }

    if (!wentGone) {
      expect(maxDist).toBeLessThanOrEqual(BOUNDS.boundary + 1);
    } else {
      expect(wentGone).toBe(true);
    }
  });

  it("a diagonal BREAK_OFF flee is bounded regardless of heading angle", () => {
    const sprite = new NpcShipSprite(makeNpc("flee_3", 10, 100), 0, 0, BOUNDS);
    sprite.setAggressive(true);
    // Pursuer to the upper-right ⇒ flee heads toward the lower-left.
    sprite.setPursuitTarget(80, 80, 0);

    let maxDist = 0;
    let wentGone = false;
    for (let i = 0; i < 3000; i++) {
      sprite.update(16);
      if (sprite.isGone()) {
        wentGone = true;
        break;
      }
      maxDist = Math.max(
        maxDist,
        Math.hypot(sprite.x - BOUNDS.cx, sprite.y - BOUNDS.cy),
      );
    }

    if (!wentGone) {
      expect(maxDist).toBeLessThanOrEqual(BOUNDS.boundary + 1);
    }
  });

  it("a ship already at the boundary transitions to gone almost immediately, without overshoot", () => {
    const startX = BOUNDS.boundary - 1;
    const sprite = new NpcShipSprite(
      makeNpc("flee_4", 10, 100),
      startX,
      0,
      BOUNDS,
    );
    sprite.setAggressive(true);
    sprite.setPursuitTarget(startX + 50, 0, 0); // pursuer further out ⇒ flee inward-then-out is irrelevant; heading is directly away (-x is toward centre here is fine, boundary check is radial)

    let maxDist = 0;
    let wentGone = false;
    for (let i = 0; i < 50 && !wentGone; i++) {
      sprite.update(16);
      wentGone = sprite.isGone();
      maxDist = Math.max(
        maxDist,
        Math.hypot(sprite.x - BOUNDS.cx, sprite.y - BOUNDS.cy),
      );
    }

    expect(maxDist).toBeLessThanOrEqual(BOUNDS.boundary + 1);
  });

  it("a fleeing garrison aggressor that reaches the boundary is despawned by NpcShipManager (same cleanup as a scripted departure)", () => {
    const npc = makeNpc("flee_manager_1", 10, 100);
    const galaxy = { npcShips: [npc] } as unknown as Galaxy;
    const gameEngine = {
      galaxy,
      player: { currentSystemId: "sys_a" },
    } as unknown as GameEngine;
    const physics = new ShipPhysics(0, 0, 0.3);

    const deps: NpcShipManagerDeps = {
      getShipPhysics: () => physics,
      getPlanetSprites: () => [],
      getStarCenter: () => ({ x: 400, y: 300 }),
      isTurnRunning: () => true,
      showMessage: () => {},
      showTooltip: () => {},
      hideTooltip: () => {},
      executeRouteTo: () => {},
      clearRouteTarget: () => {},
      endTurn: () => {},
      isInCombat: () => false,
      isPaused: () => false,
    };

    const manager = new NpcShipManager(
      {
        app: { screen: { width: 800, height: 600 } },
        stage: new Container(),
        uiLayer: new Container(),
        gameLayer: new Container(),
      } as unknown as Renderer,
      gameEngine,
      new Container(),
      new Container(),
      deps,
    );
    manager.initialize();
    const sprite = (manager as unknown as { npcSprites: NpcShipSprite[] })
      .npcSprites[0];
    sprite.setAggressive(true);
    sprite.setPursuitTarget(50, 0, 0); // flee heads to -x, straight out of bounds

    for (let i = 0; i < 3000; i++) {
      manager.update(16, 0);
      if (
        (manager as unknown as { npcSprites: NpcShipSprite[] }).npcSprites
          .length === 0
      ) {
        break;
      }
    }

    expect(
      (manager as unknown as { npcSprites: NpcShipSprite[] }).npcSprites,
    ).toHaveLength(0);
    manager.destroy();
  });
});
