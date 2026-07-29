import { describe, it, expect, vi, beforeEach } from "vitest";
import { StationScene } from "@/presentation/StationScene";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import { Text } from "pixi.js";
import { StationType } from "@/types";

/**
 * Task 3 (ship-fitting-hangar-rework): the SR-canon categorized hangar. The
 * hangar renders the four fitting banks (weapons / engine / radar / equipment)
 * with per-category slot counts from the hull, a МАССА/СВОБОДНО/СКОРОСТЬ/ЗАЩИТА
 * stat strip, the СКЛАД warehouse, and a separate ТРЮМ cargo panel. Installing
 * from the warehouse routes through the loadout's category + mass rules.
 */

vi.mock("pixi.js", () => ({
  Container: vi.fn().mockImplementation(() => ({
    addChild: vi.fn(),
    removeChildren: vi.fn().mockReturnValue([]),
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
    roundRect: vi.fn().mockReturnThis(),
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
    anchor: { set: vi.fn() },
    style: {},
    eventMode: "auto",
    cursor: "default",
    alpha: 1,
    on: vi.fn(),
    destroy: vi.fn(),
  })),
  // HangarPanel's scrollable columns (wireScrollRegion) need a Rectangle for
  // the tracking hitArea — this mock didn't exercise that path before.
  Rectangle: class Rectangle {
    constructor(
      public x = 0,
      public y = 0,
      public width = 0,
      public height = 0,
    ) {}
  },
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

function makeEngine(
  loadout: ShipLoadout,
  inventory: Partial<{
    modules: unknown[];
    micromodules: unknown[];
    resources: Array<{ type: string; amount: number }>;
    ownedGearIds: string[];
  }> = {},
) {
  return {
    player: {
      credits: 5000,
      ship: { hullHP: 80, maxHull: 100, energy: 40, maxEnergy: 50 },
      isHostileTo: vi.fn().mockReturnValue(false),
      inventory: {
        modules: inventory.modules ?? [],
        micromodules: inventory.micromodules ?? [],
        resources: inventory.resources ?? [],
        ownedGearIds: inventory.ownedGearIds ?? [],
        addItem: vi.fn(),
        addOwnedGear: vi.fn(),
        removeOwnedGear: vi.fn(),
      },
    },
    playerLoadout: loadout,
    transitionTo: vi.fn().mockResolvedValue(undefined),
  } as unknown as import("@/systems/GameEngine").GameEngine;
}

const station = {
  id: "st_dock",
  name: "Ремонтный док",
  type: StationType.REPAIR_DOCK,
  faction: "INDEPENDENT",
} as unknown as import("@/domain/Station").Station;

function openHangar(scene: StationScene): void {
  // Switch from the default "main" view to the hangar and re-render.
  (scene as unknown as { view: string }).view = "hangar";
  (scene as unknown as { render: () => void }).render();
}

describe("StationScene hangar — SR-canon categorized fitting layout", () => {
  beforeEach(() => {
    (Text as unknown as ReturnType<typeof vi.fn>).mockClear();
  });

  it("renders the four categorized banks with per-category slot counts from the hull", () => {
    const loadout = new ShipLoadout("hull_scout"); // weapon 2, equip 2
    loadout.install("wpn_pulse"); // weapon → 1/2
    loadout.install("eq_engine_i"); // engine → 1/1

    const scene = new StationScene(mockRenderer);
    scene.initialize({ gameEngine: makeEngine(loadout), station });
    (Text as unknown as ReturnType<typeof vi.fn>).mockClear();
    openHangar(scene);

    const texts = renderedTexts();
    expect(texts.some((t) => t.includes("ОРУЖИЕ") && t.includes("1/2"))).toBe(
      true,
    );
    expect(
      texts.some((t) => t.includes("ДВИГАТЕЛЬ") && t.includes("1/1")),
    ).toBe(true);
    expect(texts.some((t) => t.includes("РАДАР") && t.includes("0/1"))).toBe(
      true,
    );
    expect(
      texts.some((t) => t.includes("ОБОРУДОВАНИЕ") && t.includes("0/2")),
    ).toBe(true);

    scene.destroy();
  });

  it("shows the МАССА/СВОБОДНО/СКОРОСТЬ/ЗАЩИТА strip and the hull banner", () => {
    const loadout = new ShipLoadout("hull_scout"); // massCapacity 30
    loadout.install("wpn_pulse"); // mass 4
    loadout.install("eq_engine_i"); // mass 6 → used 10, free 20

    const scene = new StationScene(mockRenderer);
    scene.initialize({ gameEngine: makeEngine(loadout), station });
    (Text as unknown as ReturnType<typeof vi.fn>).mockClear();
    openHangar(scene);

    const all = renderedTexts().join("\n");
    expect(all).toContain("МАССА 10/30");
    expect(all).toContain("СВОБОДНО 20");
    expect(all).toContain("СКОРОСТЬ");
    expect(all).toContain("ЗАЩИТА");
    expect(all).toContain("Каркас «Разведчик»"); // hull banner (hull is the ship)

    scene.destroy();
  });

  it("renders the СКЛАД warehouse and a separate ТРЮМ cargo panel", () => {
    const loadout = new ShipLoadout("hull_scout");
    loadout.install("eq_engine_i");

    const scene = new StationScene(mockRenderer);
    scene.initialize({
      gameEngine: makeEngine(loadout, {
        ownedGearIds: ["eq_radar"],
        resources: [{ type: "METALS", amount: 5 }],
      }),
      station,
    });
    (Text as unknown as ReturnType<typeof vi.fn>).mockClear();
    openHangar(scene);

    const all = renderedTexts().join("\n");
    expect(all).toContain("СКЛАД");
    expect(all).toContain("Радар дальнего поля"); // warehouse gear
    expect(all).toContain("[Установить]");
    // ТРЮМ is its own panel and lists cargo goods, not equipment.
    expect(all).toContain("ТРЮМ");
    expect(all).toContain("Металлы ×5");

    scene.destroy();
  });

  it("blocks a 2nd item into a full weapon bank with a category reason", () => {
    const loadout = new ShipLoadout("hull_scout"); // weapon 2
    loadout.install("wpn_pulse");
    loadout.install("wpn_pulse"); // weapon bank now 2/2 (full)

    const scene = new StationScene(mockRenderer);
    scene.initialize({ gameEngine: makeEngine(loadout), station });

    const reason = (
      scene as unknown as {
        explainInstallBlock: (l: ShipLoadout, id: string) => string | null;
      }
    ).explainInstallBlock(loadout, "wpn_beam");
    expect(reason).not.toBeNull();
    expect(reason).toContain("Нет слота");
    expect(reason).toContain("ОРУЖИЕ");

    scene.destroy();
  });

  it("blocks an over-mass install even when a slot is free", () => {
    const loadout = new ShipLoadout("hull_scout"); // massCapacity 30
    loadout.install("wpn_torpedo"); // mass 12
    loadout.install("wpn_torpedo"); // mass 12 → weapon 2/2, used 24
    loadout.install("eq_engine_i"); // mass 6 → used 30 (at capacity)

    const scene = new StationScene(mockRenderer);
    scene.initialize({ gameEngine: makeEngine(loadout), station });

    const block = scene as unknown as {
      explainInstallBlock: (l: ShipLoadout, id: string) => string | null;
    };
    // eq_shield is equipment (bank 0/2, free) but mass 8 → over the budget.
    const reason = block.explainInstallBlock(loadout, "eq_shield");
    expect(reason).not.toBeNull();
    expect(reason).toContain("Перегруз");
    // A within-budget, free-bank install is NOT blocked.
    loadout.removeAt(2); // drop the engine → frees mass 6
    expect(block.explainInstallBlock(loadout, "eq_tank")).toBeNull();

    scene.destroy();
  });
});
