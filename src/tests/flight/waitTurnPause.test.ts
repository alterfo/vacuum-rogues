/**
 * Regression: "Wait-turn pause stops working after a while"
 * (docs/plans/20260619-wait-turn-pause-stops-working.md).
 *
 * Standing still and pressing Play with no course runs a *wait* turn: the ship
 * holds position while the calendar advances one game-day per real second
 * (`advanceWaitTime`, MS_PER_WAIT_DAY = 1000). Pressing Pause must always be able
 * to halt that turn.
 *
 * Root cause (empirically confirmed): `advanceWaitTime(deltaTime)` feeds the
 * **raw, unclamped** per-frame `deltaTime` into `waitDayAccum`, while
 * `ShipPhysics.update` already caps its own dt at 100 ms (ShipPhysics.ts:163).
 * So if the tab is backgrounded — or the loop hitches — for "a while",
 * `requestAnimationFrame` resumes with a single huge `deltaTime` and the
 * `while (waitDayAccum >= 1)` loop flushes hundreds of game-days in ONE frame.
 * The wait turn "runs away": days blow past faster than the player can react, so
 * Pause effectively no longer stops it at a useful point. Each frame must advance
 * at most one wait-day so the turn always stays haltable.
 *
 * Fix (Task 2): `advanceWaitTime` clamps the per-frame dt to one wait-day
 * (`Math.min(deltaTime, MS_PER_WAIT_DAY)`), mirroring the dt cap in
 * `ShipPhysics.update`. The baseline test proves the harness is sound (normal
 * wait → Pause → stop works); the former-red repro is now green, alongside the
 * adjacent edge cases (large dt + Pause, N-days elapsed, post-combat latch).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock pixi.js + presentation helpers so SpaceFlightScene constructs in jsdom
// (mirrors pauseFinishesDay.test.ts).
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

/** A parked ship: a course-less wait turn never moves it (isMoving stays false). */
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

  /** Start a course-less wait turn (the "stand still and press Play" path). */
  function startWaitTurn(): void {
    s.plannedRoute = null;
    s.isTurnRunning = false;
    onPlayPause();
    expect(s.isTurnRunning).toBe(true); // sanity: a wait turn is now running
  }

  // Baseline (GREEN): proves the harness is sound — under normal frame pacing a
  // wait turn pauses at the next day boundary. If this ever fails the fixture is
  // broken, not the bug.
  it("normal pacing: Pause stops the wait turn at the next day boundary", () => {
    startWaitTurn();
    onPlayPause(); // request pause
    updateShip(16); // < 1 wait-day — turn keeps running
    expect(s.isTurnRunning).toBe(true);
    updateShip(1000); // crosses a whole wait-day → deferred pause fires
    expect(s.isTurnRunning).toBe(false);
  });

  // GREEN after the Task-2 fix (was the Task-1 red repro, committed as `it.fails`):
  // the tab is backgrounded for ~10 minutes, then RAF resumes with one enormous
  // deltaTime. `advanceWaitTime` now clamps the per-frame dt to one wait-day, so a
  // single frame advances at most one game-day instead of flushing ~600 at once —
  // the turn can no longer run away faster than the player can react.
  it("a backgrounded tab must not flush an unbounded number of wait-days in one frame", () => {
    startWaitTurn();

    updateShip(600_000); // ~10 minutes elapsed while the tab was backgrounded

    expect(advanceGalaxyDay.mock.calls.length).toBeLessThanOrEqual(1);
  });

  // Edge case (large dt + Pause): even after a huge resume-frame, the turn is
  // still running (only one day passed) and a subsequent Pause halts it at the
  // very next day boundary — the latch is never stranded by the big frame.
  it("after a huge resume-frame, Pause still stops the wait turn promptly", () => {
    startWaitTurn();

    updateShip(600_000); // backgrounded-tab resume — advances at most one day
    expect(s.isTurnRunning).toBe(true); // one day ≠ a runaway; turn still haltable

    onPlayPause(); // request pause
    updateShip(1000); // next whole wait-day → deferred pause fires
    expect(s.isTurnRunning).toBe(false);
  });

  // Edge case (N days elapsed): a wait turn that has run for many days is just as
  // haltable as a fresh one — running "for a while" must not desync the latch.
  it("a wait turn that has run for many days still stops on Pause", () => {
    startWaitTurn();

    for (let day = 0; day < 200; day++) updateShip(1000); // 200 game-days pass
    expect(s.isTurnRunning).toBe(true);
    expect(advanceGalaxyDay.mock.calls.length).toBe(200);

    onPlayPause(); // request pause after 200 days
    updateShip(1000); // next whole wait-day → deferred pause fires
    expect(s.isTurnRunning).toBe(false);
  });

  // Edge case (post-combat): Pause is requested, then a fight starts mid-wait.
  // The wait gate suppresses `advanceWaitTime` during combat (the calendar
  // freezes), so the deferred latch is parked, not consumed — the turn keeps
  // running. When combat clears, the next day boundary consumes the stale latch
  // and the turn ends. The latch must survive a combat interval without
  // stranding the turn.
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
