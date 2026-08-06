import {
  currentFontSizeKey,
  setFontScale,
  type FontSizeKey,
} from "@/utils/fontScale";
import { GAME_BALANCE } from "@/config/balance";

export const NEURAL_ENABLED_KEY = "neuralEnabled";

export const AUTO_COMBAT_ENABLED_KEY = "autoCombatEnabled";

export interface SettingsStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface SpeedTarget {
  gameSpeedMultiplier: number;
}

function liveStore(): SettingsStore | undefined {
  try {
    return typeof localStorage !== "undefined" ? localStorage : undefined;
  } catch {
    return undefined;
  }
}

export function getFontKey(): FontSizeKey {
  return currentFontSizeKey();
}

export function setFontKey(key: FontSizeKey): void {
  setFontScale(key);
}

export function getSpeed(target: SpeedTarget): number {
  return target.gameSpeedMultiplier;
}

export function setSpeed(target: SpeedTarget, value: number): void {
  const steps = GAME_BALANCE.gameSpeedMultipliers;
  target.gameSpeedMultiplier = (steps as readonly number[]).includes(value)
    ? value
    : GAME_BALANCE.gameSpeedDefault;
}

export type FeatureFlag = "neural" | "autoCombat";

export const FEATURE_FLAG_KEYS: Readonly<Record<FeatureFlag, string>> = {
  neural: NEURAL_ENABLED_KEY,
  autoCombat: AUTO_COMBAT_ENABLED_KEY,
};

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

export function isNeuralEnabled(
  store: SettingsStore | undefined = liveStore(),
): boolean {
  return isFeatureEnabled("neural", store);
}

export function setNeuralEnabled(
  on: boolean,
  store: SettingsStore | undefined = liveStore(),
): void {
  setFeatureEnabled("neural", on, store);
}

export function isAutoCombatEnabled(
  store: SettingsStore | undefined = liveStore(),
): boolean {
  return isFeatureEnabled("autoCombat", store);
}

export function setAutoCombatEnabled(
  on: boolean,
  store: SettingsStore | undefined = liveStore(),
): void {
  setFeatureEnabled("autoCombat", on, store);
}
