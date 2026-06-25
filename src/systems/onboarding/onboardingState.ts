// "Seen" persistence for the onboarding / contextual-help layer
// (`docs/plans/20260623-onboarding-and-contextual-help.md`).
//
// Browser-level `localStorage` only — the same kind of flag as `sr_settings` /
// `sr_mobile_ack`, so there is no save-schema/migration change and the set
// survives «Новая игра». The seen help keys are stored as a JSON string array
// under {@link HELP_SEEN_KEY}. The store is injectable so tests drive a fake
// without the real `localStorage`, and every access is wrapped in `typeof`/try-
// guards plus a JSON-shape guard: a runtime that lacks `localStorage`, has
// storage disabled, or holds malformed JSON degrades to "nothing seen" / no-op
// rather than throwing — at worst a first-time hint shows again, which is
// harmless.

import type { HelpKey } from "./helpContent";

/** localStorage key holding the JSON array of help keys the player has seen. */
export const HELP_SEEN_KEY = "sr_help_seen";

/** Minimal injectable view of the persistence store (a `Storage` subset). */
export interface OnboardingStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The live `localStorage`, or `undefined` when the runtime lacks it. */
function liveStore(): OnboardingStore | undefined {
  try {
    return typeof localStorage !== "undefined" ? localStorage : undefined;
  } catch {
    // Accessing `localStorage` can throw in sandboxed/disabled-storage contexts.
    return undefined;
  }
}

/**
 * Read the persisted seen-set as a string array, degrading to `[]` on any
 * problem (absent key, unreadable store, malformed/non-array JSON).
 */
function readSeen(store: OnboardingStore | undefined): string[] {
  if (!store) return [];
  try {
    const raw = store.getItem(HELP_SEEN_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

/**
 * True once the player has seen the first-time hint for `key`. Degrades to
 * `false` when storage is unavailable or unreadable (the hint may show again,
 * which is harmless).
 */
export function hasSeen(
  key: HelpKey,
  store: OnboardingStore | undefined = liveStore(),
): boolean {
  return readSeen(store).includes(key);
}

/**
 * Record that the player has now seen the first-time hint for `key`, so it
 * won't auto-show again. Idempotent; best-effort no-op when storage is
 * unavailable or write-blocked.
 */
export function markSeen(
  key: HelpKey,
  store: OnboardingStore | undefined = liveStore(),
): void {
  if (!store) return;
  try {
    const seen = readSeen(store);
    if (seen.includes(key)) return;
    seen.push(key);
    store.setItem(HELP_SEEN_KEY, JSON.stringify(seen));
  } catch {
    // Storage full / disabled — best-effort; the hint may reappear.
  }
}

/**
 * Clear every seen key so all first-time hints show again on next visit
 * (the «Показать обучение заново» replay control). Best-effort no-op when
 * storage is unavailable.
 */
export function resetSeen(
  store: OnboardingStore | undefined = liveStore(),
): void {
  if (!store) return;
  try {
    store.removeItem(HELP_SEEN_KEY);
  } catch {
    // Best-effort.
  }
}
