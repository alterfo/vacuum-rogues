import { describe, it, expect, vi, beforeEach } from "vitest";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import { ownedUninstalledGear } from "@/systems/equipment/GearBridge";
import { gearById } from "@/systems/equipment/GearCatalog";
import type { GearListing } from "@/systems/info/GalacticRegistry";
import type { Renderer } from "@/presentation/Renderer";
import { PlanetType, StationType } from "@/types";

/**
 * Task 4 (screen consistency) — gear-buy parity guard (➕A).
 *
 * The same «buy this gear» action must land in the SAME place regardless of
 * entry point. SR-canon: the shop is a warehouse counter — a purchase drops into
 * the owned-uninstalled store (ТРЮМ) and fitting is a separate hangar action; the
 * shop NEVER auto-installs. The planet Верфь gear tab already did this; the
 * in-space station shop used to auto-install into a free slot (and offered a
 * forked gear trade-in modal the planet lacks). These tests boot both real scenes
 * and call their private `buyItem(listing)` with the SAME listing + a free slot,
 * asserting both warehouse the purchase identically (no auto-install) and that the
 * forked station trade-in path is gone.
 */

interface FakeNode {
  text: string;
  handlers: Record<string, (e: unknown) => void>;
}

const created: FakeNode[] = [];

vi.mock("pixi.js", () => {
  class FakeBase {
    handlers: Record<string, (e: unknown) => void> = {};
    children: unknown[] = [];
    x = 0;
    y = 0;
    width = 50;
    height = 14;
    alpha = 1;
    tint = 0xffffff;
    eventMode = "auto";
    cursor = "default";
    hitArea: unknown = null;
    mask: unknown = null;
    style: Record<string, unknown> = {};
    anchor = { set: () => {} };
    on(ev: string, cb: (e: unknown) => void) {
      this.handlers[ev] = cb;
      return this;
    }
    addChild(c: unknown) {
      this.children.push(c);
      return c;
    }
    removeChild() {}
    removeChildren() {
      const c = this.children;
      this.children = [];
      return c;
    }
    destroy() {}
  }
  class Container extends FakeBase {}
  class Graphics extends FakeBase {
    rect() {
      return this;
    }
    fill() {
      return this;
    }
    stroke() {
      return this;
    }
    clear() {
      return this;
    }
  }
  class Text extends FakeBase {
    text = "";
    constructor(opts?: { text?: string; style?: Record<string, unknown> }) {
      super();
      this.text = opts?.text ?? "";
      this.style = opts?.style ?? {};
      created.push(this as unknown as FakeNode);
    }
  }
  class Rectangle {
    constructor(
      public x = 0,
      public y = 0,
      public w = 0,
      public h = 0,
    ) {}
  }
  return {
    Container,
    Graphics,
    Text,
    Rectangle,
    FederatedPointerEvent: class {},
  };
});

// Imported AFTER the mock so every scene sees the fake pixi.
import { EquipmentShopScene } from "@/presentation/EquipmentShopScene";
import { StationScene } from "@/presentation/StationScene";

const renderer = {
  app: {
    screen: { width: 1280, height: 800 },
    stage: { eventMode: "auto", on: vi.fn(), off: vi.fn() },
  },
  uiLayer: { addChild: vi.fn(), removeChild: vi.fn(), children: [] },
  gameLayer: { addChild: vi.fn(), removeChild: vi.fn(), children: [] },
  clearGameLayer: vi.fn(),
  clearUILayer: vi.fn(),
} as unknown as Renderer;

function makePlayer(credits = 5000) {
  const inventory = {
    ownedGearIds: [] as string[],
    micromodules: [] as unknown[],
    resources: [] as Array<{ type: string; amount: number }>,
    modules: [] as Array<{ id: string; name: string }>,
    addItem: vi.fn(),
    addOwnedGear(id: string) {
      this.ownedGearIds.push(id);
    },
    removeOwnedGear(id: string) {
      const i = this.ownedGearIds.indexOf(id);
      if (i >= 0) {
        this.ownedGearIds.splice(i, 1);
        return true;
      }
      return false;
    },
  };
  return {
    credits,
    currentSystemId: "sys1",
    ship: {
      hullClass: "SCOUT",
      hullHP: 80,
      maxHull: 100,
      energy: 40,
      maxEnergy: 50,
    },
    isHostileTo: () => false,
    inventory,
  };
}

function makeEngine(loadout: ShipLoadout, player = makePlayer()) {
  return {
    player,
    playerLoadout: loadout,
    bank: null,
    galaxy: { id: "g1", gameDays: 0, systems: [{ id: "sys1", stations: [] }] },
    audio: { playSfx: () => Promise.resolve() },
    questManager: {
      getActiveQuests: () => [],
      getCompletedQuestIds: () => [],
      getPendingReturnQuests: () => [],
    },
    transitionTo: vi.fn().mockResolvedValue(undefined),
  } as unknown as import("@/systems/GameEngine").GameEngine;
}

const planet = {
  id: "p1",
  name: "Тест-мир",
  type: PlanetType.HABITAT,
} as unknown as import("@/domain/Planet").Planet;

const tradeStation = {
  id: "st_trade",
  name: "Торговый пост",
  type: StationType.TRADE_POST,
  faction: "INDEPENDENT",
} as unknown as import("@/domain/Station").Station;

/** A weapon listing — a fresh SCOUT hull has a free weapon slot. */
function weaponListing(price = 200): GearListing {
  return {
    systemId: "sys1",
    planetId: "p1",
    gear: gearById("wpn_pulse")!,
    price,
  };
}

describe("Gear-buy parity — planet Верфь ⇄ in-space station shop (➕A)", () => {
  beforeEach(() => {
    created.length = 0;
  });

  it("a planet purchase with a free slot lands in the warehouse, never auto-fitted", () => {
    const loadout = new ShipLoadout("hull_scout"); // free weapon slot
    const engine = makeEngine(loadout);
    const scene = new EquipmentShopScene(renderer);
    scene.initialize({ gameEngine: engine, planet });

    (scene as unknown as { buyItem: (l: GearListing) => void }).buyItem(
      weaponListing(),
    );

    expect(ownedUninstalledGear(engine.player!, loadout)).toEqual([
      "wpn_pulse",
    ]);
    expect(loadout.installedGearIds()).not.toContain("wpn_pulse");
    scene.destroy();
  });

  it("a station purchase with a free slot now lands in the warehouse too (no auto-install)", () => {
    const loadout = new ShipLoadout("hull_scout"); // free weapon slot
    const engine = makeEngine(loadout);
    const scene = new StationScene(renderer);
    scene.initialize({ gameEngine: engine, station: tradeStation });

    (scene as unknown as { buyItem: (l: GearListing) => void }).buyItem(
      weaponListing(),
    );

    // The previous behaviour auto-installed into the free slot; canon is the
    // warehouse path the planet uses.
    expect(ownedUninstalledGear(engine.player!, loadout)).toEqual([
      "wpn_pulse",
    ]);
    expect(loadout.installedGearIds()).not.toContain("wpn_pulse");
    scene.destroy();
  });

  it("both entry points produce identical owned-gear + credits after the same buy", () => {
    const price = 200;
    const planetLoadout = new ShipLoadout("hull_scout");
    const planetEngine = makeEngine(planetLoadout);
    const planetScene = new EquipmentShopScene(renderer);
    planetScene.initialize({ gameEngine: planetEngine, planet });
    (planetScene as unknown as { buyItem: (l: GearListing) => void }).buyItem(
      weaponListing(price),
    );

    created.length = 0;
    const stationLoadout = new ShipLoadout("hull_scout");
    const stationEngine = makeEngine(stationLoadout);
    const stationScene = new StationScene(renderer);
    stationScene.initialize({
      gameEngine: stationEngine,
      station: tradeStation,
    });
    (stationScene as unknown as { buyItem: (l: GearListing) => void }).buyItem(
      weaponListing(price),
    );

    // Same place (warehouse), same loadout (untouched), same credit deduction.
    expect(ownedUninstalledGear(stationEngine.player!, stationLoadout)).toEqual(
      ownedUninstalledGear(planetEngine.player!, planetLoadout),
    );
    expect(stationLoadout.installedGearIds()).toEqual(
      planetLoadout.installedGearIds(),
    );
    expect(stationEngine.player!.credits).toBe(planetEngine.player!.credits);
    expect(stationEngine.player!.credits).toBe(5000 - price);

    planetScene.destroy();
    stationScene.destroy();
  });

  it("the forked station gear trade-in path is gone (no scene-local swap surface)", () => {
    // The auto-install + gear trade-in modal was the divergence; aligning to the
    // canonical warehouse buy removes both. No `buyItemWithTradeIn` /
    // `showTradeInModal` should remain on the station scene.
    const proto = StationScene.prototype as unknown as Record<string, unknown>;
    expect(proto.buyItemWithTradeIn).toBeUndefined();
    expect(proto.showTradeInModal).toBeUndefined();
  });
});
