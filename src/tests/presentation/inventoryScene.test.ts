import { describe, it, expect, vi, beforeEach } from "vitest";
import { InventoryScene } from "@/presentation/InventoryScene";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import { Text } from "pixi.js";

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

function makeEngine(loadout: ShipLoadout | null) {
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
    // Full lines, not bare numbers — `toContain("0")` would match almost any
    // rendered text and verify nothing.
    expect(all).toContain(`Корпус: 80/${stats.maxHull}`); // live HP / loadout max
    // Current shields are capped at the loadout-derived capacity (0 here —
    // the mock ship's legacy `shields: 10` must NOT leak through).
    expect(all).toContain(`Щиты: 0/${stats.shields}`);
    expect(all).toContain(`Скорость: ${stats.speed.toFixed(2)}`); // px/ms format
    expect(all).toContain("Уворот: 5"); // evasion from live ship state
    expect(all).toContain(`Слоты: ${stats.slotsUsed}/${stats.slotsTotal}`);

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
    // 9-slot hull with 6 installed items → 7 cards worth of gear, 5 rendered.
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
});
