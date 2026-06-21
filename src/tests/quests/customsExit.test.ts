/**
 * Regression: the customs ("Таможня") text quest restarts after a win, can't be
 * exited, and «Сдаться» does nothing.
 *
 * Root cause (all three symptoms, one root): the quest is launched with
 * `returnScene = PLANET`; surrender / Esc / exit and the post-win return all
 * route through `TextQuestScene.doReturn()`, which transitions back to PLANET.
 * `PlanetScene.initialize()` then calls `checkAndResumeTextQuest()`, which
 * auto-relaunches any still-active TEXT_ADVENTURE quest on that planet — so the
 * immediate return bounces the player straight back into the same quest. An
 * inescapable loop that reads as "restart / can't exit / surrender does nothing".
 *
 * Fix contract (Task 2): `doReturn()` tags the return context with
 * `resumeTextQuest: false`; `PlanetScene` honours it and skips the auto-resume
 * on that one immediate return. A genuine fresh landing (no flag) still resumes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SceneType, QuestType } from "@/types";

// ── PixiJS mock (must come before imports that load pixi.js) ─────────────────
// Rich Container/Graphics/Text for the TextQuestScene VM layout; bare Rectangle/
// Sprite so PlanetScene can be imported (we only ever Object.create it).

vi.mock("pixi.js", () => ({
  Container: vi.fn().mockImplementation(() => ({
    addChild: vi.fn(),
    removeChild: vi.fn(),
    children: [],
    x: 0,
    y: 0,
    destroyed: false,
    destroy: vi.fn(),
    on: vi.fn(),
    eventMode: "auto",
    cursor: "auto",
    alpha: 1,
    hitArea: null,
  })),
  Graphics: vi.fn().mockImplementation(() => ({
    rect: vi.fn().mockReturnThis(),
    roundRect: vi.fn().mockReturnThis(),
    fill: vi.fn().mockReturnThis(),
    stroke: vi.fn().mockReturnThis(),
    clear: vi.fn().mockReturnThis(),
    addChild: vi.fn(),
    children: [],
    x: 0,
    y: 0,
    eventMode: "auto",
    on: vi.fn(),
    destroyed: false,
    destroy: vi.fn(),
  })),
  Text: vi.fn().mockImplementation((opts?: { text?: string }) => ({
    anchor: { set: vi.fn() },
    x: 0,
    y: 0,
    width: 80,
    height: 20,
    text: opts?.text ?? "",
    eventMode: "none",
    cursor: "auto",
    alpha: 1,
    label: "",
    destroyed: false,
    on: vi.fn(),
    destroy: vi.fn(),
    parent: null,
  })),
  Sprite: vi.fn(),
  Rectangle: vi.fn(),
}));

vi.mock("onnxruntime-web", () => ({
  Tensor: vi.fn(),
  InferenceSession: { create: vi.fn() },
}));

import { TextQuestScene } from "@/presentation/TextQuestScene";
import { PlanetScene } from "@/presentation/PlanetScene";
import { customsScript } from "@/systems/quests/scripts/customs";
import type { QuestVM } from "@/systems/quests/QuestVM";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRenderer() {
  return {
    app: { screen: { width: 800, height: 600 } },
    gameLayer: { addChild: vi.fn(), removeChild: vi.fn(), children: [] },
    uiLayer: { addChild: vi.fn(), removeChild: vi.fn(), children: [] },
    clearGameLayer: vi.fn(),
    clearUILayer: vi.fn(),
  } as any;
}

function makeEngine() {
  const forceCompleteQuest = vi.fn().mockReturnValue(true);
  const transitionTo = vi.fn().mockResolvedValue(undefined);
  const engine = {
    player: { credits: 1000 },
    questManager: { forceCompleteQuest },
    transitionTo,
  } as any;
  return { engine, forceCompleteQuest, transitionTo };
}

/** Position the scene's live VM at `check_final` with a winning credit balance,
 *  exactly as the script reaches it after 20 inspected ships. */
function driveToWinTerminal(scene: TextQuestScene): void {
  const vm = (scene as any).vm as QuestVM;
  vm.setParam("money", 6000);
  vm.setParam("shipNum", 20);
  // jump to the end-of-shift auto-check (the script gets here via critMax on shipNum)
  (vm as any).currentLocationId = "check_final";
  (scene as any).renderVmLocation();
}

/** An active, in-progress customs TEXT_ADVENTURE quest issued on `planetId`. */
function activeCustomsQuest(planetId: string) {
  return {
    id: "q_customs",
    type: QuestType.TEXT_ADVENTURE,
    planetId,
    targetObjectId: "customs",
    isCompleted: false,
    isFailed: false,
  };
}

/** A PlanetScene with only the fields `checkAndResumeTextQuest` reads. */
function makePlanetScene(opts: {
  planetId: string;
  activeQuests: unknown[];
  suppressResume?: boolean;
}) {
  const scene = Object.create(PlanetScene.prototype) as PlanetScene;
  const startTextQuest = vi.fn().mockResolvedValue(undefined);
  const fields = scene as unknown as Record<string, unknown>;
  fields.gameEngine = {
    questManager: { getActiveQuests: () => opts.activeQuests },
    startTextQuest,
  };
  fields.planet = { id: opts.planetId };
  // The Task-2 fix stores this from the init context (resumeTextQuest === false).
  fields.suppressTextQuestResume = opts.suppressResume ?? false;
  return { scene, startTextQuest };
}

// ── Win path: terminal finishes once, completes, returns (no re-launch) ────────

describe("Customs quest — win exits once and does not restart", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("winning marks the quest complete and returns to the prior scene once", () => {
    const renderer = makeRenderer();
    const { engine, forceCompleteQuest, transitionTo } = makeEngine();
    const scene = new TextQuestScene(renderer);

    scene.initialize({
      gameEngine: engine,
      questScript: customsScript,
      seed: 1,
      questId: "q_customs",
      returnScene: SceneType.PLANET,
      returnContext: { gameEngine: engine, planet: { id: "planet_x" } },
    });

    driveToWinTerminal(scene);
    vi.advanceTimersByTime(800); // check_final auto-executes `win` → quest_success

    const vm = (scene as any).vm as QuestVM;
    expect(vm.isFinished()).toBe(true);
    expect(vm.isSuccess()).toBe(true);
    expect(forceCompleteQuest).toHaveBeenCalledTimes(1);
    expect(forceCompleteQuest).toHaveBeenCalledWith("q_customs", engine.player);

    vi.advanceTimersByTime(2000); // success terminal returns after the toast delay
    expect(transitionTo).toHaveBeenCalledTimes(1);
    expect(transitionTo.mock.calls[0][0]).toBe(SceneType.PLANET);
    const reLaunched = transitionTo.mock.calls.some(
      ([s]: [SceneType]) => s === SceneType.TEXT_QUEST,
    );
    expect(reLaunched).toBe(false);
  });
});

// ── doReturn must tell the destination NOT to auto-resume the quest ────────────
// (RED until Task 2): without this signal, returning to PLANET re-launches the
// still-active quest in an inescapable loop.

describe("Customs quest — surrender / exit / Esc return without re-launching", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  function initScene() {
    const renderer = makeRenderer();
    const { engine, transitionTo } = makeEngine();
    const scene = new TextQuestScene(renderer);
    scene.initialize({
      gameEngine: engine,
      questScript: customsScript,
      seed: 1,
      questId: "q_customs",
      returnScene: SceneType.PLANET,
      returnContext: { gameEngine: engine, planet: { id: "planet_x" } },
    });
    return { scene, transitionTo };
  }

  // `it.fails`: reproduction asserts the post-fix contract and currently fails
  // (no `resumeTextQuest` flag yet). Task 2 converts these to a plain `it`.
  it.fails(
    "«Сдаться» returns to the prior scene and flags no auto-resume",
    () => {
      const { scene, transitionTo } = initScene();
      (scene as any).doReturn();
      expect(transitionTo).toHaveBeenCalledTimes(1);
      const [sceneArg, ctx] = transitionTo.mock.calls[0];
      expect(sceneArg).toBe(SceneType.PLANET);
      expect((ctx as { resumeTextQuest?: boolean }).resumeTextQuest).toBe(
        false,
      );
    },
  );

  it.fails("Escape returns to the prior scene and flags no auto-resume", () => {
    const { scene, transitionTo } = initScene();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(transitionTo).toHaveBeenCalledTimes(1);
    const [sceneArg, ctx] = transitionTo.mock.calls[0];
    expect(sceneArg).toBe(SceneType.PLANET);
    expect((ctx as { resumeTextQuest?: boolean }).resumeTextQuest).toBe(false);
    scene.destroy();
  });
});

// ── The loop itself: the immediate return must NOT auto-relaunch the quest ─────

describe("PlanetScene.checkAndResumeTextQuest — no relaunch loop", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  // `it.fails`: the loop reproduction — currently relaunches the still-active
  // quest. Task 2 honours the suppression flag and converts this to a plain `it`.
  it.fails(
    "does NOT auto-relaunch when entered as the return from an exited quest",
    () => {
      const { scene, startTextQuest } = makePlanetScene({
        planetId: "planet_x",
        activeQuests: [activeCustomsQuest("planet_x")],
        suppressResume: true, // doReturn flagged resumeTextQuest:false
      });
      (scene as any).checkAndResumeTextQuest();
      vi.advanceTimersByTime(200);
      expect(startTextQuest).not.toHaveBeenCalled();
    },
  );

  it("still resumes a pending quest on a genuine fresh landing (no suppression)", () => {
    const { scene, startTextQuest } = makePlanetScene({
      planetId: "planet_x",
      activeQuests: [activeCustomsQuest("planet_x")],
      suppressResume: false,
    });
    (scene as any).checkAndResumeTextQuest();
    vi.advanceTimersByTime(200);
    expect(startTextQuest).toHaveBeenCalledTimes(1);
    expect(startTextQuest.mock.calls[0][0]).toBe("customs");
  });
});
