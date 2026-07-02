/**
 * `IOverlayPresenter` port (plan 20260701, Phase 2 Task 8) — the modal/loading
 * /outcome overlays GameEngine used to build directly with `pixi.js` now route
 * through this port so `systems/` stays free of a `pixi.js` import.
 *
 * Two angles:
 *   1. GameEngine routes its public overlay entry points (`handleError`,
 *      `showGameOutcomeScreen`, `showLoadingOverlay`/`hideLoadingOverlay`) to an
 *      injected fake presenter with the right arguments — headless, no renderer.
 *   2. The real `OverlayPresenter` builds the expected PixiJS objects against a
 *      fake renderer and no-ops cleanly when the renderer isn't attached yet.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Broad PixiJS mock — GameEngine still transitively pulls in SceneFactory/scenes.
vi.mock("pixi.js", () => ({
  Filter: class {},
  Application: vi.fn().mockImplementation(() => ({
    init: vi.fn().mockResolvedValue(undefined),
    canvas: document.createElement("canvas"),
    renderer: { type: "webgl", resize: vi.fn() },
    stage: { addChild: vi.fn(), eventMode: "auto" },
    ticker: { start: vi.fn(), stop: vi.fn() },
  })),
  Container: vi.fn().mockImplementation(() => ({
    addChild: vi.fn(),
    addChildAt: vi.fn(),
    removeChild: vi.fn(),
    children: [],
    filters: [],
  })),
  Graphics: vi.fn().mockImplementation(() => ({
    fill: vi.fn().mockReturnThis(),
    rect: vi.fn().mockReturnThis(),
    circle: vi.fn().mockReturnThis(),
    stroke: vi.fn().mockReturnThis(),
    poly: vi.fn().mockReturnThis(),
    moveTo: vi.fn().mockReturnThis(),
    lineTo: vi.fn().mockReturnThis(),
    addChild: vi.fn(),
    addChildAt: vi.fn(),
    removeChild: vi.fn(),
    children: [],
    eventMode: "static",
    cursor: "pointer",
    on: vi.fn(),
    parent: null,
    destroy: vi.fn(),
  })),
  Text: vi.fn().mockImplementation(() => ({
    anchor: { set: vi.fn() },
    x: 0,
    y: 0,
    width: 100,
    height: 30,
    text: "",
    style: {},
    eventMode: "none",
    cursor: "auto",
    alpha: 1,
    on: vi.fn(),
    destroy: vi.fn(),
    parent: null,
  })),
  BlurFilter: vi.fn().mockImplementation(() => ({})),
}));

import {
  GameEngine,
  type GameEngineDIDependencies,
} from "@/systems/GameEngine";
import { OverlayPresenter } from "@/presentation/OverlayPresenter";
import type { IOverlayPresenter } from "@/core/ports";
import type { Renderer } from "@/presentation/Renderer";
import { GameValidationException } from "@/exceptions/GameValidationException";
import {
  MockSaveService,
  MockGalaxyService,
  MockPlayerService,
  MockExceptionHandler,
  MockQuestService,
} from "@/tests/mocks";
import { AdaptiveQualityProfile } from "@/ai/AdaptiveQualityProfile";

class FakeOverlayPresenter implements IOverlayPresenter {
  showErrorCalls: { message: string; hasOnDismiss: boolean }[] = [];
  showLoadingCalls: string[] = [];
  hideLoadingCalls = 0;
  showGameOutcomeCalls: {
    win: boolean;
    hasOnRestart: boolean;
    hasOnNewGamePlus: boolean;
  }[] = [];

  showError(message: string, onDismiss?: () => void): void {
    this.showErrorCalls.push({ message, hasOnDismiss: !!onDismiss });
  }
  showLoading(text: string): void {
    this.showLoadingCalls.push(text);
  }
  hideLoading(): void {
    this.hideLoadingCalls++;
  }
  showGameOutcome(
    win: boolean,
    handlers: { onRestart: () => void; onNewGamePlus?: () => void },
  ): void {
    this.showGameOutcomeCalls.push({
      win,
      hasOnRestart: !!handlers.onRestart,
      hasOnNewGamePlus: !!handlers.onNewGamePlus,
    });
  }
}

function makeDiDeps(
  overlayPresenter?: IOverlayPresenter,
): GameEngineDIDependencies {
  return {
    saveService: new MockSaveService(),
    galaxyService: new MockGalaxyService(),
    playerService: new MockPlayerService(),
    exceptionHandler: new MockExceptionHandler(),
    qualityProfile: new AdaptiveQualityProfile(),
    questService: new MockQuestService(),
    overlayPresenter,
  };
}

describe("GameEngine routes overlay calls through IOverlayPresenter", () => {
  let overlay: FakeOverlayPresenter;
  let engine: GameEngine;

  beforeEach(() => {
    overlay = new FakeOverlayPresenter();
    engine = new GameEngine(makeDiDeps(overlay));
  });

  it("handleError shows a New-Game-button error modal for a save-validation failure", () => {
    const err = new GameValidationException(
      "SAVE_VALIDATION_FAILED",
      "corrupt data",
    );
    engine.handleError(err);

    expect(overlay.showErrorCalls).toHaveLength(1);
    expect(overlay.showErrorCalls[0].hasOnDismiss).toBe(true);
    expect(overlay.showErrorCalls[0].message).toContain("Ошибка сохранения");
  });

  it("handleError shows a plain error modal (no button) for a generic recoverable error", () => {
    engine.handleError(new Error("boom"));

    expect(overlay.showErrorCalls).toHaveLength(1);
    expect(overlay.showErrorCalls[0].hasOnDismiss).toBe(false);
  });

  it("showGameOutcomeScreen forwards win with a New Game+ handler", () => {
    engine.showGameOutcomeScreen(true);

    expect(overlay.showGameOutcomeCalls).toEqual([
      { win: true, hasOnRestart: true, hasOnNewGamePlus: true },
    ]);
  });

  it("showGameOutcomeScreen forwards a loss with no New Game+ handler", () => {
    engine.showGameOutcomeScreen(false);

    expect(overlay.showGameOutcomeCalls).toEqual([
      { win: false, hasOnRestart: true, hasOnNewGamePlus: false },
    ]);
  });

  it("showGameOutcomeScreen is idempotent — a second call is dropped before reaching the presenter", () => {
    engine.showGameOutcomeScreen(true);
    engine.showGameOutcomeScreen(true);

    expect(overlay.showGameOutcomeCalls).toHaveLength(1);
  });

  it("showLoadingOverlay/hideLoadingOverlay forward to showLoading/hideLoading", () => {
    engine.showLoadingOverlay("Загрузка...");
    engine.hideLoadingOverlay();

    expect(overlay.showLoadingCalls).toEqual(["Загрузка..."]);
    expect(overlay.hideLoadingCalls).toBe(1);
  });

  it("falls back to a silent no-op presenter when none is injected", () => {
    const headless = new GameEngine(makeDiDeps(undefined));
    expect(() => headless.handleError(new Error("boom"))).not.toThrow();
    expect(() => headless.showGameOutcomeScreen(true)).not.toThrow();
  });
});

describe("OverlayPresenter (real, renderer-backed)", () => {
  function makeRenderer(): Renderer {
    const uiLayer = {
      addChild: vi.fn((child: { parent?: unknown }) => {
        child.parent = uiLayer;
      }),
      removeChild: vi.fn(),
      children: [],
    };
    return {
      app: { screen: { width: 800, height: 600 } },
      uiLayer,
    } as unknown as Renderer;
  }

  it("no-ops every method when the renderer isn't attached yet", () => {
    const presenter = new OverlayPresenter(() => null);
    expect(() => {
      presenter.showError("x");
      presenter.clearModal();
      presenter.showLoading("x");
      presenter.hideLoading();
      presenter.showGameOutcome(true, { onRestart: () => {} });
    }).not.toThrow();
  });

  it("showError adds an overlay + message to the renderer's uiLayer", () => {
    const renderer = makeRenderer();
    const presenter = new OverlayPresenter(() => renderer);

    presenter.showError("something broke");

    expect(renderer.uiLayer.addChild).toHaveBeenCalledTimes(2); // overlay + message
  });

  it("showError with onDismiss adds a third clickable button that fires the callback", () => {
    const renderer = makeRenderer();
    const presenter = new OverlayPresenter(() => renderer);
    const onDismiss = vi.fn();

    presenter.showError("save broke", onDismiss);

    expect(renderer.uiLayer.addChild).toHaveBeenCalledTimes(3); // overlay + message + button
    const btnCall = (renderer.uiLayer.addChild as ReturnType<typeof vi.fn>).mock
      .calls[2][0] as { on: ReturnType<typeof vi.fn> };
    const pointerdown = btnCall.on.mock.calls.find(
      (c: unknown[]) => c[0] === "pointerdown",
    )?.[1] as () => void;
    pointerdown();

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("showGameOutcome on a win renders a New Game+ button that clears the modal then fires the callback", () => {
    const renderer = makeRenderer();
    const presenter = new OverlayPresenter(() => renderer);
    const onNewGamePlus = vi.fn();
    const onRestart = vi.fn();

    presenter.showGameOutcome(true, { onRestart, onNewGamePlus });

    // overlay + title + msg + NG+ button + restart button = 5 uiLayer children
    expect(renderer.uiLayer.addChild).toHaveBeenCalledTimes(5);
    const ngPlusCall = (renderer.uiLayer.addChild as ReturnType<typeof vi.fn>)
      .mock.calls[3][0] as { on: ReturnType<typeof vi.fn> };
    const pointerdown = ngPlusCall.on.mock.calls.find(
      (c: unknown[]) => c[0] === "pointerdown",
    )?.[1] as () => void;
    pointerdown();

    expect(onNewGamePlus).toHaveBeenCalledTimes(1);
    expect(onRestart).not.toHaveBeenCalled();
  });

  it("showGameOutcome on a loss renders only the restart button", () => {
    const renderer = makeRenderer();
    const presenter = new OverlayPresenter(() => renderer);

    presenter.showGameOutcome(false, { onRestart: () => {} });

    // overlay + title + msg + restart button = 4 uiLayer children
    expect(renderer.uiLayer.addChild).toHaveBeenCalledTimes(4);
  });

  it("clearModal empties the tracked modal objects", () => {
    const renderer = makeRenderer();
    const presenter = new OverlayPresenter(() => renderer);
    presenter.showError("x");

    presenter.clearModal();

    expect(renderer.uiLayer.removeChild).toHaveBeenCalled();
  });

  it("a second showError clears every object of the previous modal before drawing a new one", () => {
    const renderer = makeRenderer();
    const presenter = new OverlayPresenter(() => renderer);
    presenter.showError("first");

    presenter.showError("second");

    // first showError tracked 2 objects (overlay + message); the internal
    // clearModal() the second call runs must remove exactly those before
    // drawing the new modal.
    expect(renderer.uiLayer.removeChild).toHaveBeenCalledTimes(2);
  });

  it("showLoading replaces a prior loading overlay via hideLoading first", () => {
    const renderer = makeRenderer();
    const presenter = new OverlayPresenter(() => renderer);

    presenter.showLoading("first");
    presenter.showLoading("second");

    // 2 children per call (overlay + label) x2 calls = 4
    expect(renderer.uiLayer.addChild).toHaveBeenCalledTimes(4);
  });
});
