import { describe, it, expect, vi, afterEach } from "vitest";
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
import { readFlags, clearFlags } from "./oddityFlags";

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
    buyGear: rec("buyGear"),
    upgradeHull: rec("upgradeHull"),
    buyModule: rec("buyModule"),
    takeLoan: rec("takeLoan"),
    repayLoan: rec("repayLoan"),
    sellCargo: rec("sellCargo"),
    armUp: rec("armUp"),
    liberate: rec("liberate"),
    ...overrides,
  };
  return { controller, calls };
}

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

function fixedPolicy(action: Action): PlayerPolicy {
  return { name: "fixed", decide: () => action };
}

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

describe("AutopilotController — blocking-modal gate (F-shakedown, 2026-07-12)", () => {
  it("dismisses a blocking modal BEFORE deciding, and skips decide/apply this tick", async () => {
    const sch = makeFakeScheduler();
    const dismissBlockingModal = vi.fn(() => true);
    const { controller, calls } = makeController({ dismissBlockingModal });
    const decide = vi.fn(() => ({ kind: "attack" }) as Action);
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

    expect(dismissBlockingModal).toHaveBeenCalledTimes(1);
    expect(decide).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it("proceeds to decide/apply once dismissBlockingModal reports nothing was open", async () => {
    const sch = makeFakeScheduler();
    const dismissBlockingModal = vi.fn(() => false);
    const { controller, calls } = makeController({ dismissBlockingModal });
    const ap = new AutopilotController({
      observe: flightObs,
      policy: fixedPolicy({ kind: "attack" }),
      controller,
      scheduler: sch.scheduler,
      indicator: noopIndicator(),
    });

    ap.start();
    sch.fire();
    await flush();

    expect(dismissBlockingModal).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["attack"]);
  });

  it("still decides/applies when the controller doesn't implement dismissBlockingModal", async () => {
    const sch = makeFakeScheduler();
    const { controller, calls } = makeController(); // no override — optional method absent
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

  it("stops itself at a terminal scene instead of deciding forever (2026-07-18 live report)", async () => {
    const sch = makeFakeScheduler();
    const indicator: AutopilotIndicator = { show: vi.fn(), hide: vi.fn() };
    const decide = vi.fn(() => ({ kind: "wait" }) as Action);
    const { controller } = makeController();
    const ap = new AutopilotController({
      observe: flightObs,
      policy: { name: "spy", decide },
      controller,
      scheduler: sch.scheduler,
      indicator,
      isTerminal: () => true,
    });

    ap.start();
    expect(ap.isEngaged).toBe(true);

    sch.fire();
    await flush();

    expect(ap.isEngaged).toBe(false);
    expect(indicator.hide).toHaveBeenCalledTimes(1);
    expect(decide).not.toHaveBeenCalled();
  });

  it("without isTerminal, behaves exactly as before (opt-in, no default terminal check)", async () => {
    const sch = makeFakeScheduler();
    const { controller, calls } = makeController();
    const ap = new AutopilotController({
      observe: flightObs,
      policy: fixedPolicy({ kind: "wait" }),
      controller,
      scheduler: sch.scheduler,
      indicator: noopIndicator(),
    });

    ap.start();
    sch.fire();
    await flush();

    expect(ap.isEngaged).toBe(true);
    expect(calls).toEqual(["tick"]);
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

    await ap.tickOnce();
    expect(decide).not.toHaveBeenCalled();

    ap.start();
    ap.stop();
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

    await ap.tickOnce();
    expect(decide).toHaveBeenCalledTimes(1);

    release!();
    await first;

    await ap.tickOnce();
    expect(decide).toHaveBeenCalledTimes(2);
  });
});

describe("AutopilotController — flag() (live oddity flagging, Task 7)", () => {
  afterEach(() => {
    clearFlags();
  });

  it("is a no-op before the first tick — nothing observed yet", () => {
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
    expect(() => ap.flag("too early")).not.toThrow();
    expect(readFlags()).toEqual([]);
  });

  it("records the most recently observed step/scene/action after a tick", async () => {
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
    await ap.tickOnce();
    ap.flag("странный манёвр");

    const flags = readFlags();
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({
      step: 1,
      scene: SceneType.SPACE_FLIGHT,
      lastAction: { kind: "wait" },
      note: "странный манёвр",
    });
  });

  it("a fresh start() resets the step counter a flag is recorded at", async () => {
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
    await ap.tickOnce();
    await ap.tickOnce();
    ap.stop();

    ap.start(); // fresh engagement — step counter restarts at 0
    await ap.tickOnce();
    ap.flag();

    expect(readFlags()[0].step).toBe(1);
  });

  it("never throws when the underlying store write fails (flagOddity is itself storage-guarded)", async () => {
    const original = localStorage.setItem;
    localStorage.setItem = () => {
      throw new Error("quota exceeded");
    };
    const onError = vi.fn();
    const sch = makeFakeScheduler();
    const { controller } = makeController();
    const ap = new AutopilotController({
      observe: flightObs,
      policy: fixedPolicy({ kind: "wait" }),
      controller,
      scheduler: sch.scheduler,
      indicator: noopIndicator(),
      onError,
    });

    ap.start();
    await ap.tickOnce();
    try {
      expect(() => ap.flag()).not.toThrow();
      expect(onError).not.toHaveBeenCalled();
    } finally {
      localStorage.setItem = original;
    }
  });
});

describe("AutopilotController — ignoreReclaimKey (Shift+F must not reclaim)", () => {
  it("a keydown matching ignoreReclaimKey does not disengage the autopilot", () => {
    const handlers: ((e: KeyboardEvent) => void)[] = [];
    const spy = vi.spyOn(window, "addEventListener").mockImplementation(((
      type: string,
      handler: unknown,
    ) => {
      if (type === "keydown")
        handlers.push(handler as (e: KeyboardEvent) => void);
    }) as typeof window.addEventListener);

    const sch = makeFakeScheduler();
    const { controller } = makeController();
    const ap = new AutopilotController({
      observe: flightObs,
      policy: fixedPolicy({ kind: "wait" }),
      controller,
      scheduler: sch.scheduler,
      indicator: noopIndicator(),
      ignoreReclaimKey: (e) => e.shiftKey && e.key === "F",
    });

    try {
      ap.start();
      expect(ap.isEngaged).toBe(true);

      for (const h of handlers)
        h({ type: "keydown", shiftKey: true, key: "F" } as KeyboardEvent);
      expect(ap.isEngaged).toBe(true); // ignored — still engaged

      for (const h of handlers)
        h({ type: "keydown", key: "x" } as KeyboardEvent);
      expect(ap.isEngaged).toBe(false); // a genuine keydown still reclaims
    } finally {
      spy.mockRestore();
    }
  });
});

describe("AutopilotController — busy-latch timeout (live stuck-in-combat, 2026-07-29)", () => {
  it("releases the busy latch when an apply hangs forever: surfaces the timeout to onError and keeps flying", async () => {
    const sch = makeFakeScheduler();
    const decide = vi.fn(() => ({ kind: "land" }) as Action);
    const { controller } = makeController({
      land: () => new Promise<void>(() => {}),
    });
    const onError = vi.fn();
    const ap = new AutopilotController({
      observe: flightObs,
      policy: { name: "spy", decide },
      controller,
      scheduler: sch.scheduler,
      indicator: noopIndicator(),
      onError,
      tickTimeoutMs: 20,
    });

    ap.start();
    void ap.tickOnce(); // wedges on the hung land()
    await flush();
    expect(decide).toHaveBeenCalledTimes(1);

    await ap.tickOnce();
    expect(decide).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(onError).toHaveBeenCalledTimes(1);

    await ap.tickOnce(); // a fresh tick decides again — the pilot keeps flying
    expect(decide).toHaveBeenCalledTimes(2);
  });

  it("a fast apply never trips the timeout (no spurious onError)", async () => {
    const sch = makeFakeScheduler();
    const { controller } = makeController();
    const onError = vi.fn();
    const ap = new AutopilotController({
      observe: flightObs,
      policy: fixedPolicy({ kind: "wait" }),
      controller,
      scheduler: sch.scheduler,
      indicator: noopIndicator(),
      onError,
      tickTimeoutMs: 20,
    });

    ap.start();
    await ap.tickOnce();
    await new Promise((resolve) => setTimeout(resolve, 60)); // past the window
    expect(onError).not.toHaveBeenCalled();

    await ap.tickOnce(); // still flying normally
    expect(onError).not.toHaveBeenCalled();
  });
});

function noopIndicator(): AutopilotIndicator {
  return { show() {}, hide() {} };
}
