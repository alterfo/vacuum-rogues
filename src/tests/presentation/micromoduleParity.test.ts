import { describe, it, expect, vi, beforeEach } from "vitest";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import type { Renderer } from "@/presentation/Renderer";
import { PlanetType, StationType } from "@/types";
import type { MicroModule } from "@/types";
import {
  micromoduleShopCatalog,
  micromodulePrice,
} from "@/systems/equipment/micromoduleShop";

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

import { EquipmentShopScene } from "@/presentation/EquipmentShopScene";
import { StationScene } from "@/presentation/StationScene";
import { MicromoduleApplyPanel } from "@/presentation/ui/MicromoduleApplyPanel";

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
    micromodules: [] as Array<{ id: string; name: string }>,
    resources: [] as Array<{ type: string; amount: number }>,
    modules: [] as Array<{ id: string; name: string }>,
    addItem: vi.fn(),
  };
  return {
    credits,
    currentSystemId: "sys1",
    currentAccountId: "cur:p1",
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

const craftStation = {
  id: "st_craft",
  name: "Центр крафта",
  type: StationType.CRAFT_CENTER,
  faction: "INDEPENDENT",
} as unknown as import("@/domain/Station").Station;

function openPlanetApply(loadout: ShipLoadout) {
  const engine = makeEngine(loadout);
  const scene = new EquipmentShopScene(renderer);
  scene.initialize({ gameEngine: engine, planet });
  (scene as unknown as { activeTab: string }).activeTab = "hangar";
  (
    scene as unknown as { micromoduleApplyTarget: unknown }
  ).micromoduleApplyTarget = { slotIndex: 0, gearId: "wpn_pulse" };
  created.length = 0;
  (scene as unknown as { rebuild: () => void }).rebuild();
  return { scene, engine };
}

function openStationApply(loadout: ShipLoadout) {
  const engine = makeEngine(loadout);
  const scene = new StationScene(renderer);
  scene.initialize({ gameEngine: engine, station: craftStation });
  (scene as unknown as { view: string }).view = "micromodule_apply";
  (
    scene as unknown as { micromoduleApplyTarget: unknown }
  ).micromoduleApplyTarget = { slotIndex: 0, gearId: "wpn_pulse" };
  created.length = 0;
  (scene as unknown as { render: () => void }).render();
  return { scene, engine };
}

const fakeEvent = { stopPropagation: () => {} };

interface ApplyRenderCall {
  instance: MicromoduleApplyPanel;
  ctx: {
    container: unknown;
    player: unknown;
    loadout: unknown;
    target: { slotIndex: number; gearId: string };
    showToast: unknown;
    onClose: unknown;
  };
}

describe("Micromodule parity — fit (apply) flow: planet Верфь ⇄ station hangar", () => {
  beforeEach(() => {
    created.length = 0;
  });

  it("both entry points mount the shared MicromoduleApplyPanel with the canonical model", () => {
    const loadout = new ShipLoadout("hull_scout");
    loadout.install("wpn_pulse"); // a fitted slot to hang a micromodule on

    const calls: ApplyRenderCall[] = [];
    const spy = vi
      .spyOn(MicromoduleApplyPanel.prototype, "render")
      .mockImplementation(function (this: MicromoduleApplyPanel, ctx: unknown) {
        calls.push({ instance: this, ctx: ctx as ApplyRenderCall["ctx"] });
      });

    const planetA = openPlanetApply(loadout);
    const stationA = openStationApply(loadout);

    spy.mockRestore();

    expect(calls).toHaveLength(2);
    const [planetCall, stationCall] = calls;
    expect(planetCall.instance).toBeInstanceOf(MicromoduleApplyPanel);
    expect(stationCall.instance).toBeInstanceOf(MicromoduleApplyPanel);
    expect(planetCall.instance).toBe(
      (planetA.scene as unknown as { micromoduleApplyPanel: unknown })
        .micromoduleApplyPanel,
    );
    expect(stationCall.instance).toBe(
      (stationA.scene as unknown as { micromoduleApplyPanel: unknown })
        .micromoduleApplyPanel,
    );

    const keys = (c: ApplyRenderCall["ctx"]) => Object.keys(c).sort();
    expect(keys(planetCall.ctx)).toEqual(keys(stationCall.ctx));

    expect(planetCall.ctx.player).toBe(planetA.engine.player);
    expect(planetCall.ctx.loadout).toBe(loadout);
    expect(stationCall.ctx.player).toBe(stationA.engine.player);
    expect(stationCall.ctx.loadout).toBe(loadout);

    expect(planetCall.ctx.target).toEqual({
      slotIndex: 0,
      gearId: "wpn_pulse",
    });
    expect(stationCall.ctx.target).toEqual(planetCall.ctx.target);

    for (const k of ["showToast", "onClose"] as const) {
      expect(typeof planetCall.ctx[k]).toBe("function");
      expect(typeof stationCall.ctx[k]).toBe("function");
    }

    planetA.scene.destroy();
    stationA.scene.destroy();
  });

  it("renders a byte-identical apply modal from each entry point", () => {
    const planetTexts = (() => {
      const loadout = new ShipLoadout("hull_scout");
      loadout.install("wpn_pulse");
      const planetA = openPlanetApply(loadout);
      const out = created.map((n) => n.text);
      planetA.scene.destroy();
      return out;
    })();

    const stationTexts = (() => {
      const loadout = new ShipLoadout("hull_scout");
      loadout.install("wpn_pulse");
      const stationA = openStationApply(loadout);
      const out = created.map((n) => n.text);
      stationA.scene.destroy();
      return out;
    })();

    expect(planetTexts).toEqual(stationTexts);

    expect(
      planetTexts.some((t) => t.startsWith("Выбор микромодуля для:")),
    ).toBe(true);
    expect(planetTexts).toContain("[ ← Назад ]");
  });
});

describe("Micromodule parity — buy flow: CRAFT_CENTER uses the shared shop seam", () => {
  beforeEach(() => {
    created.length = 0;
  });

  it("the station micromodule shop stocks the shared catalog (no forked stock)", () => {
    const loadout = new ShipLoadout("hull_scout");
    const scene = new StationScene(renderer);
    scene.initialize({
      gameEngine: makeEngine(loadout),
      station: craftStation,
    });

    const listings = (
      scene as unknown as {
        micromoduleListings: Array<{ id: string }>;
      }
    ).micromoduleListings;

    const listed = listings.map((m) => m.id).sort();
    const shared = micromoduleShopCatalog()
      .map((m) => m.id)
      .sort();
    expect(listed).toEqual(shared);

    scene.destroy();
  });

  it("the station shows the shared price and buys through the shared seam", () => {
    const loadout = new ShipLoadout("hull_scout");
    const player = makePlayer(5000);
    const engine = makeEngine(loadout, player);
    const scene = new StationScene(renderer);
    scene.initialize({ gameEngine: engine, station: craftStation });

    const listings = (
      scene as unknown as {
        micromoduleListings: MicroModule[];
      }
    ).micromoduleListings;
    const first = listings[0];
    const price = micromodulePrice(first);

    (scene as unknown as { view: string }).view = "micromodules";
    created.length = 0;
    (scene as unknown as { render: () => void }).render();

    expect(created.map((n) => n.text)).toContain(`${price} ₡`);

    const buyBtn = created.find((n) => n.text === "[Купить]");
    expect(buyBtn).toBeDefined();
    buyBtn!.handlers.pointerdown(fakeEvent);

    expect(player.credits).toBe(5000 - price);
    expect(player.inventory.micromodules.map((m) => m.id)).toContain(first.id);

    scene.destroy();
  });

  it("the planet Верфь has no scene-local micromodule purchase path", () => {
    expect(
      (StationScene.prototype as unknown as Record<string, unknown>)
        .renderMicromoduleShop,
    ).toBeTypeOf("function");
    expect(
      (EquipmentShopScene.prototype as unknown as Record<string, unknown>)
        .renderMicromoduleShop,
    ).toBeUndefined();
  });

  it("the shared hangar tray points buyers to a Центр крафта (no in-hangar purchase)", () => {
    const loadout = new ShipLoadout("hull_scout");
    const scene = new EquipmentShopScene(renderer);
    scene.initialize({ gameEngine: makeEngine(loadout), planet });
    (scene as unknown as { activeTab: string }).activeTab = "hangar";
    created.length = 0;
    (scene as unknown as { rebuild: () => void }).rebuild();

    expect(created.some((n) => n.text.includes("купите в Центре крафта"))).toBe(
      true,
    );

    scene.destroy();
  });
});
