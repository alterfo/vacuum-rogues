import { describe, it, expect, vi } from "vitest";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import { gearById, GearKind } from "@/systems/equipment/GearCatalog";
import type { GearListing } from "@/systems/info/GalacticRegistry";
import type { Renderer } from "@/presentation/Renderer";
import { PlanetType } from "@/types";

vi.mock("@/presentation/ui/gearIcon", () => ({
  mountGearIcon: () => 0,
  gearIconKey: () => undefined,
}));

vi.mock("pixi.js", () => {
  class FakeBase {
    x = 0;
    y = 0;
    width = 50;
    height = 14;
    alpha = 1;
    eventMode = "auto";
    cursor = "default";
    hitArea: unknown = null;
    style: Record<string, unknown> = {};
    anchor = { set: () => {} };
    children: unknown[] = [];
    on() {
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
    text: string;
    constructor(opts?: { text?: string }) {
      super();
      this.text = opts?.text ?? "";
    }
  }
  return {
    Container,
    Graphics,
    Text,
    FederatedPointerEvent: class {},
  };
});

import { EquipmentShopScene } from "@/presentation/EquipmentShopScene";

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

function makeEngine(loadout: ShipLoadout) {
  const inventory = {
    ownedGearIds: [] as string[],
    micromodules: [] as unknown[],
    resources: [] as Array<{ type: string; amount: number }>,
    modules: [] as Array<{ id: string; name: string }>,
  };
  return {
    player: {
      credits: 5000,
      currentSystemId: "sys1",
      ship: { hullClass: "SCOUT", hullHP: 80, maxHull: 100 },
      isHostileTo: () => false,
      inventory,
    },
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

function listingFor(id: string): GearListing {
  return {
    systemId: "sys1",
    planetId: "p1",
    gear: gearById(id)!,
    price: 200,
  };
}

describe("EquipmentShopScene hides already-installed gear (Task 5)", () => {
  it("omits an installed gear id from the gear-tab listing", () => {
    const loadout = new ShipLoadout("hull_scout");
    expect(loadout.install("wpn_pulse")).toBe(true);
    const scene = new EquipmentShopScene(renderer);
    scene.initialize({ gameEngine: makeEngine(loadout), planet });
    (scene as unknown as { listings: GearListing[] }).listings = [
      listingFor("wpn_pulse"),
      listingFor("wpn_beam"),
    ];

    const gearRows = (
      scene as unknown as { gearListings: () => GearListing[] }
    ).gearListings();

    expect(gearRows.map((l) => l.gear.id)).toEqual(["wpn_beam"]);
    scene.destroy();
  });

  it("leaves the full list unchanged when nothing is installed", () => {
    const loadout = new ShipLoadout("hull_scout");
    const scene = new EquipmentShopScene(renderer);
    scene.initialize({ gameEngine: makeEngine(loadout), planet });
    (scene as unknown as { listings: GearListing[] }).listings = [
      listingFor("wpn_pulse"),
      listingFor("wpn_beam"),
    ];

    const gearRows = (
      scene as unknown as { gearListings: () => GearListing[] }
    ).gearListings();

    expect(gearRows.map((l) => l.gear.id)).toEqual(["wpn_pulse", "wpn_beam"]);
    scene.destroy();
  });

  it("the hull tab is unaffected by the installed-gear filter (hulls stay excluded from gearListings for a separate reason)", () => {
    const loadout = new ShipLoadout("hull_scout");
    const scene = new EquipmentShopScene(renderer);
    scene.initialize({ gameEngine: makeEngine(loadout), planet });
    const hullListing: GearListing = {
      systemId: "sys1",
      planetId: "p1",
      gear: gearById("hull_scout")!,
      price: 1000,
    };
    expect(hullListing.gear.kind).toBe(GearKind.HULL);
    (scene as unknown as { listings: GearListing[] }).listings = [
      hullListing,
      listingFor("wpn_beam"),
    ];

    const gearRows = (
      scene as unknown as { gearListings: () => GearListing[] }
    ).gearListings();

    expect(gearRows.map((l) => l.gear.id)).toEqual(["wpn_beam"]);
    scene.destroy();
  });
});
