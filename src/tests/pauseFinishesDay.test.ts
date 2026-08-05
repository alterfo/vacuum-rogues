import { describe, it, expect, vi, beforeEach } from "vitest";

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

function makeMovingPhysics() {
  return {
    shipX: 0,
    shipY: 0,
    isMoving: true,
    currentSpeed: 1, // > 0.01 so the day-counter accrues
    timeScale: 1,
    stepPerUpdate: 0,
    update(_dt: number) {
      if (this.isMoving) this.shipX += this.stepPerUpdate;
    },
    stop: vi.fn(function (this: { isMoving: boolean; currentSpeed: number }) {
      this.isMoving = false;
      this.currentSpeed = 0;
    }),
    setTarget: vi.fn(),
  };
}

describe("Pause finishes the current day, then stops (playtest3 F1)", () => {
  let scene: SpaceFlightScene;
  let s: Record<string, unknown>;

  function onPlayPause(): void {
    (scene as unknown as { onPlayPause(): void }).onPlayPause();
  }
  function updateShip(dt: number): void {
    (scene as unknown as { updateShip(dt: number): void }).updateShip(dt);
  }

  beforeEach(() => {
    scene = new SpaceFlightScene(makeMockRenderer());
    s = scene as unknown as Record<string, unknown>;
    s.hud = { showMessage: vi.fn(), setTurnRunning: vi.fn() };
    s.updateInteractiveCursors = vi.fn();
    s.executeRouteTo = vi.fn();
    s.npcManager = {
      followNpcId: null,
      getFollowTarget: () => null,
      refresh: vi.fn(),
      setCursors: vi.fn(),
    };
    s.planetManager = {
      routeTargetStationId: null,
      routeTargetPlanetId: null,
      stationMarkers: [],
      planetSprites: [],
      landingThreshold: () => 0,
      setCursors: vi.fn(),
    };
    s.playerShip = { isArcActive: () => false, update: vi.fn() };
    s.starRenderer = { updateSunContactDamage: () => false };
    s.pendingWarp = null;
  });

  it("does NOT stop immediately on Pause — defers to the next day boundary", () => {
    const phys = makeMovingPhysics();
    phys.stepPerUpdate = 100;
    s.shipPhysics = phys;
    s.isTurnRunning = true;
    s.distanceTraveled = 200; // partway through a day (DISTANCE_PER_DAY = 500)

    onPlayPause();

    expect(s.pauseAtDayBoundary).toBe(true);
    expect(s.isTurnRunning).toBe(true);
    expect(phys.stop).not.toHaveBeenCalled();
    expect(phys.isMoving).toBe(true);
  });

  it("continues to the day boundary, lands on a whole day, THEN ends the turn", () => {
    const advanceGalaxyDay = vi.fn();
    s.gameEngine = {
      player: { ship: { hullHP: 100, maxHull: 100 } },
      galaxy: { gameDays: 7 },
      advanceGalaxyDay,
    };
    const phys = makeMovingPhysics();
    phys.stepPerUpdate = 100; // 5 updates = 500px = 1 day
    s.shipPhysics = phys;
    s.isTurnRunning = true;
    s.distanceTraveled = 200;

    onPlayPause(); // deferred pause requested mid-day

    updateShip(16); // 300
    expect(s.isTurnRunning).toBe(true);
    expect(advanceGalaxyDay).not.toHaveBeenCalled();
    updateShip(16); // 400
    expect(s.isTurnRunning).toBe(true);
    updateShip(16); // 500 → crosses the day boundary

    expect(advanceGalaxyDay).toHaveBeenCalledTimes(1);
    expect(s.isTurnRunning).toBe(false);
    expect(s.pauseAtDayBoundary).toBe(false);
    expect(phys.isMoving).toBe(false);
  });

  it("commits at most one day on the pause frame even when several elapse at once", () => {
    const advanceGalaxyDay = vi.fn();
    s.gameEngine = {
      player: { ship: { hullHP: 100, maxHull: 100 } },
      galaxy: { gameDays: 0 },
      advanceGalaxyDay,
    };
    const phys = makeMovingPhysics();
    phys.stepPerUpdate = 1600; // > 3 days of distance in a single frame
    s.shipPhysics = phys;
    s.isTurnRunning = true;
    s.distanceTraveled = 0;

    onPlayPause();
    updateShip(16); // moves 1600px (>= 3 days) in one frame

    expect(advanceGalaxyDay).toHaveBeenCalledTimes(1);
    expect(s.isTurnRunning).toBe(false);
  });

  it("aborts immediately during a combat auto-follow (no day boundary to wait for)", () => {
    const phys = makeMovingPhysics();
    s.shipPhysics = phys;
    s.isTurnRunning = true;
    (s.npcManager as { followNpcId: string | null }).followNpcId = "npc-1";

    onPlayPause();

    expect(s.isTurnRunning).toBe(false);
    expect(s.pauseAtDayBoundary).toBe(false);
    expect(phys.isMoving).toBe(false);
  });

  it("aborts immediately while an in-flight fight is active (stationary combat has no day to defer to)", () => {
    const phys = makeMovingPhysics();
    phys.isMoving = false; // combat froze the ship in place
    phys.currentSpeed = 0;
    s.shipPhysics = phys;
    s.isTurnRunning = true;
    (s.npcManager as { followNpcId: string | null }).followNpcId = null;
    s.combatModule = { isActive: true };

    onPlayPause();

    expect(s.isTurnRunning).toBe(false);
    expect(s.pauseAtDayBoundary).toBe(false);
  });

  it("low-HP emergency hard-stop halts immediately even with a deferred pause latched", () => {
    const advanceGalaxyDay = vi.fn();
    s.gameEngine = {
      player: { ship: { hullHP: 20, maxHull: 100 } }, // 20% — below the 30% floor
      galaxy: { gameDays: 0 },
      advanceGalaxyDay,
    };
    const phys = makeMovingPhysics();
    phys.stepPerUpdate = 100; // would NOT cross a day boundary this frame
    s.shipPhysics = phys;
    s.isTurnRunning = true;
    s.distanceTraveled = 200;
    s.clearPlannedRoute = vi.fn();
    s.pauseAtDayBoundary = true; // a deferred pause is already pending

    updateShip(16);

    expect(s.isTurnRunning).toBe(false);
    expect(s.pauseAtDayBoundary).toBe(false);
    expect(phys.isMoving).toBe(false);
    expect(advanceGalaxyDay).not.toHaveBeenCalled();
  });

  it("clears the deferred-pause latch when the ship arrives at an open-space destination (no leak to the next turn)", () => {
    s.gameEngine = {
      player: { ship: { hullHP: 100, maxHull: 100 } },
      galaxy: { gameDays: 0 },
      advanceGalaxyDay: vi.fn(),
    };
    const phys = makeMovingPhysics();
    phys.update = function (this: typeof phys) {
      this.isMoving = false;
      this.currentSpeed = 0;
    };
    s.shipPhysics = phys;
    s.isTurnRunning = true;
    s.distanceTraveled = 0;
    s.clearPlannedRoute = vi.fn();
    s.pauseAtDayBoundary = true; // a deferred pause was latched before arrival

    updateShip(16); // ship arrives at the open-space destination this frame

    expect(s.isTurnRunning).toBe(false);
    expect(s.pauseAtDayBoundary).toBe(false);
  });

  it("Play from a paused state starts a fresh turn with no stale deferred pause", () => {
    const phys = makeMovingPhysics();
    phys.isMoving = false;
    s.shipPhysics = phys;
    s.isTurnRunning = false;
    s.plannedRoute = null;
    s.pauseAtDayBoundary = true; // simulate a leftover latch

    onPlayPause(); // course-less wait turn

    expect(s.isTurnRunning).toBe(true);
    expect(s.pauseAtDayBoundary).toBe(false);
  });

  it("does NOT advance the calendar while in-flight combat is active", () => {
    const advanceGalaxyDay = vi.fn();
    s.gameEngine = {
      player: { ship: { hullHP: 100, maxHull: 100 } },
      galaxy: { gameDays: 3 },
      advanceGalaxyDay,
    };
    const phys = makeMovingPhysics();
    phys.isMoving = false; // combat froze the ship in place
    phys.currentSpeed = 0;
    s.shipPhysics = phys;
    s.isTurnRunning = true; // combat began mid-turn (player was flying)
    s.combatModule = { isActive: true };

    updateShip(5000); // 5× MS_PER_WAIT_DAY — would commit 5 wait-days if unguarded

    expect(advanceGalaxyDay).not.toHaveBeenCalled();
  });

  it("resumes the wait-turn calendar once combat ends", () => {
    const advanceGalaxyDay = vi.fn();
    s.gameEngine = {
      player: { ship: { hullHP: 100, maxHull: 100 } },
      galaxy: { gameDays: 3 },
      advanceGalaxyDay,
    };
    const phys = makeMovingPhysics();
    phys.isMoving = false; // ship idle after the fight
    phys.currentSpeed = 0;
    s.shipPhysics = phys;
    s.isTurnRunning = true;
    s.combatModule = { isActive: false }; // combat ended → wait turn resumes

    updateShip(5000);

    expect(advanceGalaxyDay).toHaveBeenCalled();
  });
});
