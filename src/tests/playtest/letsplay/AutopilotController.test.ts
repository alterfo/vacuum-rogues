import { describe, it, expect, vi } from "vitest";
import { SceneType } from "@/types";
import {
  AutopilotController,
  DEFAULT_AUTOPILOT_TICK_MS,
  type AutopilotIndicator,
  type AutopilotScheduler,
  type HumanInputSource,
} from "./AutopilotController";
import type { ApplyCall, LiveSceneController } from "./LiveApplier";
import { legalActionsForScene, type Observation } from "./observe";
import type { Action, PlayerPolicy } from "./PlayerPolicy";

/**
 * Task 2 of the dev-only autopilot: the controller (observe → decide → apply on a
 * timer). It is pure logic over ports, so it is tested against a **fake scene +
 * clock** (no PixiJS, no real engine):
 *  - it decides+applies once per scheduler tick, at the configured cadence;
 *  - `stop()` halts ticking, hides the indicator, and unsubscribes input;
 *  - a simulated human input disengages it (reclaim-on-input);
 *  - a faulty policy / applier never throws out of the tick loop;
 *  - a slow async apply can't overlap the next tick (re-entrancy guard).
 */

/** A hand-driven fake clock: captures the tick callback so the test fires it. */
function makeFakeScheduler(): {
  scheduler: AutopilotScheduler;
  fire: () => void;
  intervalMs: () => number;
  starts: () => number;
  cancels: () => number;
  running: () => boolean;
} {
  let captured: (() => void) | null = null;
  let interval = 0;
  let starts = 0;
  let cancels = 0;
  return {
    scheduler: {
      start(onTick, ms) {
        captured = onTick;
        interval = ms;
        starts++;
        return () => {
          cancels++;
          captured = null;
        };
      },
    },
    fire: () => captured?.(),
    intervalMs: () => interval,
    starts: () => starts,
    cancels: () => cancels,
    running: () => captured !== null,
  };
}

/** A spy controller recording the verbs invoked, in order. */
function makeController(overrides: Partial<LiveSceneController> = {}): {
  controller: LiveSceneController;
  calls: ApplyCall[];
} {
  const calls: ApplyCall[] = [];
  const rec = (call: ApplyCall) => (): void => {
    calls.push(call);
  };
  const controller: LiveSceneController = {
    tick: rec("tick"),
    leaveToFlight: rec("leaveToFlight"),
    land: rec("land"),
    dock: rec("dock"),
    openStarMap: rec("openStarMap"),
    warp: rec("warp"),
    openTrade: rec("openTrade"),
    executeTrade: rec("executeTrade"),
    takeQuest: rec("takeQuest"),
    attack: rec("attack"),
    flee: rec("flee"),
    repair: rec("repair"),
    ...overrides,
  };
  return { controller, calls };
}

/** A SPACE_FLIGHT observation whose legalActions come from the real pure helper. */
function flightObs(): Observation {
  return {
    scene: SceneType.SPACE_FLIGHT,
    hasPlayer: true,
    player: null,
    system: null,
    currentPlanet: null,
    npcs: [],
    hostiles: [],
    quests: [],
    legalActions: legalActionsForScene(SceneType.SPACE_FLIGHT, {
      hasPlayer: true,
      planetCount: 1,
      stationCount: 1,
      hostileCount: 1,
      connectionCount: 1,
      availableQuestCount: 0,
    }),
  };
}

/** A policy that always returns the same action (kind must be legal in the obs). */
function fixedPolicy(action: Action): PlayerPolicy {
  return { name: "fixed", decide: () => action };
}

/** Flush all pending microtasks (the async apply chain settles within these). */
const flush = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

describe("AutopilotController — engage / tick cadence", () => {
  it("starts the scheduler at the configured cadence and shows the indicator", () => {
    const sch = makeFakeScheduler();
    const indicator: AutopilotIndicator = { show: vi.fn(), hide: vi.fn() };
    const { controller } = makeController();
    const ap = new AutopilotController({
      observe: flightObs,
      policy: fixedPolicy({ kind: "land" }),
      controller,
      scheduler: sch.scheduler,
      indicator,
      tickIntervalMs: 500,
    });

    expect(ap.isEngaged).toBe(false);
    ap.start();

    expect(ap.isEngaged).toBe(true);
    expect(sch.starts()).toBe(1);
    expect(sch.intervalMs()).toBe(500);
    expect(indicator.show).toHaveBeenCalledTimes(1);
  });

  it("defaults the cadence to DEFAULT_AUTOPILOT_TICK_MS", () => {
    const sch = makeFakeScheduler();
    const { controller } = makeController();
    new AutopilotController({
      observe: flightObs,
      policy: fixedPolicy({ kind: "wait" }),
      controller,
      scheduler: sch.scheduler,
      indicator: noopIndicator(),
    }).start();

    expect(sch.intervalMs()).toBe(DEFAULT_AUTOPILOT_TICK_MS);
  });

  it("decides + applies once per scheduler tick", async () => {
    const sch = makeFakeScheduler();
    const { controller, calls } = makeController();
    const decide = vi.fn(() => ({ kind: "land" }) as Action);
    const ap = new AutopilotController({
      observe: flightObs,
      policy: { name: "spy", decide },
      controller,
      scheduler: sch.scheduler,
      indicator: noopIndicator(),
    });

    ap.start();
    sch.fire();
    await flush();
    sch.fire();
    await flush();

    expect(decide).toHaveBeenCalledTimes(2);
    expect(calls).toEqual(["land", "land"]);
  });

  it("routes the chosen action through the live applier to the matching verb", async () => {
    const sch = makeFakeScheduler();
    const { controller, calls } = makeController();
    const ap = new AutopilotController({
      observe: flightObs,
      policy: fixedPolicy({ kind: "warp" }), // from flight, warp opens the star map
      controller,
      scheduler: sch.scheduler,
      indicator: noopIndicator(),
    });

    ap.start();
    sch.fire();
    await flush();

    expect(calls).toEqual(["openStarMap"]);
  });

  it("skips an illegal action without driving the scene (still no throw)", async () => {
    const sch = makeFakeScheduler();
    const { controller, calls } = makeController();
    const ap = new AutopilotController({
      observe: flightObs,
      // "repair" is not legal in SPACE_FLIGHT → the applier no-ops it.
      policy: fixedPolicy({ kind: "repair" }),
      controller,
      scheduler: sch.scheduler,
      indicator: noopIndicator(),
    });

    ap.start();
    sch.fire();
    await flush();

    expect(calls).toEqual([]);
    expect(ap.isEngaged).toBe(true);
  });
});

describe("AutopilotController — disengage", () => {
  it("stop() cancels the timer, unsubscribes input, hides the indicator", () => {
    const sch = makeFakeScheduler();
    const unsubscribe = vi.fn();
    const onHumanInput: HumanInputSource = vi.fn(() => unsubscribe);
    const indicator: AutopilotIndicator = { show: vi.fn(), hide: vi.fn() };
    const { controller } = makeController();
    const ap = new AutopilotController({
      observe: flightObs,
      policy: fixedPolicy({ kind: "wait" }),
      controller,
      scheduler: sch.scheduler,
      onHumanInput,
      indicator,
    });

    ap.start();
    expect(sch.running()).toBe(true);

    ap.stop();

    expect(ap.isEngaged).toBe(false);
    expect(sch.cancels()).toBe(1);
    expect(sch.running()).toBe(false);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(indicator.hide).toHaveBeenCalledTimes(1);
  });

  it("stops ticking after stop()", async () => {
    const sch = makeFakeScheduler();
    const { controller, calls } = makeController();
    const ap = new AutopilotController({
      observe: flightObs,
      policy: fixedPolicy({ kind: "land" }),
      controller,
      scheduler: sch.scheduler,
      indicator: noopIndicator(),
    });

    ap.start();
    sch.fire();
    await flush();
    expect(calls).toEqual(["land"]);

    ap.stop();
    // The fake clock callback is cleared by cancel, so firing is inert; even if a
    // stale tick leaked through, the disengaged guard would no-op it.
    sch.fire();
    await flush();

    expect(calls).toEqual(["land"]); // unchanged
  });

  it("reclaims control on the first human input (disengages)", async () => {
    const sch = makeFakeScheduler();
    let triggerInput: (() => void) | null = null;
    const onHumanInput: HumanInputSource = (onInput) => {
      triggerInput = onInput;
      return () => {
        triggerInput = null;
      };
    };
    const indicator: AutopilotIndicator = { show: vi.fn(), hide: vi.fn() };
    const { controller } = makeController();
    const ap = new AutopilotController({
      observe: flightObs,
      policy: fixedPolicy({ kind: "wait" }),
      controller,
      scheduler: sch.scheduler,
      onHumanInput,
      indicator,
    });

    ap.start();
    expect(ap.isEngaged).toBe(true);
    expect(triggerInput).toBeTypeOf("function");

    triggerInput!(); // human grabs the stick

    expect(ap.isEngaged).toBe(false);
    expect(sch.cancels()).toBe(1);
    expect(indicator.hide).toHaveBeenCalledTimes(1);
  });

  it("is idempotent: a second start()/stop() is a no-op", () => {
    const sch = makeFakeScheduler();
    const { controller } = makeController();
    const ap = new AutopilotController({
      observe: flightObs,
      policy: fixedPolicy({ kind: "wait" }),
      controller,
      scheduler: sch.scheduler,
      indicator: noopIndicator(),
    });

    ap.start();
    ap.start(); // ignored
    expect(sch.starts()).toBe(1);

    ap.stop();
    ap.stop(); // ignored
    expect(sch.cancels()).toBe(1);
  });

  it("does not tick before start or after stop", async () => {
    const sch = makeFakeScheduler();
    const decide = vi.fn(() => ({ kind: "wait" }) as Action);
    const { controller } = makeController();
    const ap = new AutopilotController({
      observe: flightObs,
      policy: { name: "spy", decide },
      controller,
      scheduler: sch.scheduler,
      indicator: noopIndicator(),
    });

    // tickOnce before start → no-op
    await ap.tickOnce();
    expect(decide).not.toHaveBeenCalled();

    ap.start();
    ap.stop();
    // tickOnce after stop → no-op
    await ap.tickOnce();
    expect(decide).not.toHaveBeenCalled();
  });
});

describe("AutopilotController — robustness (never throws)", () => {
  it("swallows a policy fault, routes it to onError, and keeps flying", async () => {
    const onError = vi.fn();
    const sch = makeFakeScheduler();
    const { controller, calls } = makeController();
    let blowUp = true;
    const ap = new AutopilotController({
      observe: flightObs,
      policy: {
        name: "flaky",
        decide: () => {
          if (blowUp) throw new Error("boom");
          return { kind: "land" };
        },
      },
      controller,
      scheduler: sch.scheduler,
      indicator: noopIndicator(),
      onError,
    });

    ap.start();
    await expect(ap.tickOnce()).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([]);

    // The loop recovers on the next tick once the policy stops throwing.
    blowUp = false;
    await ap.tickOnce();
    expect(calls).toEqual(["land"]);
  });

  it("swallows an applier/scene fault and still resolves", async () => {
    const onError = vi.fn();
    const sch = makeFakeScheduler();
    const { controller } = makeController({
      land: () => {
        throw new Error("scene exploded");
      },
    });
    const ap = new AutopilotController({
      observe: flightObs,
      policy: fixedPolicy({ kind: "land" }),
      controller,
      scheduler: sch.scheduler,
      indicator: noopIndicator(),
      onError,
    });

    ap.start();
    await expect(ap.tickOnce()).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(ap.isEngaged).toBe(true); // a scene fault does not disengage
  });

  it("does not overlap ticks while a slow async apply is in flight", async () => {
    const sch = makeFakeScheduler();
    let release: (() => void) | null = null;
    const inFlight = new Promise<void>((resolve) => {
      release = resolve;
    });
    const decide = vi.fn(() => ({ kind: "land" }) as Action);
    const { controller } = makeController({
      land: () => inFlight, // never resolves until released
    });
    const ap = new AutopilotController({
      observe: flightObs,
      policy: { name: "spy", decide },
      controller,
      scheduler: sch.scheduler,
      indicator: noopIndicator(),
    });

    ap.start();
    const first = ap.tickOnce(); // enters, awaits the slow apply
    await flush();
    expect(decide).toHaveBeenCalledTimes(1);

    // A second tick while busy must be skipped (no second decide).
    await ap.tickOnce();
    expect(decide).toHaveBeenCalledTimes(1);

    release!();
    await first;

    // Once the in-flight apply settles, a fresh tick proceeds.
    await ap.tickOnce();
    expect(decide).toHaveBeenCalledTimes(2);
  });
});

/** A throwaway no-op indicator for tests that don't assert on it. */
function noopIndicator(): AutopilotIndicator {
  return { show() {}, hide() {} };
}
