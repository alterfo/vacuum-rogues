/**
 * Task 3 (font-scale layout bug-fix pack,
 * `docs/plans/20260708-font-scale-and-faction-bugs.md`): regression test for
 * two `StationScene` row renderers whose two-line stack used fixed pixel
 * offsets independent of `scaledFont`'s taller line height at "L" scale:
 *  - `renderShop`'s gear-listing row (kind badge above the name line), and
 *  - `renderMicromoduleShop`'s micromodule-listing row (tier badge above the
 *    name line).
 *
 * Mirrors the lightweight `pixi.js` mock convention already established for
 * this scene in `gearBuyParity.test.ts` (plain mutable `Graphics`/`Text`
 * objects, so the source's real `x`/`y` assignments are directly inspectable).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import { gearById } from "@/systems/equipment/GearCatalog";
import type { GearListing } from "@/systems/info/GalacticRegistry";
import type { Renderer } from "@/presentation/Renderer";
import { StationType, ModuleCategory, type MicroModule } from "@/types";
import { setFontScale, scaledFont } from "@/utils/fontScale";
import { lineStepFor } from "@/presentation/ui/questCardLayout";

afterEach(() => setFontScale("M")); // never leak a scale into other tests

interface FakeNode {
  text: string;
  x: number;
  y: number;
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

// Imported AFTER the mock so the scene sees the fake pixi.
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

const tradeStation = {
  id: "st_trade",
  name: "Торговый пост",
  type: StationType.TRADE_POST,
  faction: "INDEPENDENT",
} as unknown as import("@/domain/Station").Station;

function weaponListing(): GearListing {
  return {
    systemId: "sys1",
    planetId: "st_trade",
    gear: gearById("wpn_pulse")!,
    price: 200,
  };
}

const testMicromodule: MicroModule = {
  id: "mm_test",
  name: "Тестовый микромодуль",
  targetCategory: ModuleCategory.WEAPON,
  bonusType: "damage",
  bonusTier: 1,
};

describe("StationScene equipment shop rows at L font scale", () => {
  it("keeps the name line from overlapping the kind badge above it", () => {
    setFontScale("L");
    created = [];
    const loadout = new ShipLoadout("hull_scout");
    const engine = makeEngine(loadout);
    const scene = new StationScene(renderer);
    scene.initialize({ gameEngine: engine, station: tradeStation });
    (scene as unknown as { shopListings: GearListing[] }).shopListings = [
      weaponListing(),
    ];
    (scene as unknown as { view: string }).view = "shop";
    created = [];
    (scene as unknown as { render: () => void }).render();

    const gearName = gearById("wpn_pulse")!.name;
    const nameIdx = created.findIndex((n) => n.text.includes(gearName));
    expect(nameIdx, "expected the gear name Text node").toBeGreaterThanOrEqual(
      0,
    );
    const name = created[nameIdx];
    // The kind badge is the row's first Text (then tech, then name), sharing
    // the name's x column.
    const badge = created[nameIdx - 2]; // kindBadge, then tech, then name
    expect(badge.x).toBe(name.x);

    const badgeStep = lineStepFor(scaledFont(11));
    // The bug: the name line used to sit at a fixed +18 offset from the badge
    // line regardless of scale; at "L" the badge line's own height exceeds
    // that gap and the name line bleeds into it.
    expect(name.y).toBeGreaterThanOrEqual(badge.y + badgeStep);
    scene.destroy();
  });
});

describe("StationScene micromodule shop rows at L font scale", () => {
  it("keeps the name line from overlapping the tier badge above it", () => {
    setFontScale("L");
    created = [];
    const loadout = new ShipLoadout("hull_scout");
    const engine = makeEngine(loadout);
    const scene = new StationScene(renderer);
    scene.initialize({ gameEngine: engine, station: tradeStation });
    (
      scene as unknown as { micromoduleListings: MicroModule[] }
    ).micromoduleListings = [testMicromodule];
    (scene as unknown as { view: string }).view = "micromodules";
    created = [];
    (scene as unknown as { render: () => void }).render();

    const nameIdx = created.findIndex((n) => n.text === testMicromodule.name);
    expect(
      nameIdx,
      "expected the micromodule name Text node",
    ).toBeGreaterThanOrEqual(0);
    const name = created[nameIdx];
    const badge = created[nameIdx - 1]; // tierBadge immediately precedes name
    expect(badge.text).toContain("Ур.");
    expect(badge.x).toBe(name.x);

    const badgeStep = lineStepFor(scaledFont(11));
    // The bug: the name line used to sit at a fixed +18 offset from the tier
    // badge regardless of scale; at "L" the badge's own height exceeds that
    // gap and the name line bleeds into it.
    expect(name.y).toBeGreaterThanOrEqual(badge.y + badgeStep);
    scene.destroy();
  });
});
