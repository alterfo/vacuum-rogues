/**
 * Task 3 (font-scale layout bug-fix pack,
 * `docs/plans/20260708-font-scale-and-faction-bugs.md`): regression test for
 * `EquipmentShopScene.renderRows`'s gear-listing row. `ROW_H` and the
 * name/stat/price/fit line offsets were fixed pixel constants independent of
 * `scaledFont`'s taller line height at "L" scale, so the stat line bled into
 * the name line above it (and the fit hint into the price line above it).
 *
 * PixiJS text metrics aren't reliable headless, so this mirrors the existing
 * scene-level test convention for these scenes (`gearBuyParity.test.ts`): a
 * lightweight `pixi.js` mock whose `Graphics`/`Text`/`Container` are plain
 * mutable objects, so the source's real `x`/`y` assignments and `rect(...)`
 * calls are directly inspectable after render.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import { gearById } from "@/systems/equipment/GearCatalog";
import type { GearListing } from "@/systems/info/GalacticRegistry";
import type { Renderer } from "@/presentation/Renderer";
import { PlanetType } from "@/types";
import { setFontScale, scaledFont } from "@/utils/fontScale";
import { lineStepFor } from "@/presentation/ui/questCardLayout";

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

// Imported AFTER the mock so the scene sees the fake pixi.
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

function weaponListing(): GearListing {
  return {
    systemId: "sys1",
    planetId: "p1",
    gear: gearById("wpn_pulse")!,
    price: 200,
  };
}

describe("EquipmentShopScene gear rows at L font scale", () => {
  it("keeps the stat line from overlapping the name line above it", () => {
    setFontScale("L");
    created = [];
    const loadout = new ShipLoadout("hull_scout");
    const engine = makeEngine(loadout);
    const scene = new EquipmentShopScene(renderer);
    scene.initialize({ gameEngine: engine, planet });
    (scene as unknown as { listings: GearListing[] }).listings = [
      weaponListing(),
    ];
    created = [];
    (scene as unknown as { render: () => void }).render();

    const gearName = gearById("wpn_pulse")!.name;
    const nameIdx = created.findIndex((n) => n.text.includes(gearName));
    expect(nameIdx, "expected the gear name Text node").toBeGreaterThanOrEqual(
      0,
    );
    const name = created[nameIdx];
    // The stat line is the very next Text `renderRows` creates, in the same
    // column as the name line above it.
    const stat = created[nameIdx + 1];
    expect(stat.x).toBe(name.x);

    const nameStep = lineStepFor(scaledFont(13));
    // The bug: the stat line used to sit at a fixed +19 offset from the name
    // line regardless of scale; at "L" the name line's own height exceeds
    // that gap and the stat line bleeds into it.
    expect(stat.y).toBeGreaterThanOrEqual(name.y + nameStep);
  });

  it("keeps the fit hint from overlapping the price line above it", () => {
    setFontScale("L");
    created = [];
    const loadout = new ShipLoadout("hull_scout"); // free weapon slot → "fits"
    const engine = makeEngine(loadout);
    const scene = new EquipmentShopScene(renderer);
    scene.initialize({ gameEngine: engine, planet });
    (scene as unknown as { listings: GearListing[] }).listings = [
      weaponListing(),
    ];
    created = [];
    (scene as unknown as { render: () => void }).render();

    // The row's own price line (not the header credits readout, which also
    // contains "₡" but renders before `renderRows` runs).
    const priceText = created.find((n) => n.text === "200₡");
    expect(priceText, "expected the row's price Text node").toBeTruthy();
    const fitText = created.find((n) => n.text.includes("Влезет"));
    expect(
      fitText,
      "expected the fit-hint Text node (gear fits a free slot)",
    ).toBeTruthy();
    expect(fitText!.x).toBe(priceText!.x);

    const priceStep = lineStepFor(scaledFont(12));
    expect(fitText!.y).toBeGreaterThanOrEqual(priceText!.y + priceStep);
  });

  it("grows ROW_H so the two-line stack fits the row's own drawn background", () => {
    setFontScale("L");
    created = [];
    const loadout = new ShipLoadout("hull_scout");
    const engine = makeEngine(loadout);
    const scene = new EquipmentShopScene(renderer);
    scene.initialize({ gameEngine: engine, planet });
    (scene as unknown as { listings: GearListing[] }).listings = [
      weaponListing(),
    ];
    created = [];
    (scene as unknown as { render: () => void }).render();

    const rowH = (scene as unknown as { ROW_H: number }).ROW_H;
    const nameStep = lineStepFor(scaledFont(13));
    const statStep = lineStepFor(scaledFont(10));
    // Content (name top pad 6 + name step + stat step + bottom pad) must fit
    // within the row height, not just the historical fixed 52 px.
    expect(rowH).toBeGreaterThanOrEqual(6 + nameStep + statStep);
    scene.destroy();
  });
});
