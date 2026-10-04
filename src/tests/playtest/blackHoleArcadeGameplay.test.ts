import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RealEngineHarness } from "./realEngineHarness";
import { SceneType } from "@/types";
import type { ArcadeRunState } from "@/systems/blackHoleArcade/arcadeTypes";
import { arcadeReward } from "@/systems/blackHoleArcade/arcadeRewards";
import { BLACK_HOLE_ARCADE_REWARD_WIN_BONUS } from "@/config/balance";
import { hullDifficulty } from "@/systems/blackHoleArcade/arcadeEnemies";
import type { ArcadeSound } from "@/presentation/blackHoleArcade/arcadeSound";

vi.mock("pixi.js", async () => (await import("./pixiStub")).makePixiStub());

if (typeof globalThis.localStorage === "undefined") {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    },
  });
}

interface ArcadeProbe {
  state: ArcadeRunState;
  fieldX: number;
  fieldY: number;
  fieldScale: number;
  overlayKind: string;
  paused: boolean;
  sound: ArcadeSound;
  touchUi: boolean;
  practice: boolean;
  qualityApplied: number;
  uiPointers: Set<number>;
  toggleSound(): void;
  togglePause(): void;
  queueBomb(): void;
  payout: number | null;
}

function key(code: string, type: "keydown" | "keyup" = "keydown"): void {
  window.dispatchEvent(new KeyboardEvent(type, { code, key: code }));
}

function touch(
  type: string,
  id: number,
  clientX: number,
  clientY: number,
): void {
  const event = new MouseEvent(type, { clientX, clientY, bubbles: true });
  Object.defineProperty(event, "pointerType", { value: "touch" });
  Object.defineProperty(event, "pointerId", { value: id });
  window.dispatchEvent(event);
}

function pointer(
  type: string,
  clientX: number,
  clientY: number,
  button = 0,
): void {
  const event = new MouseEvent(type, {
    clientX,
    clientY,
    button,
    bubbles: true,
  });
  window.dispatchEvent(event);
}

describe("Black-hole arcade gameplay", () => {
  let harness: RealEngineHarness;
  const arcade = () => harness.currentScene() as unknown as ArcadeProbe;
  const credits = () => harness.engine.player!.credits;

  const enter = async (startLevel = 1) => {
    await harness.goTo(SceneType.BLACK_HOLE_ARCADE, {
      returnSystemId: harness.engine.player!.currentSystemId,
      startLevel,
    });
    harness.tick(16);
  };

  const aim = (x: number, y: number) => {
    const a = arcade();
    pointer(
      "pointermove",
      a.fieldX + x * a.fieldScale,
      a.fieldY + y * a.fieldScale,
    );
  };

  const clearLevel = () => {
    arcade().state.plan = { ...arcade().state.plan, spawns: [] };
    for (let i = 0; i < 60; i++) harness.tick(50);
  };

  beforeEach(async () => {
    harness = await RealEngineHarness.boot({ seed: "BH_ARCADE_PLAY" });
    await harness.newGame();
  });

  afterEach(() => {
    harness?.dispose();
    vi.clearAllMocks();
  });

  it("the ship snaps to the mouse with no lag, in field coordinates", async () => {
    await enter();
    aim(150, 400);
    harness.tick(16);
    expect(arcade().state.player.x).toBeCloseTo(150, 3);
    expect(arcade().state.player.y).toBeCloseTo(400, 3);
    aim(600, 900);
    harness.tick(16);
    expect(arcade().state.player.x).toBeCloseTo(600, 3);
    expect(arcade().state.player.y).toBeCloseTo(900, 3);
  });

  it("fires automatically, and F turns auto-fire off and on", async () => {
    await enter();
    for (let i = 0; i < 10; i++) harness.tick(16);
    expect(arcade().state.playerBullets.length).toBeGreaterThan(0);

    key("KeyF");
    arcade().state.playerBullets.length = 0;
    for (let i = 0; i < 20; i++) harness.tick(16);
    const kinds = arcade().state.playerBullets.length;
    expect(kinds).toBe(0);

    pointer("pointerdown", 10, 10, 0);
    harness.tick(16);
    expect(arcade().state.playerBullets.length).toBeGreaterThan(0);
    pointer("pointerup", 10, 10, 0);
  });

  it("the keyboard also flies the ship, and the mouse takes over again when it moves", async () => {
    await enter();
    const x0 = arcade().state.player.x;
    key("KeyA");
    for (let i = 0; i < 10; i++) harness.tick(16);
    key("KeyA", "keyup");
    expect(arcade().state.player.x).toBeLessThan(x0 - 50);
    aim(500, 800);
    harness.tick(16);
    expect(arcade().state.player.x).toBeCloseTo(500, 3);
  });

  it("right click and B each throw one bomb", async () => {
    await enter();
    const bombs = arcade().state.player.bombs;
    pointer("pointerdown", 10, 10, 2);
    harness.tick(16);
    expect(arcade().state.player.bombs).toBe(bombs - 1);
    for (let i = 0; i < 120; i++) harness.tick(16);
    key("KeyB");
    harness.tick(16);
    expect(arcade().state.player.bombs).toBe(bombs - 2);
  });

  it("Escape pauses the world and resumes it", async () => {
    await enter();
    for (let i = 0; i < 5; i++) harness.tick(16);
    key("Escape");
    expect(arcade().paused).toBe(true);
    expect(arcade().overlayKind).toBe("pause");
    const t = arcade().state.levelTimeMs;
    for (let i = 0; i < 20; i++) harness.tick(16);
    expect(arcade().state.levelTimeMs).toBe(t);
    key("Escape");
    expect(arcade().paused).toBe(false);
    harness.tick(16);
    expect(arcade().state.levelTimeMs).toBeGreaterThan(t);
  });

  it("clearing a level offers a breather; Enter carries on to a harder level without paying yet", async () => {
    await enter();
    const before = credits();
    clearLevel();
    expect(arcade().state.phase).toBe("intermission");
    expect(arcade().overlayKind).toBe("intermission");
    key("Enter");
    expect(arcade().state.level).toBe(2);
    expect(arcade().state.phase).toBe("playing");
    expect(credits()).toBe(before);
  });

  it("cashing out pays once for the levels cleared, and Enter then leaves", async () => {
    await enter();
    clearLevel();
    key("Enter");
    clearLevel();
    const before = credits();
    arcade().state.chipCredits = 70;
    const expected = arcadeReward(2, 70, "cashOut");

    key("KeyC");
    expect(credits() - before).toBe(expected);
    expect(arcade().payout).toBe(expected);
    key("KeyC");
    expect(credits() - before).toBe(expected);

    key("Enter");
    await vi.waitFor(() =>
      expect(harness.currentSceneType()).toBe(SceneType.SPACE_FLIGHT),
    );
    for (let i = 0; i < 20; i++) harness.tick(16);
    expect(harness.currentSceneType()).toBe(SceneType.SPACE_FLIGHT);
    expect(credits() - before).toBe(expected);
    expect(harness.errors()).toEqual([]);
  });

  it("dying pays half the level money and shows the end screen instead of auto-leaving", async () => {
    await enter();
    clearLevel();
    key("Enter");
    clearLevel();
    key("Enter");
    const before = credits();
    arcade().state.player.hull = 1;
    arcade().state.player.invulnMs = 0;
    arcade().state.player.shield = 0;
    arcade().state.enemyBullets.push({
      id: 9999,
      owner: "enemy",
      kind: "enemyOrb",
      x: arcade().state.player.x,
      y: arcade().state.player.y,
      vx: 0,
      vy: 0,
      radius: 6,
      damage: 50,
      pierce: 0,
      hitIds: [],
      ttlMs: 0,
      ageMs: 0,
      homingTurn: 0,
      waveBaseX: 0,
      waveAmp: 0,
      waveFreq: 0,
      wavePhase: 0,
      blast: 0,
      speed: 0,
    });
    harness.tick(16);
    expect(arcade().state.phase).toBe("lost");
    expect(credits() - before).toBe(arcadeReward(2, 0, "lost"));
    for (let i = 0; i < 200; i++) harness.tick(16);
    expect(harness.currentSceneType()).toBe(SceneType.BLACK_HOLE_ARCADE);
    key("Enter");
    await vi.waitFor(() =>
      expect(harness.currentSceneType()).toBe(SceneType.SPACE_FLIGHT),
    );
  });

  it("retreating from the pause menu pays half and cannot be paid twice", async () => {
    await enter();
    clearLevel();
    key("Enter");
    const before = credits();
    key("Escape");
    key("KeyL");
    const expected = arcadeReward(1, 0, "retreat");
    expect(credits() - before).toBe(expected);
    key("KeyL");
    expect(credits() - before).toBe(expected);
  });

  it("winning the final level pays the full run plus the victory bonus", async () => {
    await enter(50);
    const before = credits();
    clearLevel();
    expect(arcade().state.phase).toBe("won");
    const paid = credits() - before;
    expect(paid).toBe(arcadeReward(50, 0, "won"));
    expect(paid).toBeGreaterThan(BLACK_HOLE_ARCADE_REWARD_WIN_BONUS);
  });

  it("leaving with Escape on the end screen goes back to flight", async () => {
    await enter();
    clearLevel();
    key("KeyC");
    key("Escape");
    await vi.waitFor(() =>
      expect(harness.currentSceneType()).toBe(SceneType.SPACE_FLIGHT),
    );
  });

  it("a long real-time run stays error-free with the whole pipeline live", async () => {
    await enter(30);
    arcade().state.player.hull = 1e6;
    arcade().state.player.maxHull = 1e6;
    arcade().state.player.weapon = "laser";
    arcade().state.player.weaponLevel = 5;
    for (let i = 0; i < 1500; i++) {
      aim(360 + Math.sin(i / 20) * 280, 880);
      harness.tick(16);
    }
    expect(harness.errors()).toEqual([]);
    expect(arcade().state.kills).toBeGreaterThan(0);
  });

  it("the run difficulty follows the pilot's hull, a little", async () => {
    const loadout = harness.engine.playerLoadout!;
    const real = loadout.derivedStats();
    const spy = vi.spyOn(loadout, "derivedStats");

    spy.mockReturnValue({ ...real, maxHull: 30 });
    await enter();
    expect(arcade().state.difficulty).toBe(1);

    spy.mockReturnValue({ ...real, maxHull: 440 });
    await enter();
    expect(arcade().state.difficulty).toBeCloseTo(hullDifficulty(440), 5);
    expect(arcade().state.difficulty).toBeGreaterThan(1.1);
    expect(arcade().state.difficulty).toBeLessThanOrEqual(1.25);
  });

  it("M and the HUD button switch the sound off and on", async () => {
    await enter();
    const sound = arcade().sound;
    expect(sound.enabled).toBe(true);
    key("KeyM");
    expect(sound.enabled).toBe(false);
    key("KeyM");
    expect(sound.enabled).toBe(true);
    key("Escape");
    key("KeyM");
    expect(sound.enabled).toBe(false);
  });

  it("gameplay events reach the sound engine, and music follows the situation", async () => {
    await enter(10);
    const sound = arcade().sound;
    const handle = vi.spyOn(sound, "handle");
    const music = vi.spyOn(sound, "setMusic");
    for (let i = 0; i < 20; i++) harness.tick(16);
    expect(handle.mock.calls.some(([e]) => e.kind === "fire")).toBe(true);
    expect(music).toHaveBeenLastCalledWith("calm", expect.any(Number));

    const last =
      arcade().state.plan.spawns[arcade().state.plan.spawns.length - 1].atMs;
    arcade().state.levelTimeMs = last;
    arcade().state.player.hull = 1e6;
    arcade().state.player.maxHull = 1e6;
    for (let i = 0; i < 40; i++) harness.tick(16);
    expect(music).toHaveBeenLastCalledWith("boss", expect.any(Number));

    key("Escape");
    harness.tick(16);
    expect(music).toHaveBeenLastCalledWith("off", expect.any(Number));
  });

  it("leaving the scene shuts the audio down", async () => {
    await enter();
    const sound = arcade().sound;
    const destroy = vi.spyOn(sound, "destroy");
    await harness.goTo(SceneType.SPACE_FLIGHT);
    expect(destroy).toHaveBeenCalled();
  });

  it("a finger drags the ship relatively, and never jumps to where it lands", async () => {
    await enter();
    const a = arcade();
    const x0 = a.state.player.x;
    const y0 = a.state.player.y;
    touch("pointerdown", 1, 100, 300);
    expect(a.touchUi).toBe(true);
    harness.tick(16);
    expect(a.state.player.x).toBeCloseTo(x0, 3);
    expect(a.state.player.y).toBeCloseTo(y0, 3);

    touch("pointermove", 1, 140, 270);
    harness.tick(16);
    expect(a.state.player.x).toBeCloseTo(x0 + (40 * 1.2) / a.fieldScale, 2);
    expect(a.state.player.y).toBeCloseTo(y0 - (30 * 1.2) / a.fieldScale, 2);

    touch("pointerup", 1, 140, 270);
    const px = a.state.player.x;
    harness.tick(16);
    expect(a.state.player.x).toBeCloseTo(px, 3);
  });

  it("a second finger does not steal the drag, and a button tap does not start one", async () => {
    await enter();
    const a = arcade();
    touch("pointerdown", 1, 100, 300);
    touch("pointerdown", 2, 500, 500);
    touch("pointermove", 2, 560, 500);
    harness.tick(16);
    expect(a.state.player.x).toBeCloseTo(a.state.player.x, 3);
    const x = a.state.player.x;
    touch("pointermove", 2, 700, 500);
    harness.tick(16);
    expect(a.state.player.x).toBeCloseTo(x, 3);
    touch("pointerup", 1, 100, 300);
    touch("pointerup", 2, 100, 300);

    a.uiPointers.add(9);
    touch("pointerdown", 9, 300, 300);
    touch("pointermove", 9, 400, 300);
    const x2 = a.state.player.x;
    harness.tick(16);
    expect(a.state.player.x).toBeCloseTo(x2, 3);
    expect(a.uiPointers.has(9)).toBe(false);
  });

  it("the on-screen controls drive pause, bombs and sound", async () => {
    await enter();
    const a = arcade();
    const bombs = a.state.player.bombs;
    a.queueBomb();
    harness.tick(16);
    expect(a.state.player.bombs).toBe(bombs - 1);
    a.togglePause();
    expect(a.paused).toBe(true);
    a.queueBomb();
    a.togglePause();
    expect(a.paused).toBe(false);
    const on = a.sound.enabled;
    a.toggleSound();
    expect(a.sound.enabled).toBe(!on);
  });

  it("backgrounding the page pauses the run", async () => {
    await enter();
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(arcade().paused).toBe(true);
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
  });

  it("sustained slow frames degrade the effects automatically", async () => {
    await enter();
    expect(arcade().qualityApplied).toBe(0);
    for (let i = 0; i < 400; i++) harness.tick(60);
    expect(arcade().qualityApplied).toBe(2);
    expect(harness.errors()).toEqual([]);
  });

  it("opened without a game it is a practice run: no pay, back to the main menu", async () => {
    const engine = harness.engine as unknown as { player: unknown };
    const player = engine.player;
    engine.player = null;
    try {
      await harness.goTo(SceneType.BLACK_HOLE_ARCADE, {});
      harness.tick(16);
      expect(arcade().practice).toBe(true);
      clearLevel();
      key("KeyC");
      expect(arcade().payout).toBe(0);
      key("Enter");
      await vi.waitFor(() =>
        expect(harness.currentSceneType()).toBe(SceneType.MAIN_MENU),
      );
      expect(harness.errors()).toEqual([]);
    } finally {
      engine.player = player;
    }
  });
});
