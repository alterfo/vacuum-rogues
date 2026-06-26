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
// Neural-AI flag — localStorage("neuralEnabled"), default false
// ---------------------------------------------------------------------------

/**
 * True when the player has opted into the (experimental) neural AI. Defaults to
 * **false** — a fresh/never-set store, and any non-`"true"` value, read as off.
 * Degrades to `false` when storage is unavailable or unreadable.
 */
export function isNeuralEnabled(
  store: SettingsStore | undefined = liveStore(),
): boolean {
  if (!store) return false;
  try {
    return store.getItem(NEURAL_ENABLED_KEY) === "true";
  } catch {
    return false;
  }
}

/**
 * Persist the neural-AI flag. No-op (best-effort) when storage is unavailable or
 * write-blocked.
 */
export function setNeuralEnabled(
  on: boolean,
  store: SettingsStore | undefined = liveStore(),
): void {
  if (!store) return;
  try {
    store.setItem(NEURAL_ENABLED_KEY, on ? "true" : "false");
  } catch {
    // Best-effort: a storage-disabled browser simply can't remember the choice.
  }
}
