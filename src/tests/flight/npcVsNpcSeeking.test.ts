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
import { NpcShip } from "@/domain/NpcShip";
import { NpcRole, NpcState, FactionType } from "@/types";
import { Faction } from "@/types/faction";
import { GAME_BALANCE } from "@/config/balance";

function renderer(): Renderer {
  return {
    app: { screen: { width: 800, height: 600 } },
    stage: new Container(),
    uiLayer: new Container(),
    gameLayer: new Container(),
  } as unknown as Renderer;
}

function makeNpc(id: string, role: NpcRole, faction: Faction): NpcShip {
  return new NpcShip({
    id,
    name: id,
    race: FactionType.OUTLANDERS,
    faction,
    role,
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

function makeManager(npcs: NpcShip[]): NpcShipManager {
  const galaxy = {
    npcShips: npcs,
    isHostileSystem: () => false,
    isPirateSystem: () => false,
  } as unknown as Galaxy;
  const gameEngine = {
    galaxy,
    player: { currentSystemId: "sys_a" },
  } as unknown as GameEngine;
  const deps: NpcShipManagerDeps = {
    getShipPhysics: () => null, // no player ship — isolate NPC-vs-NPC steering
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
    getCombatTargetId: () => null,
    isPaused: () => false,
  };
  return new NpcShipManager(
    renderer(),
    gameEngine,
    new Container(),
    new Container(),
    deps,
  );
}

function place(
  manager: NpcShipManager,
  id: string,
  x: number,
  y: number,
): NpcShipSprite & { x: number; y: number } {
  const s = (
    manager as unknown as { npcSprites: NpcShipSprite[] }
  ).npcSprites.find((sp) => sp.npc.id === id) as NpcShipSprite & {
    x: number;
    y: number;
  };
  s.x = x;
  s.y = y;
  return s;
}

describe("NPC-vs-NPC seeking (hostile factions close in to fight)", () => {
  it("a pirate steers TOWARD a nearby Overmind ship (closes the gap)", () => {
    const manager = makeManager([
      makeNpc("ovm_1", NpcRole.PATROL, Faction.OVERMIND),
      makeNpc("prt_1", NpcRole.PIRATE, Faction.INDEPENDENT),
    ]);
    manager.initialize();
    const ovm = place(manager, "ovm_1", 0, 0);
    const pir = place(manager, "prt_1", 500, 0); // within scanner, outside weapon

    const before = Math.hypot(pir.x - ovm.x, pir.y - ovm.y);
    for (let i = 0; i < 20; i++) manager.update(100, 0);
    const after = Math.hypot(pir.x - ovm.x, pir.y - ovm.y);

    expect(after).toBeLessThan(before);
    manager.destroy();
  });

  it("does NOT seek a non-hostile co-faction ship (no false engagement)", () => {
    const manager = makeManager([
      makeNpc("ovm_1", NpcRole.PATROL, Faction.OVERMIND),
      makeNpc("ovm_2", NpcRole.PATROL, Faction.OVERMIND),
    ]);
    manager.initialize();
    place(manager, "ovm_1", 0, 0);
    place(manager, "ovm_2", 400, 0);

    manager.update(100, 0);

    for (const id of ["ovm_1", "ovm_2"]) {
      expect(npcCombatTargetOf(manager, id)).toBeNull();
    }
    manager.destroy();
  });

  it("ignores an enemy beyond scanner range (no engagement target set)", () => {
    const manager = makeManager([
      makeNpc("ovm_1", NpcRole.PATROL, Faction.OVERMIND),
      makeNpc("prt_1", NpcRole.PIRATE, Faction.INDEPENDENT),
    ]);
    manager.initialize();
    place(manager, "ovm_1", 0, 0);
    place(manager, "prt_1", 5000, 0); // beyond SCANNER_RANGE (1200)

    manager.update(100, 0);

    expect(npcCombatTargetOf(manager, "prt_1")).toBeNull();
    expect(npcCombatTargetOf(manager, "ovm_1")).toBeNull();
    manager.destroy();
  });

  it("sets the engagement target on a pirate with an Overmind in scanner range", () => {
    const manager = makeManager([
      makeNpc("ovm_1", NpcRole.PATROL, Faction.OVERMIND),
      makeNpc("prt_1", NpcRole.PIRATE, Faction.INDEPENDENT),
    ]);
    manager.initialize();
    place(manager, "ovm_1", 0, 0);
    place(manager, "prt_1", 500, 0);

    manager.update(100, 0);

    expect(npcCombatTargetOf(manager, "prt_1")).not.toBeNull();
    manager.destroy();
  });
});

function npcCombatTargetOf(
  manager: NpcShipManager,
  id: string,
): { x: number; y: number } | null {
  const s = (
    manager as unknown as { npcSprites: NpcShipSprite[] }
  ).npcSprites.find((sp) => sp.npc.id === id) as unknown as {
    npcCombatX: number | null;
    npcCombatY: number | null;
  };
  if (s.npcCombatX === null || s.npcCombatY === null) return null;
  return { x: s.npcCombatX, y: s.npcCombatY };
}
