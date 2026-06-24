// Pure, injectable phone-class device detection for the soft mobile boot gate
// (`docs/plans/20260623-mobile-device-soft-gate.md`).
//
// The decision combines three signals — a coarse primary pointer
// (`matchMedia('(pointer: coarse)')`), a small viewport (`min(w,h) < 768`), and a
// phone user-agent hint — into the rule `coarse && (small || phoneUA)`: a
// touch-primary device that is either small-screened or self-identifies as a
// phone. This stays conservative on the borderline cases the plan calls out —
// large touchscreen laptops/hybrids and tablets (iPad) keep their fine/large
// profile and are *not* flagged — while a false positive remains harmless because
// the gate is soft (a «Всё равно продолжить» button always lets the visitor
// through).
//
// `env` is injectable so tests drive a device matrix without the real
// `window`/`navigator`; it defaults to the live globals, read through `typeof`
// guards so a bare Node import (Vitest) never throws. No PixiJS/DOM mutation —
// pure logic, unit-tested standalone.

/** Viewport edge (px) below which the *shorter* side counts as a small screen. */
export const MOBILE_MAX_VIEWPORT_PX = 768;

/**
 * Phone-class user-agent hint. Matches phones (iPhone/iPod, Android phones whose
 * UA carries the `Mobile` token, Windows Phone, BlackBerry, etc.) but **not**
 * tablets — an Android tablet UA omits `Mobile` and `iPad` is excluded — so
 * tablets fall back to the size/pointer gate and aren't over-flagged.
 */
const PHONE_UA_RE =
  /iphone|ipod|android.*mobile|windows phone|blackberry|bb10|iemobile|opera mini/i;

/** Injectable view of the runtime environment used by {@link isMobileDevice}. */
export interface DeviceEnv {
  readonly userAgent?: string;
  readonly matchMedia?: (query: string) => { matches: boolean };
  readonly innerWidth?: number;
  readonly innerHeight?: number;
  readonly maxTouchPoints?: number;
}

/** Snapshot the live `window`/`navigator`, tolerating a runtime that lacks them. */
function liveEnv(): DeviceEnv {
  const win = typeof window !== "undefined" ? window : undefined;
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  return {
    userAgent: nav?.userAgent,
    matchMedia:
      win && typeof win.matchMedia === "function"
        ? (q: string) => win.matchMedia(q)
        : undefined,
    innerWidth: win?.innerWidth,
    innerHeight: win?.innerHeight,
    maxTouchPoints: nav?.maxTouchPoints,
  };
}

/**
 * Coarse primary pointer. Prefers `matchMedia('(pointer: coarse)')`; when
 * `matchMedia` is unavailable (or throws) it degrades to a touch-capability
 * check via `maxTouchPoints`, and to `false` when nothing is knowable.
 */
function hasCoarsePointer(env: DeviceEnv): boolean {
  if (typeof env.matchMedia === "function") {
    try {
      return !!env.matchMedia("(pointer: coarse)").matches;
    } catch {
      // fall through to the touch-point fallback
    }
  }
  return (env.maxTouchPoints ?? 0) > 0;
}

/**
 * Small viewport: the shorter side is below {@link MOBILE_MAX_VIEWPORT_PX}.
 * Returns `false` when the dimensions are unknown/zero (degrade safely — an
 * unmeasurable screen is not assumed small).
 */
function hasSmallViewport(env: DeviceEnv): boolean {
  const w = env.innerWidth ?? 0;
  const h = env.innerHeight ?? 0;
  if (w <= 0 || h <= 0) return false;
  return Math.min(w, h) < MOBILE_MAX_VIEWPORT_PX;
}

/**
 * True for a phone-class device. Conservative by design: large touchscreen
 * laptops/hybrids and tablets keep their desktop profile and are not flagged.
 * Missing APIs degrade safely (toward "not mobile"). `env` defaults to the live
 * `window`/`navigator`.
 */
export function isMobileDevice(env: DeviceEnv = liveEnv()): boolean {
  const coarse = hasCoarsePointer(env);
  const small = hasSmallViewport(env);
  const phoneUA = PHONE_UA_RE.test(env.userAgent ?? "");
  return coarse && (small || phoneUA);
}
