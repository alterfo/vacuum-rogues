import {
  hasCoarsePointer,
  liveEnv,
  type DeviceEnv,
} from "@/systems/device/isMobileDevice";

export type LayoutMode = "desktop" | "tablet" | "phone";

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

export interface ResponsiveLayout {
  readonly mode: LayoutMode;
  readonly uiScale: number;
  readonly minTarget: number;
  readonly touch: boolean;
}

export const PHONE_MAX_SHORT_SIDE_PX = 768;
export const TABLET_MAX_SHORT_SIDE_PX = 1024;

export const MIN_TOUCH_TARGET_PX = 44;

export const UI_SCALE: Record<LayoutMode, number> = {
  desktop: 1.0,
  tablet: 0.9,
  phone: 0.8,
};

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

export function liveViewport(env: DeviceEnv = liveEnv()): Viewport {
  return { width: env.innerWidth ?? 0, height: env.innerHeight ?? 0 };
}

export function isTouchLayoutActive(env: DeviceEnv = liveEnv()): boolean {
  return layoutFor(liveViewport(env)).touch && hasCoarsePointer(env);
}

export interface HitArea {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

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
