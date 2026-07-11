import { describe, it, expect, vi, beforeEach } from "vitest";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import type { Renderer } from "@/presentation/Renderer";
import { PlanetType } from "@/types";
import type { GearListing } from "@/systems/info/GalacticRegistry";

/**
 * Task 1 (gear-variety-and-hangar plan): `StationScene.buildShopInventory`
 * threads the owning system's `techLevel` into `generateShop` as
 * `maxTechLevel` so an in-space shop can't stock gear above the local
 * system's tech; `EquipmentShopScene.buildShopInventory` (planet shops) never
 * did this, so a low-tech planet could stock any tech-level item. Mirrors
 * `shopGenerator.test.ts`'s gating assertions through the scene path.
 */

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

// Imported AFTER the mock so the scene + scaledText see the fake pixi.
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

function makePlayer() {
  const inventory = {
    ownedGearIds: [] as string[],
    micromodules: [] as unknown[],
    resources: [] as Array<{ type: string; amount: number }>,
    modules: [] as Array<{ id: string; name: string }>,
    addItem: vi.fn(),
  };
  return {
    credits: 5000,
    currentSystemId: "sys1",
    ship: { hullClass: "SCOUT", maxHull: 100, energy: 40, maxEnergy: 50 },
    inventory,
  };
}

function makeEngine(loadout: ShipLoadout, systemTechLevel: number) {
  return {
    player: makePlayer(),
    playerLoadout: loadout,
    bank: null,
    galaxy: {
      id: "g1",
      gameDays: 0,
      systems: [{ id: "sys1", techLevel: systemTechLevel }],
    },
    audio: { playSfx: () => Promise.resolve() },
    transitionTo: vi.fn().mockResolvedValue(undefined),
  } as unknown as import("@/systems/GameEngine").GameEngine;
}

const planet = {
  id: "p1",
  name: "Тест-мир",
  type: PlanetType.TERRESTRIAL,
} as unknown as import("@/domain/Planet").Planet;

function shopListings(scene: EquipmentShopScene): GearListing[] {
  return (scene as unknown as { listings: GearListing[] }).listings;
}

describe("EquipmentShopScene — planet shop respects system techLevel gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("a techLevel-2 system never stocks tech-4+ gear", () => {
    const loadout = new ShipLoadout("hull_scout");
    const scene = new EquipmentShopScene(renderer);
    scene.initialize({ gameEngine: makeEngine(loadout, 2), planet });

    const listings = shopListings(scene);
    expect(listings.length).toBeGreaterThan(0);
    for (const l of listings) {
      expect(l.gear.techLevel).toBeLessThanOrEqual(2);
    }

    scene.destroy();
  });

  it("a techLevel-8 system can stock high-tech gear", () => {
    const loadout = new ShipLoadout("hull_scout");
    const scene = new EquipmentShopScene(renderer);
    scene.initialize({ gameEngine: makeEngine(loadout, 8), planet });

    const listings = shopListings(scene);
    const maxFound = Math.max(...listings.map((l) => l.gear.techLevel));
    expect(maxFound).toBeGreaterThanOrEqual(4);

    scene.destroy();
  });
});
