import { describe, it, expect } from "vitest";
import { Container } from "pixi.js";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import {
  cargoCapacityOf,
  ownedUninstalledGear,
} from "@/systems/equipment/GearBridge";
import {
  NpcShipManager,
  type NpcShipManagerDeps,
} from "@/presentation/flight/NpcShipManager";
import type { Renderer } from "@/presentation/Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import type { Galaxy } from "@/domain/Galaxy";
import type { ShipPhysics } from "@/systems/ShipPhysics";
import type { Player } from "@/domain/Player";
import { Inventory } from "@/domain/Inventory";
import { NpcShip } from "@/domain/NpcShip";
import { NpcRole, NpcState, FactionType, ResourceType } from "@/types";
import { Faction } from "@/types/faction";
import { GAME_BALANCE } from "@/config/balance";

function makeNpc(id: string, loadout: string[]): NpcShip {
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

function oneItemRng(): () => number {
  return () => 0.5;
}

function makeManager(opts: { fillHoldToCapacity?: boolean }): {
  manager: NpcShipManager;
  player: Player;
  inventory: Inventory;
  loadout: ShipLoadout;
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
  const capacity = cargoCapacityOf(loadout);

  const inventory = new Inventory();
  if (opts.fillHoldToCapacity)
    inventory.addResource(ResourceType.METALS, capacity);

  const player = { currentSystemId: "sys_a", inventory } as unknown as Player;
  const gameEngine = {
    galaxy,
    player,
    playerLoadout: loadout,
  } as unknown as GameEngine;

  const physics = {
    shipX: 0,
    shipY: 0,
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
    player,
    inventory,
    loadout,
    capacity,
    messages,
  };
}

describe("Looted gear lands in the gear inventory (Task 5)", () => {
  it("a gear drop (by gear id) is acquired as owned gear, not metal", () => {
    const { manager, player, inventory, loadout } = makeManager({});
    const r = GAME_BALANCE.lootPickupRadius;
    manager.spawnLootForNpc(makeNpc("g", ["eq_tank"]), r - 5, 0, oneItemRng());
    expect(manager.spaceLoot.length).toBe(1);

    manager.update(16, 0);

    expect(manager.spaceLoot.length).toBe(0);
    expect(player.inventory.ownedGearIds).toContain("eq_tank");
    expect(ownedUninstalledGear(player, loadout)).toContain("eq_tank");
    expect(inventory.resources.length).toBe(0);
    manager.destroy();
  });

  it("a gear drop named by loadoutSummary display name resolves to its gear id", () => {
    const { manager, player, inventory } = makeManager({});
    const r = GAME_BALANCE.lootPickupRadius;
    manager.spawnLootForNpc(
      makeNpc("g", ["Топливный бак"]),
      r - 5,
      0,
      oneItemRng(),
    );

    manager.update(16, 0);

    expect(player.inventory.ownedGearIds).toContain("eq_tank");
    expect(inventory.resources.length).toBe(0);
    manager.destroy();
  });

  it("a non-gear junk drop still salvages to a resource (METALS)", () => {
    const { manager, player, inventory } = makeManager({});
    const r = GAME_BALANCE.lootPickupRadius;
    manager.spawnLootForNpc(
      makeNpc("j", ["salvaged_plating"]),
      r - 5,
      0,
      oneItemRng(),
    );

    manager.update(16, 0);

    expect(manager.spaceLoot.length).toBe(0);
    const metals = inventory.resources.find(
      (m) => m.type === ResourceType.METALS,
    );
    expect(metals?.amount).toBe(1);
    expect(player.inventory.ownedGearIds ?? []).not.toContain(
      "salvaged_plating",
    );
    manager.destroy();
  });

  it("gear is collected even when the resource hold is full (gear isn't cargo)", () => {
    const { manager, player, inventory, capacity } = makeManager({
      fillHoldToCapacity: true,
    });
    const r = GAME_BALANCE.lootPickupRadius;
    manager.spawnLootForNpc(makeNpc("g", ["eq_tank"]), r - 5, 0, oneItemRng());

    manager.update(16, 0);

    expect(player.inventory.ownedGearIds).toContain("eq_tank");
    expect(manager.spaceLoot.length).toBe(0);
    const metals = inventory.resources.find(
      (m) => m.type === ResourceType.METALS,
    );
    expect(metals?.amount).toBe(capacity);
    manager.destroy();
  });

  it("a full hold skips a junk drop but still collects a gear drop later in the list", () => {
    const { manager, player, inventory, capacity } = makeManager({
      fillHoldToCapacity: true,
    });
    const r = GAME_BALANCE.lootPickupRadius;
    manager.spawnLootForNpc(makeNpc("g", ["eq_tank"]), r - 5, 0, oneItemRng());
    manager.spawnLootForNpc(
      makeNpc("j", ["salvaged_plating"]),
      r - 5,
      0,
      oneItemRng(),
    );
    expect(manager.spaceLoot.length).toBe(2);

    manager.update(16, 0);

    expect(player.inventory.ownedGearIds).toContain("eq_tank");
    expect(manager.spaceLoot.length).toBe(1);
    expect(manager.spaceLoot[0].moduleId).toBe("salvaged_plating");
    const metals = inventory.resources.find(
      (m) => m.type === ResourceType.METALS,
    );
    expect(metals?.amount).toBe(capacity);
    manager.destroy();
  });
});
