import { describe, it, expect, vi, afterEach } from "vitest";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import { gearById } from "@/systems/equipment/GearCatalog";
import type { GearListing } from "@/systems/info/GalacticRegistry";
import type { Renderer } from "@/presentation/Renderer";
import { PlanetType } from "@/types";
import { setFontScale, scaledFont } from "@/utils/fontScale";
import { MONO_CHAR_WIDTH_RATIO } from "@/presentation/ui/questCardLayout";

afterEach(() => setFontScale("M")); // never leak a scale into other tests

interface FakeNode {
  text: string;
  x: number;
  y: number;
  rectCalls: number[][];
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
    rectCalls: number[][] = [];
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
    rect(x: number, y: number, w: number, h: number) {
      this.rectCalls.push([x, y, w, h]);
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
      created.push(this as unknown as FakeNode);
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

function makeRenderer(width: number, height: number): Renderer {
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

function longNameListing(): GearListing {
  return {
    systemId: "sys1",
    planetId: "p1",
    gear: gearById("wpn_torpedo")!, // "Самонаводящаяся торпеда" — long name
    price: 8500,
  };
}

function longNameHullListing(): GearListing {
  return {
    systemId: "sys1",
    planetId: "p1",
    gear: gearById("hull_liberator")!,
    price: 90000,
  };
}

describe("EquipmentShopScene row name clamp (kill the label overlap)", () => {
  it("clamps a long gear name so it never crosses the type column on a narrow panel", () => {
    setFontScale("L");
    created = [];
    const loadout = new ShipLoadout("hull_scout");
    const engine = makeEngine(loadout);
    const renderer = makeRenderer(380, 600);
    const scene = new EquipmentShopScene(renderer);
    scene.initialize({ gameEngine: engine, planet });
    (scene as unknown as { listings: GearListing[] }).listings = [
      longNameListing(),
    ];
    created = [];
    (scene as unknown as { render: () => void }).render();

    const fullName = gearById("wpn_torpedo")!.name;
    const nameNode = created.find(
      (n) => n.text.includes(fullName.slice(0, 3)) && n.text !== fullName,
    );
    expect(
      nameNode,
      "expected the gear name to be truncated on a narrow panel",
    ).toBeTruthy();
    expect(nameNode!.text.length).toBeLessThan(fullName.length);

    const sw = 380;
    const pw = Math.min(820, sw - 40);
    const px = (sw - pw) / 2;
    const typeColX = px + pw * 0.52;
    const charPx = scaledFont(13) * MONO_CHAR_WIDTH_RATIO;
    const rightEdge = nameNode!.x + nameNode!.text.length * charPx;
    expect(rightEdge).toBeLessThanOrEqual(typeColX);

    scene.destroy();
  });

  it("leaves a short name untouched", () => {
    setFontScale("M");
    created = [];
    const loadout = new ShipLoadout("hull_scout");
    const engine = makeEngine(loadout);
    const renderer = makeRenderer(1280, 800);
    const scene = new EquipmentShopScene(renderer);
    scene.initialize({ gameEngine: engine, planet });
    (scene as unknown as { listings: GearListing[] }).listings = [
      {
        systemId: "sys1",
        planetId: "p1",
        gear: gearById("wpn_pulse")!,
        price: 200,
      },
    ];
    created = [];
    (scene as unknown as { render: () => void }).render();

    const gearName = gearById("wpn_pulse")!.name;
    const nameNode = created.find((n) => n.text === gearName);
    expect(nameNode, "short name should render in full").toBeTruthy();

    scene.destroy();
  });

  it("clamps a long hull name so it never crosses the price column on a narrow panel", () => {
    setFontScale("L");
    created = [];
    const loadout = new ShipLoadout("hull_scout");
    const engine = makeEngine(loadout);
    const renderer = makeRenderer(300, 500);
    const scene = new EquipmentShopScene(renderer);
    scene.initialize({ gameEngine: engine, planet });
    (scene as unknown as { activeTab: string }).activeTab = "hull";
    (scene as unknown as { listings: GearListing[] }).listings = [
      longNameHullListing(),
    ];
    created = [];
    (scene as unknown as { render: () => void }).render();

    const fullName = gearById("hull_liberator")!.name;
    const nameNode = created.find(
      (n) => n.text.includes(fullName.slice(0, 3)) && n.text !== fullName,
    );
    expect(
      nameNode,
      "expected the hull name to be truncated on a narrow panel",
    ).toBeTruthy();

    const sw = 300;
    const pw = Math.min(820, sw - 40);
    const px = (sw - pw) / 2;
    const priceColX = px + pw * 0.7;
    const charPx = scaledFont(13) * MONO_CHAR_WIDTH_RATIO;
    const rightEdge = nameNode!.x + nameNode!.text.length * charPx;
    expect(rightEdge).toBeLessThanOrEqual(priceColX);

    scene.destroy();
  });
});
