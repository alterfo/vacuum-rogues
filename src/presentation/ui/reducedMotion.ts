// Reduced-motion accessibility flag (accessibility pass,
// `docs/plans/20260625-accessibility-pass.md`, Task 2).
//
// `reducedMotion()` is the single source of truth for "should idle/decorative
// motion be damped". It is the logical **OR** of two signals:
//   • an explicit player **setting** — a browser-level `localStorage` flag
//     (`reducedMotion`, default `false`), the same class of client pref as
//     `fontScale`/`paletteMode`/`neuralEnabled`, so there is **no
//     save-schema/migration change**; and
//   • the OS-level **`matchMedia('(prefers-reduced-motion: reduce)')`** media
//     query (the boot loader's CSS already honours it — `src/index.html`).
//
// Either being true ⇒ reduced motion is active, so a player who has asked their
// OS to reduce motion gets it for free, and the in-game toggle can additionally
// force it on. Every storage/`matchMedia` access is `typeof`/try-guarded so a
// runtime without them (bare Node import / Vitest, storage-disabled browser)
// degrades to "not reduced" rather than throwing. `env` is injectable so the
// flag and its consumers are unit-testable without the live globals.
//
// Motion consumers read it through `reducedMotion()` and damp/disable their idle
// parallax + heavy particle animation when it is true (e.g.
// `SpaceBackgroundLayer.update`, `MainMenuScene.update`).

/** localStorage key holding the explicit reduced-motion player setting. */
export const REDUCED_MOTION_KEY = "reducedMotion";

/** The media query honoured for the OS-level reduce-motion preference. */
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** Minimal injectable persistence store (a `Storage` subset). */
export interface ReducedMotionStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Minimal injectable `matchMedia` view (only `.matches` is read). */
export type MatchMedia = (query: string) => { matches: boolean };

/** Injectable view of the runtime environment used by {@link reducedMotion}. */
export interface ReducedMotionEnv {
  store?: ReducedMotionStore;
  matchMedia?: MatchMedia;
}

/** The live `localStorage`, or `undefined` when the runtime lacks it. */
function liveStore(): ReducedMotionStore | undefined {
  try {
    return typeof localStorage !== "undefined" ? localStorage : undefined;
  } catch {
    // Accessing `localStorage` can throw in sandboxed/disabled-storage contexts.
    return undefined;
  }
}

/** The live `window.matchMedia`, or `undefined` when the runtime lacks it. */
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

/** Snapshot the live `window`/`localStorage`, tolerating a runtime that lacks them. */
export function liveEnv(): ReducedMotionEnv {
  return { store: liveStore(), matchMedia: liveMatchMedia() };
}

// ---------------------------------------------------------------------------
// The explicit player setting — localStorage("reducedMotion"), default off
// ---------------------------------------------------------------------------

/**
 * True when the player has explicitly enabled reduced motion. Defaults to
 * **false** — a fresh/never-set store, any non-`"true"` value, and an
 * unavailable/unreadable store all read as off. Pure given an injected `store`.
 */
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

/**
 * Persist the reduced-motion setting. Best-effort no-op when storage is
 * unavailable or write-blocked (a storage-disabled browser can't remember it).
 */
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

// ---------------------------------------------------------------------------
// The OS-level preference — matchMedia('(prefers-reduced-motion: reduce)')
// ---------------------------------------------------------------------------

/**
 * True when the OS/browser reports a reduce-motion preference. Degrades to
 * **false** when `matchMedia` is unavailable or throws. Pure given an injected
 * `matchMedia`.
 */
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

// ---------------------------------------------------------------------------
// The combined flag — the single read seam every motion consumer goes through
// ---------------------------------------------------------------------------

/**
 * Whether idle/decorative motion should be damped: the explicit player setting
 * **OR** the OS-level `prefers-reduced-motion` preference. Pure given an
 * injected `env`; defaults to the live globals.
 */
export function reducedMotion(env: ReducedMotionEnv = liveEnv()): boolean {
  return (
    isReducedMotionSet(env.store) || prefersReducedMotionMedia(env.matchMedia)
  );
}
