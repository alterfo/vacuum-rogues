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

describe("Gravity tractor — derived stat", () => {
  it("grav_tractor_2 yields gravTractorRange 150", () => {
    const lo = new ShipLoadout("hull_corvette");
    lo.install("grav_tractor_2");
    expect(lo.derivedStats().gravTractorRange).toBe(150);
  });

  it("no tractor installed → gravTractorRange 0", () => {
    const lo = new ShipLoadout("hull_corvette");
    lo.install("eq_engine_i");
    expect(lo.derivedStats().gravTractorRange).toBe(0);
  });

  it("tier 1 / tier 3 ranges match the catalog (80 / 250)", () => {
    const lo1 = new ShipLoadout("hull_corvette");
    lo1.install("grav_tractor_1");
    expect(lo1.derivedStats().gravTractorRange).toBe(80);

    const lo3 = new ShipLoadout("hull_corvette");
    lo3.install("grav_tractor_3");
    expect(lo3.derivedStats().gravTractorRange).toBe(250);
  });

  it("best tractor wins when two are installed", () => {
    const lo = new ShipLoadout("hull_bastion"); // 9 slots
    lo.install("grav_tractor_1"); // 80
    lo.install("grav_tractor_3"); // 250 → wins
    expect(lo.derivedStats().gravTractorRange).toBe(250);
  });
});

function makeNpc(id: string): NpcShip {
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
    loadoutSummary: ["laser_mk1"],
  });
}

function seqRng(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

function makeManager(opts: {
  tractorGearId?: string;
  cargoCapacity?: number;
  preFill?: number;
  fillHoldToCapacity?: boolean;
  shipX?: number;
  shipY?: number;
}): { manager: NpcShipManager; inventory: Inventory; capacity: number } {
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
  if (opts.preFill) inventory.addResource(ResourceType.METALS, opts.preFill);
  if (opts.fillHoldToCapacity)
    inventory.addResource(ResourceType.METALS, capacity);

  const player = {
    currentSystemId: "sys_a",
    inventory,
    ship: { cargoCapacity: opts.cargoCapacity ?? 100 },
  };
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

  return {
    manager: new NpcShipManager(renderer, gameEngine, gameLayer, uiLayer, deps),
    inventory,
    capacity,
  };
}

describe("Gravity tractor — auto-pickup", () => {
  it("picks up loot within tractor range", () => {
    const { manager, inventory } = makeManager({
      tractorGearId: "grav_tractor_2",
    });
    manager.spawnLootForNpc(makeNpc("t"), 100, 0, seqRng([0.5]));
    expect(manager.spaceLoot.length).toBe(1);

    manager.update(16, 0);

    expect(manager.spaceLoot.length).toBe(0);
    const metals = inventory.resources.find(
      (r) => r.type === ResourceType.METALS,
    );
    expect(metals?.amount).toBe(1);
    manager.destroy();
  });

  it("does not pick up loot beyond tractor range", () => {
    const { manager, inventory } = makeManager({
      tractorGearId: "grav_tractor_2",
    });
    manager.spawnLootForNpc(makeNpc("t"), 500, 0, seqRng([0.5]));
    expect(manager.spaceLoot.length).toBe(1);

    manager.update(16, 0);

    expect(manager.spaceLoot.length).toBe(1);
    expect(inventory.resources.length).toBe(0);
    manager.destroy();
  });

  it("does not pick up loot when no tractor is equipped", () => {
    const { manager } = makeManager({ tractorGearId: "eq_engine_i" });
    manager.spawnLootForNpc(makeNpc("t"), 50, 0, seqRng([0.5]));

    manager.update(16, 0);

    expect(manager.spaceLoot.length).toBe(1);
    manager.destroy();
  });

  it("does not pick up loot when cargo is full", () => {
    const { manager, inventory, capacity } = makeManager({
      tractorGearId: "grav_tractor_2",
      fillHoldToCapacity: true,
    });
    manager.spawnLootForNpc(makeNpc("t"), 50, 0, seqRng([0.5]));

    manager.update(16, 0);

    expect(manager.spaceLoot.length).toBe(1);
    const metals = inventory.resources.find(
      (r) => r.type === ResourceType.METALS,
    );
    expect(metals?.amount).toBe(capacity); // full hold — nothing added
    manager.destroy();
  });

  it("picks up an Overmind artifact into the ARTIFACTS hold", () => {
    const { manager, inventory } = makeManager({
      tractorGearId: "grav_tractor_3",
    });
    const overmind = new NpcShip({
      id: "ov",
      name: "ov",
      race: FactionType.OUTLANDERS,
      faction: Faction.OVERMIND,
      role: NpcRole.PATROL,
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
      loadoutSummary: [],
    });
    manager.spawnLootForNpc(overmind, 80, 0, seqRng([0.5, 0.1]));
    expect(manager.spaceLoot[0].artifactId).toBe("ARTIFACTS");

    manager.update(16, 0);

    expect(manager.spaceLoot.length).toBe(0);
    const arts = inventory.resources.find(
      (r) => r.type === ResourceType.ARTIFACTS,
    );
    expect(arts?.amount).toBe(1);
    manager.destroy();
  });
});
