import { describe, it, expect, vi, beforeEach } from "vitest";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import { EquipmentSystem } from "@/systems/EquipmentSystem";
import type { Renderer } from "@/presentation/Renderer";
import { PlanetType, StationType } from "@/types";

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
import { HangarPanel } from "@/presentation/ui/HangarPanel";

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

function makePlayer(ownedGearIds: string[] = []) {
  const inventory = {
    ownedGearIds: [...ownedGearIds],
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
    credits: 5000,
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

function makeEngine(loadout: ShipLoadout, ownedGearIds: string[] = []) {
  return {
    player: makePlayer(ownedGearIds),
    playerLoadout: loadout,
    bank: null,
    galaxy: { id: "g1", gameDays: 0, systems: [{ id: "sys1" }] },
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

const station = {
  id: "st_dock",
  name: "Ремонтный док",
  type: StationType.REPAIR_DOCK,
  faction: "INDEPENDENT",
} as unknown as import("@/domain/Station").Station;

function openPlanetHangar(loadout: ShipLoadout, ownedGearIds: string[]) {
  const engine = makeEngine(loadout, ownedGearIds);
  const scene = new EquipmentShopScene(renderer);
  scene.initialize({ gameEngine: engine, planet });
  (scene as unknown as { activeTab: string }).activeTab = "hangar";
  created.length = 0;
  (scene as unknown as { rebuild: () => void }).rebuild();
  return { scene, engine };
}

function openStationHangar(loadout: ShipLoadout, ownedGearIds: string[]) {
  const engine = makeEngine(loadout, ownedGearIds);
  const scene = new StationScene(renderer);
  scene.initialize({ gameEngine: engine, station });
  (scene as unknown as { view: string }).view = "hangar";
  created.length = 0;
  (scene as unknown as { render: () => void }).render();
  return { scene, engine };
}

const fakeEvent = { stopPropagation: () => {} };

interface RenderCall {
  instance: HangarPanel;
  ctx: {
    container: unknown;
    player: unknown;
    loadout: unknown;
    bank: unknown;
    equipment: unknown;
    repairRatePerHp: unknown;
    showToast: unknown;
    addToastSlot: unknown;
    rerender: unknown;
    back: unknown;
    openMicromoduleApply: unknown;
  };
}

describe("Shipyard parity — planet Верфь АНГАР tab ⇄ station hangar service", () => {
  beforeEach(() => {
    created.length = 0;
  });

  it("both entry points mount the shared HangarPanel with the canonical model", () => {
    const loadout = new ShipLoadout("hull_scout");
    loadout.install("wpn_pulse");

    const calls: RenderCall[] = [];
    const spy = vi
      .spyOn(HangarPanel.prototype, "render")
      .mockImplementation(function (this: HangarPanel, ctx: unknown) {
        calls.push({ instance: this, ctx: ctx as RenderCall["ctx"] });
      });

    const planetH = openPlanetHangar(loadout, ["eq_radar"]);
    const stationH = openStationHangar(loadout, ["eq_radar"]);

    spy.mockRestore();

    expect(calls).toHaveLength(2);
    const [planetCall, stationCall] = calls;
    expect(planetCall.instance).toBeInstanceOf(HangarPanel);
    expect(stationCall.instance).toBeInstanceOf(HangarPanel);
    expect(planetCall.instance).toBe(
      (planetH.scene as unknown as { hangarPanel: HangarPanel }).hangarPanel,
    );
    expect(stationCall.instance).toBe(
      (stationH.scene as unknown as { hangarPanel: HangarPanel }).hangarPanel,
    );

    const keys = (c: RenderCall["ctx"]) => Object.keys(c).sort();
    expect(keys(planetCall.ctx)).toEqual(keys(stationCall.ctx));

    expect(planetCall.ctx.player).toBe(planetH.engine.player);
    expect(planetCall.ctx.loadout).toBe(loadout);
    expect(planetCall.ctx.bank).toBe(planetH.engine.bank);
    expect(stationCall.ctx.player).toBe(stationH.engine.player);
    expect(stationCall.ctx.loadout).toBe(loadout);
    expect(stationCall.ctx.bank).toBe(stationH.engine.bank);
    expect(planetCall.ctx.equipment).toBeInstanceOf(EquipmentSystem);
    expect(stationCall.ctx.equipment).toBeInstanceOf(EquipmentSystem);

    expect(planetCall.ctx.repairRatePerHp).toBe(2);
    expect(stationCall.ctx.repairRatePerHp).toBe(4.8);

    for (const k of [
      "showToast",
      "addToastSlot",
      "rerender",
      "back",
      "openMicromoduleApply",
    ] as const) {
      expect(typeof planetCall.ctx[k]).toBe("function");
      expect(typeof stationCall.ctx[k]).toBe("function");
    }

    planetH.scene.destroy();
    stationH.scene.destroy();
  });

  it("renders a byte-identical hangar board (same fit/unfit/install actions) from each entry point", () => {
    const planetTexts = (() => {
      const loadout = new ShipLoadout("hull_scout");
      loadout.install("wpn_pulse"); // a fitted slot → [снять]
      created.length = 0;
      const planetH = openPlanetHangar(loadout, ["eq_radar"]); // owned → install/sell
      const out = created.map((n) => n.text);
      planetH.scene.destroy();
      return out;
    })();

    const stationTexts = (() => {
      const loadout = new ShipLoadout("hull_scout");
      loadout.install("wpn_pulse");
      created.length = 0;
      const stationH = openStationHangar(loadout, ["eq_radar"]);
      const out = created.map((n) => n.text);
      stationH.scene.destroy();
      return out;
    })();

    expect(planetTexts).toEqual(stationTexts);

    expect(planetTexts).toContain("[снять]"); // unfit
    expect(planetTexts).toContain("[Установить]"); // install from warehouse
    expect(planetTexts.some((t) => t.startsWith("[Продать"))).toBe(true); // sell
  });

  it("fitting from the station hangar mutates the same canonical loadout as the planet Верфь", () => {
    const loadout = new ShipLoadout("hull_scout"); // radar slot free
    created.length = 0;
    const stationH = openStationHangar(loadout, ["eq_radar"]);

    expect(loadout.installedGearIds()).not.toContain("eq_radar");
    const installBtn = created.find((n) => n.text === "[Установить]");
    expect(installBtn).toBeDefined();
    installBtn!.handlers.pointerdown(fakeEvent);
    expect(loadout.installedGearIds()).toContain("eq_radar");

    stationH.scene.destroy();
  });
});
