/**
 * Live oddity flagging — player → oracle feedback loop (Task 7).
 *
 * While watching the live autopilot fly the game, a human can flag a moment
 * that looks wrong (`window.__autopilot.flag("описание")` in the console, or
 * the silent `Shift+F` hotkey). Each flag is a snapshot of what the agent saw
 * and did right then — `{ timestamp, step, scene, obs, lastAction, note? }` —
 * persisted to a rolling `localStorage` list so a session's flags survive a
 * page reload and can be exported for analysis or, longer-term, folded into
 * the training dataset as negative examples (what the teacher should NOT do).
 *
 * Pure + storage-guarded like `keymap.ts`/`fontScale.ts`: every access is
 * try-guarded and degrades to a no-op/empty-array when `localStorage` is
 * unavailable (SSR, a locked-down browser, or a headless test).
 */
import type { SceneType } from "@/types";
import type { Observation } from "./observe";
import type { Action } from "./PlayerPolicy";

/** One flagged moment: what the agent observed/did, and (optionally) why. */
export interface OddityFlagEntry {
  readonly timestamp: number;
  readonly step: number;
  readonly scene: SceneType;
  readonly obs: Observation;
  readonly lastAction: Action | null;
  readonly note?: string;
}

/** Minimal injectable persistence store (a `Storage` subset). */
export interface OddityFlagStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** localStorage key holding the rolling flag list (JSON array). */
export const ODDITY_FLAGS_KEY = "autopilot_oddity_flags";

/** Oldest entries roll off once the list exceeds this size. */
export const MAX_ODDITY_FLAGS = 100;

/** The live `localStorage`, or `undefined` when the runtime lacks it. */
function liveStore(): OddityFlagStore | undefined {
  try {
    return typeof localStorage !== "undefined" ? localStorage : undefined;
  } catch {
    return undefined;
  }
}

function readFrom(store: OddityFlagStore | undefined): OddityFlagEntry[] {
  if (!store) return [];
  try {
    const raw = store.getItem(ODDITY_FLAGS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as OddityFlagEntry[]) : [];
  } catch {
    return [];
  }
}

/**
 * Record a flag for `obs`/`step`/`lastAction`, rolling the oldest entry off
 * past {@link MAX_ODDITY_FLAGS}. Best-effort no-op when storage is unavailable
 * or the write fails (a storage-disabled browser simply can't remember it).
 */
export function flagOddity(
  obs: Observation,
  step: number,
  lastAction: Action | null,
  note?: string,
  store: OddityFlagStore | undefined = liveStore(),
): void {
  if (!store) return;
  const entry: OddityFlagEntry = {
    timestamp: Date.now(),
    step,
    scene: obs.scene,
    obs,
    lastAction,
    ...(note !== undefined ? { note } : {}),
  };
  try {
    const next = [...readFrom(store), entry].slice(-MAX_ODDITY_FLAGS);
    store.setItem(ODDITY_FLAGS_KEY, JSON.stringify(next));
  } catch {
    // Best-effort — a full/blocked store just drops this flag.
  }
}

/** All flags currently stored, oldest first. Empty when storage is unavailable. */
export function readFlags(
  store: OddityFlagStore | undefined = liveStore(),
): OddityFlagEntry[] {
  return readFrom(store);
}

/** Clear every stored flag. Best-effort no-op without storage. */
export function clearFlags(
  store: OddityFlagStore | undefined = liveStore(),
): void {
  if (!store) return;
  try {
    store.removeItem(ODDITY_FLAGS_KEY);
  } catch {
    // Best-effort.
  }
}

/** All flags serialized as JSON (for copy-paste export from the console). */
export function exportFlags(
  store: OddityFlagStore | undefined = liveStore(),
): string {
  return JSON.stringify(readFrom(store));
}
