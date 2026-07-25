import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SceneType, QuestType } from "@/types";
import type { GameEngine } from "@/systems/GameEngine";

// Mocked so tests can drive the F3 "a help panel is open" branch without
// constructing a real PixiJS HelpPanel (this file never mocks pixi.js —
// the `createLiveSceneController` tests below use hand-built engine fakes).
vi.mock("@/presentation/ui/mountSceneHelp", () => ({
  isHelpPanelOpen: vi.fn(() => false),
  dismissHelpPanel: vi.fn(),
}));
import {
  isHelpPanelOpen,
  dismissHelpPanel,
} from "@/presentation/ui/mountSceneHelp";
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

describe("installAutopilotHook — auto game-speed on engage/disengage", () => {
  beforeEach(() => {
    clearWindowHook();
  });
  afterEach(() => {
    clearWindowHook();
  });

  /** A minimal engine exposing the HUD speed seam through `currentScene`. */
  function fakeEngineWithHud(initialSpeed: number) {
    const setGameSpeed = vi.fn();
    const engine = {
      gameSpeedMultiplier: initialSpeed,
      currentScene: { hud: { setGameSpeed } },
    } as unknown as GameEngine;
    return { engine, setGameSpeed };
  }

  it("start() jumps to the fastest selectable speed tier (2026-07-18 request)", () => {
    const { engine, setGameSpeed } = fakeEngineWithHud(1);
    const hook = installAutopilotHook(engine, quietDeps);

    hook.start();

    expect(setGameSpeed).toHaveBeenCalledWith(10);
  });

  it("stop() restores whatever speed was set before engaging", () => {
    const { engine, setGameSpeed } = fakeEngineWithHud(2);
    const hook = installAutopilotHook(engine, quietDeps);

    hook.start();
    hook.stop();

    expect(setGameSpeed).toHaveBeenLastCalledWith(2);
  });

  it("toggle() applies the same auto-speed engage/restore as start()/stop()", () => {
    const { engine, setGameSpeed } = fakeEngineWithHud(4);
    const hook = installAutopilotHook(engine, quietDeps);

    hook.toggle(); // engage
    expect(setGameSpeed).toHaveBeenLastCalledWith(10);
    hook.toggle(); // disengage
    expect(setGameSpeed).toHaveBeenLastCalledWith(4);
  });

  it("never touches speed when the engine has no HUD to reach (headless-safe)", () => {
    const hook = installAutopilotHook({} as GameEngine, quietDeps);

    expect(() => {
      hook.start();
      hook.stop();
    }).not.toThrow();
  });
});

describe("installAutopilotHook — AgentMemory reset on galaxy-identity change (F6)", () => {
  beforeEach(() => {
    clearWindowHook();
  });
  afterEach(() => {
    clearWindowHook();
  });

  /** A minimal no-player engine — `observe()` early-returns for it (cheap, no scene rendering). */
  function fakeEngine(galaxyId: string): GameEngine {
    return {
      currentSceneType: SceneType.SPACE_FLIGHT,
      player: null,
      galaxy: { id: galaxyId },
      questManager: { getCompletedQuestIds: () => [] as string[] },
    } as unknown as GameEngine;
  }

  it("resets AgentMemory when the engine's galaxy id changes across ticks (new game while still engaged)", async () => {
    const engine = fakeEngine("galaxy-A");
    const hook = installAutopilotHook(engine, quietDeps);
    hook.start();

    await hook.controller.tickOnce();
    await hook.controller.tickOnce();
    await hook.controller.tickOnce();
    expect(hook.controller.currentMemory().step).toBe(3);

    // Simulate «Новая игра» while the autopilot stayed engaged (never disengaged,
    // so `start()`'s own reset never re-fires) — a fresh galaxy, same engine instance.
    (engine as unknown as { galaxy: { id: string } }).galaxy.id = "galaxy-B";
    await hook.controller.tickOnce();

    // Reset-then-incremented-once, not carried over from the previous galaxy.
    expect(hook.controller.currentMemory().step).toBe(1);
  });

  it("does NOT reset when the galaxy id stays the same across ticks", async () => {
    const engine = fakeEngine("galaxy-A");
    const hook = installAutopilotHook(engine, quietDeps);
    hook.start();

    await hook.controller.tickOnce();
    await hook.controller.tickOnce();

    expect(hook.controller.currentMemory().step).toBe(2);
  });
});

describe("createLiveSceneController — verb → live engine call", () => {
  // The F3 help-panel tests below mutate the module-level `isHelpPanelOpen`
  // mock inline. Reset it here so a mid-test failure or a reorder can't leave
  // sibling tests silently taking the help-panel early-return branch.
  beforeEach(() => {
    vi.mocked(isHelpPanelOpen).mockReturnValue(false);
    vi.mocked(dismissHelpPanel).mockClear();
  });

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

  it("dock() saves the station marker position as lastFlightShipPos before teleporting (undock edge-spawn fix)", async () => {
    // Live-session finding (2026-07-12): dock() always teleports — the ship
    // never actually travels there, so nothing else records "near the
    // station" as its position. SPACE_FLIGHT's entry logic only ever reads
    // `lastFlightShipPos`; without saving it here, undocking fell back to the
    // plain system-edge spawn (confirmed live: dock right after a warp-in,
    // then undock — the ship was back at the boundary, not by the station).
    const engine = mockEngine({
      currentScene: {
        performWarpJumpTo: vi.fn().mockResolvedValue(undefined),
        planetManager: {
          stationMarkers: [{ station: { id: "s1" }, x: 111, y: -222 }],
        },
      },
    });
    await createLiveSceneController(engine).dock();
    expect(engine.lastFlightShipPos).toEqual({ x: 111, y: -222 });
  });

  it("dock() does not touch lastFlightShipPos when no station marker is found", async () => {
    const engine = mockEngine({
      currentScene: {
        performWarpJumpTo: vi.fn().mockResolvedValue(undefined),
        planetManager: { stationMarkers: [] },
      },
    });
    await createLiveSceneController(engine).dock();
    expect(engine.lastFlightShipPos).toBeUndefined();
  });

  it("dock() physically routes to the station instead of teleporting, when a real route is available (2026-07-19: fixes the live report of teleporting to the dock)", async () => {
    const executeRouteTo = vi.fn();
    const engine = mockEngine({
      currentScene: {
        performWarpJumpTo: vi.fn().mockResolvedValue(undefined),
        planetManager: {
          stationMarkers: [{ station: { id: "s1" }, x: 111, y: -222 }],
          routeTargetStationId: null,
        },
        executeRouteTo,
        shipPhysics: { isMoving: false },
      },
    });

    await createLiveSceneController(engine).dock();

    expect(executeRouteTo).toHaveBeenCalledWith(111, -222);
    expect(
      (
        engine.currentScene as unknown as {
          planetManager: { routeTargetStationId: string | null };
        }
      ).planetManager.routeTargetStationId,
    ).toBe("s1");
    // The scene's own proactive docking (DOCKING_RANGE) completes this later —
    // no scene transition/refuel yet, unlike the teleport fallback.
    expect(engine.transitionTo).not.toHaveBeenCalled();
  });

  it("dock() does not re-plot a route while already en route to the same station", async () => {
    const executeRouteTo = vi.fn();
    const engine = mockEngine({
      currentScene: {
        performWarpJumpTo: vi.fn().mockResolvedValue(undefined),
        planetManager: {
          stationMarkers: [{ station: { id: "s1" }, x: 111, y: -222 }],
          routeTargetStationId: "s1",
        },
        executeRouteTo,
        shipPhysics: { isMoving: true },
      },
    });

    await createLiveSceneController(engine).dock();

    expect(executeRouteTo).not.toHaveBeenCalled();
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

  it("takeQuest() drives the real job-board panel (open -> accept -> close) when the scene supports it (2026-07-19: makes quest-taking watchable)", () => {
    const board = [
      { template: { id: "q1", type: "DELIVERY" } },
      { template: { id: "q2", type: "TEXT_ADVENTURE" } },
    ];
    const e2eOpenJobBoard = vi.fn();
    const e2eAcceptBoardQuest = vi.fn();
    const e2eCloseJobBoard = vi.fn();
    const engine = mockEngine({
      player: { currentSystemId: "sys1", landedPlanetId: "p1" },
      getQuestBoard: vi.fn().mockReturnValue(board),
      currentScene: {
        performWarpJumpTo: vi.fn().mockResolvedValue(undefined),
        e2eOpenJobBoard,
        e2eAcceptBoardQuest,
        e2eCloseJobBoard,
      },
    });

    createLiveSceneController(engine).takeQuest();

    expect(e2eOpenJobBoard).toHaveBeenCalledTimes(1);
    expect(e2eAcceptBoardQuest).toHaveBeenCalledWith(board[0]);
    expect(e2eAcceptBoardQuest).toHaveBeenCalledTimes(1);
    expect(e2eCloseJobBoard).toHaveBeenCalledTimes(1);
    // The visual path drives the accept itself — no double-accept via the
    // direct domain call too.
    expect(engine.acceptBoardQuest).not.toHaveBeenCalled();
  });

  it("no-op verbs (tick/executeTrade/attack/flee/repair/liberate) never drive a transition", async () => {
    const engine = mockEngine({ liberateCurrentSystem: vi.fn() });
    const c = createLiveSceneController(engine);
    await c.tick();
    await c.executeTrade();
    await c.attack();
    await c.flee();
    await c.repair();
    await c.liberate();
    expect(engine.transitionTo).not.toHaveBeenCalled();
  });

  it("liberate() calls engine.liberateCurrentSystem()", () => {
    const engine = mockEngine({
      liberateCurrentSystem: vi.fn().mockReturnValue(true),
    });
    createLiveSceneController(engine).liberate();
    expect(engine.liberateCurrentSystem).toHaveBeenCalledTimes(1);
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

  it("attack(targetId) routes through the real onAttackNpc handler when the interaction seam is modeled, not the unconditional E2E seam", async () => {
    // Live-session finding (2026-07-12): `e2eEngageCombat` registers a
    // combatant with NO range check, so the policy attacking a system-wide
    // hostile thousands of pixels away latched `combatModule.isActive` on an
    // unreachable target and the ship never moved — "under attack" with
    // nothing nearby, forever. `onAttackNpc` (the real "Атаковать" handler)
    // does its own range check: pursue if far, engage only in weapon range.
    const e2eEngageCombat = vi.fn();
    const onAttackNpc = vi.fn();
    const targetNpc = { id: "npc-far" };
    const engine = mockEngine({
      currentScene: {
        performWarpJumpTo: vi.fn().mockResolvedValue(undefined),
        combatPause: { paused: false, confirm: vi.fn() },
        npcManager: {
          e2eEngageCombat,
          npcSprites: [{ npc: { id: "npc-other" } }, { npc: targetNpc }],
          interaction: { onAttackNpc },
        },
      },
    });
    await createLiveSceneController(engine).attack("npc-far");
    expect(onAttackNpc).toHaveBeenCalledWith(targetNpc);
    expect(e2eEngageCombat).not.toHaveBeenCalled();
  });

  it("attack() without targetId routes the first sprite through onAttackNpc when modeled", async () => {
    const onAttackNpc = vi.fn();
    const firstNpc = { id: "npc-first" };
    const engine = mockEngine({
      currentScene: {
        performWarpJumpTo: vi.fn().mockResolvedValue(undefined),
        npcManager: {
          e2eEngageCombat: vi.fn(),
          npcSprites: [{ npc: firstNpc }, { npc: { id: "npc-second" } }],
          interaction: { onAttackNpc },
        },
      },
    });
    await createLiveSceneController(engine).attack();
    expect(onAttackNpc).toHaveBeenCalledWith(firstNpc);
  });

  it("attack(targetId) falls back to e2eEngageCombat when the target id isn't among the live sprites", async () => {
    const e2eEngageCombat = vi.fn();
    const onAttackNpc = vi.fn();
    const engine = mockEngine({
      currentScene: {
        performWarpJumpTo: vi.fn().mockResolvedValue(undefined),
        npcManager: {
          e2eEngageCombat,
          npcSprites: [],
          interaction: { onAttackNpc },
        },
      },
    });
    await createLiveSceneController(engine).attack("npc-unknown");
    expect(onAttackNpc).not.toHaveBeenCalled();
    expect(e2eEngageCombat).toHaveBeenCalledWith("npc-unknown");
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

  it("warp() resumes the active-pause overlay before jumping (flee-stagnant-jump combat-pause deadlock)", async () => {
    // Live-observed (2026-07-12): the SPACE_FLIGHT survive tier's
    // `flee-stagnant-jump` escalation can pick `warp` while the ship is
    // sitting on the «Огонь!» active-pause overlay (an outmatched standoff
    // that never advanced a day). Without resuming the overlay first,
    // `performWarpJumpTo` races the frozen pause and the ship parks on the
    // combat frame instead of the system boundary — the same class of freeze
    // `attack()`/`flee()` already guard against.
    const resume = vi.fn();
    const engine = mockEngine({
      currentScene: {
        performWarpJumpTo: vi.fn().mockResolvedValue(undefined),
        combatPause: { paused: true, resume },
      },
    });
    await createLiveSceneController(engine).warp();
    expect(resume).toHaveBeenCalledTimes(1);
    expect(engine.currentScene.performWarpJumpTo).toHaveBeenCalledWith("sys2");
  });

  it("warp() does not touch the pause overlay when it isn't open", async () => {
    const resume = vi.fn();
    const engine = mockEngine({
      currentScene: {
        performWarpJumpTo: vi.fn().mockResolvedValue(undefined),
        combatPause: { paused: false, resume },
      },
    });
    await createLiveSceneController(engine).warp();
    expect(resume).not.toHaveBeenCalled();
  });

  it("flee() drives an actual escape route away from the system centre (F8 — breaking off pursuit alone froze the ship)", async () => {
    const executeRouteTo = vi.fn();
    const engine = mockEngine({
      currentScene: {
        performWarpJumpTo: vi.fn().mockResolvedValue(undefined),
        combatPause: { paused: false },
        npcManager: { breakOffCombatPursuit: vi.fn() },
        shipPhysics: { shipX: 100, shipY: 0, isMoving: false },
        executeRouteTo,
        pendingWarp: null,
        starRenderer: { centerX: 0, centerY: 0 },
        SYSTEM_BOUNDARY_RADIUS: 1000,
      },
    });

    await createLiveSceneController(engine).flee();

    // The ship sits at (100, 0), 100 px from centre (0,0) along +x — the
    // near-edge escape point is the SAME direction, scaled out to the
    // boundary radius (1000, 0), never a NaN/degenerate result.
    expect(executeRouteTo).toHaveBeenCalledTimes(1);
    const [x, y] = executeRouteTo.mock.calls[0] as [number, number];
    expect(x).toBeCloseTo(1000);
    expect(y).toBeCloseTo(0);
  });

  it("flee() does NOT plot a route while a jump is already pending (the committed-warp near-edge path owns that)", async () => {
    const executeRouteTo = vi.fn();
    const engine = mockEngine({
      currentScene: {
        performWarpJumpTo: vi.fn().mockResolvedValue(undefined),
        npcManager: { breakOffCombatPursuit: vi.fn() },
        shipPhysics: { shipX: 100, shipY: 0, isMoving: false },
        executeRouteTo,
        pendingWarp: { targetSystemId: "sys-2" },
        starRenderer: { centerX: 0, centerY: 0 },
        SYSTEM_BOUNDARY_RADIUS: 1000,
      },
    });

    await createLiveSceneController(engine).flee();

    expect(executeRouteTo).not.toHaveBeenCalled();
  });

  it("flee() does NOT re-plot a route while the ship is already moving (an escape already in progress)", async () => {
    const executeRouteTo = vi.fn();
    const engine = mockEngine({
      currentScene: {
        performWarpJumpTo: vi.fn().mockResolvedValue(undefined),
        npcManager: { breakOffCombatPursuit: vi.fn() },
        shipPhysics: { shipX: 100, shipY: 0, isMoving: true },
        executeRouteTo,
        pendingWarp: null,
        starRenderer: { centerX: 0, centerY: 0 },
        SYSTEM_BOUNDARY_RADIUS: 1000,
      },
    });

    await createLiveSceneController(engine).flee();

    expect(executeRouteTo).not.toHaveBeenCalled();
  });

  it("tick() dismisses an open help panel and returns without touching anything else (F3)", () => {
    vi.mocked(isHelpPanelOpen).mockReturnValue(true);
    const closeModals = vi.fn();
    const engine = mockEngine({
      currentScene: {
        performWarpJumpTo: vi.fn().mockResolvedValue(undefined),
        npcManager: { hasOpenModal: () => true, closeModals },
      },
    });

    createLiveSceneController(engine).tick();

    expect(dismissHelpPanel).toHaveBeenCalledTimes(1);
    // The help-panel check runs FIRST and returns — the encounter-overlay
    // dismissal (a separate, later concern) must not also fire this tick.
    expect(closeModals).not.toHaveBeenCalled();

    vi.mocked(isHelpPanelOpen).mockReturnValue(false);
  });

  it("tick() does not touch the help-panel seam when none is open", () => {
    vi.mocked(isHelpPanelOpen).mockReturnValue(false);
    vi.mocked(dismissHelpPanel).mockClear();
    const engine = mockEngine({
      currentScene: {
        performWarpJumpTo: vi.fn().mockResolvedValue(undefined),
      },
    });

    createLiveSceneController(engine).tick();

    expect(dismissHelpPanel).not.toHaveBeenCalled();
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

  it("dismissBlockingModal() closes an open modal AND re-arms a turn a shakedown hail froze", () => {
    // Mirrors `NpcInteractionController.openShakedownHail`: `endTurn()` froze
    // the turn, then a contact-panel modal opened. `hasOpenModal()` covers
    // that panel; the autopilot has no follow-up click to re-arm the turn the
    // way a human's pay/attack/flee response eventually does, so this must do
    // it itself once the modal is gone.
    const closeModals = vi.fn();
    const e2eStartTurn = vi.fn();
    const engine = mockEngine({
      currentSceneType: SceneType.SPACE_FLIGHT,
      currentScene: {
        performWarpJumpTo: vi.fn().mockResolvedValue(undefined),
        npcManager: { hasOpenModal: () => true, closeModals },
        pendingWarp: null,
        plannedRoute: null,
        shipPhysics: { isMoving: false },
        isTurnRunning: false,
        combatModule: { isActive: false },
        e2eStartTurn,
      },
    });
    const dismissed = createLiveSceneController(engine).dismissBlockingModal!();
    expect(dismissed).toBe(true);
    expect(closeModals).toHaveBeenCalledTimes(1);
    expect(e2eStartTurn).toHaveBeenCalledTimes(1);
  });

  it("dismissBlockingModal() does not re-arm the turn while real combat is already active", () => {
    const closeModals = vi.fn();
    const e2eStartTurn = vi.fn();
    const engine = mockEngine({
      currentSceneType: SceneType.SPACE_FLIGHT,
      currentScene: {
        performWarpJumpTo: vi.fn().mockResolvedValue(undefined),
        npcManager: { hasOpenModal: () => true, closeModals },
        pendingWarp: null,
        plannedRoute: null,
        shipPhysics: { isMoving: false },
        isTurnRunning: false,
        combatModule: { isActive: true },
        e2eStartTurn,
      },
    });
    createLiveSceneController(engine).dismissBlockingModal!();
    expect(e2eStartTurn).not.toHaveBeenCalled();
  });

  it("dismissBlockingModal() does not touch the turn when the turn is already running", () => {
    const closeModals = vi.fn();
    const e2eStartTurn = vi.fn();
    const engine = mockEngine({
      currentSceneType: SceneType.SPACE_FLIGHT,
      currentScene: {
        performWarpJumpTo: vi.fn().mockResolvedValue(undefined),
        npcManager: { hasOpenModal: () => true, closeModals },
        pendingWarp: null,
        plannedRoute: null,
        shipPhysics: { isMoving: false },
        isTurnRunning: true,
        combatModule: { isActive: false },
        e2eStartTurn,
      },
    });
    createLiveSceneController(engine).dismissBlockingModal!();
    expect(e2eStartTurn).not.toHaveBeenCalled();
  });

  it("dismissBlockingModal() returns false and touches nothing when no modal is open", () => {
    const closeModals = vi.fn();
    const e2eStartTurn = vi.fn();
    const engine = mockEngine({
      currentSceneType: SceneType.SPACE_FLIGHT,
      currentScene: {
        performWarpJumpTo: vi.fn().mockResolvedValue(undefined),
        npcManager: { hasOpenModal: () => false, closeModals },
        pendingWarp: null,
        plannedRoute: null,
        shipPhysics: { isMoving: false },
        isTurnRunning: false,
        combatModule: { isActive: false },
        e2eStartTurn,
      },
    });
    const dismissed = createLiveSceneController(engine).dismissBlockingModal!();
    expect(dismissed).toBe(false);
    expect(closeModals).not.toHaveBeenCalled();
    expect(e2eStartTurn).not.toHaveBeenCalled();
  });

  it("dismissBlockingModal() does not re-arm the turn when a route is already planned", () => {
    const closeModals = vi.fn();
    const e2eStartTurn = vi.fn();
    const engine = mockEngine({
      currentSceneType: SceneType.SPACE_FLIGHT,
      currentScene: {
        performWarpJumpTo: vi.fn().mockResolvedValue(undefined),
        npcManager: { hasOpenModal: () => true, closeModals },
        pendingWarp: null,
        plannedRoute: { x: 10, y: 20 },
        shipPhysics: { isMoving: false },
        isTurnRunning: false,
        combatModule: { isActive: false },
        e2eStartTurn,
      },
    });
    createLiveSceneController(engine).dismissBlockingModal!();
    expect(e2eStartTurn).not.toHaveBeenCalled();
  });

  it("dismissBlockingModal() resumes a stuck active-pause («Огонь!») overlay", () => {
    // Live-session finding (2026-07-12): a multi-ship garrison re-pauses combat
    // faster than a single per-verb resume can make progress — from
    // SPACE_FLIGHT, a `warp` decision dispatches to `openStarMap()` first
    // (LiveApplier's two-step warp), which had no pause awareness at all, so
    // the flee-stagnant-jump escape valve never actually fired. Confirmed
    // live: `combatPause.paused` stayed true across a full 10s window with
    // zero net ship displacement.
    const closeModals = vi.fn();
    const resume = vi.fn();
    const engine = mockEngine({
      currentSceneType: SceneType.SPACE_FLIGHT,
      currentScene: {
        performWarpJumpTo: vi.fn().mockResolvedValue(undefined),
        npcManager: { hasOpenModal: () => false, closeModals },
        combatPause: { paused: true, resume },
      },
    });
    const dismissed = createLiveSceneController(engine).dismissBlockingModal!();
    expect(dismissed).toBe(true);
    expect(resume).toHaveBeenCalledTimes(1);
    expect(closeModals).not.toHaveBeenCalled();
  });

  it("dismissBlockingModal() does not touch a combatPause that isn't open", () => {
    const resume = vi.fn();
    const engine = mockEngine({
      currentSceneType: SceneType.SPACE_FLIGHT,
      currentScene: {
        performWarpJumpTo: vi.fn().mockResolvedValue(undefined),
        npcManager: { hasOpenModal: () => false, closeModals: vi.fn() },
        combatPause: { paused: false, resume },
      },
    });
    const dismissed = createLiveSceneController(engine).dismissBlockingModal!();
    expect(dismissed).toBe(false);
    expect(resume).not.toHaveBeenCalled();
  });

  it("dismissBlockingModal() prefers closing an open manager modal over resuming combatPause in the same call", () => {
    const closeModals = vi.fn();
    const resume = vi.fn();
    const engine = mockEngine({
      currentSceneType: SceneType.SPACE_FLIGHT,
      currentScene: {
        performWarpJumpTo: vi.fn().mockResolvedValue(undefined),
        npcManager: { hasOpenModal: () => true, closeModals },
        combatPause: { paused: true, resume },
        pendingWarp: null,
        plannedRoute: null,
        shipPhysics: { isMoving: false },
        isTurnRunning: false,
        combatModule: { isActive: false },
      },
    });
    createLiveSceneController(engine).dismissBlockingModal!();
    expect(closeModals).toHaveBeenCalledTimes(1);
    expect(resume).not.toHaveBeenCalled();
  });

  it("dismissBlockingModal() engages an open encounter prompt instead of blind-closing it (2026-07-19)", () => {
    const closeModals = vi.fn();
    const applyEncounterChoice = vi.fn();
    const closeEncounterPrompt = vi.fn();
    const fakeEncounter = { id: "enc1" };
    const engine = mockEngine({
      currentSceneType: SceneType.SPACE_FLIGHT,
      currentScene: {
        performWarpJumpTo: vi.fn().mockResolvedValue(undefined),
        npcManager: {
          hasOpenModal: () => true,
          closeModals,
          isEncounterPromptOpen: true,
          activeEncounter: fakeEncounter,
          closeEncounterPrompt,
          applyEncounterChoice,
        },
      },
    });
    const dismissed = createLiveSceneController(engine).dismissBlockingModal!();
    expect(dismissed).toBe(true);
    expect(applyEncounterChoice).toHaveBeenCalledWith(fakeEncounter, "engage");
    expect(closeEncounterPrompt).toHaveBeenCalledTimes(1);
    expect(closeModals).not.toHaveBeenCalled();
  });

  it("dismissBlockingModal() closes the prompt BEFORE applying the choice — never re-applies on the next tick (2026-07-19 regression: infinite credits from re-scanning the same encounter)", () => {
    // A real `EncounterController`: `closeEncounterPrompt()` actually clears
    // `isEncounterPromptOpen`/`activeEncounter`, exactly like the production
    // class. The first version of this fix called `applyEncounterChoice`
    // without ever closing the prompt, so a second tick saw the identical
    // still-open prompt and applied "engage" again — live-confirmed as an
    // infinite "+300 кр" loop from a single anomaly.
    const applyEncounterChoice = vi.fn();
    const fakeEncounter = { id: "enc1" };
    const npcManager = {
      hasOpenModal: () => npcManager.isEncounterPromptOpen,
      closeModals: vi.fn(),
      isEncounterPromptOpen: true,
      activeEncounter: fakeEncounter as typeof fakeEncounter | null,
      closeEncounterPrompt: vi.fn(() => {
        npcManager.isEncounterPromptOpen = false;
        npcManager.activeEncounter = null;
      }),
      applyEncounterChoice,
    };
    const engine = mockEngine({
      currentSceneType: SceneType.SPACE_FLIGHT,
      currentScene: {
        performWarpJumpTo: vi.fn().mockResolvedValue(undefined),
        npcManager,
      },
    });
    const controller = createLiveSceneController(engine);

    controller.dismissBlockingModal!();
    controller.dismissBlockingModal!(); // a second tick — must be inert now

    expect(applyEncounterChoice).toHaveBeenCalledTimes(1);
    expect(npcManager.isEncounterPromptOpen).toBe(false);
  });

  it("dismissBlockingModal() still closes a non-encounter modal (contact panel/OVERMIND) as before", () => {
    const closeModals = vi.fn();
    const applyEncounterChoice = vi.fn();
    const engine = mockEngine({
      currentSceneType: SceneType.SPACE_FLIGHT,
      currentScene: {
        performWarpJumpTo: vi.fn().mockResolvedValue(undefined),
        npcManager: {
          hasOpenModal: () => true,
          closeModals,
          isEncounterPromptOpen: false,
          activeEncounter: null,
          applyEncounterChoice,
        },
        pendingWarp: null,
        plannedRoute: null,
        shipPhysics: { isMoving: false },
        isTurnRunning: false,
        combatModule: { isActive: false },
        e2eStartTurn: vi.fn(),
      },
    });
    const dismissed = createLiveSceneController(engine).dismissBlockingModal!();
    expect(dismissed).toBe(true);
    expect(closeModals).toHaveBeenCalledTimes(1);
    expect(applyEncounterChoice).not.toHaveBeenCalled();
  });

  it("dismissBlockingModal() bribes an open customs modal when the bribe is affordable (Task 11b, #contraband)", () => {
    // Live report 2026-07-19: "unclear what the autopilot does if caught with
    // contraband." The PlanetScene customs modal is a blocking overlay the
    // autopilot otherwise acts underneath. Prefer the cheapest clearance (bribe,
    // no reputation cost) when the ship can afford it.
    const applyCustomsChoice = vi.fn().mockReturnValue(true);
    const engine = mockEngine({
      currentSceneType: SceneType.PLANET,
      player: { credits: 5000, currentSystemId: "sys1", landedPlanetId: "p1" },
      currentScene: {
        isCustomsModalOpen: true,
        customsBribeCost: 900,
        applyCustomsChoice,
      },
    });
    const dismissed = createLiveSceneController(engine).dismissBlockingModal!();
    expect(dismissed).toBe(true);
    expect(applyCustomsChoice).toHaveBeenCalledWith("bribe");
  });

  it("dismissBlockingModal() dumps the cargo when the customs bribe is unaffordable", () => {
    const applyCustomsChoice = vi.fn().mockReturnValue(true);
    const engine = mockEngine({
      currentSceneType: SceneType.PLANET,
      player: { credits: 100, currentSystemId: "sys1", landedPlanetId: "p1" },
      currentScene: {
        isCustomsModalOpen: true,
        customsBribeCost: 900,
        applyCustomsChoice,
      },
    });
    const dismissed = createLiveSceneController(engine).dismissBlockingModal!();
    expect(dismissed).toBe(true);
    expect(applyCustomsChoice).toHaveBeenCalledWith("dump");
  });

  it("dismissBlockingModal() dumps when no bribe cost is exposed (defensive)", () => {
    const applyCustomsChoice = vi.fn().mockReturnValue(true);
    const engine = mockEngine({
      currentSceneType: SceneType.PLANET,
      player: { credits: 5000, currentSystemId: "sys1", landedPlanetId: "p1" },
      currentScene: {
        isCustomsModalOpen: true,
        customsBribeCost: null,
        applyCustomsChoice,
      },
    });
    createLiveSceneController(engine).dismissBlockingModal!();
    expect(applyCustomsChoice).toHaveBeenCalledWith("dump");
  });

  it("dismissBlockingModal() ignores a closed customs modal (returns false, touches nothing)", () => {
    const applyCustomsChoice = vi.fn();
    const engine = mockEngine({
      currentSceneType: SceneType.PLANET,
      currentScene: {
        isCustomsModalOpen: false,
        customsBribeCost: 900,
        applyCustomsChoice,
      },
    });
    const dismissed = createLiveSceneController(engine).dismissBlockingModal!();
    expect(dismissed).toBe(false);
    expect(applyCustomsChoice).not.toHaveBeenCalled();
  });

  it("tick() calls hud.closeModals() when the quest journal is open", () => {
    const closeModals = vi.fn();
    const engine = mockEngine({
      currentScene: {
        performWarpJumpTo: vi.fn().mockResolvedValue(undefined),
        hud: {
          isQuestJournalOpen: () => true,
          isSettingsPanelOpen: () => false,
          closeModals,
        },
      },
    });
    createLiveSceneController(engine).tick();
    expect(closeModals).toHaveBeenCalledTimes(1);
  });

  it("tick() calls hud.closeModals() when the accessibility panel is open", () => {
    const closeModals = vi.fn();
    const engine = mockEngine({
      currentScene: {
        performWarpJumpTo: vi.fn().mockResolvedValue(undefined),
        hud: {
          isQuestJournalOpen: () => false,
          isSettingsPanelOpen: () => true,
          closeModals,
        },
      },
    });
    createLiveSceneController(engine).tick();
    expect(closeModals).toHaveBeenCalledTimes(1);
  });

  it("tick() does not force-close the settings panel with zero grace when the quest journal is already idle-due to close", () => {
    // Regression for the co-occurrence race: journal opens first and earns
    // its grace tick; before the journal's idle-close fires, the settings
    // panel ALSO opens (the two are independently openable — neither toggle
    // closes the other). The shared closeModals() call must not destroy the
    // freshly-opened settings panel as collateral damage of the journal's
    // own overdue close.
    let journalOpen = false;
    let settingsOpen = false;
    const closeModals = vi.fn(() => {
      journalOpen = false;
      settingsOpen = false;
    });
    const engine = mockEngine({
      currentScene: {
        performWarpJumpTo: vi.fn().mockResolvedValue(undefined),
        hud: {
          isQuestJournalOpen: () => journalOpen,
          isSettingsPanelOpen: () => settingsOpen,
          closeModals,
        },
      },
    });
    const controller = createLiveSceneController(engine);

    controller.tick(); // tick 1: nothing open yet, flushes the "first tick" state
    expect(closeModals).not.toHaveBeenCalled();

    journalOpen = true;
    controller.tick(); // tick 2: journal opens mid-session — grace tick, no close
    expect(closeModals).not.toHaveBeenCalled();
    expect(journalOpen).toBe(true);

    settingsOpen = true;
    controller.tick(); // tick 3: journal's grace is spent, but settings just opened —
    // must defer the close entirely rather than nuke settings via closeModals().
    expect(closeModals).not.toHaveBeenCalled();
    expect(journalOpen).toBe(true);
    expect(settingsOpen).toBe(true);

    controller.tick(); // tick 4: both panels have had their grace tick — now close.
    expect(closeModals).toHaveBeenCalledTimes(1);
    expect(journalOpen).toBe(false);
    expect(settingsOpen).toBe(false);
  });

  it("tick() does not call hud.closeModals() when neither panel is open", () => {
    const closeModals = vi.fn();
    const engine = mockEngine({
      currentScene: {
        performWarpJumpTo: vi.fn().mockResolvedValue(undefined),
        hud: {
          isQuestJournalOpen: () => false,
          isSettingsPanelOpen: () => false,
          closeModals,
        },
      },
    });
    createLiveSceneController(engine).tick();
    expect(closeModals).not.toHaveBeenCalled();
  });

  it("tick() calls planetManager.closeInfoPanel() when the planet info panel is open", () => {
    const closeInfoPanel = vi.fn();
    const engine = mockEngine({
      currentScene: {
        performWarpJumpTo: vi.fn().mockResolvedValue(undefined),
        planetManager: { hasInfoPanel: true, closeInfoPanel },
      },
    });
    createLiveSceneController(engine).tick();
    expect(closeInfoPanel).toHaveBeenCalledTimes(1);
  });

  it("tick() does not call planetManager.closeInfoPanel() when no info panel is open", () => {
    const closeInfoPanel = vi.fn();
    const engine = mockEngine({
      currentScene: {
        performWarpJumpTo: vi.fn().mockResolvedValue(undefined),
        planetManager: { hasInfoPanel: false, closeInfoPanel },
      },
    });
    createLiveSceneController(engine).tick();
    expect(closeInfoPanel).not.toHaveBeenCalled();
  });

  it("tick() starts a turn (e2eStartTurn) when the ship is genuinely idle in flight (F7)", () => {
    const e2eStartTurn = vi.fn();
    const engine = mockEngine({
      currentSceneType: SceneType.SPACE_FLIGHT,
      currentScene: {
        performWarpJumpTo: vi.fn().mockResolvedValue(undefined),
        pendingWarp: null,
        plannedRoute: null,
        shipPhysics: { isMoving: false },
        isTurnRunning: false,
        combatModule: { isActive: false },
        e2eStartTurn,
      },
    });
    createLiveSceneController(engine).tick();
    expect(e2eStartTurn).toHaveBeenCalledTimes(1);
  });

  it("tick() does NOT start a turn when a turn is already running", () => {
    const e2eStartTurn = vi.fn();
    const engine = mockEngine({
      currentSceneType: SceneType.SPACE_FLIGHT,
      currentScene: {
        performWarpJumpTo: vi.fn().mockResolvedValue(undefined),
        pendingWarp: null,
        plannedRoute: null,
        shipPhysics: { isMoving: false },
        isTurnRunning: true,
        combatModule: { isActive: false },
        e2eStartTurn,
      },
    });
    createLiveSceneController(engine).tick();
    expect(e2eStartTurn).not.toHaveBeenCalled();
  });

  it("tick() does NOT start a turn while a fight is active", () => {
    const e2eStartTurn = vi.fn();
    const engine = mockEngine({
      currentSceneType: SceneType.SPACE_FLIGHT,
      currentScene: {
        performWarpJumpTo: vi.fn().mockResolvedValue(undefined),
        pendingWarp: null,
        plannedRoute: null,
        shipPhysics: { isMoving: false },
        isTurnRunning: false,
        combatModule: { isActive: true },
        e2eStartTurn,
      },
    });
    createLiveSceneController(engine).tick();
    expect(e2eStartTurn).not.toHaveBeenCalled();
  });

  it("tick() does NOT start a turn while the ship is already moving", () => {
    const e2eStartTurn = vi.fn();
    const engine = mockEngine({
      currentSceneType: SceneType.SPACE_FLIGHT,
      currentScene: {
        performWarpJumpTo: vi.fn().mockResolvedValue(undefined),
        pendingWarp: null,
        plannedRoute: null,
        shipPhysics: { isMoving: true },
        isTurnRunning: false,
        combatModule: { isActive: false },
        e2eStartTurn,
      },
    });
    createLiveSceneController(engine).tick();
    expect(e2eStartTurn).not.toHaveBeenCalled();
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
