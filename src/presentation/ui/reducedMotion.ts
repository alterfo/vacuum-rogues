export const REDUCED_MOTION_KEY = "reducedMotion";

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export interface ReducedMotionStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type MatchMedia = (query: string) => { matches: boolean };

export interface ReducedMotionEnv {
  store?: ReducedMotionStore;
  matchMedia?: MatchMedia;
}

function liveStore(): ReducedMotionStore | undefined {
  try {
    return typeof localStorage !== "undefined" ? localStorage : undefined;
  } catch {
    return undefined;
  }
}

function liveMatchMedia(): MatchMedia | undefined {
  try {
    return typeof window !== "undefined" &&
      typeof window.matchMedia === "function"
      ? (q: string) => window.matchMedia(q)
      : undefined;
  } catch {
    return undefined;
  }
}

export function liveEnv(): ReducedMotionEnv {
  return { store: liveStore(), matchMedia: liveMatchMedia() };
}

export function isReducedMotionSet(
  store: ReducedMotionStore | undefined = liveStore(),
): boolean {
  if (!store) return false;
  try {
    return store.getItem(REDUCED_MOTION_KEY) === "true";
  } catch {
    return false;
  }
}

export function setReducedMotion(
  on: boolean,
  store: ReducedMotionStore | undefined = liveStore(),
): void {
  if (!store) return;
  try {
    store.setItem(REDUCED_MOTION_KEY, on ? "true" : "false");
  } catch {
    // Best-effort.
  }
}

export function prefersReducedMotionMedia(
  matchMedia: MatchMedia | undefined = liveMatchMedia(),
): boolean {
  if (!matchMedia) return false;
  try {
    return matchMedia(REDUCED_MOTION_QUERY).matches === true;
  } catch {
    return false;
  }
}

export function reducedMotion(env: ReducedMotionEnv = liveEnv()): boolean {
  return (
    isReducedMotionSet(env.store) || prefersReducedMotionMedia(env.matchMedia)
  );
}
