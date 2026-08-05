import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SceneType, QuestType } from "@/types";

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

import { TextQuestScene } from "@/presentation/TextQuestScene";
import { PlanetScene } from "@/presentation/PlanetScene";
import { customsScript } from "@/systems/quests/scripts/customs";
import type { QuestVM } from "@/systems/quests/QuestVM";

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

function driveToWinTerminal(scene: TextQuestScene): void {
  const vm = (scene as any).vm as QuestVM;
  vm.setParam("money", 6000);
  vm.setParam("shipNum", 20);
  (vm as any).currentLocationId = "check_final";
  (scene as any).renderVmLocation();
}

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
  fields.suppressTextQuestResume = opts.suppressResume ?? false;
  return { scene, startTextQuest };
}

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
      ([s]) => s === SceneType.TEXT_QUEST,
    );
    expect(reLaunched).toBe(false);
    scene.destroy(); // release the global keydown listener (no cross-test leak)
  });
});

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

  it("«Сдаться» returns to the prior scene and flags no auto-resume", () => {
    const { scene, transitionTo } = initScene();
    (scene as any).doReturn();
    expect(transitionTo).toHaveBeenCalledTimes(1);
    const [sceneArg, ctx] = transitionTo.mock.calls[0];
    expect(sceneArg).toBe(SceneType.PLANET);
    expect((ctx as { resumeTextQuest?: boolean }).resumeTextQuest).toBe(false);
    scene.destroy(); // release the global keydown listener (no cross-test leak)
  });

  it("Escape returns to the prior scene and flags no auto-resume", () => {
    const { scene, transitionTo } = initScene();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(transitionTo).toHaveBeenCalledTimes(1);
    const [sceneArg, ctx] = transitionTo.mock.calls[0];
    expect(sceneArg).toBe(SceneType.PLANET);
    expect((ctx as { resumeTextQuest?: boolean }).resumeTextQuest).toBe(false);
    scene.destroy();
  });
});

describe("Customs quest — failure terminal exits without re-launching", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  function driveToFailureTerminal(scene: TextQuestScene): void {
    const vm = (scene as any).vm as QuestVM;
    (vm as any).currentLocationId = "quest_failure_credits";
    (scene as any).renderVmLocation();
  }

  it("a failure terminal shows retry (no auto-return) and then exits with no-resume", () => {
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

    driveToFailureTerminal(scene);
    const vm = (scene as any).vm as QuestVM;
    expect(vm.isFinished()).toBe(true);
    expect(vm.isSuccess()).toBe(false);
    vi.advanceTimersByTime(3000);
    expect(transitionTo).not.toHaveBeenCalled();

    (scene as any).doReturn();
    expect(transitionTo).toHaveBeenCalledTimes(1);
    const [sceneArg, ctx] = transitionTo.mock.calls[0];
    expect(sceneArg).toBe(SceneType.PLANET);
    expect((ctx as { resumeTextQuest?: boolean }).resumeTextQuest).toBe(false);
    scene.destroy(); // release the global keydown listener (no cross-test leak)
  });
});

describe("PlanetScene.checkAndResumeTextQuest — no relaunch loop", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("does NOT auto-relaunch when entered as the return from an exited quest", () => {
    const { scene, startTextQuest } = makePlanetScene({
      planetId: "planet_x",
      activeQuests: [activeCustomsQuest("planet_x")],
      suppressResume: true, // doReturn flagged resumeTextQuest:false
    });
    (scene as any).checkAndResumeTextQuest();
    vi.advanceTimersByTime(200);
    expect(startTextQuest).not.toHaveBeenCalled();
  });

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
