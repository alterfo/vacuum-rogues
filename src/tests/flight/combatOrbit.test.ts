import { describe, it, expect } from "vitest";
import { Container } from "pixi.js";
import {
  NpcShipManager,
  type NpcShipManagerDeps,
} from "@/presentation/flight/NpcShipManager";
import type { NpcShipSprite } from "@/presentation/NpcShipSprite";
import type { Renderer } from "@/presentation/Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import type { Galaxy } from "@/domain/Galaxy";
import { ShipPhysics } from "@/systems/ShipPhysics";
import { NpcShip } from "@/domain/NpcShip";
import { NpcRole, NpcState, FactionType } from "@/types";
import { Faction } from "@/types/faction";
import { GAME_BALANCE } from "@/config/balance";

const WR = GAME_BALANCE.weaponRange;

function renderer(): Renderer {
  return {
    app: { screen: { width: 800, height: 600 } },
    stage: new Container(),
    uiLayer: new Container(),
    gameLayer: new Container(),
  } as unknown as Renderer;
}

function makeNpc(id: string): NpcShip {
  return new NpcShip({
    id,
    name: id,
    race: FactionType.OUTLANDERS,
    faction: Faction.INDEPENDENT,
    role: NpcRole.PIRATE,
    hullHP: 100,
    maxHull: 100,
    shields: 0,
    speed: GAME_BALANCE.npcSpeed,
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

function spriteOf(manager: NpcShipManager): NpcShipSprite & {
  x: number;
  y: number;
  container: { rotation: number };
} {
  return (manager as unknown as { npcSprites: NpcShipSprite[] })
    .npcSprites[0] as NpcShipSprite & {
    x: number;
    y: number;
    container: { rotation: number };
  };
}

interface OrbitResult {
  maxDistAfterEntry: number;
  inRangeFraction: number;
  reachedRange: boolean;
}

function runCombatOrbit(): OrbitResult {
  const dtMs = 50;
  const frames = 600;
  const postEntryWindow = 240; // frames to observe once range is first reached
  const physics = new ShipPhysics(0, 0, 0.5);

  const galaxy = {
    npcShips: [makeNpc("pir_1")],
    isHostileSystem: () => false,
  } as unknown as Galaxy;
  const gameEngine = {
    galaxy,
    player: { currentSystemId: "sys_a" },
  } as unknown as GameEngine;

  const deps: NpcShipManagerDeps = {
    getShipPhysics: () => physics,
    getPlanetSprites: () => [],
    getStarCenter: () => ({ x: 400, y: 300 }),
    isTurnRunning: () => true,
    showMessage: () => {},
    showTooltip: () => {},
    hideTooltip: () => {},
    executeRouteTo: (x, y) => physics.setTarget(x, y),
    clearRouteTarget: () => {},
    endTurn: () => {},
    isInCombat: () => true,
    getCombatTargetId: () => "pir_1",
    isPaused: () => false,
  };

  const manager = new NpcShipManager(
    renderer(),
    gameEngine,
    new Container(),
    new Container(),
    deps,
  );
  manager.initialize();
  const target = spriteOf(manager);
  let targetX = 900;
  target.x = targetX;
  target.y = 0;
  target.container.rotation = 0; // heading +x

  let reachedRange = false;
  let framesAfterEntry = 0;
  let maxDistAfterEntry = 0;
  let inRangeFrames = 0;
  let observedFrames = 0;

  for (let f = 0; f < frames; f++) {
    targetX += GAME_BALANCE.npcSpeed * dtMs;
    target.x = targetX;
    target.container.rotation = 0;

    manager.updateCombat(dtMs);
    physics.update(dtMs);

    const dist = Math.hypot(target.x - physics.shipX, target.y - physics.shipY);
    if (dist <= WR) reachedRange = true;
    if (reachedRange) {
      observedFrames++;
      maxDistAfterEntry = Math.max(maxDistAfterEntry, dist);
      if (dist <= WR) inRangeFrames++;
      if (++framesAfterEntry > postEntryWindow) break;
    }
  }

  manager.destroy();
  return {
    maxDistAfterEntry,
    inRangeFraction: observedFrames > 0 ? inRangeFrames / observedFrames : 0,
    reachedRange,
  };
}

describe("combat pursuit holds the target in weapon range (orbit fix)", () => {
  it("first closes to weapon range", () => {
    const { reachedRange } = runCombatOrbit();
    expect(reachedRange).toBe(true);
  });

  it("keeps the target inside WEAPON_RANGE once engaged (no overshoot/orbit out)", () => {
    const { maxDistAfterEntry } = runCombatOrbit();
    expect(maxDistAfterEntry).toBeLessThanOrEqual(WR * 1.05);
  });

  it("keeps a target in firing range nearly every frame (so auto-fire fires)", () => {
    const { inRangeFraction } = runCombatOrbit();
    expect(inRangeFraction).toBeGreaterThanOrEqual(0.85);
  });
});
