import { describe, it, expect, vi, beforeEach } from "vitest";
import { InventoryScene } from "@/presentation/InventoryScene";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import { Text } from "pixi.js";
import { SceneType } from "@/types";

vi.mock("pixi.js", () => ({
  Container: vi.fn().mockImplementation(() => ({
    addChild: vi.fn(),
    destroy: vi.fn(),
    children: [],
    on: vi.fn(),
    x: 0,
    y: 0,
    eventMode: "auto",
    cursor: "default",
  })),
  Graphics: vi.fn().mockImplementation(() => ({
    rect: vi.fn().mockReturnThis(),
    fill: vi.fn().mockReturnThis(),
    stroke: vi.fn().mockReturnThis(),
    clear: vi.fn().mockReturnThis(),
    on: vi.fn(),
    addChild: vi.fn(),
    eventMode: "auto",
    cursor: "default",
  })),
  Text: vi.fn().mockImplementation((opts?: { text?: string }) => ({
    text: opts?.text ?? "",
    x: 0,
    y: 0,
    width: 50,
    height: 14,
    style: {},
    eventMode: "auto",
    cursor: "default",
    anchor: { set: vi.fn() },
    on: vi.fn(),
    destroy: vi.fn(),
  })),
}));

function renderedTexts(): string[] {
  return (Text as unknown as ReturnType<typeof vi.fn>).mock.calls.map((call) =>
    String((call[0] as { text?: string } | undefined)?.text ?? ""),
  );
}

const mockRenderer = {
  app: { screen: { width: 1280, height: 800 } },
  uiLayer: { addChild: vi.fn(), removeChild: vi.fn(), children: [] },
  gameLayer: { addChild: vi.fn(), removeChild: vi.fn(), children: [] },
  clearGameLayer: vi.fn(),
  clearUILayer: vi.fn(),
} as unknown as import("@/presentation/Renderer").Renderer;

const LEGACY_MODULE_NAME = "ЛЕГАСИ-БЛАСТЕР-9000";

function makeEngine(
  loadout: ShipLoadout | null,
  lastFlightShipPos: { x: number; y: number } | null = null,
) {
  return {
    player: {
      credits: 1234,
      ship: {
        name: "Тестовый корабль",
        hullHP: 80,
        maxHull: 100,
        shields: 10,
        maxShields: 20,
        energy: 50,
        maxEnergy: 50,
        speed: 1,
        evasion: 5,
        modules: [
          { id: "legacy_1", name: LEGACY_MODULE_NAME, category: "WEAPON" },
          null,
          null,
        ],
      },
      inventory: {
        modules: [
          { id: "legacy_2", name: LEGACY_MODULE_NAME, category: "WEAPON" },
        ],
        resources: [],
      },
    },
    playerLoadout: loadout,
    lastFlightShipPos,
    transitionTo: vi.fn().mockResolvedValue(undefined),
  } as unknown as import("@/systems/GameEngine").GameEngine;
}

describe("InventoryScene — canonical GearCatalog loadout view (F6)", () => {
  beforeEach(() => {
    (Text as unknown as ReturnType<typeof vi.fn>).mockClear();
  });

  it("renders the ShipLoadout hull and installed gear (the working system)", () => {
    const loadout = new ShipLoadout("hull_corvette");
    loadout.install("eq_engine_i");
    loadout.install("eq_tank");

    const scene = new InventoryScene(mockRenderer);
    scene.initialize({ gameEngine: makeEngine(loadout) });

    const texts = renderedTexts();
    expect(texts.some((t) => t.includes("Каркас «Корвет»"))).toBe(true);
    expect(texts.some((t) => t.includes("Двигатель Тип-I"))).toBe(true);
    expect(texts.some((t) => t.includes("Топливный бак"))).toBe(true);

    scene.destroy();
  });

  it("does NOT render legacy ship.modules / inventory.modules entries", () => {
    const loadout = new ShipLoadout("hull_corvette");
    loadout.install("eq_engine_i");

    const scene = new InventoryScene(mockRenderer);
    scene.initialize({ gameEngine: makeEngine(loadout) });

    const texts = renderedTexts();
    expect(texts.some((t) => t.includes(LEGACY_MODULE_NAME))).toBe(false);

    scene.destroy();
  });

  it("shows loadout-derived stats: hull, shields, speed, evasion", () => {
    const loadout = new ShipLoadout("hull_corvette");
    loadout.install("eq_engine_i");
    loadout.install("eq_tank");
    const stats = loadout.derivedStats();

    const scene = new InventoryScene(mockRenderer);
    scene.initialize({ gameEngine: makeEngine(loadout) });

    const all = renderedTexts().join("\n");
    expect(all).toContain(`Корпус: 80/${stats.maxHull}`); // live HP / loadout max
    expect(all).toContain(`Щиты: 0/${stats.shields}`);
    expect(all).toContain(`Скорость: ${stats.speed.toFixed(2)}`); // px/ms format
    expect(all).toContain("Уворот: 5"); // evasion from live ship state
    expect(all).toContain(`Слоты: ${stats.slotsUsed}/${stats.slotsTotal}`);

    scene.destroy();
  });

  it("clamps live hull HP to the loadout-derived maximum", () => {
    const loadout = new ShipLoadout("hull_corvette");
    const stats = loadout.derivedStats();
    const engine = makeEngine(loadout);
    (engine.player!.ship as { hullHP: number }).hullHP = stats.maxHull + 60;

    const scene = new InventoryScene(mockRenderer);
    scene.initialize({ gameEngine: engine });

    const all = renderedTexts().join("\n");
    expect(all).toContain(`Корпус: ${stats.maxHull}/${stats.maxHull}`);

    scene.destroy();
  });

  it("renders no interactive equip/unequip affordances (read-only view)", () => {
    const loadout = new ShipLoadout("hull_corvette");
    loadout.install("eq_engine_i");

    const scene = new InventoryScene(mockRenderer);
    scene.initialize({ gameEngine: makeEngine(loadout) });

    const all = renderedTexts().join("\n");
    expect(all).not.toContain("Снять");
    expect(all).not.toContain("Установить");
    expect(all).not.toContain("МОДУЛИ В ИНВЕНТАРЕ");

    scene.destroy();
  });

  it("shows an overflow count instead of silently dropping gear past 5 cards", () => {
    const loadout = new ShipLoadout("hull_bastion");
    for (const id of [
      "eq_engine_i",
      "eq_tank",
      "eq_radar",
      "eq_scanner",
      "eq_droid",
      "eq_shield",
    ]) {
      expect(loadout.install(id)).toBe(true);
    }

    const scene = new InventoryScene(mockRenderer);
    scene.initialize({ gameEngine: makeEngine(loadout) });

    const all = renderedTexts().join("\n");
    expect(all).toContain("…и ещё 2");

    scene.destroy();
  });

  it("keeps the resources/credits section", () => {
    const loadout = new ShipLoadout("hull_corvette");
    const scene = new InventoryScene(mockRenderer);
    scene.initialize({ gameEngine: makeEngine(loadout) });

    const all = renderedTexts().join("\n");
    expect(all).toContain("Кредиты: 1234");

    scene.destroy();
  });

  it("passes preserveShipPos from lastFlightShipPos when closing via Escape", async () => {
    const shipPos = { x: 200, y: 300 };
    const loadout = new ShipLoadout("hull_corvette");
    const engine = makeEngine(loadout, shipPos);

    const scene = new InventoryScene(mockRenderer);
    scene.initialize({ gameEngine: engine });

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(engine.transitionTo).toHaveBeenCalledWith(SceneType.SPACE_FLIGHT, {
      preserveShipPos: shipPos,
    });

    scene.destroy();
  });

  it("transitions to SPACE_FLIGHT without preserveShipPos when lastFlightShipPos is null", async () => {
    const loadout = new ShipLoadout("hull_corvette");
    const engine = makeEngine(loadout, null);

    const scene = new InventoryScene(mockRenderer);
    scene.initialize({ gameEngine: engine });

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const calls = (engine.transitionTo as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const [sceneArg, ctxArg] = calls[0];
    expect(sceneArg).toBe(SceneType.SPACE_FLIGHT);
    expect(ctxArg?.preserveShipPos).toBeUndefined();

    scene.destroy();
  });
});
