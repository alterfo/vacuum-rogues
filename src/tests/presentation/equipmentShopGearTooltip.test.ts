import { describe, it, expect, vi, afterEach } from "vitest";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import { gearById } from "@/systems/equipment/GearCatalog";
import type { GearListing } from "@/systems/info/GalacticRegistry";
import type { Renderer } from "@/presentation/Renderer";
import { PlanetType } from "@/types";
import { setFontScale } from "@/utils/fontScale";

afterEach(() => setFontScale("M"));

interface FakeNode {
  text: string;
  x: number;
  y: number;
  eventMode: string;
  destroyed: boolean;
  children: FakeNode[];
  handlers: Record<string, () => void>;
}

let texts: FakeNode[] = [];
let graphicsNodes: FakeNode[] = [];

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
    destroyed = false;
    handlers: Record<string, () => void> = {};
    on(ev: string, cb: () => void) {
      this.handlers[ev] = cb;
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
    destroy() {
      this.destroyed = true;
    }
  }
  class Container extends FakeBase {}
  class Graphics extends FakeBase {
    constructor() {
      super();
      graphicsNodes.push(this as unknown as FakeNode);
    }
    rect() {
      return this;
    }
    roundRect() {
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
  class Sprite extends FakeBase {}
  class Text extends FakeBase {
    text: string;
    constructor(opts?: { text?: string }) {
      super();
      this.text = opts?.text ?? "";
      texts.push(this as unknown as FakeNode);
    }
  }
  return {
    Container,
    Graphics,
    Sprite,
    Text,
    FederatedPointerEvent: class {},
  };
});

import { EquipmentShopScene } from "@/presentation/EquipmentShopScene";

function makeRenderer(width = 1280, height = 800): Renderer {
  return {
    app: {
      screen: { width, height },
      stage: { eventMode: "auto", on: vi.fn(), off: vi.fn() },
    },
    uiLayer: { addChild: vi.fn(), removeChild: vi.fn(), children: [] },
    gameLayer: { addChild: vi.fn(), removeChild: vi.fn(), children: [] },
    clearGameLayer: vi.fn(),
    clearUILayer: vi.fn(),
  } as unknown as Renderer;
}

function makeEngine(loadout: ShipLoadout) {
  const inventory = {
    ownedGearIds: [] as string[],
    micromodules: [] as unknown[],
    resources: [] as Array<{ type: string; amount: number }>,
    modules: [] as Array<{ id: string; name: string }>,
  };
  return {
    player: {
      credits: 20000,
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

function gearListing(): GearListing {
  return {
    systemId: "sys1",
    planetId: "p1",
    gear: gearById("wpn_beam")!,
    price: 7500,
  };
}

describe("EquipmentShopScene gear-row hover tooltip (Task 10)", () => {
  it("shows a stat tooltip on pointerover and hides it on pointerout", () => {
    texts = [];
    graphicsNodes = [];
    const loadout = new ShipLoadout("hull_scout");
    const engine = makeEngine(loadout);
    const renderer = makeRenderer();
    const scene = new EquipmentShopScene(renderer);
    scene.initialize({ gameEngine: engine, planet });
    (scene as unknown as { listings: GearListing[] }).listings = [
      gearListing(),
    ];
    texts = [];
    graphicsNodes = [];
    (scene as unknown as { render: () => void }).render();

    const staticGraphics = graphicsNodes.filter(
      (g) => g.eventMode === "static",
    );
    const rowBg = staticGraphics[staticGraphics.length - 1];
    expect(rowBg, "row background must be hoverable").toBeTruthy();

    const beforeCount = texts.length;
    rowBg!.handlers.pointerover();

    const tooltipTexts = texts.slice(beforeCount);
    const gear = gearById("wpn_beam")!;
    expect(tooltipTexts.some((t) => t.text === gear.name)).toBe(true);
    expect(tooltipTexts.some((t) => t.text.includes("Урон:"))).toBe(true);
    expect(tooltipTexts.some((t) => t.text.includes("Откат:"))).toBe(true);

    const tooltipNode = graphicsNodes[graphicsNodes.length - 1];
    expect(tooltipNode).toBeDefined();

    rowBg!.handlers.pointerout();
    // hovering again after pointerout must re-mount a fresh tooltip
    const beforeCount2 = texts.length;
    rowBg!.handlers.pointerover();
    expect(texts.length).toBeGreaterThan(beforeCount2);

    scene.destroy();
  });

  it("clears row hover state without throwing when nothing is installed to compare against", () => {
    texts = [];
    graphicsNodes = [];
    const loadout = new ShipLoadout("hull_scout");
    const engine = makeEngine(loadout);
    const renderer = makeRenderer();
    const scene = new EquipmentShopScene(renderer);
    scene.initialize({ gameEngine: engine, planet });
    (scene as unknown as { listings: GearListing[] }).listings = [
      gearListing(),
    ];
    texts = [];
    graphicsNodes = [];
    (scene as unknown as { render: () => void }).render();

    const staticGraphics = graphicsNodes.filter(
      (g) => g.eventMode === "static",
    );
    const rowBg = staticGraphics[staticGraphics.length - 1];
    expect(() => {
      rowBg!.handlers.pointerover();
      rowBg!.handlers.pointerout();
    }).not.toThrow();

    scene.destroy();
  });
});
