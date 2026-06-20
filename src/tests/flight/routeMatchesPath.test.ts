/**
 * Flight & Shop Polish — Task 1: the planned dashed course (RouteRenderer.drawRoute)
 * must be the exact polyline the ship flies (ShipPhysics.setPath), including the
 * star-avoidance bow and the planet spiral-in.
 *
 * Regression: most execute callers (Ход / second click → onPlayPause) re-fire a
 * planned course WITHOUT threading the `landing` spiral hint, so executeRouteTo
 * used to recompute the path and silently drop the spiral/bow — the ship beelined
 * a path the preview never drew. These pin "drawn == flown" by driving the scene's
 * private route methods directly (running the full initialize() in jsdom isn't
 * practical), capturing what is handed to drawRoute vs setPath.
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

type Pt = { x: number; y: number };

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

interface Harness {
  scene: SpaceFlightScene;
  s: Record<string, unknown>;
  drawn: Pt[][];
  plan(x: number, y: number, landing?: object): void;
  execute(x: number, y: number, landing?: object): void;
  lastDrawn(): Pt[];
  lastSetPath(): Pt[];
}

function makeHarness(
  ship: Pt,
  star: { centerX: number; centerY: number; avoidRadius: number },
): Harness {
  const scene = new SpaceFlightScene(makeMockRenderer());
  const s = scene as unknown as Record<string, unknown>;
  const drawn: Pt[][] = [];

  s.starRenderer = star;
  const shipPhysics = new ShipPhysics(ship.x, ship.y, 0.1);
  s.shipPhysics = shipPhysics;
  s.playerShip = { finishTakeoff: vi.fn() };
  s.routeRenderer = {
    // Capture the exact polyline the renderer is told to draw.
    drawRoute: vi.fn((p: Pt[]) => drawn.push(p)),
    drawLandingMarker: vi.fn(),
    drawNavigationMarker: vi.fn(),
    clearRoute: vi.fn(),
  };
  s.planetManager = {
    getPlanetAt: () => null,
    routeTargetPlanetId: null,
    routeTargetStationId: null,
  };
  s.npcManager = { followNpcId: null };
  s.isTurnRunning = false;
  // Avoid touching the HUD/cursor plumbing the real method walks.
  s.updateInteractiveCursors = vi.fn();

  const setPathSpy = vi.spyOn(shipPhysics, "setPath");

  return {
    scene,
    s,
    drawn,
    plan: (x, y, landing) =>
      (
        scene as unknown as {
          planRouteTo(x: number, y: number, l?: object): void;
        }
      ).planRouteTo(x, y, landing),
    execute: (x, y, landing) =>
      (
        scene as unknown as {
          executeRouteTo(x: number, y: number, l?: object): void;
        }
      ).executeRouteTo(x, y, landing),
    // The drawn polyline includes the ship-start point as element 0; the flown
    // path (setPath) is everything after it. Compare drawn.slice(1) to setPath.
    lastDrawn: () => drawn[drawn.length - 1],
    lastSetPath: () =>
      setPathSpy.mock.calls[setPathSpy.mock.calls.length - 1][0] as Pt[],
  };
}

const STAR = { centerX: 400, centerY: 300, avoidRadius: 120 };

describe("Task 1: drawn route == flown path (single source)", () => {
  let h: Harness;

  beforeEach(() => {
    // Ship due-west of the star; a route due-east crosses the star → bow.
    h = makeHarness({ x: 100, y: 300 }, STAR);
  });

  it("a star-crossing route is drawn and flown along the identical bowed polyline", () => {
    h.plan(700, 300);
    const drawnPlan = h.lastDrawn();
    // A genuine bow: more than just [ship, destination].
    expect(drawnPlan.length).toBeGreaterThan(2);

    h.execute(700, 300);
    const flown = h.lastSetPath();

    // The drawn line's first point is the ship start; the rest is the flown path.
    expect(flown).toEqual(drawnPlan.slice(1));
  });

  it("re-planning re-derives one path; the flown route matches the LAST drawn route", () => {
    h.plan(700, 300); // first plan (bows around the star)
    h.plan(120, 560); // re-plan to a different empty-space point
    const drawnPlan = h.lastDrawn();

    h.execute(120, 560);
    const flown = h.lastSetPath();

    expect(flown).toEqual(drawnPlan.slice(1));
  });

  it("a planet landing executed via Ход (no landing hint) still flies the drawn spiral", () => {
    // Ship + planet on the same side, well clear of the star → straight shot,
    // so computeFlightPath takes the spiral-in branch (the divergence case).
    const hp = makeHarness({ x: 100, y: 100 }, STAR);
    const landing = { planetX: 250, planetY: 150, planetRadius: 40 };

    // Plan WITH the spiral hint (what a planet click does).
    hp.plan(250, 150, landing);
    const drawnPlan = hp.lastDrawn();
    // Spiral-in is a curve, not a 1-segment beeline.
    expect(drawnPlan.length).toBeGreaterThan(2);

    // Execute WITHOUT the hint (what Ход / onPlayPause does) — must still fly the
    // drawn spiral, not a recomputed straight line.
    hp.execute(250, 150);
    const flown = hp.lastSetPath();

    expect(flown).toEqual(drawnPlan.slice(1));
  });

  it("resuming a paused mid-route flight re-bows from the ship's CURRENT position (no stale backtrack)", () => {
    // Plan a star-crossing route — a genuine multi-waypoint bow from the origin.
    h.plan(700, 300);
    const planned = h.lastDrawn();
    expect(planned.length).toBeGreaterThan(2);

    // The ship has flown past the star to the east side; the turn then paused
    // there (endTurn leaves plannedRoute + the original routePath intact). A
    // resume must NOT replay that origin-side path (whose early waypoints are now
    // behind the ship → the ship would fly backward toward the star).
    const sp = h.s.shipPhysics as ShipPhysics;
    sp.shipX = 560;
    sp.shipY = 300;
    sp.isMoving = false;

    h.execute(700, 300); // resume (no landing hint, like Ход / onPlayPause)
    const flown = h.lastSetPath();

    // From (560,300) the shot to (700,300) is clear of the star, so the flown
    // path is a single forward segment — proof it re-derived from the current
    // position instead of replaying the stale origin-side bow (which would aim
    // the ship back at a waypoint it already passed → flying backward).
    expect(flown).toEqual([{ x: 700, y: 300 }]);
  });
});
