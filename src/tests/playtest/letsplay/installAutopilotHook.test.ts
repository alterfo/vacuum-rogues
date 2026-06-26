import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SceneType } from "@/types";
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
        getQuestTemplate: () => ({}),
        acceptQuest: vi.fn(),
      },
      transitionTo: vi.fn().mockResolvedValue(undefined),
      ...over,
    } as unknown as GameEngine & {
      transitionTo: ReturnType<typeof vi.fn>;
      currentScene: { performWarpJumpTo: ReturnType<typeof vi.fn> };
      questManager: { acceptQuest: ReturnType<typeof vi.fn> };
      _planet: typeof planet;
    };
    (engine as unknown as { _planet: typeof planet })._planet = planet;
    return engine as unknown as GameEngine & {
      transitionTo: ReturnType<typeof vi.fn>;
      currentScene: { performWarpJumpTo: ReturnType<typeof vi.fn> };
      questManager: { acceptQuest: ReturnType<typeof vi.fn> };
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

  it("openTrade() transitions to TRADE with a planet", async () => {
    const engine = mockEngine();
    await createLiveSceneController(engine).openTrade();
    expect(engine.transitionTo).toHaveBeenCalledWith(
      SceneType.TRADE,
      expect.objectContaining({ planet: { id: "p1", availableQuests: [] } }),
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

  it("takeQuest() accepts a registered, offered, not-active board quest", () => {
    const engine = mockEngine({
      player: { currentSystemId: "sys1", landedPlanetId: "p1" },
    });
    engine._planet.availableQuests.push({ id: "q1" });

    createLiveSceneController(engine).takeQuest();
    expect(engine.questManager.acceptQuest).toHaveBeenCalledWith("q1", "p1");
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
});
