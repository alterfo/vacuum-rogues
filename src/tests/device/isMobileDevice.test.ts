import { describe, it, expect } from "vitest";
import {
  isMobileDevice,
  MOBILE_MAX_VIEWPORT_PX,
  type DeviceEnv,
} from "@/systems/device/isMobileDevice";

const UA = {
  iphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  androidPhone:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36",
  androidTablet:
    "Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  ipad: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/604.1",
  desktop:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
} as const;

function env(opts: {
  ua?: string;
  coarse?: boolean;
  w?: number;
  h?: number;
  touch?: number;
  noMatchMedia?: boolean;
}): DeviceEnv {
  return {
    userAgent: opts.ua,
    matchMedia: opts.noMatchMedia
      ? undefined
      : (q: string) => ({
          matches: q.includes("coarse") ? !!opts.coarse : false,
        }),
    innerWidth: opts.w,
    innerHeight: opts.h,
    maxTouchPoints: opts.touch,
  };
}

describe("isMobileDevice — phone-class detection", () => {
  it("flags a phone: coarse pointer + small viewport + phone UA", () => {
    expect(
      isMobileDevice(env({ ua: UA.iphone, coarse: true, w: 390, h: 844 })),
    ).toBe(true);
    expect(
      isMobileDevice(
        env({ ua: UA.androidPhone, coarse: true, w: 412, h: 915 }),
      ),
    ).toBe(true);
  });

  it("does not flag a desktop: fine pointer + large viewport + desktop UA", () => {
    expect(
      isMobileDevice(env({ ua: UA.desktop, coarse: false, w: 1920, h: 1080 })),
    ).toBe(false);
  });

  it("is conservative on a large touchscreen / hybrid laptop (coarse but large + desktop UA)", () => {
    expect(
      isMobileDevice(env({ ua: UA.desktop, coarse: true, w: 1920, h: 1080 })),
    ).toBe(false);
  });

  it("is conservative on tablets — large iPad / Android tablet are not flagged", () => {
    expect(
      isMobileDevice(env({ ua: UA.ipad, coarse: true, w: 1024, h: 1366 })),
    ).toBe(false);
    expect(
      isMobileDevice(
        env({ ua: UA.androidTablet, coarse: true, w: 1280, h: 800 }),
      ),
    ).toBe(false);
  });

  it("treats the 768px shorter-side boundary as not-small (exclusive)", () => {
    expect(
      isMobileDevice(
        env({
          ua: UA.desktop,
          coarse: true,
          w: 1024,
          h: MOBILE_MAX_VIEWPORT_PX,
        }),
      ),
    ).toBe(false);
    expect(
      isMobileDevice(
        env({
          ua: UA.desktop,
          coarse: true,
          w: 1024,
          h: MOBILE_MAX_VIEWPORT_PX - 1,
        }),
      ),
    ).toBe(true);
  });

  it("flags a phone-UA touch device even when the reported viewport is large (desktop-mode request)", () => {
    expect(
      isMobileDevice(
        env({ ua: UA.androidPhone, coarse: true, w: 1280, h: 800 }),
      ),
    ).toBe(true);
  });

  it("requires a coarse pointer — a fine-pointer device with a small window is not mobile", () => {
    expect(
      isMobileDevice(env({ ua: UA.desktop, coarse: false, w: 600, h: 700 })),
    ).toBe(false);
  });

  it("a phone UA with a fine pointer is not mobile — the coarse gate short-circuits the UA path", () => {
    expect(
      isMobileDevice(env({ ua: UA.iphone, coarse: false, w: 390, h: 844 })),
    ).toBe(false);
  });

  it("uses the shorter side for the small-viewport test (landscape phone: width is the short side)", () => {
    expect(
      isMobileDevice(
        env({
          ua: UA.desktop,
          coarse: true,
          w: MOBILE_MAX_VIEWPORT_PX - 1,
          h: 1024,
        }),
      ),
    ).toBe(true);
  });

  describe("degraded environments", () => {
    it("falls back to maxTouchPoints when matchMedia is absent", () => {
      expect(
        isMobileDevice(
          env({
            ua: UA.iphone,
            noMatchMedia: true,
            touch: 5,
            w: 390,
            h: 844,
          }),
        ),
      ).toBe(true);
    });

    it("degrades safely to false when nothing is knowable (no matchMedia, no touch, no dims, no UA)", () => {
      expect(isMobileDevice({})).toBe(false);
    });

    it("does not throw when matchMedia throws — falls back to touch points", () => {
      const throwingEnv: DeviceEnv = {
        userAgent: UA.iphone,
        matchMedia: () => {
          throw new Error("matchMedia unavailable");
        },
        innerWidth: 390,
        innerHeight: 844,
        maxTouchPoints: 5,
      };
      expect(() => isMobileDevice(throwingEnv)).not.toThrow();
      expect(isMobileDevice(throwingEnv)).toBe(true);
    });

    it("missing viewport dimensions are treated as not-small (no over-trigger from absent dims)", () => {
      expect(isMobileDevice(env({ ua: UA.iphone, coarse: true }))).toBe(true);
      expect(isMobileDevice(env({ ua: UA.desktop, coarse: true }))).toBe(false);
    });
  });
});
