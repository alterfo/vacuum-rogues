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

function makeWaitingPhysics() {
  return {
    shipX: 0,
    shipY: 0,
    isMoving: false,
    currentSpeed: 0,
    timeScale: 1,
    update: vi.fn(),
    stop: vi.fn(),
    setTarget: vi.fn(),
  };
}

describe("Wait-turn pause stays haltable after a while", () => {
  let scene: SpaceFlightScene;
  let s: Record<string, unknown>;
  let advanceGalaxyDay: ReturnType<typeof vi.fn>;

  const onPlayPause = () =>
    (scene as unknown as { onPlayPause(): void }).onPlayPause();
  const updateShip = (dt: number) =>
    (scene as unknown as { updateShip(dt: number): void }).updateShip(dt);

  beforeEach(() => {
    scene = new SpaceFlightScene(makeMockRenderer());
    s = scene as unknown as Record<string, unknown>;
    advanceGalaxyDay = vi.fn();
    s.hud = { showMessage: vi.fn(), setTurnRunning: vi.fn() };
    s.updateInteractiveCursors = vi.fn();
    s.executeRouteTo = vi.fn();
    s.npcManager = {
      followNpcId: null,
      getFollowTarget: () => null,
      refresh: vi.fn(),
    };
    s.planetManager = {
      routeTargetStationId: null,
      routeTargetPlanetId: null,
      stationMarkers: [],
      planetSprites: [],
      landingThreshold: () => 0,
    };
    s.playerShip = { isArcActive: () => false, update: vi.fn() };
    s.starRenderer = { updateSunContactDamage: () => false };
    s.pendingWarp = null;
    s.combatModule = { isActive: false };
    s.shipPhysics = makeWaitingPhysics();
    s.gameEngine = {
      player: { ship: { hullHP: 100, maxHull: 100 } },
      galaxy: { gameDays: 0 },
      advanceGalaxyDay,
    };
  });

  function startWaitTurn(): void {
    s.plannedRoute = null;
    s.isTurnRunning = false;
    onPlayPause();
    expect(s.isTurnRunning).toBe(true); // sanity: a wait turn is now running
  }

  it("normal pacing: Pause stops the wait turn at the next day boundary", () => {
    startWaitTurn();
    onPlayPause(); // request pause
    updateShip(16); // < 1 wait-day — turn keeps running
    expect(s.isTurnRunning).toBe(true);
    updateShip(1000); // crosses a whole wait-day → deferred pause fires
    expect(s.isTurnRunning).toBe(false);
  });

  it("a backgrounded tab must not flush an unbounded number of wait-days in one frame", () => {
    startWaitTurn();

    updateShip(600_000); // ~10 minutes elapsed while the tab was backgrounded

    expect(advanceGalaxyDay.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it("after a huge resume-frame, Pause still stops the wait turn promptly", () => {
    startWaitTurn();

    updateShip(600_000); // backgrounded-tab resume — advances at most one day
    expect(s.isTurnRunning).toBe(true); // one day ≠ a runaway; turn still haltable

    onPlayPause(); // request pause
    updateShip(1000); // next whole wait-day → deferred pause fires
    expect(s.isTurnRunning).toBe(false);
  });

  it("a wait turn that has run for many days still stops on Pause", () => {
    startWaitTurn();

    for (let day = 0; day < 200; day++) updateShip(1000); // 200 game-days pass
    expect(s.isTurnRunning).toBe(true);
    expect(advanceGalaxyDay.mock.calls.length).toBe(200);

    onPlayPause(); // request pause after 200 days
    updateShip(1000); // next whole wait-day → deferred pause fires
    expect(s.isTurnRunning).toBe(false);
  });

  it("a deferred Pause survives a combat interval and fires once combat clears", () => {
    startWaitTurn();
    onPlayPause(); // request pause (latch set)

    (s.combatModule as { isActive: boolean }).isActive = true; // fight starts
    for (let day = 0; day < 5; day++) updateShip(1000); // calendar frozen by gate
    expect(s.isTurnRunning).toBe(true); // latch parked, not stranded
    expect(advanceGalaxyDay.mock.calls.length).toBe(0); // no days burned in combat

    (s.combatModule as { isActive: boolean }).isActive = false; // fight ends
    updateShip(1000); // next whole wait-day → stale latch consumed
    expect(s.isTurnRunning).toBe(false);
  });
});
