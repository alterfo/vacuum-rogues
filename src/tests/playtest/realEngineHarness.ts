/**
 * Real-engine playtest harness.
 *
 * Boots the *real* {@link GameEngine} with the *real* game-logic services
 * (`GalaxyService`, `PlayerService`, `QuestManagerAdapter`, the engine-owned
 * `BankingService`, `AdaptiveQualityProfile`) and only stubs the I/O edges
 * (save + ONNX) and PixiJS (via {@link makePixiStub}, declared by each test
 * file's `vi.mock("pixi.js")`). Unlike the mocked unit tests it drives genuine
 * scene transitions through `transitionTo`, so it exercises the *wiring* between
 * components — the integration gap where this month's bugs hid (combat not
 * firing, «Новая игра» not resetting, the hex-removal save crash).
 *
 * Every run installs an **error sink** that records each `logger.error` call and
 * any global `error` / `unhandledrejection` for the run's duration. Scenarios
 * assert `errors()` is empty — the cheap catch-all for the
 * "X is not a constructor / cannot read property" class of integration breakage.
 *
 * The harness deliberately does NOT start the rAF game loop: frames are advanced
 * deterministically via {@link RealEngineHarness.tick} so tests stay stable.
 */
import { GameEngine, GameEngineDIDependencies } from "@/systems/GameEngine";
import { GalaxyService, PlayerService } from "@/core/services";
import { QuestManagerAdapter } from "@/core/adapters";
import { AdaptiveQualityProfile } from "@/ai/AdaptiveQualityProfile";
import { MockSaveService, MockExceptionHandler } from "@/tests/mocks";
import { Renderer } from "@/presentation/Renderer";
import { SceneType, FactionType } from "@/types";
import type { GameMode } from "@/types";
import type { GameScene } from "@/presentation/GameScene";
import type { Player } from "@/domain/Player";
import type { Galaxy } from "@/domain/Galaxy";
import type { IQuestService } from "@/core/ports/IQuestService";
import { logger } from "@/utils/logger";

/** A single recorded failure observed during a harness run. */
export interface RecordedError {
  /** Where it surfaced: a `logger.error` call or a global error/rejection. */
  source: "logger" | "unhandled";
  message: string;
  detail?: unknown;
}

/**
 * Structural mirror of `CombatModule.PlayerDeathCause` (win-rate-100pct plan,
 * Task 6 escalation telemetry) — not imported, same "mirror, don't couple"
 * convention `campaignMetrics.ts`'s `CampaignDeathCause` already uses.
 */
export interface RecordedPlayerDeathCause {
  killerNpcId: string;
  killerRole: string;
  engagementStartHullFraction: number | null;
  simultaneousCombatants: number;
  roundsSurvived: number;
}

export interface HarnessOptions {
  /** Galaxy seed — fixed by default so runs are deterministic. */
  seed?: string;
  /** Number of systems in the generated galaxy. */
  systemCount?: number;
  /**
   * A save store to use instead of a fresh per-harness {@link MockSaveService}.
   * Pass the *same* instance to two harnesses to simulate a reload: engine A
   * writes an autosave, engine B (fresh instance, shared store) reads it back.
   */
  saveService?: MockSaveService;
}

/**
 * Boot + drive a real GameEngine headlessly. Construct via the async
 * {@link RealEngineHarness.boot} factory; always `dispose()` in a test teardown.
 */
export class RealEngineHarness {
  readonly engine: GameEngine;
  private readonly galaxyService: GalaxyService;
  private readonly saveService: MockSaveService;
  private readonly recorded: RecordedError[] = [];
  private readonly seed: string;
  private readonly systemCount: number;

  private container: HTMLDivElement | null = null;
  private restoreLogger: (() => void) | null = null;
  private restoreCanvas: (() => void) | null = null;
  private onWindowError: ((ev: ErrorEvent) => void) | null = null;
  private onRejection: ((ev: PromiseRejectionEvent) => void) | null = null;

  /**
   * Most recent `CombatModule.lastDeathCause` observed across any {@link tick}
   * this session (win-rate-100pct plan, Task 6 escalation telemetry).
   * Captured synchronously right after `currentScene.update()` — in the SAME
   * call stack as a fatal hit, before the (fire-and-forgotten, unawaited)
   * GAME_OVER scene transition has any chance to swap `currentScene` out from
   * under a caller polling from further up the stack (a caller-side "read
   * after the fact" raced and lost this reference — see the campaign runner's
   * own history note). Surviving scene/`CombatModule` teardown+recreation is
   * exactly why this lives on the long-lived harness, not the ephemeral scene.
   */
  private _lastDeathCause: RecordedPlayerDeathCause | null = null;

  private constructor(opts: HarnessOptions) {
    this.seed = opts.seed ?? "PLAYTEST_SEED";
    this.systemCount = opts.systemCount ?? 12;

    this.galaxyService = new GalaxyService();
    this.saveService = opts.saveService ?? new MockSaveService();

    const diDeps: GameEngineDIDependencies = {
      // I/O edges are stubbed (no IndexedDB, no ONNX model loading)…
      saveService: this.saveService,
      exceptionHandler: new MockExceptionHandler(),
      // …everything that carries game logic is REAL, so the wiring is genuine.
      galaxyService: this.galaxyService,
      playerService: new PlayerService(),
      questService: new QuestManagerAdapter(),
      qualityProfile: new AdaptiveQualityProfile(),
    };
    this.engine = new GameEngine(diDeps);
  }

  /**
   * Construct the harness, install the error sink, wire a real renderer over the
   * stubbed Pixi, generate a real galaxy and land on the main menu.
   */
  static async boot(opts: HarnessOptions = {}): Promise<RealEngineHarness> {
    const harness = new RealEngineHarness(opts);
    // These install global patches (logger.error, the canvas prototype, window
    // listeners). The async work below can reject, in which case boot() never
    // returns the harness and the caller's `afterEach` cannot dispose it — so we
    // must clean up the patches ourselves before rethrowing, or they leak into
    // every subsequent test in the worker.
    harness.installErrorSink();
    harness.installCanvas2DStub();

    try {
      // A real Renderer over the stubbed PixiJS Application — gives every scene a
      // genuine `renderer.app.screen` / game+ui layers to build into.
      const container = document.createElement("div");
      container.id = "game-container";
      document.body.appendChild(container);
      harness.container = container;
      const renderer = new Renderer(container);
      await renderer.initialize();
      harness.engine.renderer = renderer;

      // Real galaxy so the game-start scenes have systems to resolve against.
      harness.engine.galaxy = await harness.galaxyService.generate(
        harness.seed,
        harness.systemCount,
      );

      await harness.engine.transitionTo(SceneType.MAIN_MENU, {
        gameEngine: harness.engine,
      });
      return harness;
    } catch (error) {
      harness.dispose();
      throw error;
    }
  }

  /**
   * Start a fresh game: enter the in-flight scene with no player yet, which runs
   * the engine's real new-game path (player + loadout + difficulty + banking).
   */
  async newGame(
    faction: FactionType = FactionType.OUTLANDERS,
    mode: GameMode = "NORMAL",
  ): Promise<void> {
    if (!this.engine.galaxy) {
      this.engine.galaxy = await this.galaxyService.generate(
        this.seed,
        this.systemCount,
      );
    }
    await this.engine.transitionTo(SceneType.SPACE_FLIGHT, {
      gameEngine: this.engine,
      selectedFaction: faction,
      selectedGameMode: mode,
    });
  }

  /** Drive a real scene transition (the same call the game uses internally). */
  async goTo(sceneType: SceneType, context: object = {}): Promise<void> {
    await this.engine.transitionTo(sceneType, {
      gameEngine: this.engine,
      ...context,
    });
  }

  /** Advance one deterministic frame (mirrors the engine's game-loop body). */
  tick(deltaMs = 16): void {
    // Captured BEFORE `.update()` (Task 6 escalation telemetry): a fatal hit
    // inside this very `.update()` call chain reaches
    // `GameEngine.transitionTo` SYNCHRONOUSLY (`triggerPlayerDeath` →
    // `transitionToGameOver` → `transitionTo`, called with no `await` before
    // it — see `EndgameController.triggerPlayerDeath`), which itself
    // synchronously destroys and nulls `engine.currentScene` (`transitionTo`:
    // `this.currentScene.destroy(); this.currentScene = null;`, BEFORE its
    // first `await`) — all nested inside THIS `.update()` call, not after it
    // returns. Re-reading `this.engine.currentScene` after `.update()` would
    // already see `null`/the next scene, losing the dying flight scene's
    // `combatModule` entirely. This local reference stays valid regardless —
    // only the engine's OWN pointer was reassigned, not this variable — and
    // `CombatModule.destroy()` never clears `lastDeathCause`.
    const sceneBeforeUpdate = this.engine.currentScene;
    try {
      sceneBeforeUpdate?.update(deltaMs);
      const cause = (
        sceneBeforeUpdate as {
          combatModule?: { lastDeathCause?: RecordedPlayerDeathCause | null };
        } | null
      )?.combatModule?.lastDeathCause;
      if (cause) this._lastDeathCause = cause;
    } catch (error) {
      this.recorded.push({
        source: "unhandled",
        message: (error as Error)?.message ?? String(error),
        detail: error,
      });
    }
  }

  /** See {@link _lastDeathCause}. `null` until the player has died once. */
  lastDeathCause(): RecordedPlayerDeathCause | null {
    return this._lastDeathCause;
  }

  currentScene(): GameScene | null {
    return this.engine.currentScene;
  }

  currentSceneType(): SceneType {
    return this.engine.currentSceneType;
  }

  player(): Player | null {
    return this.engine.player;
  }

  galaxy(): Galaxy | null {
    return this.engine.galaxy;
  }

  quests(): IQuestService {
    return this.engine.questManager;
  }

  credits(): number {
    return this.engine.player?.credits ?? 0;
  }

  /** The list of failures recorded so far (a copy — safe to assert against). */
  errors(): RecordedError[] {
    return [...this.recorded];
  }

  /** Drop everything recorded so far (use between scenario phases if needed). */
  clearErrors(): void {
    this.recorded.length = 0;
  }

  /** Restore the patched logger / global listeners and detach the DOM container. */
  dispose(): void {
    this.restoreLogger?.();
    this.restoreLogger = null;
    this.restoreCanvas?.();
    this.restoreCanvas = null;
    if (typeof window !== "undefined") {
      if (this.onWindowError)
        window.removeEventListener("error", this.onWindowError);
      if (this.onRejection) {
        window.removeEventListener("unhandledrejection", this.onRejection);
      }
    }
    this.onWindowError = null;
    this.onRejection = null;
    this.container?.remove();
    this.container = null;
  }

  /** Patch `logger.error` + global error/rejection capture for the run. */
  private installErrorSink(): void {
    const original = logger.error;
    this.restoreLogger = () => {
      logger.error = original;
    };
    logger.error = (message: string, ...args: unknown[]): void => {
      this.recorded.push({ source: "logger", message, detail: args });
      // Pass through so failures are still visible in test output when debugging.
      original(message, ...args);
    };

    if (typeof window !== "undefined") {
      this.onWindowError = (ev: ErrorEvent) => {
        this.recorded.push({
          source: "unhandled",
          message: ev.message,
          detail: ev.error,
        });
      };
      this.onRejection = (ev: PromiseRejectionEvent) => {
        this.recorded.push({
          source: "unhandled",
          message: String(ev.reason),
          detail: ev.reason,
        });
      };
      window.addEventListener("error", this.onWindowError);
      window.addEventListener("unhandledrejection", this.onRejection);
    }
  }

  /**
   * jsdom returns `null` from `canvas.getContext("2d")`, but the flight renderers
   * (StarRenderer limb mask, soft-glow textures, backdrop gradients…) build
   * offscreen 2D canvases. Patch the prototype to hand back a no-op 2D context so
   * those real scenes construct headlessly. WebGL is not needed — PixiJS itself
   * is stubbed.
   */
  private installCanvas2DStub(): void {
    if (typeof HTMLCanvasElement === "undefined") return;
    const proto = HTMLCanvasElement.prototype;
    const original = proto.getContext;
    this.restoreCanvas = () => {
      proto.getContext = original;
    };
    proto.getContext = function (
      this: HTMLCanvasElement,
      kind: string,
    ): unknown {
      return kind === "2d" ? makeContext2D(this) : null;
    } as typeof proto.getContext;
  }
}

/** A no-op canvas gradient (only `addColorStop` is ever called on it). */
function makeGradient(): { addColorStop(): void } {
  return { addColorStop(): void {} };
}

/** A minimal, no-op 2D rendering context covering every method the renderers hit. */
function makeContext2D(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = {
    canvas,
    fillStyle: "#000000" as string | object,
    strokeStyle: "#000000" as string | object,
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    miterLimit: 10,
    font: "10px sans-serif",
    textAlign: "start",
    textBaseline: "alphabetic",
    shadowBlur: 0,
    shadowColor: "transparent",
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    filter: "none",
    imageSmoothingEnabled: true,
    createRadialGradient: () => makeGradient(),
    createLinearGradient: () => makeGradient(),
    createConicGradient: () => makeGradient(),
    createPattern: () => ({}),
    createImageData: (w: number, h: number) => ({
      data: new Uint8ClampedArray(Math.max(1, w) * Math.max(1, h) * 4),
      width: w,
      height: h,
    }),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({
      data: new Uint8ClampedArray(Math.max(1, w) * Math.max(1, h) * 4),
      width: w,
      height: h,
    }),
    putImageData: (): void => {},
    fillRect: (): void => {},
    clearRect: (): void => {},
    strokeRect: (): void => {},
    beginPath: (): void => {},
    closePath: (): void => {},
    moveTo: (): void => {},
    lineTo: (): void => {},
    arc: (): void => {},
    arcTo: (): void => {},
    ellipse: (): void => {},
    rect: (): void => {},
    roundRect: (): void => {},
    bezierCurveTo: (): void => {},
    quadraticCurveTo: (): void => {},
    fill: (): void => {},
    stroke: (): void => {},
    clip: (): void => {},
    save: (): void => {},
    restore: (): void => {},
    translate: (): void => {},
    scale: (): void => {},
    rotate: (): void => {},
    transform: (): void => {},
    setTransform: (): void => {},
    resetTransform: (): void => {},
    drawImage: (): void => {},
    fillText: (): void => {},
    strokeText: (): void => {},
    measureText: () => ({ width: 0 }),
    setLineDash: (): void => {},
    getLineDash: () => [] as number[],
    isPointInPath: () => false,
  };
  return ctx as unknown as CanvasRenderingContext2D;
}
