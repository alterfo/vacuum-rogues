import { describe, it, expect, vi, beforeEach } from "vitest";

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
import { planetOrbitPosition, hashToAngle } from "@/utils/flightGeometry";

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

const STAR = { x: 400, y: 300 };
const EDGE = { x: 400, y: 3000 };

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

describe("Task 9: re-entry spawn beside station / landed planet", () => {
  let scene: SpaceFlightScene;
  let s: Record<string, unknown>;

  beforeEach(() => {
    scene = new SpaceFlightScene(makeMockRenderer());
    s = scene as unknown as Record<string, unknown>;
    s.starRenderer = { centerX: STAR.x, centerY: STAR.y };
    s.shipPhysics = new ShipPhysics(EDGE.x, EDGE.y, 0.1);
    s.shipContainer = { x: 0, y: 0 };
    s.planetManager = {
      planetSprites: [
        {
          planet: { id: "planet-1" },
          screenX: 700,
          screenY: 300,
          displayRadius: 80,
        },
      ],
      stationMarkers: [{ station: { id: "station-1" }, x: 250, y: 520 }],
    };
  });

  it("spawnShipBeside parks the ship just outside the body, along the star radial", () => {
    (
      scene as unknown as {
        spawnShipBeside(x: number, y: number, r: number, m?: number): void;
      }
    ).spawnShipBeside(700, 300, 80);
    const phys = s.shipPhysics as ShipPhysics;
    expect(phys.shipX).toBeCloseTo(700 + 80 + 40, 5);
    expect(phys.shipY).toBeCloseTo(300, 5);
  });

  it("STATION → SPACE_FLIGHT spawns within 200px of the station, not at the edge", () => {
    (
      scene as unknown as { applyReentrySpawn(id?: string): void }
    ).applyReentrySpawn("station-1");
    const phys = s.shipPhysics as ShipPhysics;
    expect(dist(phys.shipX, phys.shipY, 250, 520)).toBeLessThanOrEqual(200);
    expect(dist(phys.shipX, phys.shipY, EDGE.x, EDGE.y)).toBeGreaterThan(200);
  });

  it("falls back to landedPlanetId when there is no station origin (within 200px)", () => {
    const player = { landedPlanetId: "planet-1" as string | null };
    s.gameEngine = { player };
    (
      scene as unknown as { applyReentrySpawn(id?: string): void }
    ).applyReentrySpawn(undefined);
    const phys = s.shipPhysics as ShipPhysics;
    expect(dist(phys.shipX, phys.shipY, 700, 300)).toBeLessThanOrEqual(200);
    expect(player.landedPlanetId).toBeNull();
  });

  it("leaves the ship at its default spawn when neither station nor landing is known", () => {
    s.gameEngine = { player: { landedPlanetId: null } };
    (
      scene as unknown as { applyReentrySpawn(id?: string): void }
    ).applyReentrySpawn(undefined);
    const phys = s.shipPhysics as ShipPhysics;
    expect(phys.shipX).toBeCloseTo(EDGE.x, 5);
    expect(phys.shipY).toBeCloseTo(EDGE.y, 5);
  });

  it("falls back to the domain station position when the live marker lookup misses (e.g. a lookup-timing race)", () => {
    s.planetManager = { planetSprites: [], stationMarkers: [] };
    s.gameEngine = {
      player: { currentSystemId: "sys-1", landedPlanetId: null },
      galaxy: {
        systems: [
          {
            id: "sys-1",
            planets: [],
            stations: [{ id: "station-1", orbitAngle: 0, orbitRadius: 300 }],
          },
        ],
      },
    };
    (
      scene as unknown as { applyReentrySpawn(id?: string): void }
    ).applyReentrySpawn("station-1");
    const phys = s.shipPhysics as ShipPhysics;
    expect(dist(phys.shipX, phys.shipY, 700, 300)).toBeLessThanOrEqual(200);
    expect(dist(phys.shipX, phys.shipY, EDGE.x, EDGE.y)).toBeGreaterThan(200);
  });

  it("falls back to the domain planet position for landedPlanetId when the live sprite lookup misses", () => {
    s.planetManager = { planetSprites: [], stationMarkers: [] };
    s.gameEngine = {
      player: { currentSystemId: "sys-1", landedPlanetId: "planet-2" },
      galaxy: {
        gameDays: 0,
        systems: [
          {
            id: "sys-1",
            stations: [],
            planets: [{ id: "planet-2", orbitalRadius: 250 }],
          },
        ],
      },
    };
    (
      scene as unknown as { applyReentrySpawn(id?: string): void }
    ).applyReentrySpawn(undefined);
    const phys = s.shipPhysics as ShipPhysics;
    const expected = planetOrbitPosition(250, hashToAngle("planet-2"), 0, STAR);
    expect(
      dist(phys.shipX, phys.shipY, expected.x, expected.y),
    ).toBeLessThanOrEqual(200);
    expect(dist(phys.shipX, phys.shipY, EDGE.x, EDGE.y)).toBeGreaterThan(200);
    expect(
      (s.gameEngine as { player: { landedPlanetId: string | null } }).player
        .landedPlanetId,
    ).toBeNull();
  });
});

describe("preserveShipPos entry spawn + font-scale restyle-in-place", () => {
  let scene: SpaceFlightScene;
  let s: Record<string, unknown>;

  beforeEach(() => {
    scene = new SpaceFlightScene(makeMockRenderer());
    s = scene as unknown as Record<string, unknown>;
    s.starRenderer = { centerX: STAR.x, centerY: STAR.y };
    s.shipPhysics = new ShipPhysics(900, 410, 0.1);
    s.planetManager = { planetSprites: [], stationMarkers: [] };
  });

  it("applyEntrySpawn teleports to preserveShipPos, never to the edge", () => {
    const keep = { x: 900, y: 410 };
    (
      scene as unknown as { applyEntrySpawn(ctx?: object): void }
    ).applyEntrySpawn({ preserveShipPos: keep });
    const phys = s.shipPhysics as ShipPhysics;
    expect(phys.shipX).toBeCloseTo(keep.x, 5);
    expect(phys.shipY).toBeCloseTo(keep.y, 5);
    expect(dist(phys.shipX, phys.shipY, EDGE.x, EDGE.y)).toBeGreaterThan(200);
  });

  it("applyEntrySpawn falls back to the domain planet position for fromPlanetId when the live sprite lookup misses", () => {
    s.gameEngine = {
      player: { currentSystemId: "sys-1" },
      galaxy: {
        gameDays: 3,
        systems: [
          {
            id: "sys-1",
            stations: [],
            planets: [{ id: "planet-3", orbitalRadius: 260 }],
          },
        ],
      },
    };
    (
      scene as unknown as { applyEntrySpawn(ctx?: object): void }
    ).applyEntrySpawn({ fromPlanetId: "planet-3" });
    const phys = s.shipPhysics as ShipPhysics;
    const expected = planetOrbitPosition(260, hashToAngle("planet-3"), 3, STAR);
    expect(
      dist(phys.shipX, phys.shipY, expected.x, expected.y),
    ).toBeLessThanOrEqual(200);
    expect(dist(phys.shipX, phys.shipY, EDGE.x, EDGE.y)).toBeGreaterThan(200);
  });

  it("onFontScaleChanged restyles modules in place — no scene re-init", () => {
    const transitionTo = vi.fn();
    s.gameEngine = { transitionTo, lastFlightShipPos: null };
    const hud = { refreshFontScale: vi.fn() };
    const npcManager = { refreshFontScale: vi.fn() };
    s.hud = hud;
    s.planetManager = { refreshFontScale: vi.fn() };
    s.npcManager = npcManager;

    (scene as unknown as { onFontScaleChanged(): void }).onFontScaleChanged();

    expect(transitionTo).not.toHaveBeenCalled();
    expect(hud.refreshFontScale).toHaveBeenCalledTimes(1);
    expect(npcManager.refreshFontScale).toHaveBeenCalledTimes(1);
    expect(
      (s.planetManager as { refreshFontScale: ReturnType<typeof vi.fn> })
        .refreshFontScale,
    ).toHaveBeenCalledTimes(1);
  });
});
