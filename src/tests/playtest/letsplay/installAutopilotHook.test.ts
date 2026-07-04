import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SceneType, QuestType } from "@/types";
import type { GameEngine } from "@/systems/GameEngine";
import {
  installAutopilotHook,
  createLiveSceneController,
  AUTOPILOT_HOTKEY_CODE,
  type AutopilotWindowHook,
} from "@/tests/playtest/letsplay/installAutopilotHook";
import type { AutopilotScheduler } from "@/tests/playtest/letsplay/AutopilotController";

/**
 * Task 3: the live install hook. Two concerns:
 *  - {@link installAutopilotHook} publishes `window.__autopilot`, delegates
 *    start/stop/toggle to the controller, binds the toggle hotkey, and is
 *    idempotent.
 *  - {@link createLiveSceneController} maps each verb onto the real engine
 *    `transitionTo` / scene call (the live mirror of the headless applier).
 */

/** A scheduler that captures `onTick` but never fires it — no real timer in tests. */
const inertScheduler: AutopilotScheduler = {
  start: () => () => {},
};

/** Deps that keep the controller off real timers / window listeners / the DOM. */
const quietDeps = {
  scheduler: inertScheduler,
  onHumanInput: () => () => {},
  indicator: { show() {}, hide() {} },
};

function clearWindowHook(): void {
  delete (window as unknown as { __autopilot?: AutopilotWindowHook })
    .__autopilot;
}

describe("installAutopilotHook — window hook + hotkey", () => {
  let restoreAdd: () => void = () => {};
  const keydownHandlers: ((e: KeyboardEvent) => void)[] = [];

  beforeEach(() => {
    clearWindowHook();
    localStorage.clear();
    keydownHandlers.length = 0;
    // Capture listeners instead of really binding them, so installs don't leak
    // across tests and we can invoke the hotkey handler directly.
    const capture = (
      type: string,
      handler: EventListenerOrEventListenerObject,
    ): void => {
      if (type === "keydown" && typeof handler === "function") {
        keydownHandlers.push(handler as (e: KeyboardEvent) => void);
      }
    };
    const spy = vi
      .spyOn(window, "addEventListener")
      .mockImplementation(capture as unknown as typeof window.addEventListener);
    restoreAdd = () => spy.mockRestore();
  });

  afterEach(() => {
    restoreAdd();
    clearWindowHook();
    localStorage.clear();
  });

  it("publishes window.__autopilot with start/stop/toggle/engaged", () => {
    const hook = installAutopilotHook({} as GameEngine, quietDeps);

    const onWindow = (
      window as unknown as { __autopilot?: AutopilotWindowHook }
    ).__autopilot;
    expect(onWindow).toBe(hook);
    expect(typeof hook.start).toBe("function");
    expect(typeof hook.stop).toBe("function");
    expect(typeof hook.toggle).toBe("function");
    expect(hook.engaged).toBe(false);
  });

  it("start() engages and stop() disengages", () => {
    const hook = installAutopilotHook({} as GameEngine, quietDeps);

    expect(hook.engaged).toBe(false);
    hook.start();
    expect(hook.engaged).toBe(true);
    hook.stop();
    expect(hook.engaged).toBe(false);
  });

  it("toggle() flips engaged state", () => {
    const hook = installAutopilotHook({} as GameEngine, quietDeps);

    hook.toggle();
    expect(hook.engaged).toBe(true);
    hook.toggle();
    expect(hook.engaged).toBe(false);
  });

  it("the bound hotkey toggles only on AUTOPILOT_HOTKEY_CODE", () => {
    const hook = installAutopilotHook({} as GameEngine, quietDeps);
    // Exactly one keydown listener (the hotkey) is bound at install time.
    expect(keydownHandlers).toHaveLength(1);
    const onKey = keydownHandlers[0];

    onKey({ code: "KeyW" } as KeyboardEvent); // an unrelated key does nothing
    expect(hook.engaged).toBe(false);

    onKey({ code: AUTOPILOT_HOTKEY_CODE } as KeyboardEvent); // toggle on
    expect(hook.engaged).toBe(true);

    onKey({ code: AUTOPILOT_HOTKEY_CODE } as KeyboardEvent); // toggle off
    expect(hook.engaged).toBe(false);
  });

  it("is idempotent — a second install returns the same hook and binds no new listener", () => {
    const first = installAutopilotHook({} as GameEngine, quietDeps);
    expect(keydownHandlers).toHaveLength(1);

    const second = installAutopilotHook({} as GameEngine, quietDeps);
    expect(second).toBe(first);
    expect(keydownHandlers).toHaveLength(1); // no new hotkey listener
  });

  it("exposes flag() and exportFlags() on the window hook (Task 7)", () => {
    const hook = installAutopilotHook({} as GameEngine, quietDeps);
    expect(typeof hook.flag).toBe("function");
    expect(typeof hook.exportFlags).toBe("function");
    expect(() => hook.flag("note")).not.toThrow();
    expect(typeof hook.exportFlags()).toBe("string");
  });

  it("engaged + Shift+F flags without toggling the autopilot off", () => {
    const hook = installAutopilotHook({} as GameEngine, quietDeps);
    const flagSpy = vi.spyOn(hook.controller, "flag");
    hook.start();
    const onKey = keydownHandlers[0];

    onKey({ shiftKey: true, key: "F" } as KeyboardEvent);
    expect(flagSpy).toHaveBeenCalledTimes(1);
    expect(hook.engaged).toBe(true); // still engaged — Shift+F never reclaims

    onKey({ shiftKey: true, key: "f" } as KeyboardEvent); // case-insensitive
    expect(flagSpy).toHaveBeenCalledTimes(2);
    expect(hook.engaged).toBe(true);
  });

  it("Shift+F while disengaged neither flags nor toggles", () => {
    const hook = installAutopilotHook({} as GameEngine, quietDeps);
    const flagSpy = vi.spyOn(hook.controller, "flag");
    const onKey = keydownHandlers[0];

    onKey({ shiftKey: true, key: "F" } as KeyboardEvent);
    expect(flagSpy).not.toHaveBeenCalled();
    expect(hook.engaged).toBe(false);
  });
});

describe("createLiveSceneController — verb → live engine call", () => {
  function mockEngine(over: Partial<Record<string, unknown>> = {}) {
    const planet = { id: "p1", availableQuests: [] as { id: string }[] };
    const station = { id: "s1" };
    const system = {
      id: "sys1",
      planets: [planet],
      stations: [station],
      connections: [{ toSystemId: "sys2" }],
    };
    const engine = {
      player: { currentSystemId: "sys1", landedPlanetId: null },
      galaxy: { systems: [system] },
      currentScene: { performWarpJumpTo: vi.fn().mockResolvedValue(undefined) },
      questManager: {
        getActiveQuests: () => [] as { id: string }[],
        getCompletedQuestIds: () => [] as string[],
      },
      getQuestBoard: () => [] as { template: { id: string; type: string } }[],
      acceptBoardQuest: vi.fn(),
      transitionTo: vi.fn().mockResolvedValue(undefined),
      ...over,
    } as unknown as GameEngine & {
      transitionTo: ReturnType<typeof vi.fn>;
      currentScene: { performWarpJumpTo: ReturnType<typeof vi.fn> };
      getQuestBoard: (
        planetId: string,
      ) => { template: { id: string; type: string } }[];
      acceptBoardQuest: ReturnType<typeof vi.fn>;
      _planet: typeof planet;
    };
    (engine as unknown as { _planet: typeof planet })._planet = planet;
    return engine as unknown as GameEngine & {
      transitionTo: ReturnType<typeof vi.fn>;
      currentScene: { performWarpJumpTo: ReturnType<typeof vi.fn> };
      getQuestBoard: (
        planetId: string,
      ) => { template: { id: string; type: string } }[];
      acceptBoardQuest: ReturnType<typeof vi.fn>;
      _planet: typeof planet;
    };
  }

  it("land() transitions to PLANET with the resolved planet", async () => {
    const engine = mockEngine();
    await createLiveSceneController(engine).land();
    expect(engine.transitionTo).toHaveBeenCalledWith(
      SceneType.PLANET,
      expect.objectContaining({
        gameEngine: engine,
        planet: { id: "p1", availableQuests: [] },
      }),
    );
  });

  it("dock() transitions to STATION with the resolved station", async () => {
    const engine = mockEngine();
    await createLiveSceneController(engine).dock();
    expect(engine.transitionTo).toHaveBeenCalledWith(
      SceneType.STATION,
      expect.objectContaining({ station: { id: "s1" } }),
    );
  });

  it("openStarMap() transitions to STAR_MAP", async () => {
    const engine = mockEngine();
    await createLiveSceneController(engine).openStarMap();
    expect(engine.transitionTo).toHaveBeenCalledWith(
      SceneType.STAR_MAP,
      expect.objectContaining({ gameEngine: engine }),
    );
  });

  it("warp() jumps to the first connection via performWarpJumpTo", async () => {
    const engine = mockEngine();
    await createLiveSceneController(engine).warp();
    expect(engine.currentScene.performWarpJumpTo).toHaveBeenCalledWith("sys2");
    expect(engine.transitionTo).not.toHaveBeenCalled();
  });

  it("warp() biases toward a carried quest's target, except for a find-sell-destination reason", async () => {
    const engine = mockEngine({
      galaxy: {
        systems: [
          {
            id: "sys1",
            planets: [{ id: "p1", availableQuests: [] }],
            stations: [{ id: "s1" }],
            connections: [{ toSystemId: "sys2" }, { toSystemId: "sys3" }],
          },
        ],
      },
      questManager: {
        getActiveQuests: () => [
          { type: QuestType.DELIVERY, targetSystemId: "sys3" },
        ],
        getCompletedQuestIds: () => [] as string[],
      },
    });

    // find-sell-destination must stay blind to the carried quest's target —
    // falls back to the generic "explore the unknown" pick (first connection).
    await createLiveSceneController(engine).warp(
      undefined,
      "mem:find-sell-destination",
    );
    expect(engine.currentScene.performWarpJumpTo).toHaveBeenCalledWith("sys2");

    engine.currentScene.performWarpJumpTo.mockClear();

    // Any other warp reason still biases toward the quest target.
    await createLiveSceneController(engine).warp(undefined, "mem:explore");
    expect(engine.currentScene.performWarpJumpTo).toHaveBeenCalledWith("sys3");
  });

  it("openTrade() executes trade directly and transitions to SPACE_FLIGHT", async () => {
    // Mock engine must include player.inventory so executeTradeOnPlanet can
    // iterate cargo before transitioning (no TRADE scene — that caused the cycle).
    const engine = mockEngine({
      player: {
        currentSystemId: "sys1",
        landedPlanetId: null,
        inventory: { resources: [] },
      },
      playerLoadout: null,
    });
    await createLiveSceneController(engine).openTrade();
    expect(engine.transitionTo).toHaveBeenCalledWith(
      SceneType.SPACE_FLIGHT,
      expect.objectContaining({ gameEngine: engine }),
    );
  });

  it("leaveToFlight() transitions to SPACE_FLIGHT", async () => {
    const engine = mockEngine();
    await createLiveSceneController(engine).leaveToFlight();
    expect(engine.transitionTo).toHaveBeenCalledWith(
      SceneType.SPACE_FLIGHT,
      expect.objectContaining({ gameEngine: engine }),
    );
  });

  it("takeQuest() accepts every non-dialogue quest the real job board offers", () => {
    const board = [
      { template: { id: "q1", type: "DELIVERY" } },
      { template: { id: "q2", type: "TEXT_ADVENTURE" } },
    ];
    const engine = mockEngine({
      player: { currentSystemId: "sys1", landedPlanetId: "p1" },
      getQuestBoard: vi.fn().mockReturnValue(board),
    });

    createLiveSceneController(engine).takeQuest();
    expect(engine.getQuestBoard).toHaveBeenCalledWith("p1");
    expect(engine.acceptBoardQuest).toHaveBeenCalledWith(board[0], "p1");
    expect(engine.acceptBoardQuest).toHaveBeenCalledTimes(1);
  });

  it("no-op verbs (tick/executeTrade/attack/flee/repair) never drive a transition", async () => {
    const engine = mockEngine();
    const c = createLiveSceneController(engine);
    await c.tick();
    await c.executeTrade();
    await c.attack();
    await c.flee();
    await c.repair();
    expect(engine.transitionTo).not.toHaveBeenCalled();
  });

  it("attack() presses «Огонь!» (combatPause.confirm) when the active-pause overlay is up", async () => {
    const confirm = vi.fn();
    const e2eEngageCombat = vi.fn();
    const engine = mockEngine({
      currentScene: {
        performWarpJumpTo: vi.fn().mockResolvedValue(undefined),
        combatPause: { paused: true, confirm },
        npcManager: { e2eEngageCombat },
      },
    });
    await createLiveSceneController(engine).attack("npc1");
    // The Fire modal is driven (one aimed shot + resume), NOT re-engaged.
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(e2eEngageCombat).not.toHaveBeenCalled();
  });

  it("attack() engages combat when there is no active-pause overlay", async () => {
    const e2eEngageCombat = vi.fn();
    const engine = mockEngine({
      currentScene: {
        performWarpJumpTo: vi.fn().mockResolvedValue(undefined),
        combatPause: { paused: false, confirm: vi.fn() },
        npcManager: { e2eEngageCombat },
      },
    });
    await createLiveSceneController(engine).attack("npc1");
    expect(e2eEngageCombat).toHaveBeenCalledWith("npc1");
  });

  it("flee() resumes the active-pause overlay then breaks off pursuit", async () => {
    const resume = vi.fn();
    const breakOffCombatPursuit = vi.fn();
    const engine = mockEngine({
      currentScene: {
        performWarpJumpTo: vi.fn().mockResolvedValue(undefined),
        combatPause: { paused: true, resume },
        npcManager: { breakOffCombatPursuit },
      },
    });
    await createLiveSceneController(engine).flee();
    expect(resume).toHaveBeenCalledTimes(1);
    expect(breakOffCombatPursuit).toHaveBeenCalledTimes(1);
  });

  it("tick() calls closeModals() when npcManager.hasOpenModal() is true", () => {
    const closeModals = vi.fn();
    const engine = mockEngine({
      currentScene: {
        performWarpJumpTo: vi.fn().mockResolvedValue(undefined),
        npcManager: { hasOpenModal: () => true, closeModals },
      },
    });
    createLiveSceneController(engine).tick();
    expect(closeModals).toHaveBeenCalledTimes(1);
  });

  it("tick() does not call closeModals() when no modal is open", () => {
    const closeModals = vi.fn();
    const engine = mockEngine({
      currentScene: {
        performWarpJumpTo: vi.fn().mockResolvedValue(undefined),
        npcManager: { hasOpenModal: () => false, closeModals },
      },
    });
    createLiveSceneController(engine).tick();
    expect(closeModals).not.toHaveBeenCalled();
  });

  it("attack(targetId) delegates to npcManager.e2eEngageCombat(targetId)", () => {
    const e2eEngageCombat = vi.fn();
    const engine = mockEngine({
      currentScene: {
        performWarpJumpTo: vi.fn().mockResolvedValue(undefined),
        npcManager: { e2eEngageCombat },
      },
    });
    createLiveSceneController(engine).attack("npc-42");
    expect(e2eEngageCombat).toHaveBeenCalledWith("npc-42");
  });

  it("attack() without targetId passes undefined to e2eEngageCombat", () => {
    const e2eEngageCombat = vi.fn();
    const engine = mockEngine({
      currentScene: {
        performWarpJumpTo: vi.fn().mockResolvedValue(undefined),
        npcManager: { e2eEngageCombat },
      },
    });
    createLiveSceneController(engine).attack();
    expect(e2eEngageCombat).toHaveBeenCalledWith(undefined);
  });

  it("flee() calls npcManager.breakOffCombatPursuit()", () => {
    const breakOffCombatPursuit = vi.fn();
    const engine = mockEngine({
      currentScene: {
        performWarpJumpTo: vi.fn().mockResolvedValue(undefined),
        npcManager: { breakOffCombatPursuit },
      },
    });
    createLiveSceneController(engine).flee();
    expect(breakOffCombatPursuit).toHaveBeenCalledTimes(1);
  });
});
