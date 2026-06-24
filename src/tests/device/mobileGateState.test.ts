import { describe, it, expect } from "vitest";
import {
  wasDismissed,
  markDismissed,
  shouldShowMobileGate,
  MOBILE_ACK_KEY,
  type MobileGateStore,
} from "@/systems/device/mobileGateState";
import type { DeviceEnv } from "@/systems/device/isMobileDevice";

/** In-memory Storage subset for the persistence tests. */
function fakeStore(initial: Record<string, string> = {}): MobileGateStore & {
  map: Map<string, string>;
} {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    map,
    getItem: (k) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

/** Phone-class env (coarse + small + phone UA) used by the decision tests. */
const PHONE_ENV: DeviceEnv = {
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  matchMedia: (q: string) => ({ matches: q.includes("coarse") }),
  innerWidth: 390,
  innerHeight: 844,
};

/** Desktop env (fine pointer + large + desktop UA). */
const DESKTOP_ENV: DeviceEnv = {
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  matchMedia: () => ({ matches: false }),
  innerWidth: 1920,
  innerHeight: 1080,
};

describe("mobileGateState — dismissed flag persistence", () => {
  it("starts not-dismissed on a fresh store", () => {
    expect(wasDismissed(fakeStore())).toBe(false);
  });

  it("markDismissed persists, and wasDismissed reads it back", () => {
    const store = fakeStore();
    markDismissed(store);
    expect(store.map.get(MOBILE_ACK_KEY)).toBe("1");
    expect(wasDismissed(store)).toBe(true);
  });

  it("ignores an unrelated/garbage value under the key (only exact ack counts)", () => {
    expect(wasDismissed(fakeStore({ [MOBILE_ACK_KEY]: "0" }))).toBe(false);
    expect(wasDismissed(fakeStore({ [MOBILE_ACK_KEY]: "true" }))).toBe(false);
  });

  describe("degraded storage", () => {
    it("wasDismissed degrades to false when the store is undefined", () => {
      expect(wasDismissed(undefined)).toBe(false);
    });

    it("markDismissed is a no-op (does not throw) when the store is undefined", () => {
      expect(() => markDismissed(undefined)).not.toThrow();
    });

    it("does not throw when getItem/setItem throw", () => {
      const throwing: MobileGateStore = {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
      };
      expect(() => markDismissed(throwing)).not.toThrow();
      expect(wasDismissed(throwing)).toBe(false);
    });
  });
});

describe("shouldShowMobileGate — boot decision", () => {
  it("shows on a mobile device that has not dismissed", () => {
    expect(shouldShowMobileGate(PHONE_ENV, fakeStore())).toBe(true);
  });

  it("does not show on a desktop device", () => {
    expect(shouldShowMobileGate(DESKTOP_ENV, fakeStore())).toBe(false);
  });

  it("does not show on mobile after the notice was dismissed", () => {
    const store = fakeStore();
    markDismissed(store);
    expect(shouldShowMobileGate(PHONE_ENV, store)).toBe(false);
  });

  it("still does not show on a dismissed desktop (both gates closed)", () => {
    const store = fakeStore();
    markDismissed(store);
    expect(shouldShowMobileGate(DESKTOP_ENV, store)).toBe(false);
  });
});
