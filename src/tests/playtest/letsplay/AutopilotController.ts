/**
 * Dev-only autopilot — the controller (observe → decide → apply on a timer).
 *
 * Where the headless {@link PlayerAgent} plays the *real* engine through the
 * harness as fast as a test loop can drive it, the **autopilot** plays the
 * *live, rendered* game at a human-watchable pace. The {@link AutopilotController}
 * closes that loop: while engaged it periodically `observe`s the live engine,
 * asks its {@link PlayerPolicy} to `decide`, and applies the chosen {@link Action}
 * onto the live scene via {@link applyLiveAction} over a {@link LiveSceneController}
 * port — `observe → decide → apply`, once per tick.
 *
 * It is deliberately **pure logic over ports** so it never imports PixiJS / the
 * real scene and is unit-testable against a fake scene + clock:
 *  - `observe` is a thunk (live: `() => observe(engine)`), so the controller is
 *    decoupled from the concrete engine;
 *  - the recurring timer is the injectable {@link AutopilotScheduler} (live: a
 *    `setInterval` wrapper; test: a hand-driven fake clock);
 *  - human input arrives through the {@link HumanInputSource} port — the **first**
 *    real pointer/key press disengages the autopilot (reclaim-on-input), since the
 *    autopilot drives the scene through the port (never via synthesized DOM
 *    events), so only a genuine human event reaches the listeners;
 *  - the small "AUTOPILOT" overlay is the {@link AutopilotIndicator} port.
 *
 * For parity with {@link PlayerAgent} it carries a fresh per-engagement
 * {@link AgentMemory} and folds each observation into it before deciding, so a
 * belief-using policy (`MemoryHeuristicPolicy`) behaves identically here; the
 * default heuristic simply ignores it.
 *
 * Dev-only: lives under `src/tests/`, imported by no production module (enforced
 * by `letsplayDevOnly.test.ts`).
 */
import { applyLiveAction, type LiveSceneController } from "./LiveApplier";
import type { Observation } from "./observe";
import type { Action, PlayerPolicy } from "./PlayerPolicy";
import { type AgentMemory, createMemory, updateMemory } from "./AgentMemory";
import { flagOddity } from "./oddityFlags";

/** Default tick cadence — slow enough that a human can follow each decision. */
export const DEFAULT_AUTOPILOT_TICK_MS = 800;

/**
 * Recurring-timer port. The live wiring backs it with `setInterval`; a test backs
 * it with a hand-driven fake clock so ticks are deterministic. `start` begins
 * invoking `onTick` every `intervalMs` and returns a function that cancels it.
 */
export interface AutopilotScheduler {
  start(onTick: () => void, intervalMs: number): () => void;
}

/**
 * Human-input port for reclaim-on-input. `subscribe(onInput)` registers `onInput`
 * to fire on the first human pointer/key event and returns an unsubscribe. The
 * autopilot never synthesizes such events (it drives the scene through the
 * controller port), so any event reaching here is a genuine human take-over.
 */
export type HumanInputSource = (onInput: () => void) => () => void;

/** The tiny on-screen "AUTOPILOT" indicator port (shown while engaged). */
export interface AutopilotIndicator {
  show(): void;
  hide(): void;
}

/** Everything the {@link AutopilotController} needs; only the first three are required. */
export interface AutopilotDeps {
  /** Snapshot the live engine each tick (live: `() => observe(engine)`). */
  readonly observe: () => Observation;
  /** The brain choosing the next legal action. */
  readonly policy: PlayerPolicy;
  /** The port that drives the live scene with the chosen action. */
  readonly controller: LiveSceneController;
  /** Recurring timer; defaults to a `setInterval` wrapper. */
  readonly scheduler?: AutopilotScheduler;
  /** Human-input subscription; defaults to live `window` pointer/key listeners. */
  readonly onHumanInput?: HumanInputSource;
  /**
   * When the default input source is in use, a `keydown` matching this
   * predicate is excluded from reclaim-on-input (e.g. the silent `Shift+F`
   * oddity-flag hotkey should never disengage the autopilot). Ignored when
   * `onHumanInput` is supplied.
   */
  readonly ignoreReclaimKey?: (e: KeyboardEvent) => boolean;
  /** "AUTOPILOT" overlay; defaults to a DOM badge (no-op without a `document`). */
  readonly indicator?: AutopilotIndicator;
  /** Tick cadence (ms); defaults to {@link DEFAULT_AUTOPILOT_TICK_MS}. */
  readonly tickIntervalMs?: number;
  /** Sink for a swallowed decision/apply fault (live: `logger.warn`). */
  readonly onError?: (err: unknown) => void;
}

/** Run `fn`, routing any throw to `onError` instead of propagating. */
function guard(fn: () => void, onError: (err: unknown) => void): void {
  try {
    fn();
  } catch (err) {
    onError(err);
  }
}

/** Run `fn`, returning its result or `null` if it throws (routed to `onError`). */
function guardReturn<T>(
  fn: () => T,
  onError: (err: unknown) => void,
): T | null {
  try {
    return fn();
  } catch (err) {
    onError(err);
    return null;
  }
}

/** `setInterval`-backed scheduler — the default for the live build. */
const defaultScheduler: AutopilotScheduler = {
  start(onTick, intervalMs) {
    const handle = setInterval(onTick, intervalMs);
    return () => clearInterval(handle);
  },
};

/**
 * Live `window` input source — the first pointer/key/wheel/touch disengages the
 * autopilot. Degrades to a no-op without a `window` (e.g. under Vitest), so it is
 * safe as a default the controller resolves lazily. A `keydown` matching
 * `ignoreKey` (e.g. the oddity-flag hotkey) is excluded so flagging never stops
 * the autopilot.
 */
/** Bare modifier keys should never disengage the autopilot (Shift alone != Shift+F). */
const MODIFIER_ONLY_KEYS = new Set([
  "Shift",
  "Control",
  "Alt",
  "Meta",
  "CapsLock",
  "NumLock",
]);

function makeDefaultInputSource(
  ignoreKey?: (e: KeyboardEvent) => boolean,
): HumanInputSource {
  return (onInput) => {
    if (typeof window === "undefined") return () => {};
    const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    const handler = (e: Event): void => {
      if (e.type === "keydown") {
        const ke = e as KeyboardEvent;
        if (MODIFIER_ONLY_KEYS.has(ke.key)) return; // Shift alone ≠ Shift+F
        if (ignoreKey?.(ke)) return;
      }
      onInput();
    };
    for (const e of events)
      window.addEventListener(e, handler, { passive: true });
    return () => {
      for (const e of events) window.removeEventListener(e, handler);
    };
  };
}

/** A no-op indicator — used when no `document` is available (tests / Node). */
const noopIndicator: AutopilotIndicator = { show() {}, hide() {} };

/**
 * Default on-screen badge: a small fixed-position "АВТОПИЛОТ" pill toggled in the
 * DOM. Created lazily and only with a `document`, so it never touches the DOM at
 * import time and degrades to {@link noopIndicator} under Node / Vitest.
 */
function domIndicator(): AutopilotIndicator {
  if (typeof document === "undefined") return noopIndicator;
  let el: HTMLDivElement | null = null;
  const ensure = (): HTMLDivElement => {
    if (el) return el;
    el = document.createElement("div");
    el.id = "autopilot-indicator";
    el.textContent = "● АВТОПИЛОТ";
    el.style.cssText = [
      "position:fixed",
      "top:8px",
      "left:50%",
      "transform:translateX(-50%)",
      "z-index:99999",
      "padding:4px 12px",
      "border-radius:12px",
      "font:600 12px/1 monospace",
      "letter-spacing:1px",
      "color:#7CFC9A",
      "background:rgba(8,16,12,0.82)",
      "border:1px solid #2f7d4f",
      "pointer-events:none",
      "display:none",
    ].join(";");
    document.body.appendChild(el);
    return el;
  };
  return {
    show() {
      ensure().style.display = "block";
    },
    hide() {
      if (el) el.style.display = "none";
    },
  };
}

/**
 * The controller. Construct with at least `{ observe, policy, controller }`, then
 * {@link start}/{@link stop}. Engaged, it runs one {@link tickOnce} per scheduler
 * tick; any human input or an explicit {@link stop} disengages it.
 */
export class AutopilotController {
  private engaged = false;
  /** Re-entrancy guard so a slow async apply can't overlap the next tick. */
  private busy = false;
  private cancelTimer: (() => void) | null = null;
  private cancelInput: (() => void) | null = null;
  /** Fresh per engagement — a human handing the ship over starts a clean belief. */
  private memory: AgentMemory = createMemory();
  /** Ticks completed since the last `start()` — the `step` a flag is recorded at. */
  private step = 0;
  /** The most recent `observe()`/decision, kept for `flag()` (null before the first tick). */
  private lastObs: Observation | null = null;
  private lastAction: Action | null = null;

  private readonly observeFn: () => Observation;
  private readonly policy: PlayerPolicy;
  private readonly controller: LiveSceneController;
  private readonly scheduler: AutopilotScheduler;
  private readonly inputSource: HumanInputSource;
  private readonly indicator: AutopilotIndicator;
  private readonly intervalMs: number;
  private readonly onError: (err: unknown) => void;

  constructor(deps: AutopilotDeps) {
    this.observeFn = deps.observe;
    this.policy = deps.policy;
    this.controller = deps.controller;
    this.scheduler = deps.scheduler ?? defaultScheduler;
    this.inputSource =
      deps.onHumanInput ?? makeDefaultInputSource(deps.ignoreReclaimKey);
    this.indicator = deps.indicator ?? domIndicator();
    this.intervalMs = deps.tickIntervalMs ?? DEFAULT_AUTOPILOT_TICK_MS;
    this.onError = deps.onError ?? (() => {});
  }

  /** Whether the autopilot is currently flying the ship. */
  get isEngaged(): boolean {
    return this.engaged;
  }

  /**
   * The controller's live belief state. Exposed so the concrete
   * {@link LiveSceneController} (constructed before this controller, over the
   * same engine) can read the trading memory a `MemoryHeuristicPolicy` decide
   * just folded an observation into — e.g. `openTrade` needs the known
   * cross-planet margin to buy the right good, not just sell.
   */
  currentMemory(): AgentMemory {
    return this.memory;
  }

  /**
   * Force a fresh belief state without touching engagement/scheduler state
   * (unlike {@link start}, which also re-arms the timer/indicator). Exposed
   * for `installAutopilotHook` to call when it detects a new-game/galaxy
   * identity change while the autopilot stayed continuously engaged across it
   * (F6, live-session finding): a player who starts «Новая игра» WITHOUT first
   * disengaging the autopilot never calls `start()` again, so the stale
   * memory — poisoned counters like `consecutiveWarpsWithoutLanding`/
   * `foldsSinceDayAdvance` from the finished run — would otherwise carry into
   * the fresh game and can immediately arm a stagnation deadlock at day 0.
   */
  resetMemory(): void {
    this.memory = createMemory();
  }

  /**
   * Engage the autopilot: show the indicator, subscribe to reclaim-on-input, and
   * begin ticking. Idempotent — a second `start()` while engaged is a no-op.
   */
  start(): void {
    if (this.engaged) return;
    this.engaged = true;
    this.busy = false;
    this.memory = createMemory();
    this.step = 0;
    this.lastObs = null;
    this.lastAction = null;
    guard(() => this.indicator.show(), this.onError);
    this.cancelInput = guardReturn(
      () => this.inputSource(() => this.stop()),
      this.onError,
    );
    this.cancelTimer = guardReturn(
      () => this.scheduler.start(() => void this.tickOnce(), this.intervalMs),
      this.onError,
    );
  }

  /**
   * Disengage: cancel the timer + input subscription and hide the indicator.
   * Idempotent and the single reclaim path (called by `stop()` and by the
   * reclaim-on-input handler alike).
   */
  stop(): void {
    if (!this.engaged) return;
    this.engaged = false;
    if (this.cancelTimer) {
      guard(this.cancelTimer, this.onError);
      this.cancelTimer = null;
    }
    if (this.cancelInput) {
      guard(this.cancelInput, this.onError);
      this.cancelInput = null;
    }
    guard(() => this.indicator.hide(), this.onError);
  }

  /**
   * One `observe → remember → decide → apply` step. Public so a test (or the live
   * wiring) can drive a single step directly. **Never throws**: a fault in the
   * policy or applier is routed to `onError` and swallowed so the live game keeps
   * running and the next tick simply retries. A no-op when disengaged or while a
   * previous async apply is still in flight (the re-entrancy guard).
   */
  async tickOnce(): Promise<void> {
    if (!this.engaged || this.busy) return;
    this.busy = true;
    try {
      const obs = this.observeFn();
      this.memory = updateMemory(this.memory, obs);
      const action = this.policy.decide(obs, this.memory);
      this.lastObs = obs;
      this.lastAction = action;
      this.step += 1;
      await applyLiveAction(action, obs, this.controller);
    } catch (err) {
      this.onError(err);
    } finally {
      this.busy = false;
    }
  }

  /**
   * Record an oddity flag for the most recently observed/decided step (see
   * {@link flagOddity}). A no-op before the first tick (nothing observed yet)
   * — never throws, so a human calling this from the console can't crash the
   * autopilot.
   */
  flag(note?: string): void {
    if (!this.lastObs) return;
    guard(
      () => flagOddity(this.lastObs!, this.step, this.lastAction, note),
      this.onError,
    );
  }
}
