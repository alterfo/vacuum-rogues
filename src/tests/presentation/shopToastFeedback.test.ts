/**
 * Task 7 (quest-and-hub polish pass,
 * `docs/plans/20260726-quest-and-hub-polish-pass.md`): wire up silent
 * purchase/upgrade toast feedback.
 *
 * `showToast` is a no-op unless `this.toast` is a live node, and that node is
 * only mounted by `addToastSlot`. The gear/micromodule/research shop views in
 * StationScene and the СНАРЯЖЕНИЕ/КОРПУС tabs in EquipmentShopScene never called
 * `addToastSlot`, so buying/selling/upgrading gave zero on-screen feedback. This
 * suite drives the real scenes (through the standard fake-pixi mock) and asserts
 * a confirmation toast is queued (`this.toast` is live and carries the message)
 * after each newly-wired action.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Renderer } from "@/presentation/Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import type { Station } from "@/domain/Station";
import type { Planet } from "@/domain/Planet";
import type { GearListing } from "@/systems/info/GalacticRegistry";
import type { HullSpec } from "@/systems/equipment/GearCatalog";
import { StationType, PlanetType, ResourceType } from "@/types";

interface FakeNode {
  text: string;
  alpha: number;
  handlers: Record<string, (e: unknown) => void>;
  children: FakeNode[];
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
    roundRect() {
      return this;
    }
    moveTo() {
      return this;
    }
    lineTo() {
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

// Imported AFTER the mock so the scenes + their helpers see the fake pixi.
import { StationScene } from "@/presentation/StationScene";
import { EquipmentShopScene } from "@/presentation/EquipmentShopScene";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import { gearById } from "@/systems/equipment/GearCatalog";
import { micromoduleShopCatalog } from "@/systems/equipment/micromoduleShop";

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

/** Minimal player/engine stub sufficient for the shop render + buy paths. */
function makeEngine(opts?: {
  loadout?: ShipLoadout | null;
  artifacts?: number;
}) {
  const inventory = {
    ownedGearIds: [] as string[],
    modules: [] as Array<{ id: string; name: string }>,
    micromodules: [] as unknown[],
    resources:
      opts?.artifacts !== undefined
        ? [{ type: ResourceType.ARTIFACTS, amount: opts.artifacts }]
        : ([] as Array<{ type: string; amount: number }>),
    addOwnedGear: vi.fn(),
    removeOwnedGear: vi.fn(() => true),
  };
  return {
    player: {
      credits: 1_000_000,
      currentSystemId: "sys1",
      currentAccountId: "acc1",
      rank: 0,
      ship: { hullHP: 80, maxHull: 100, energy: 40, maxEnergy: 50 },
      isHostileTo: () => false,
      inventory,
    },
    playerLoadout: opts?.loadout ?? null,
    playerLoadoutPresets: [],
    bank: null,
    galaxy: { id: "g1", gameDays: 0, systems: [{ id: "sys1", stations: [] }] },
    audio: { playSfx: vi.fn(() => Promise.resolve()) },
    questManager: {
      getActiveQuests: () => [],
      getCompletedQuestIds: () => [],
      getPendingReturnQuests: () => [],
      claimReturnReward: vi.fn(() => true),
    },
    transitionTo: vi.fn().mockResolvedValue(undefined),
  } as unknown as GameEngine;
}

function station(type: StationType): Station {
  return { id: "base-1", name: "Тест-база", type } as unknown as Station;
}

const planet = {
  id: "p1",
  name: "Тест-мир",
  type: PlanetType.HABITAT,
} as unknown as Planet;

function toast(scene: object): FakeNode | null {
  return (scene as { toast: FakeNode | null }).toast;
}

/** First created Text with the given exact label that has a click handler. */
function clickableLabel(label: string): FakeNode | undefined {
  return created.find(
    (n) => n.text === label && typeof n.handlers?.pointerdown === "function",
  );
}

function fire(node: FakeNode): void {
  node.handlers.pointerdown({ stopPropagation: () => {} });
}

beforeEach(() => {
  created.length = 0;
  vi.clearAllMocks();
});

describe("StationScene — shop-view toast feedback (Task 7)", () => {
  it("confirms a gear purchase in the МАГАЗИН СНАРЯЖЕНИЯ view", () => {
    const scene = new StationScene(renderer);
    scene.initialize({
      gameEngine: makeEngine(),
      station: station(StationType.TRADE_POST),
    });
    (scene as unknown as { view: string }).view = "shop";
    (scene as unknown as { render: () => void }).render();

    const gear = gearById("wpn_pulse")!;
    const listing: GearListing = {
      systemId: "sys1",
      planetId: "base-1",
      gear,
      price: 200,
    };
    (scene as unknown as { buyItem: (l: GearListing) => void }).buyItem(
      listing,
    );

    const t = toast(scene);
    expect(t).not.toBeNull();
    expect(t!.text).toContain("Куплено");
    expect(t!.text).toContain(gear.name);
    expect(t!.alpha).toBe(1);

    scene.destroy();
  });

  it("confirms a micromodule purchase in the МИКРОМОДУЛИ view", () => {
    const scene = new StationScene(renderer);
    scene.initialize({
      gameEngine: makeEngine(),
      station: station(StationType.CRAFT_CENTER),
    });
    (
      scene as unknown as { micromoduleListings: unknown[] }
    ).micromoduleListings = micromoduleShopCatalog();
    (scene as unknown as { view: string }).view = "micromodules";
    created.length = 0;
    (scene as unknown as { render: () => void }).render();

    const buyBtn = clickableLabel("[Купить]");
    expect(
      buyBtn,
      "expected an interactive [Купить] micromodule button",
    ).toBeTruthy();
    fire(buyBtn!);

    const t = toast(scene);
    expect(t).not.toBeNull();
    expect(t!.text).toContain("Куплено");
    expect(t!.alpha).toBe(1);

    scene.destroy();
  });

  it("confirms a research upgrade in the ИССЛЕДОВАТЕЛЬСКАЯ ЛАБОРАТОРИЯ view", () => {
    const loadout = new ShipLoadout("hull_scout");
    expect(loadout.install("wpn_pulse")).toBe(true);
    const scene = new StationScene(renderer);
    scene.initialize({
      gameEngine: makeEngine({ loadout, artifacts: 20 }),
      station: station(StationType.RESEARCH_LAB),
    });
    (scene as unknown as { view: string }).view = "research";
    created.length = 0;
    (scene as unknown as { render: () => void }).render();

    // A live toast slot exists in the research view (the reported bug: it was
    // null, so the panel's showToast callback no-op'd).
    expect(toast(scene)).not.toBeNull();

    const upgradeBtn = clickableLabel("[Улучшить]");
    expect(
      upgradeBtn,
      "expected an interactive [Улучшить] button",
    ).toBeTruthy();
    fire(upgradeBtn!);

    const t = toast(scene);
    expect(t).not.toBeNull();
    expect(t!.text).toContain("улучшен");
    expect(t!.alpha).toBe(1);

    scene.destroy();
  });
});

describe("EquipmentShopScene — gear/hull tab toast feedback (Task 7)", () => {
  it("confirms a gear purchase on the СНАРЯЖЕНИЕ tab", () => {
    const scene = new EquipmentShopScene(renderer);
    scene.initialize({
      gameEngine: makeEngine({ loadout: new ShipLoadout("hull_scout") }),
      planet,
    });
    const gear = gearById("wpn_pulse")!;
    const listing: GearListing = {
      systemId: "sys1",
      planetId: "p1",
      gear,
      price: 200,
    };
    (scene as unknown as { buyItem: (l: GearListing) => void }).buyItem(
      listing,
    );

    const t = toast(scene);
    expect(t).not.toBeNull();
    expect(t!.text).toContain("Куплено");
    expect(t!.text).toContain(gear.name);
    expect(t!.alpha).toBe(1);

    scene.destroy();
  });

  it("confirms a gear sale on the СНАРЯЖЕНИЕ tab", () => {
    const engine = makeEngine({ loadout: new ShipLoadout("hull_scout") });
    // Own an uninstalled item to sell (sellUninstalledGear reads the warehouse).
    (
      engine.player!.inventory as unknown as { ownedGearIds: string[] }
    ).ownedGearIds.push("wpn_pulse");
    const scene = new EquipmentShopScene(renderer);
    scene.initialize({ gameEngine: engine, planet });
    (scene as unknown as { sellHoldItem: (id: string) => void }).sellHoldItem(
      "wpn_pulse",
    );

    const t = toast(scene);
    expect(t).not.toBeNull();
    expect(t!.text).toContain("Продано");
    expect(t!.alpha).toBe(1);

    scene.destroy();
  });

  it("confirms a hull purchase on the КОРПУС tab (was silent)", () => {
    const scene = new EquipmentShopScene(renderer);
    scene.initialize({
      gameEngine: makeEngine({ loadout: new ShipLoadout("hull_scout") }),
      planet,
    });
    (scene as unknown as { activeTab: string }).activeTab = "hull";
    const hull = gearById("hull_corvette") as HullSpec;
    const listing: GearListing = {
      systemId: "sys1",
      planetId: "p1",
      gear: hull,
      price: 1000,
    };
    (
      scene as unknown as { buyHull: (l: GearListing, h: HullSpec) => void }
    ).buyHull(listing, hull);

    const t = toast(scene);
    expect(t).not.toBeNull();
    expect(t!.text).toContain("корпус");
    expect(t!.text).toContain(hull.name);
    expect(t!.alpha).toBe(1);

    scene.destroy();
  });
});
