export const MOBILE_MAX_VIEWPORT_PX = 768;

const PHONE_UA_RE =
  /iphone|ipod|android.*mobile|windows phone|blackberry|bb10|iemobile|opera mini/i;

export interface DeviceEnv {
  readonly userAgent?: string;
  readonly matchMedia?: (query: string) => { matches: boolean };
  readonly innerWidth?: number;
  readonly innerHeight?: number;
  readonly maxTouchPoints?: number;
}

export function liveEnv(): DeviceEnv {
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

export function hasCoarsePointer(env: DeviceEnv = liveEnv()): boolean {
  if (typeof env.matchMedia === "function") {
    try {
      return !!env.matchMedia("(pointer: coarse)").matches;
    } catch {
      // fall through to the touch-point fallback
    }
  }
  return (env.maxTouchPoints ?? 0) > 0;
}

function hasSmallViewport(env: DeviceEnv): boolean {
  const w = env.innerWidth ?? 0;
  const h = env.innerHeight ?? 0;
  if (w <= 0 || h <= 0) return false;
  return Math.min(w, h) < MOBILE_MAX_VIEWPORT_PX;
}

export function isMobileDevice(env: DeviceEnv = liveEnv()): boolean {
  const coarse = hasCoarsePointer(env);
  const small = hasSmallViewport(env);
  const phoneUA = PHONE_UA_RE.test(env.userAgent ?? "");
  return coarse && (small || phoneUA);
}
