// Unified settings accessor for the three player-facing controls surfaced by the
// settings panel: game **speed**, **font** size, and the **neural-AI** toggle
// (`docs/plans/20260625-settings-interface-speed-font-neural.md`).
//
// Each control delegates to its existing store — no new save-state field:
//   • speed → `GameEngine.gameSpeedMultiplier` (the runtime store the HUD reads),
//     validated against `GAME_BALANCE.gameSpeedMultipliers`;
//   • font  → `src/utils/fontScale.ts` (`localStorage("fontScale")`);
//   • neural → a browser-level `localStorage("neuralEnabled")` flag, **default
//     `false`** — the same class of client pref as `sr_settings`/`sr_mobile_ack`,
//     so there is no schema/migration change.
//
// The neural flag store is injectable and every access is `typeof`/try-guarded so
// a runtime without `localStorage` (bare Node import / Vitest, or storage-disabled
// browser) degrades to "off" / no-op rather than throwing.

import {
  currentFontSizeKey,
  setFontScale,
  type FontSizeKey,
} from "@/utils/fontScale";
import { GAME_BALANCE } from "@/config/balance";

/** localStorage key holding the neural-AI on/off flag. */
export const NEURAL_ENABLED_KEY = "neuralEnabled";

/** Minimal injectable view of the persistence store (a `Storage` subset). */
export interface SettingsStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * A speed sink — anything carrying a mutable `gameSpeedMultiplier`. `GameEngine`
 * satisfies this directly, so the accessor needs no engine import (testable with
 * a plain object).
 */
export interface SpeedTarget {
  gameSpeedMultiplier: number;
}

/** The live `localStorage`, or `undefined` when the runtime lacks it. */
function liveStore(): SettingsStore | undefined {
  try {
    return typeof localStorage !== "undefined" ? localStorage : undefined;
  } catch {
    // Accessing `localStorage` can throw in sandboxed/disabled-storage contexts.
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Font — delegates to fontScale.ts (localStorage("fontScale"))
// ---------------------------------------------------------------------------

/** Current font-size key (S/M/L), reading the `fontScale` store. */
export function getFontKey(): FontSizeKey {
  return currentFontSizeKey();
}

/** Persist a new font-size key through the `fontScale` store. */
export function setFontKey(key: FontSizeKey): void {
  setFontScale(key);
}

// ---------------------------------------------------------------------------
// Speed — delegates to the runtime engine store (GameEngine.gameSpeedMultiplier)
// ---------------------------------------------------------------------------

/** Current game-speed multiplier from the engine store. */
export function getSpeed(target: SpeedTarget): number {
  return target.gameSpeedMultiplier;
}

/**
 * Set the game-speed multiplier on the engine store. Values outside the
 * selectable steps (`GAME_BALANCE.gameSpeedMultipliers`) fall back to the
 * default, so the store can never hold an unknown multiplier.
 */
export function setSpeed(target: SpeedTarget, value: number): void {
  const steps = GAME_BALANCE.gameSpeedMultipliers;
  target.gameSpeedMultiplier = (steps as readonly number[]).includes(value)
    ? value
    : GAME_BALANCE.gameSpeedDefault;
}

// ---------------------------------------------------------------------------
// Feature flags — generalised on/off localStorage flags (neural is the first)
// ---------------------------------------------------------------------------

/**
 * Known experimental feature flags. **Neural-AI is the first** — add future
 * opt-in/experimental systems here so they share the same default-off,
 * storage-degrading gate (`isFeatureEnabled` / `setFeatureEnabled`).
 */
export type FeatureFlag = "neural";

/** The `localStorage` key holding each feature flag's `"true"`/`"false"`. */
export const FEATURE_FLAG_KEYS: Readonly<Record<FeatureFlag, string>> = {
  neural: NEURAL_ENABLED_KEY,
};

/**
 * True when an experimental {@link FeatureFlag} is enabled. Defaults to
 * **false** — a fresh/never-set store, any non-`"true"` value, and an
 * unavailable/unreadable store all read as off. Pure given an injected `store`.
 */
export function isFeatureEnabled(
  flag: FeatureFlag,
  store: SettingsStore | undefined = liveStore(),
): boolean {
  if (!store) return false;
  try {
    return store.getItem(FEATURE_FLAG_KEYS[flag]) === "true";
  } catch {
    return false;
  }
}

/**
 * Persist a {@link FeatureFlag}. Best-effort no-op when storage is unavailable
 * or write-blocked (a storage-disabled browser simply can't remember it).
 */
export function setFeatureEnabled(
  flag: FeatureFlag,
  on: boolean,
  store: SettingsStore | undefined = liveStore(),
): void {
  if (!store) return;
  try {
    store.setItem(FEATURE_FLAG_KEYS[flag], on ? "true" : "false");
  } catch {
    // Best-effort.
  }
}

// ---------------------------------------------------------------------------
// Neural-AI flag — the first feature flag (localStorage("neuralEnabled"), off)
// ---------------------------------------------------------------------------

/**
 * True when the player has opted into the (experimental) neural AI — the single
 * gate consulted before any neural policy runs (off ⇒ the heuristic path, no MLP
 * weights loaded). Defaults to **false**. Thin alias over
 * `isFeatureEnabled("neural", …)`.
 */
export function isNeuralEnabled(
  store: SettingsStore | undefined = liveStore(),
): boolean {
  return isFeatureEnabled("neural", store);
}

/**
 * Persist the neural-AI flag. Best-effort no-op when storage is unavailable or
 * write-blocked. Thin alias over `setFeatureEnabled("neural", …)`.
 */
export function setNeuralEnabled(
  on: boolean,
  store: SettingsStore | undefined = liveStore(),
): void {
  setFeatureEnabled("neural", on, store);
}
