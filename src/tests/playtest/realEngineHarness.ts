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

export interface RecordedError {
  source: "logger" | "unhandled";
  message: string;
  detail?: unknown;
}

export interface RecordedPlayerDeathCause {
  killerNpcId: string;
  killerRole: string;
  engagementStartHullFraction: number | null;
  simultaneousCombatants: number;
  roundsSurvived: number;
}

export interface HarnessOptions {
  seed?: string;
  systemCount?: number;
  saveService?: MockSaveService;
}

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

  private _lastDeathCause: RecordedPlayerDeathCause | null = null;

  private constructor(opts: HarnessOptions) {
    this.seed = opts.seed ?? "PLAYTEST_SEED";
    this.systemCount = opts.systemCount ?? 12;

    this.galaxyService = new GalaxyService();
    this.saveService = opts.saveService ?? new MockSaveService();

    const diDeps: GameEngineDIDependencies = {
      saveService: this.saveService,
      exceptionHandler: new MockExceptionHandler(),
      galaxyService: this.galaxyService,
      playerService: new PlayerService(),
      questService: new QuestManagerAdapter(),
      qualityProfile: new AdaptiveQualityProfile(),
    };
    this.engine = new GameEngine(diDeps);
  }

  static async boot(opts: HarnessOptions = {}): Promise<RealEngineHarness> {
    const harness = new RealEngineHarness(opts);
    harness.installErrorSink();
    harness.installCanvas2DStub();

    try {
      const container = document.createElement("div");
      container.id = "game-container";
      document.body.appendChild(container);
      harness.container = container;
      const renderer = new Renderer(container);
      await renderer.initialize();
      harness.engine.renderer = renderer;

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

  async goTo(sceneType: SceneType, context: object = {}): Promise<void> {
    await this.engine.transitionTo(sceneType, {
      gameEngine: this.engine,
      ...context,
    });
  }

  tick(deltaMs = 16): void {
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

  errors(): RecordedError[] {
    return [...this.recorded];
  }

  clearErrors(): void {
    this.recorded.length = 0;
  }

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

  private installErrorSink(): void {
    const original = logger.error;
    this.restoreLogger = () => {
      logger.error = original;
    };
    logger.error = (message: string, ...args: unknown[]): void => {
      this.recorded.push({ source: "logger", message, detail: args });
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

function makeGradient(): { addColorStop(): void } {
  return { addColorStop(): void {} };
}

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
