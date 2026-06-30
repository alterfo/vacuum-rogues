import { describe, it, expect, vi } from "vitest";
import { Container } from "pixi.js";
import {
  LootDropHandler,
  type LootPickupDeps,
} from "@/presentation/flight/LootDropHandler";
import { NpcShip } from "@/domain/NpcShip";
import { NpcRole, NpcState, FactionType, ResourceType } from "@/types";
import { Faction } from "@/types/faction";
import { Inventory } from "@/domain/Inventory";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import { cargoCapacityOf } from "@/systems/equipment/GearBridge";
import { GAME_BALANCE } from "@/config/balance";

function makeNpc(
  id: string,
  opts: { faction?: Faction; loadout?: string[] } = {},
): NpcShip {
  return new NpcShip({
    id,
    name: id,
    race: FactionType.OUTLANDERS,
    faction: opts.faction ?? Faction.INDEPENDENT,
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
    loadoutSummary: opts.loadout ?? [],
  });
}

/** Deterministic RNG cycling through a fixed sequence of [0,1) values. */
function seqRng(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

function makeHandler(): { handler: LootDropHandler; gameLayer: Container } {
  const gameLayer = new Container();
  return { handler: new LootDropHandler(gameLayer), gameLayer };
}

function makeDeps(opts: {
  shipX?: number;
  shipY?: number;
  fillHold?: boolean;
}): { deps: LootPickupDeps; inventory: Inventory; messages: string[] } {
  const inventory = new Inventory();
  const loadout = new ShipLoadout("hull_corvette");
  const messages: string[] = [];

  if (opts.fillHold) {
    const cap = cargoCapacityOf(loadout);
    inventory.addResource(ResourceType.METALS, cap);
  }

  const deps: LootPickupDeps = {
    getPlayer: () => ({ inventory }) as never,
    getLoadout: () => loadout,
    getShipPosition: () => ({
      x: opts.shipX ?? 0,
      y: opts.shipY ?? 0,
    }),
    showMessage: (m) => messages.push(m),
  };
  return { deps, inventory, messages };
}

describe("LootDropHandler", () => {
  describe("spawn", () => {
    it("creates items at the given world position", () => {
      const { handler } = makeHandler();
      handler.spawn(makeNpc("t"), 321, 654, seqRng([0.9]));
      for (const item of handler.spaceLoot) {
        expect(item.x).toBe(321);
        expect(item.y).toBe(654);
      }
      handler.destroy();
    });

    it("mounts a glowing Graphics dot per item", () => {
      const { handler, gameLayer } = makeHandler();
      handler.spawn(
        makeNpc("t", { loadout: ["laser_mk1"] }),
        0,
        0,
        seqRng([0.9]),
      );
      expect(handler.spaceLoot.length).toBe(2);
      expect(handler.lootGraphics.size).toBe(2);
      expect(gameLayer.children.length).toBe(2);
      handler.destroy();
    });

    it("drops 0 items on a low roll", () => {
      const { handler } = makeHandler();
      handler.spawn(makeNpc("t"), 0, 0, seqRng([0.1]));
      expect(handler.spaceLoot.length).toBe(0);
      expect(handler.lootGraphics.size).toBe(0);
      handler.destroy();
    });

    it("drops Overmind artifacts from an Overmind NPC", () => {
      const { handler } = makeHandler();
      // count roll 0.5 → 1 item; artifact roll 0.1 < 0.4 → artifact
      handler.spawn(
        makeNpc("ov", { faction: Faction.OVERMIND }),
        0,
        0,
        seqRng([0.5, 0.1]),
      );
      expect(handler.spaceLoot.length).toBe(1);
      expect(handler.spaceLoot[0].artifactId).toBe("ARTIFACTS");
      expect(handler.spaceLoot[0].moduleId).toBeUndefined();
      handler.destroy();
    });

    it("drops modules from a non-Overmind NPC", () => {
      const { handler } = makeHandler();
      handler.spawn(
        makeNpc("p", { loadout: ["shield_mk2"] }),
        0,
        0,
        seqRng([0.9]),
      );
      for (const item of handler.spaceLoot) {
        expect(item.moduleId).toBeDefined();
        expect(item.artifactId).toBeUndefined();
      }
      handler.destroy();
    });
  });

  describe("update — TTL despawn", () => {
    it("despawns items older than 60 seconds", () => {
      const { handler, gameLayer } = makeHandler();
      handler.spawn(makeNpc("t"), 0, 0, seqRng([0.9]));
      expect(handler.spaceLoot.length).toBe(2);

      for (let i = 0; i < 61; i++) handler.update(1000);

      expect(handler.spaceLoot.length).toBe(0);
      expect(handler.lootGraphics.size).toBe(0);
      expect(gameLayer.children.length).toBe(0);
      handler.destroy();
    });

    it("keeps items alive before the 60 s lifetime elapses", () => {
      const { handler } = makeHandler();
      handler.spawn(makeNpc("t"), 0, 0, seqRng([0.9]));

      for (let i = 0; i < 30; i++) handler.update(1000);

      expect(handler.spaceLoot.length).toBe(2);
      handler.destroy();
    });
  });

  describe("collectIfInRange", () => {
    it("collects a drop within the base pickup radius", () => {
      const { handler } = makeHandler();
      const r = GAME_BALANCE.lootPickupRadius;
      handler.spawn(makeNpc("t"), r - 5, 0, seqRng([0.5]));
      expect(handler.spaceLoot.length).toBe(1);

      const { deps, inventory } = makeDeps({ shipX: 0, shipY: 0 });
      handler.update(16);
      handler.collectIfInRange(deps);

      expect(handler.spaceLoot.length).toBe(0);
      const metals = inventory.resources.find(
        (m) => m.type === ResourceType.METALS,
      );
      expect(metals?.amount).toBe(1);
      handler.destroy();
    });

    it("does NOT collect a drop beyond the base radius (no tractor)", () => {
      const { handler } = makeHandler();
      const r = GAME_BALANCE.lootPickupRadius;
      handler.spawn(makeNpc("t"), r + 40, 0, seqRng([0.5]));

      const { deps, inventory } = makeDeps({ shipX: 0, shipY: 0 });
      handler.update(16);
      handler.collectIfInRange(deps);

      expect(handler.spaceLoot.length).toBe(1);
      expect(inventory.resources.length).toBe(0);
      handler.destroy();
    });

    it("does not collect when ship position is unavailable", () => {
      const { handler } = makeHandler();
      handler.spawn(makeNpc("t"), 0, 0, seqRng([0.5]));

      const deps: LootPickupDeps = {
        getPlayer: () => null,
        getLoadout: () => new ShipLoadout("hull_corvette"),
        getShipPosition: () => null,
        showMessage: vi.fn(),
      };
      handler.update(16);
      handler.collectIfInRange(deps);

      expect(handler.spaceLoot.length).toBe(1);
      handler.destroy();
    });

    it("leaves resource drops in space when hold is full", () => {
      const { handler } = makeHandler();
      const r = GAME_BALANCE.lootPickupRadius;
      handler.spawn(makeNpc("t"), r - 5, 0, seqRng([0.5]));

      const { deps, inventory } = makeDeps({
        shipX: 0,
        shipY: 0,
        fillHold: true,
      });
      handler.update(16);
      handler.collectIfInRange(deps);

      expect(handler.spaceLoot.length).toBe(1);
      const metals = inventory.resources.find(
        (m) => m.type === ResourceType.METALS,
      );
      // The hold stays at capacity — no extra unit added above what we seeded.
      const expectedCap = cargoCapacityOf(new ShipLoadout("hull_corvette"));
      expect(metals?.amount).toBe(expectedCap);
      handler.destroy();
    });

    it("collects an Overmind artifact drop as ResourceType.ARTIFACTS (not METALS)", () => {
      const { handler } = makeHandler();
      const r = GAME_BALANCE.lootPickupRadius;
      // count roll 0.5 → 1 item; artifact roll 0.1 < 0.4 → artifact
      handler.spawn(
        makeNpc("ov", { faction: Faction.OVERMIND }),
        r - 5,
        0,
        seqRng([0.5, 0.1]),
      );
      expect(handler.spaceLoot[0].artifactId).toBe("ARTIFACTS");

      const { deps, inventory } = makeDeps({ shipX: 0, shipY: 0 });
      handler.update(16);
      handler.collectIfInRange(deps);

      expect(handler.spaceLoot.length).toBe(0);
      const artifacts = inventory.resources.find(
        (r) => r.type === ResourceType.ARTIFACTS,
      );
      expect(artifacts?.amount).toBe(1);
      const metals = inventory.resources.find(
        (r) => r.type === ResourceType.METALS,
      );
      expect(metals).toBeUndefined();
      handler.destroy();
    });

    it("cleans up the glowing dot graphic on pickup (no Graphics leak)", () => {
      const { handler, gameLayer } = makeHandler();
      const r = GAME_BALANCE.lootPickupRadius;
      handler.spawn(makeNpc("t"), r - 5, 0, seqRng([0.5]));
      expect(handler.lootGraphics.size).toBe(1);
      expect(gameLayer.children.length).toBe(1);

      const { deps } = makeDeps({ shipX: 0, shipY: 0 });
      handler.update(16);
      handler.collectIfInRange(deps);

      expect(handler.spaceLoot.length).toBe(0);
      expect(handler.lootGraphics.size).toBe(0);
      expect(gameLayer.children.length).toBe(0);
      handler.destroy();
    });
  });

  describe("destroy", () => {
    it("clears all loot items and disposes dots", () => {
      const { handler, gameLayer } = makeHandler();
      handler.spawn(makeNpc("t"), 0, 0, seqRng([0.9]));
      expect(handler.spaceLoot.length).toBe(2);

      handler.destroy();

      expect(handler.spaceLoot.length).toBe(0);
      expect(handler.lootGraphics.size).toBe(0);
      expect(gameLayer.children.length).toBe(0);
    });
  });
});
