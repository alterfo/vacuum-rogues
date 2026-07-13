import { describe, it, expect } from "vitest";
import { Container } from "pixi.js";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import { cargoCapacityOf } from "@/systems/equipment/GearBridge";
import {
  NpcShipManager,
  type NpcShipManagerDeps,
} from "@/presentation/flight/NpcShipManager";
import type { Renderer } from "@/presentation/Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import type { Galaxy } from "@/domain/Galaxy";
import type { ShipPhysics } from "@/systems/ShipPhysics";
import { Inventory } from "@/domain/Inventory";
import { NpcShip } from "@/domain/NpcShip";
import { NpcRole, NpcState, FactionType, ResourceType } from "@/types";
import { Faction } from "@/types/faction";
import { GAME_BALANCE } from "@/config/balance";

/**
 * Task 6: floating loot ("the yellow dot") must be collectible by flying near
 * it — not only by a gravity tractor. The tractor still *extends* the reach.
 * These tests pin the proximity pickup, the no-double-collect / no-leak /
 * full-hold guards, and that the TTL despawn is unaffected.
 */

function makeNpc(id: string, loadout: string[] = ["laser_mk1"]): NpcShip {
  return new NpcShip({
    id,
    name: id,
    race: FactionType.OUTLANDERS,
    faction: Faction.INDEPENDENT,
    role: NpcRole.TRADER,
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
    loadoutSummary: loadout,
  });
}

/** Deterministic RNG cycling through a fixed sequence of [0,1) values. */
function seqRng(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

function lootGraphicsCount(manager: NpcShipManager): number {
  return (manager as unknown as { lootGraphics: Map<string, unknown> })
    .lootGraphics.size;
}

function makeManager(opts: {
  tractorGearId?: string;
  fillHoldToCapacity?: boolean;
  shipX?: number;
  shipY?: number;
}): {
  manager: NpcShipManager;
  inventory: Inventory;
  capacity: number;
  messages: string[];
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

  const loadout = new ShipLoadout("hull_corvette");
  if (opts.tractorGearId) loadout.install(opts.tractorGearId);
  const capacity = cargoCapacityOf(loadout);

  const inventory = new Inventory();
  if (opts.fillHoldToCapacity)
    inventory.addResource(ResourceType.METALS, capacity);

  const player = { currentSystemId: "sys_a", inventory };
  const gameEngine = {
    galaxy,
    player,
    playerLoadout: loadout,
  } as unknown as GameEngine;

  const physics = {
    shipX: opts.shipX ?? 0,
    shipY: opts.shipY ?? 0,
    timeScale: 1,
  } as unknown as ShipPhysics;

  const messages: string[] = [];
  const deps: NpcShipManagerDeps = {
    getShipPhysics: () => physics,
    getPlanetSprites: () => [],
    getStarCenter: () => ({ x: 400, y: 300 }),
    isTurnRunning: () => true,
    showMessage: (m: string) => messages.push(m),
    showTooltip: () => {},
    hideTooltip: () => {},
    executeRouteTo: () => {},
    clearRouteTarget: () => {},
    endTurn: () => {},
  };

  return {
    manager: new NpcShipManager(renderer, gameEngine, gameLayer, uiLayer, deps),
    inventory,
    capacity,
    messages,
  };
}

describe("Loot proximity pickup (Task 6)", () => {
  it("collects a drop flown within the base radius WITHOUT a tractor", () => {
    const { manager, inventory, messages } = makeManager({
      tractorGearId: "eq_engine_i", // no tractor
    });
    const r = GAME_BALANCE.lootPickupRadius;
    // Loot just inside the hands-on radius (no tractor equipped).
    manager.spawnLootForNpc(makeNpc("t"), r - 5, 0, seqRng([0.5]));
    expect(manager.spaceLoot.length).toBe(1);

    manager.update(16, 0);

    expect(manager.spaceLoot.length).toBe(0);
    const metals = inventory.resources.find(
      (m) => m.type === ResourceType.METALS,
    );
    expect(metals?.amount).toBe(1);
    // Hands-on pickup uses the «Подобрано: …» flavour.
    expect(messages.some((m) => m.includes("Подобрано"))).toBe(true);
    manager.destroy();
  });

  it("does NOT collect a drop beyond the base radius without a tractor", () => {
    const { manager, inventory } = makeManager({
      tractorGearId: "eq_engine_i",
    });
    const r = GAME_BALANCE.lootPickupRadius;
    manager.spawnLootForNpc(makeNpc("t"), r + 40, 0, seqRng([0.5]));

    manager.update(16, 0);

    expect(manager.spaceLoot.length).toBe(1);
    expect(inventory.resources.length).toBe(0);
    manager.destroy();
  });

  it("a tractor EXTENDS the reach beyond the base radius (no double-collect)", () => {
    const { manager, inventory, messages } = makeManager({
      tractorGearId: "grav_tractor_2", // range 150
    });
    const r = GAME_BALANCE.lootPickupRadius;
    // Beyond hands-on reach but inside the tractor range → still collected.
    expect(r).toBeLessThan(120);
    manager.spawnLootForNpc(makeNpc("t"), 120, 0, seqRng([0.5]));
    expect(manager.spaceLoot.length).toBe(1);

    manager.update(16, 0);
    manager.update(16, 0); // a second frame must NOT collect a phantom copy

    expect(manager.spaceLoot.length).toBe(0);
    const metals = inventory.resources.find(
      (m) => m.type === ResourceType.METALS,
    );
    expect(metals?.amount).toBe(1); // collected exactly once
    // The far pickup is the tractor pull, not the hands-on grab.
    expect(messages.some((m) => m.includes("Гравитяга"))).toBe(true);
    manager.destroy();
  });

  it("cleans up the dot graphic on pickup (no orphaned Graphics leak)", () => {
    const { manager } = makeManager({});
    const r = GAME_BALANCE.lootPickupRadius;
    manager.spawnLootForNpc(makeNpc("t"), r - 5, 0, seqRng([0.5]));
    expect(lootGraphicsCount(manager)).toBe(1);

    manager.update(16, 0);

    expect(manager.spaceLoot.length).toBe(0);
    expect(lootGraphicsCount(manager)).toBe(0);
    manager.destroy();
  });

  it("a full hold leaves the drop in space and corrupts nothing", () => {
    const { manager, inventory, capacity } = makeManager({
      fillHoldToCapacity: true,
    });
    const r = GAME_BALANCE.lootPickupRadius;
    manager.spawnLootForNpc(makeNpc("t"), r - 5, 0, seqRng([0.5]));

    manager.update(16, 0);

    // Loot stays in space; the over-capacity hold is unchanged (no extra unit).
    expect(manager.spaceLoot.length).toBe(1);
    const metals = inventory.resources.find(
      (m) => m.type === ResourceType.METALS,
    );
    expect(metals?.amount).toBe(capacity);
    manager.destroy();
  });

  it("still despawns an abandoned (out-of-reach) drop after the TTL", () => {
    const { manager } = makeManager({});
    const r = GAME_BALANCE.lootPickupRadius;
    // Out of pickup reach so it's never collected — must still TTL-despawn.
    manager.spawnLootForNpc(makeNpc("t"), r + 500, 0, seqRng([0.9]));
    expect(manager.spaceLoot.length).toBe(2);

    for (let i = 0; i < 61; i++) manager.update(1000, 0);

    expect(manager.spaceLoot.length).toBe(0);
    expect(lootGraphicsCount(manager)).toBe(0);
    manager.destroy();
  });
});

describe("Loot day-gate default when the calendar is unavailable (regression 7583e75)", () => {
  /** No gameEngine at all — spawnLootForNpc must fall back to `?? Infinity`,
   *  not `?? 0`, when it can't read `gameEngine.galaxy.gameDays`. */
  function makeManagerWithoutGameEngine(): NpcShipManager {
    const stage = new Container();
    const uiLayer = new Container();
    const gameLayer = new Container();
    const renderer = {
      app: { screen: { width: 800, height: 600 } },
      stage,
      uiLayer,
      gameLayer,
    } as unknown as Renderer;

    const physics = {
      shipX: 0,
      shipY: 0,
      timeScale: 1,
    } as unknown as ShipPhysics;
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
    };

    return new NpcShipManager(renderer, null, gameLayer, uiLayer, deps);
  }

  it("does not gate a minDay-restricted loot token to 'never drop' with no galaxy to read a day from", () => {
    // "eq_engine_v" (the apex engine) carries a real minDay gate
    // (APEX_ENGINE_MIN_DAY = 1050); "laser_mk1" resolves to no catalog gear
    // id and so is never gated, giving a stable control token.
    const manager = makeManagerWithoutGameEngine();
    const npc = makeNpc("gated", ["eq_engine_v", "laser_mk1"]);
    // First roll picks the loot count (0.5 -> exactly 1 item); second picks
    // the module — index 0 of whichever pool the day-gate left eligible.
    manager.spawnLootForNpc(npc, 0, 0, seqRng([0.5, 0.1]));

    expect(manager.spaceLoot.length).toBe(1);
    // Day must resolve to Infinity (not 0), so the gated engine stays
    // eligible and is the one picked at index 0 — a day-0 fallback would
    // have excluded it, leaving only "laser_mk1" in the pool.
    expect(manager.spaceLoot[0].moduleId).toBe("eq_engine_v");
    manager.destroy();
  });
});
