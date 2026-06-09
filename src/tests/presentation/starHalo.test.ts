/**
 * Sprint 3 Task 4: replace solar corona + bezier prominences with a quality
 * 3-layer radial glow halo.
 *
 * After star setup the scene must own a halo container and must NOT carry any
 * animated-prominence state (the old `starProminenceData` field and the
 * triangular spikes / corona rings it drove are gone). This guards against a
 * regression that re-introduces the cheap-looking corona.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mirror the pixi.js + presentation mocks from hudCursors.test.ts so the
// SpaceFlightScene can be constructed in jsdom without a real renderer.
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

import { StarRenderer } from "@/presentation/flight/StarRenderer";
import type { Renderer } from "@/presentation/Renderer";
import type { GameEngine } from "@/systems/GameEngine";

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
        getBoundingClientRect: vi
          .fn()
          .mockReturnValue({ left: 0, top: 0, width: 800, height: 600 }),
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

describe("starHalo: quality glow replaces corona + prominences", () => {
  let star: StarRenderer;
  let s: Record<string, unknown>;

  beforeEach(() => {
    const renderer = makeMockRenderer();
    const gameEngine: GameEngine | null = null;
    // Star rendering now lives in the StarRenderer FlightModule (extracted from
    // SpaceFlightScene). Run the star setup (procedural path: no gameEngine /
    // star texture).
    star = new StarRenderer(renderer, gameEngine, renderer.gameLayer);
    s = star as unknown as Record<string, unknown>;
    star.initialize();
  });

  it("creates a halo container after star setup", () => {
    expect(s.starHaloContainer).not.toBeNull();
    expect(s.starHaloContainer).toBeDefined();
  });

  it("carries no animated-prominence state (corona/spikes removed)", () => {
    // The old field is gone entirely — it must not be re-introduced.
    expect(s.starProminenceData).toBeUndefined();
  });

  it("builds a halo in screen blend with a single blur filter", () => {
    const halo = s.starHaloContainer as {
      blendMode: string;
      filters: unknown[];
    };
    expect(halo.blendMode).toBe("screen");
    expect(Array.isArray(halo.filters)).toBe(true);
    expect(halo.filters.length).toBe(1);
  });

  it("update advances elapsed time without prominence animation", () => {
    s.starElapsed = 0;
    star.update(16, 0);
    expect(s.starElapsed).toBe(16);
  });
});
