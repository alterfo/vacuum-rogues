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
    expect(jettison!.y - install!.y).toBeGreaterThanOrEqual(gap);

    scene.destroy();
  });
});
