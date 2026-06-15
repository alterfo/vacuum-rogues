/**
 * Playtest6 bug 1: changing the font size (⚙ → S/M/L) re-inits SPACE_FLIGHT to
 * re-apply the scale. The ship visually "jumped" because the new initialize()
 * seeded entryX/Y from the system edge while the preserveShipPos teleport ran a
 * frame later — a timing race produced a one-frame snap.
 *
 * Belt-and-suspenders fix: onFontScaleChanged() now pins
 * gameEngine.lastFlightShipPos to the current ship position BEFORE the
 * transition, so the new initialize() seeds entryX/Y from the saved spot. This
 * test pins that contract directly (running the full initialize() in jsdom isn't
 * practical — PlanetSprite is mocked there).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Minimal pixi.js stub so SpaceFlightScene can be imported & constructed.
vi.mock("pixi.js", () => {
  const makeContainer = () => ({
    addChild: vi.fn(),
    addChildAt: vi.fn(),
    removeChild: vi.fn(),
    children: [],
    eventMode: "auto",
    cursor: "pointer",
    blendMode: "normal",
    sortableChildren: false,
    rotation: 0,
    x: 0,
    y: 0,
    alpha: 1,
    zIndex: 0,
    scale: { set: vi.fn() },
    filters: [],
    hitArea: null,
    mask: null,
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
      bezierCurveTo: vi.fn().mockReturnThis(),
      closePath: vi.fn().mockReturnThis(),
      clear: vi.fn().mockReturnThis(),
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
      texture: {},
    })),
    TilingSprite: vi.fn().mockImplementation(() => ({
      ...makeContainer(),
      tileScale: { set: vi.fn() },
      tilePosition: { x: 0, y: 0 },
      tint: 0xffffff,
    })),
    Texture: { from: vi.fn().mockReturnValue({}) },
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
vi.mock("@/presentation/PlanetSprite", () => ({ PlanetSprite: vi.fn() }));
vi.mock("@/presentation/PlanetInfoPanel", () => ({ PlanetInfoPanel: vi.fn() }));
vi.mock("@/presentation/SystemMiniMap", () => ({ SystemMiniMap: vi.fn() }));
vi.mock("@/presentation/QuestJournalUI", () => ({ QuestJournalUI: vi.fn() }));
vi.mock("@/presentation/NpcShipSprite", () => ({ NpcShipSprite: vi.fn() }));
vi.mock("@/presentation/NpcContactPanel", () => ({ NpcContactPanel: vi.fn() }));
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
import { ShipPhysics } from "@/systems/ShipPhysics";
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

describe("Playtest6 bug 1: font-scale change pins lastFlightShipPos", () => {
  let scene: SpaceFlightScene;
  let s: Record<string, unknown>;

  beforeEach(() => {
    scene = new SpaceFlightScene(makeMockRenderer());
    s = scene as unknown as Record<string, unknown>;
    // Park the ship in the middle of the system, far from any edge spawn.
    s.shipPhysics = new ShipPhysics(900, 410, 0.1);
  });

  it("sets gameEngine.lastFlightShipPos to the current ship coords before transition", () => {
    const gameEngine: {
      transitionTo: ReturnType<typeof vi.fn>;
      lastFlightShipPos: { x: number; y: number } | null;
    } = { transitionTo: vi.fn(), lastFlightShipPos: null };
    s.gameEngine = gameEngine;

    (scene as unknown as { onFontScaleChanged(): void }).onFontScaleChanged();

    expect(gameEngine.lastFlightShipPos).not.toBeNull();
    expect(gameEngine.lastFlightShipPos?.x).toBeCloseTo(900, 5);
    expect(gameEngine.lastFlightShipPos?.y).toBeCloseTo(410, 5);
  });

  it("pins lastFlightShipPos BEFORE invoking transitionTo (no edge-spawn race)", () => {
    let posAtTransition: { x: number; y: number } | null = null;
    const gameEngine: {
      transitionTo: ReturnType<typeof vi.fn>;
      lastFlightShipPos: { x: number; y: number } | null;
    } = { transitionTo: vi.fn(), lastFlightShipPos: null };
    // Capture what initialize() would read at the moment of transition.
    gameEngine.transitionTo.mockImplementation(() => {
      posAtTransition = gameEngine.lastFlightShipPos;
    });
    s.gameEngine = gameEngine;

    (scene as unknown as { onFontScaleChanged(): void }).onFontScaleChanged();

    expect(gameEngine.transitionTo).toHaveBeenCalledTimes(1);
    expect(posAtTransition).not.toBeNull();
    expect(posAtTransition!.x).toBeCloseTo(900, 5);
    expect(posAtTransition!.y).toBeCloseTo(410, 5);
  });

  it("does nothing when shipPhysics is absent (guard)", () => {
    const gameEngine: {
      transitionTo: ReturnType<typeof vi.fn>;
      lastFlightShipPos: { x: number; y: number } | null;
    } = { transitionTo: vi.fn(), lastFlightShipPos: null };
    s.gameEngine = gameEngine;
    s.shipPhysics = null;

    (scene as unknown as { onFontScaleChanged(): void }).onFontScaleChanged();

    expect(gameEngine.transitionTo).not.toHaveBeenCalled();
    expect(gameEngine.lastFlightShipPos).toBeNull();
  });
});
