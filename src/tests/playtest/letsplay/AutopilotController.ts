import { applyLiveAction, type LiveSceneController } from "./LiveApplier";
import type { Observation } from "./observe";
import type { Action, PlayerPolicy } from "./PlayerPolicy";
import { type AgentMemory, createMemory, updateMemory } from "./AgentMemory";
import { flagOddity } from "./oddityFlags";

export const DEFAULT_AUTOPILOT_TICK_MS = 800;

export const DEFAULT_TICK_TIMEOUT_MS = 15_000;

export interface AutopilotScheduler {
  start(onTick: () => void, intervalMs: number): () => void;
}

export type HumanInputSource = (onInput: () => void) => () => void;

export interface AutopilotIndicator {
  show(): void;
  hide(): void;
}

export interface AutopilotDeps {
  readonly observe: () => Observation;
  readonly policy: PlayerPolicy;
  readonly controller: LiveSceneController;
  readonly scheduler?: AutopilotScheduler;
  readonly onHumanInput?: HumanInputSource;
  readonly ignoreReclaimKey?: (e: KeyboardEvent) => boolean;
  readonly indicator?: AutopilotIndicator;
  readonly tickIntervalMs?: number;
  readonly tickTimeoutMs?: number;
  readonly onError?: (err: unknown) => void;
  readonly isTerminal?: () => boolean;
}

function guard(fn: () => void, onError: (err: unknown) => void): void {
  try {
    fn();
  } catch (err) {
    onError(err);
  }
}

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

const defaultScheduler: AutopilotScheduler = {
  start(onTick, intervalMs) {
    const handle = setInterval(onTick, intervalMs);
    return () => clearInterval(handle);
  },
};

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

const noopIndicator: AutopilotIndicator = { show() {}, hide() {} };

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

export class AutopilotController {
  private engaged = false;
  private busy = false;
  private cancelTimer: (() => void) | null = null;
  private cancelInput: (() => void) | null = null;
  private memory: AgentMemory = createMemory();
  private step = 0;
  private lastObs: Observation | null = null;
  private lastAction: Action | null = null;

  private readonly observeFn: () => Observation;
  private readonly policy: PlayerPolicy;
  private readonly controller: LiveSceneController;
  private readonly scheduler: AutopilotScheduler;
  private readonly inputSource: HumanInputSource;
  private readonly indicator: AutopilotIndicator;
  private readonly intervalMs: number;
  private readonly tickTimeoutMs: number;
  private readonly onError: (err: unknown) => void;
  private readonly isTerminal: (() => boolean) | undefined;

  constructor(deps: AutopilotDeps) {
    this.observeFn = deps.observe;
    this.policy = deps.policy;
    this.controller = deps.controller;
    this.scheduler = deps.scheduler ?? defaultScheduler;
    this.inputSource =
      deps.onHumanInput ?? makeDefaultInputSource(deps.ignoreReclaimKey);
    this.indicator = deps.indicator ?? domIndicator();
    this.intervalMs = deps.tickIntervalMs ?? DEFAULT_AUTOPILOT_TICK_MS;
    this.tickTimeoutMs = deps.tickTimeoutMs ?? DEFAULT_TICK_TIMEOUT_MS;
    this.onError = deps.onError ?? (() => {});
    this.isTerminal = deps.isTerminal;
  }

  get isEngaged(): boolean {
    return this.engaged;
  }

  currentMemory(): AgentMemory {
    return this.memory;
  }

  resetMemory(): void {
    this.memory = createMemory();
  }

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

  async tickOnce(): Promise<void> {
    if (!this.engaged || this.busy) return;
    if (this.isTerminal?.()) {
      this.stop();
      return;
    }
    this.busy = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(
              `autopilot tick timed out after ${this.tickTimeoutMs}ms — releasing the busy latch`,
            ),
          ),
        this.tickTimeoutMs,
      );
    });
    try {
      await Promise.race([this.runTick(), timeout]);
    } catch (err) {
      this.onError(err);
    } finally {
      if (timer !== null) clearTimeout(timer);
      this.busy = false;
    }
  }

  private async runTick(): Promise<void> {
    if (await this.controller.dismissBlockingModal?.()) return;
    const obs = this.observeFn();
    this.memory = updateMemory(this.memory, obs);
    const action = this.policy.decide(obs, this.memory);
    this.lastObs = obs;
    this.lastAction = action;
    this.step += 1;
    await applyLiveAction(action, obs, this.controller);
  }

  flag(note?: string): void {
    if (!this.lastObs) return;
    guard(
      () => flagOddity(this.lastObs!, this.step, this.lastAction, note),
      this.onError,
    );
  }
}
