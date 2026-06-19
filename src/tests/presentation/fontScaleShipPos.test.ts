/**
 * Font-scale change contract (font-scale restyle plan, Task 1).
 *
 * History: changing the font size (⚙ → S/M/L) used to re-init the whole
 * SPACE_FLIGHT scene "to re-apply the scale", which rebuilt planets/ships/
 * asteroids/NPCs + the nebula backdrop just to resize text (slow + a jarring
 * full redraw), and needed a lastFlightShipPos pin to dodge an edge-spawn race.
 *
 * That re-init is now GONE: onFontScaleChanged() restyles the text-bearing flight
 * modules in place (hud / planetManager / npcManager → refreshFontScale()). This
 * test pins the new contract — no scene transition, no ship-position pin, the
 * world is left untouched — so the heavy re-init can't silently come back.
 * (Running the full initialize() in jsdom isn't practical — PlanetSprite is
 * mocked here — so the module fields are stubbed directly.)
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

describe("Font-scale change restyles in place (no scene re-init)", () => {
  let scene: SpaceFlightScene;
  let s: Record<string, unknown>;
  let hud: { refreshFontScale: ReturnType<typeof vi.fn> };
  let planetManager: { refreshFontScale: ReturnType<typeof vi.fn> };
  let npcManager: { refreshFontScale: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    scene = new SpaceFlightScene(makeMockRenderer());
    s = scene as unknown as Record<string, unknown>;
    // Park the ship in the middle of the system, far from any edge spawn.
    s.shipPhysics = new ShipPhysics(900, 410, 0.1);
    // Stub the text-bearing modules so we can observe the restyle delegation.
    hud = { refreshFontScale: vi.fn() };
    planetManager = { refreshFontScale: vi.fn() };
    npcManager = { refreshFontScale: vi.fn() };
    s.hud = hud;
    s.planetManager = planetManager;
    s.npcManager = npcManager;
  });

  it("restyles the text-bearing modules in place instead of re-initialising", () => {
    const gameEngine: {
      transitionTo: ReturnType<typeof vi.fn>;
      lastFlightShipPos: { x: number; y: number } | null;
    } = { transitionTo: vi.fn(), lastFlightShipPos: null };
    s.gameEngine = gameEngine;

    (scene as unknown as { onFontScaleChanged(): void }).onFontScaleChanged();

    expect(hud.refreshFontScale).toHaveBeenCalledTimes(1);
    expect(planetManager.refreshFontScale).toHaveBeenCalledTimes(1);
    expect(npcManager.refreshFontScale).toHaveBeenCalledTimes(1);
  });

  it("does NOT re-init the scene or pin the ship position", () => {
    const gameEngine: {
      transitionTo: ReturnType<typeof vi.fn>;
      lastFlightShipPos: { x: number; y: number } | null;
    } = { transitionTo: vi.fn(), lastFlightShipPos: null };
    s.gameEngine = gameEngine;

    (scene as unknown as { onFontScaleChanged(): void }).onFontScaleChanged();

    // No scene transition (the world is left exactly as-is) and no ship-position
    // pin: the ship never moves, so there is nothing to preserve.
    expect(gameEngine.transitionTo).not.toHaveBeenCalled();
    expect(gameEngine.lastFlightShipPos).toBeNull();
  });
});
