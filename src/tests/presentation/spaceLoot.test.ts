import { describe, it, expect } from "vitest";
import { Container } from "pixi.js";
import {
  NpcShipManager,
  type NpcShipManagerDeps,
} from "@/presentation/flight/NpcShipManager";
import type { Renderer } from "@/presentation/Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import type { Galaxy } from "@/domain/Galaxy";
import { NpcShip } from "@/domain/NpcShip";
import { NpcRole, NpcState, FactionType, type SpaceLootItem } from "@/types";
import { Faction } from "@/types/faction";

type NpcOpts = {
  role?: NpcRole;
  faction?: Faction;
  loadout?: string[];
};

function makeNpc(id: string, opts: NpcOpts = {}): NpcShip {
  return new NpcShip({
    id,
    name: id,
    race: FactionType.OUTLANDERS,
    faction: opts.faction ?? Faction.INDEPENDENT,
    role: opts.role ?? NpcRole.TRADER,
    hullHP: 100,
    maxHull: 100,
    shields: 0,
    speed: 0.1,
    damage: 20,
    currentSystemId: "sys_a",
    state: NpcState.PATROLLING,
    goal: null,
    destinationSystemId: null,
    daysToArrival: 0,
    credits: 0,
    reputation: 0,
    loadoutSummary: opts.loadout ?? [],
  });
}

function seqRng(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

function makeManager(): {
  manager: NpcShipManager;
  gameLayer: Container;
} {
  const stage = new Container();
  const uiLayer = new Container();
  const gameLayer = new Container();
  const renderer = {
    app: { screen: { width: 800, height: 600 } },
    stage,
    uiLayer,
    gameLayer,
  } as unknown as Renderer;

  const galaxy = {
    npcShips: [],
    isHostileSystem: () => false,
  } as unknown as Galaxy;
  const gameEngine = {
    galaxy,
    player: { currentSystemId: "sys_a" },
  } as unknown as GameEngine;

  const deps: NpcShipManagerDeps = {
    getShipPhysics: () => null,
    getPlanetSprites: () => [],
    getStarCenter: () => ({ x: 400, y: 300 }),
    isTurnRunning: () => true,
    showMessage: () => {},
    showTooltip: () => {},
    hideTooltip: () => {},
    executeRouteTo: () => {},
    clearRouteTarget: () => {},
    endTurn: () => {},
  };

  return {
    manager: new NpcShipManager(renderer, gameEngine, gameLayer, uiLayer, deps),
    gameLayer,
  };
}

function lootGraphicsCount(manager: NpcShipManager): number {
  return (manager as unknown as { lootGraphics: Map<string, unknown> })
    .lootGraphics.size;
}

describe("NpcShipManager space loot", () => {
  it("adds loot items to spaceLoot when an NPC is destroyed", () => {
    const { manager, gameLayer } = makeManager();
    manager.spawnLootForNpc(
      makeNpc("trader_1", { loadout: ["laser_mk1"] }),
      120,
      80,
      seqRng([0.9]),
    );

    expect(manager.spaceLoot.length).toBe(2);
    expect(lootGraphicsCount(manager)).toBe(2);
    expect(gameLayer.children.length).toBe(2);
    manager.destroy();
  });

  it("places loot at the destroyed ship's world position", () => {
    const { manager } = makeManager();
    manager.spawnLootForNpc(makeNpc("t"), 321, 654, seqRng([0.9]));

    for (const item of manager.spaceLoot) {
      expect(item.x).toBe(321);
      expect(item.y).toBe(654);
    }
    manager.destroy();
  });

  it("drops Overmind artifacts from an Overmind kill", () => {
    const { manager } = makeManager();
    manager.spawnLootForNpc(
      makeNpc("ov_1", { faction: Faction.OVERMIND, role: NpcRole.PATROL }),
      0,
      0,
      seqRng([0.5, 0.1]),
    );

    expect(manager.spaceLoot.length).toBe(1);
    const item = manager.spaceLoot[0] as SpaceLootItem;
    expect(item.artifactId).toBe("ARTIFACTS");
    expect(item.moduleId).toBeUndefined();
    manager.destroy();
  });

  it("drops modules (not artifacts) from a non-Overmind kill", () => {
    const { manager } = makeManager();
    manager.spawnLootForNpc(
      makeNpc("trader_1", { loadout: ["shield_mk2"] }),
      0,
      0,
      seqRng([0.9]),
    );

    expect(manager.spaceLoot.length).toBeGreaterThan(0);
    for (const item of manager.spaceLoot) {
      expect(item.moduleId).toBeDefined();
      expect(item.artifactId).toBeUndefined();
    }
    manager.destroy();
  });

  it("can drop nothing (0-item roll)", () => {
    const { manager } = makeManager();
    manager.spawnLootForNpc(makeNpc("t"), 0, 0, seqRng([0.1]));
    expect(manager.spaceLoot.length).toBe(0);
    expect(lootGraphicsCount(manager)).toBe(0);
    manager.destroy();
  });

  it("despawns loot older than 60 seconds", () => {
    const { manager, gameLayer } = makeManager();
    manager.spawnLootForNpc(makeNpc("t"), 0, 0, seqRng([0.9]));
    expect(manager.spaceLoot.length).toBe(2);

    for (let i = 0; i < 61; i++) manager.update(1000, 0);

    expect(manager.spaceLoot.length).toBe(0);
    expect(lootGraphicsCount(manager)).toBe(0);
    expect(gameLayer.children.length).toBe(0);
    manager.destroy();
  });

  it("keeps loot alive before the 60 s lifetime elapses", () => {
    const { manager } = makeManager();
    manager.spawnLootForNpc(makeNpc("t"), 0, 0, seqRng([0.9]));

    for (let i = 0; i < 30; i++) manager.update(1000, 0);

    expect(manager.spaceLoot.length).toBe(2);
    manager.destroy();
  });
});
