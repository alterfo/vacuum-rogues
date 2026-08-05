import type { SceneType } from "@/types";
import type { Observation } from "./observe";
import type { Action } from "./PlayerPolicy";

export interface OddityFlagEntry {
  readonly timestamp: number;
  readonly step: number;
  readonly scene: SceneType;
  readonly obs: Observation;
  readonly lastAction: Action | null;
  readonly note?: string;
}

export interface OddityFlagStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const ODDITY_FLAGS_KEY = "autopilot_oddity_flags";

export const MAX_ODDITY_FLAGS = 100;

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

export function readFlags(
  store: OddityFlagStore | undefined = liveStore(),
): OddityFlagEntry[] {
  return readFrom(store);
}

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

export function exportFlags(
  store: OddityFlagStore | undefined = liveStore(),
): string {
  return JSON.stringify(readFrom(store));
}
