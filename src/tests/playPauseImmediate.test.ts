/**
 * Sprint 3 Task 2: the Ход / Pause button must stop the ship immediately when
 * pressed mid-turn, instead of deferring the pause to the next day boundary.
 *
 * onPlayPause() while isTurnRunning=true should call shipPhysics.stop() and
 * endTurn() right away — whether the ship is flying or holding station.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock pixi.js and all presentation helpers that import it (mirrors
// routeOnlyInPause.test.ts so SpaceFlightScene can be constructed in jsdom).
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
  PlanetSprite: vi.fn().mockImplementation(() => ({
    planet: {},
    screenX: 400,
    screenY: 300,
    displayRadius: 60,
    container: { addChild: vi.fn(), children: [] },
    graphics: { eventMode: "static", cursor: "pointer", on: vi.fn() },
    destroy: vi.fn(),
    createHitArea: vi.fn(),
    setTooltipHandlers: vi.fn(),
    update: vi.fn(),
    setOrbitForDay: vi.fn(),
  })),
}));

vi.mock("@/presentation/PlanetInfoPanel", () => ({
  PlanetInfoPanel: vi.fn().mockImplementation(() => ({
    container: { addChild: vi.fn() },
    destroy: vi.fn(),
  })),
}));

vi.mock("@/presentation/SystemMiniMap", () => ({
  SystemMiniMap: vi.fn().mockImplementation(() => ({
    container: { addChild: vi.fn() },
    destroy: vi.fn(),
    updateWithSprites: vi.fn(),
  })),
}));

vi.mock("@/presentation/QuestJournalUI", () => ({
  QuestJournalUI: vi.fn().mockImplementation(() => ({
    container: { addChild: vi.fn() },
    destroy: vi.fn(),
  })),
}));

vi.mock("@/presentation/NpcShipSprite", () => ({
  NpcShipSprite: vi.fn().mockImplementation(() => ({
    npc: {},
    x: 0,
    y: 0,
    mapColor: 0xffffff,
    container: { addChild: vi.fn(), cursor: "pointer" },
    destroy: vi.fn(),
    setClickHandler: vi.fn(),
    setHoverHandler: vi.fn(),
    update: vi.fn(),
    updateHitArea: vi.fn(),
  })),
}));

vi.mock("@/presentation/NpcContactPanel", () => ({
  NpcContactPanel: vi.fn().mockImplementation(() => ({
    container: { addChild: vi.fn() },
    destroy: vi.fn(),
  })),
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
import type { Renderer } from "@/presentation/Renderer";

function makeMockRenderer(): Renderer {
  const makeLayer = () => ({
    addChild: vi.fn(),
    addChildAt: vi.fn(),
    removeChild: vi.fn(),
    children: [],
    eventMode: "auto",
    sortableChildren: false,
    scale: { set: vi.fn() },
    x: 0,
    y: 0,
  });
  return {
    app: {
      screen: { width: 800, height: 600 },
      canvas: Object.assign(document.createElement("canvas"), {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        getBoundingClientRect: vi.fn().mockReturnValue({
          left: 0,
          top: 0,
          width: 800,
          height: 600,
        }),
        style: {},
      }),
      stage: {
        eventMode: "static",
        hitArea: null,
        addChild: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
      },
    },
    gameLayer: makeLayer(),
    uiLayer: makeLayer(),
    stage: { addChild: vi.fn(), addChildAt: vi.fn() },
    clearGameLayer: vi.fn(),
    clearUILayer: vi.fn(),
  } as unknown as Renderer;
}

describe("playPauseImmediate: Pause stops the ship immediately mid-turn", () => {
  let scene: SpaceFlightScene;
  let s: Record<string, unknown>;
  let stop: ReturnType<typeof vi.fn>;
  let endTurn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    scene = new SpaceFlightScene(makeMockRenderer());
    s = scene as unknown as Record<string, unknown>;

    stop = vi.fn();
    endTurn = vi.fn();
    s.shipPhysics = { isMoving: true, stop };
    s.endTurn = endTurn;
    s.showMessage = vi.fn();
    s.updateInteractiveCursors = vi.fn();
    s.executeRouteTo = vi.fn();
  });

  function onPlayPause(): void {
    (scene as unknown as { onPlayPause(): void }).onPlayPause();
  }

  it("stops the ship and ends the turn immediately while flying", () => {
    s.isTurnRunning = true;
    (s.shipPhysics as { isMoving: boolean }).isMoving = true;

    onPlayPause();

    expect(stop).toHaveBeenCalledTimes(1);
    expect(endTurn).toHaveBeenCalledTimes(1);
  });

  it("stops and ends the turn immediately while holding station (not moving)", () => {
    s.isTurnRunning = true;
    (s.shipPhysics as { isMoving: boolean }).isMoving = false;

    onPlayPause();

    expect(stop).toHaveBeenCalledTimes(1);
    expect(endTurn).toHaveBeenCalledTimes(1);
  });

  it("does not stop or end the turn when paused (starts a wait turn instead)", () => {
    s.isTurnRunning = false;
    s.plannedRoute = null;
    s.followNpcId = null;
    s.npcSprites = [];

    onPlayPause();

    expect(stop).not.toHaveBeenCalled();
    expect(endTurn).not.toHaveBeenCalled();
    expect(s.isTurnRunning).toBe(true);
  });
});
