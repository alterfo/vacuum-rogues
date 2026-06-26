// Pure, viewport-driven responsive-layout helper for the mobile adaptation
// (`docs/plans/20260625-mobile-adaptation.md`, Phase 1).
//
// `layoutFor(viewport)` classifies a viewport into one of three layout modes and
// reports a UI scale + a minimum touch-target size, so panel builders read **one
// source of truth** for reflow/scaling instead of each hard-coding breakpoints.
// It is pure geometry (no `window`, no PixiJS, no device check) — the touch
// *capability* gate lives separately in {@link touchHitArea}, which combines this
// classification with a real coarse-pointer probe so a narrow **desktop** window
// is never given fat touch targets (the desktop path stays byte-for-byte
// unchanged).
//
// Breakpoints are taken on the **shorter** side (portrait-safe) and align with
// the soft-gate's `MOBILE_MAX_VIEWPORT_PX = 768`: a phone's short side is < 768,
// a tablet's is 768–1023 (e.g. iPad portrait = 768), desktop is ≥ 1024.

import {
  hasCoarsePointer,
  liveEnv,
  type DeviceEnv,
} from "@/systems/device/isMobileDevice";

export type LayoutMode = "desktop" | "tablet" | "phone";

/** Minimal viewport shape — `renderer.app.screen` satisfies it. */
export interface Viewport {
  readonly width: number;
  readonly height: number;
}

export interface ResponsiveLayout {
  /** Coarse layout bucket, classified on the shorter viewport side. */
  readonly mode: LayoutMode;
  /** Multiplier panels apply to fixed pixel dimensions (1.0 on desktop). */
  readonly uiScale: number;
  /** Minimum comfortable interactive size (px); 0 on desktop ⇒ no bump. */
  readonly minTarget: number;
  /** True for the touch-oriented layouts (tablet/phone) — i.e. `mode !== "desktop"`. */
  readonly touch: boolean;
}

/** Shorter side (px) below which a viewport is a **phone** (mirrors the soft-gate). */
export const PHONE_MAX_SHORT_SIDE_PX = 768;
/** Shorter side (px) below which a viewport is a **tablet** (≥ this ⇒ desktop). */
export const TABLET_MAX_SHORT_SIDE_PX = 1024;

/** Comfortable minimum touch target (Apple HIG 44 / Material 48 → 44 px). */
export const MIN_TOUCH_TARGET_PX = 44;

/** Per-mode UI scale applied to fixed panel dimensions. */
export const UI_SCALE: Record<LayoutMode, number> = {
  desktop: 1.0,
  tablet: 0.9,
  phone: 0.8,
};

/**
 * Classify a viewport into a layout mode + UI scale + min touch-target.
 * Pure: identical output for identical input, no globals touched. A zero/unknown
 * dimension degrades to `desktop` (the safe, unchanged profile).
 */
export function layoutFor(viewport: Viewport): ResponsiveLayout {
  const w = viewport.width > 0 ? viewport.width : 0;
  const h = viewport.height > 0 ? viewport.height : 0;
  const short = w > 0 && h > 0 ? Math.min(w, h) : Number.POSITIVE_INFINITY;

  const mode: LayoutMode =
    short < PHONE_MAX_SHORT_SIDE_PX
      ? "phone"
      : short < TABLET_MAX_SHORT_SIDE_PX
        ? "tablet"
        : "desktop";

  const touch = mode !== "desktop";
  return {
    mode,
    uiScale: UI_SCALE[mode],
    minTarget: touch ? MIN_TOUCH_TARGET_PX : 0,
    touch,
  };
}

/** Read the live `window` viewport (degrades to 0×0 ⇒ desktop when unavailable). */
export function liveViewport(env: DeviceEnv = liveEnv()): Viewport {
  return { width: env.innerWidth ?? 0, height: env.innerHeight ?? 0 };
}

/**
 * True when comfortable touch controls should be active: the viewport is a
 * touch layout (tablet/phone) **and** the device has a coarse primary pointer.
 * This is the single gate shared by {@link touchHitArea} (fat hit rects) and the
 * on-screen flight controls (Phase 2) — so a narrow *desktop* window is never
 * given touch chrome (the desktop path stays byte-for-byte unchanged). `env` is
 * injectable for tests; it defaults to the live `window`/`navigator`.
 */
export function isTouchLayoutActive(env: DeviceEnv = liveEnv()): boolean {
  return layoutFor(liveViewport(env)).touch && hasCoarsePointer(env);
}

/** An axis-aligned hit rectangle (PixiJS `Rectangle`-shaped, but plain data). */
export interface HitArea {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The hit rectangle for an interactive element of visual size `w`×`h`.
 *
 * On a **non-touch** runtime (desktop, or Node/Vitest) this returns the element's
 * exact bounds `{0, 0, w, h}` — so existing callers are byte-for-byte unchanged.
 * On a **touch-primary** device whose viewport is a touch layout, the rectangle is
 * grown to at least `minTarget` on each axis and **re-centred** on the visual
 * element, so a tap landing just outside a small button still registers without
 * moving what's drawn.
 *
 * `env` is injectable for tests; it defaults to the live `window`/`navigator`.
 */
export function touchHitArea(
  w: number,
  h: number,
  env: DeviceEnv = liveEnv(),
): HitArea {
  if (!isTouchLayoutActive(env)) {
    return { x: 0, y: 0, width: w, height: h };
  }
  const layout = layoutFor(liveViewport(env));
  const tw = Math.max(w, layout.minTarget);
  const th = Math.max(h, layout.minTarget);
  return { x: (w - tw) / 2, y: (h - th) / 2, width: tw, height: th };
}
