import { describe, it, expect, vi, afterEach } from "vitest";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import { gearById } from "@/systems/equipment/GearCatalog";
import type { GearListing } from "@/systems/info/GalacticRegistry";
import type { Renderer } from "@/presentation/Renderer";
import type { HullSpec } from "@/systems/equipment/GearCatalog";
import { PlanetType } from "@/types";
import { setFontScale } from "@/utils/fontScale";

afterEach(() => setFontScale("M"));

interface FakeNode {
  text: string;
  x: number;
  y: number;
  children: FakeNode[];
}

let created: FakeNode[] = [];

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
    children: FakeNode[] = [];
    on() {
      return this;
    }
    addChild(c: FakeNode) {
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
      created.push(this as unknown as FakeNode);
    }
  }
  return {
    Container,
    Graphics,
    Text,
    FederatedPointerEvent: class {},
  };
});

import {
  EquipmentShopScene,
  installedSameClass,
  gearComparisonSuffix,
} from "@/presentation/EquipmentShopScene";

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

function makeEngine(loadout: ShipLoadout, playSfx: () => Promise<void>) {
  const inventory = {
    ownedGearIds: [] as string[],
    micromodules: [] as unknown[],
    resources: [] as Array<{ type: string; amount: number }>,
    modules: [] as Array<{ id: string; name: string }>,
    removeOwnedGear: () => true,
    addOwnedGear: () => {},
  };
  return {
    player: {
      credits: 500000,
      currentSystemId: "sys1",
      ship: { hullClass: "SCOUT", hullHP: 80, maxHull: 100 },
      isHostileTo: () => false,
      inventory,
    },
    playerLoadout: loadout,
    bank: null,
    galaxy: { id: "g1", gameDays: 0, systems: [{ id: "sys1", stations: [] }] },
    audio: { playSfx },
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

describe("EquipmentShopScene — purchase/sell sound cues (Task 4)", () => {
  it("plays the 'sell' cue on a sell (not the mis-wired 'buy')", () => {
    created = [];
    const playSfx = vi.fn(() => Promise.resolve());
    const loadout = new ShipLoadout("hull_scout");
    const scene = new EquipmentShopScene(renderer);
    scene.initialize({ gameEngine: makeEngine(loadout, playSfx), planet });
    (scene as unknown as { sellHoldItem: (id: string) => void }).sellHoldItem(
      "wpn_pulse",
    );
    expect(playSfx).toHaveBeenCalledWith("sell");
    expect(playSfx).not.toHaveBeenCalledWith("buy");
  });

  it("plays the 'buy' cue on a gear purchase", () => {
    created = [];
    const playSfx = vi.fn(() => Promise.resolve());
    const loadout = new ShipLoadout("hull_scout");
    const scene = new EquipmentShopScene(renderer);
    scene.initialize({ gameEngine: makeEngine(loadout, playSfx), planet });
    const listing: GearListing = {
      systemId: "sys1",
      planetId: "p1",
      gear: gearById("wpn_pulse")!,
      price: 200,
    };
    (scene as unknown as { buyItem: (l: GearListing) => void }).buyItem(
      listing,
    );
    expect(playSfx).toHaveBeenCalledWith("buy");
  });

  it("plays the 'buy' cue on a hull purchase (was silent)", () => {
    created = [];
    const playSfx = vi.fn(() => Promise.resolve());
    const loadout = new ShipLoadout("hull_scout");
    const scene = new EquipmentShopScene(renderer);
    scene.initialize({ gameEngine: makeEngine(loadout, playSfx), planet });
    const targetHull = gearById("hull_corvette") as HullSpec;
    expect(targetHull?.kind).toBe("HULL");
    const listing: GearListing = {
      systemId: "sys1",
      planetId: "p1",
      gear: targetHull,
      price: 1000,
    };
    (
      scene as unknown as {
        buyHull: (l: GearListing, h: HullSpec) => void;
      }
    ).buyHull(listing, targetHull);
    expect(playSfx).toHaveBeenCalledWith("buy");
  });
});

describe("EquipmentShopScene — weapon replacement comparison (Task 4)", () => {
  it("installedSameClass matches an installed weapon of the same weaponClass", () => {
    const beam = gearById("wpn_beam")!; // ENERGY
    const pulse = gearById("wpn_pulse")!; // ENERGY
    expect(installedSameClass(["wpn_pulse"], beam)).toBe(pulse);
    expect(installedSameClass(["wpn_railgun"], beam)).toBeNull();
  });

  it("gearComparisonSuffix compares weapons by damage", () => {
    const beam = gearById("wpn_beam")!; // damage 30
    const pulse = gearById("wpn_pulse")!; // damage 14
    const suffix = gearComparisonSuffix(beam, pulse);
    expect(suffix).toContain("+16");
    expect(suffix).toContain(`vs ${pulse.name}`);
  });

  it("renders the '→ replaces X' comparison on a weapon row", () => {
    created = [];
    const loadout = new ShipLoadout("hull_scout");
    expect(loadout.install("wpn_pulse")).toBe(true);
    const scene = new EquipmentShopScene(renderer);
    scene.initialize({
      gameEngine: makeEngine(loadout, () => Promise.resolve()),
      planet,
    });
    (scene as unknown as { listings: GearListing[] }).listings = [
      {
        systemId: "sys1",
        planetId: "p1",
        gear: gearById("wpn_beam")!,
        price: 1200,
      },
    ];
    created = [];
    (scene as unknown as { render: () => void }).render();
    const pulseName = gearById("wpn_pulse")!.name;
    const statNode = created.find((n) => n.text.includes(`vs ${pulseName}`));
    expect(statNode, "expected a weapon-comparison stat node").toBeTruthy();
  });
});
