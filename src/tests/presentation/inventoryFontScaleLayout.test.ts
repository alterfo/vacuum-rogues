/**
 * Task 3 (font-scale layout bug-fix pack,
 * `docs/plans/20260708-font-scale-and-faction-bugs.md`): regression test for
 * `InventoryScene.renderWarehouseRow`'s stacked «Установить»/«Выбросить»
 * action buttons. They sat at a fixed +12/+28 offset (a 16 px centre gap)
 * regardless of `scaledFont`'s taller line height at "L" scale — mirroring the
 * HangarPanel warehouse-row bug already fixed in `HangarPanel.test.ts`
 * (`20260625-arc-movement-and-combat-fixes` Task 3).
 *
 * Mirrors the lightweight `pixi.js` mock convention already used by this
 * scene's own `inventoryScene.test.ts` (plain mutable `Container`/`Text`
 * objects), extended to record every created Text instance so its final,
 * post-construction `x`/`y` is inspectable after render.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import { setFontScale, scaledFont } from "@/utils/fontScale";
import { lineStepFor } from "@/presentation/ui/questCardLayout";
import { t } from "@/i18n/i18n";

afterEach(() => setFontScale("M")); // never leak a scale into other tests

interface FakeNode {
  text: string;
  x: number;
  y: number;
}

let created: FakeNode[] = [];

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
  Text: vi.fn().mockImplementation((opts?: { text?: string }) => {
    const node = {
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
    };
    created.push(node);
    return node;
  }),
}));

// Imported AFTER the mock so the scene sees the fake pixi.
import { InventoryScene } from "@/presentation/InventoryScene";

const mockRenderer = {
  app: { screen: { width: 1280, height: 800 } },
  uiLayer: { addChild: vi.fn(), removeChild: vi.fn(), children: [] },
  gameLayer: { addChild: vi.fn(), removeChild: vi.fn(), children: [] },
  clearGameLayer: vi.fn(),
  clearUILayer: vi.fn(),
} as unknown as import("@/presentation/Renderer").Renderer;

function makeEngine(loadout: ShipLoadout, ownedGearIds: string[]) {
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
        modules: [null, null, null],
      },
      inventory: {
        modules: [],
        resources: [],
        ownedGearIds,
      },
    },
    playerLoadout: loadout,
    lastFlightShipPos: null,
    transitionTo: vi.fn().mockResolvedValue(undefined),
  } as unknown as import("@/systems/GameEngine").GameEngine;
}

describe("InventoryScene warehouse row at L font scale", () => {
  it("keeps the «Выбросить» button from overlapping «Установить» above it", () => {
    setFontScale("L");
    created = [];
    const loadout = new ShipLoadout("hull_scout"); // free weapon slot
    const engine = makeEngine(loadout, ["wpn_pulse"]);

    const scene = new InventoryScene(mockRenderer);
    scene.initialize({ gameEngine: engine });

    const installLabel = t("inventory.install");
    const jettisonLabel = t("inventory.jettison");
    const install = created.find((n) => n.text === installLabel);
    const jettison = created.find((n) => n.text === jettisonLabel);
    expect(install, "expected the «Установить» button").toBeTruthy();
    expect(jettison, "expected the «Выбросить» button").toBeTruthy();
    expect(jettison!.x).toBe(install!.x);

    const gap = lineStepFor(scaledFont(11));
    // The bug: the two buttons sat at a fixed 16 px centre gap regardless of
    // scale; at "L" the button text's own height exceeds that gap and they
    // visually overlap (mis-tappable, same class as the HangarPanel bug).
    expect(jettison!.y - install!.y).toBeGreaterThanOrEqual(gap);

    scene.destroy();
  });
});
