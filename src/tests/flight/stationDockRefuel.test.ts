/**
 * Task 7 of the smart-autopilot plan (game oddity): station docking must
 * refuel the ship exactly like `SpaceFlightScene.onLandOnPlanet` does on
 * landing. Before this fix `onDockAtStation` transitioned to `StationScene`
 * without touching `ship.energy` at all — an inconsistent, player-visible
 * oddity (land refuels for free, dock doesn't).
 *
 * Mirrors the prototype-invocation pattern in `landingGate.test.ts`: the real
 * `onDockAtStation` method is called off `SpaceFlightScene.prototype` against a
 * minimal `this` carrying only the fields it touches, so no full scene/renderer
 * construction is needed.
 */
import { describe, it, expect, vi } from "vitest";

// Mock pixi.js + the presentation helpers SpaceFlightScene imports at load time
// so the module resolves in jsdom without a real WebGL context (mirrors the
// pixi mock block in landingGate.test.ts). We never construct the scene — the
// real method is invoked off its prototype against a minimal `this`.
vi.mock("pixi.js", () => {
  const makeContainer = () => ({
    addChild: vi.fn(),
    addChildAt: vi.fn(),
    removeChild: vi.fn(),
    children: [],
    eventMode: "auto",
    cursor: "pointer",
    sortableChildren: false,
    x: 0,
    y: 0,
    alpha: 1,
    zIndex: 0,
    scale: { set: vi.fn() },
    filters: [],
    hitArea: null,
    on: vi.fn(),
    off: vi.fn(),
    destroy: vi.fn(),
  });
  return {
    Container: vi.fn().mockImplementation(makeContainer),
    Graphics: vi.fn().mockImplementation(() => ({
      ...makeContainer(),
      fill: vi.fn().mockReturnThis(),
      rect: vi.fn().mockReturnThis(),
      circle: vi.fn().mockReturnThis(),
      ellipse: vi.fn().mockReturnThis(),
      stroke: vi.fn().mockReturnThis(),
      poly: vi.fn().mockReturnThis(),
      moveTo: vi.fn().mockReturnThis(),
      lineTo: vi.fn().mockReturnThis(),
      clear: vi.fn().mockReturnThis(),
      mask: null,
    })),
    Text: vi.fn().mockImplementation(() => ({
      ...makeContainer(),
      anchor: { set: vi.fn() },
      text: "",
      style: { fill: 0, fontFamily: "", fontSize: 12 },
      width: 100,
      height: 20,
    })),
    Sprite: vi.fn().mockImplementation(() => ({
      ...makeContainer(),
      anchor: { set: vi.fn() },
      width: 0,
      height: 0,
      tint: 0xffffff,
      mask: null,
      texture: {},
    })),
    TilingSprite: vi.fn().mockImplementation(() => ({
      ...makeContainer(),
      tileScale: { set: vi.fn() },
      tilePosition: { x: 0, y: 0 },
      tint: 0xffffff,
      mask: null,
    })),
    BlurFilter: vi.fn().mockImplementation(() => ({
      strength: 0,
      padding: 0,
      resolution: 1,
    })),
    Circle: vi.fn().mockImplementation((x: number, y: number, r: number) => ({
      x,
      y,
      radius: r,
    })),
  };
});

vi.mock("@/presentation/sphereMesh", () => ({
  buildSphereMesh: vi.fn().mockReturnValue(null),
}));
vi.mock("@/presentation/PlanetSprite", () => ({
  PlanetSprite: vi.fn().mockImplementation(() => ({})),
}));
vi.mock("@/presentation/PlanetInfoPanel", () => ({
  PlanetInfoPanel: vi.fn().mockImplementation(() => ({ destroy: vi.fn() })),
}));
vi.mock("@/presentation/SystemMiniMap", () => ({
  SystemMiniMap: vi.fn().mockImplementation(() => ({ destroy: vi.fn() })),
}));
vi.mock("@/presentation/QuestJournalUI", () => ({
  QuestJournalUI: vi.fn().mockImplementation(() => ({ destroy: vi.fn() })),
}));
vi.mock("@/presentation/NpcShipSprite", () => ({
  NpcShipSprite: vi.fn().mockImplementation(() => ({})),
}));
vi.mock("@/presentation/NpcContactPanel", () => ({
  NpcContactPanel: vi.fn().mockImplementation(() => ({ destroy: vi.fn() })),
}));
vi.mock("@/presentation/textures", () => ({
  pickVariant: vi.fn().mockReturnValue(null),
  pickVariantKey: vi.fn().mockReturnValue(null),
  loadTextureAsync: vi.fn().mockResolvedValue(null),
  tex: vi.fn().mockReturnValue(null),
}));
vi.mock("@/presentation/cursor", () => ({
  installGameCursors: vi.fn(),
  setCanvasCursor: vi.fn(),
}));

import { SpaceFlightScene } from "@/presentation/SpaceFlightScene";

type DockFn = (station: unknown) => Promise<void>;
const onDockAtStation = (
  SpaceFlightScene.prototype as unknown as { onDockAtStation: DockFn }
).onDockAtStation;

/** A minimal scene `this` carrying only the fields `onDockAtStation` touches. */
function makeScene(energy: number, maxEnergy = 100) {
  const transitionTo = vi.fn().mockResolvedValue(undefined);
  const clearPlannedRoute = vi.fn();
  const scene = {
    gameEngine: {
      player: { ship: { energy, maxEnergy } },
      transitionTo,
    },
    planetManager: { routeTargetStationId: "st-1" },
    clearPlannedRoute,
  };
  return { scene, transitionTo, clearPlannedRoute };
}

const dock = (scene: unknown, station: unknown) =>
  onDockAtStation.call(scene, station);

describe("SpaceFlightScene.onDockAtStation (station refuel — Task 7)", () => {
  it("refuels the ship to max before transitioning to STATION", async () => {
    const { scene, transitionTo } = makeScene(20, 100);

    await dock(scene, { id: "st-1", name: "Alpha" });

    expect((scene.gameEngine.player.ship as { energy: number }).energy).toBe(
      100,
    );
    expect(transitionTo).toHaveBeenCalledTimes(1);
  });

  it("is a no-op refuel (stays at max) when the tank is already full", async () => {
    const { scene } = makeScene(100, 100);

    await dock(scene, { id: "st-1", name: "Alpha" });

    expect((scene.gameEngine.player.ship as { energy: number }).energy).toBe(
      100,
    );
  });
});
