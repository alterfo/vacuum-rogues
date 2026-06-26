import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  REDUCED_MOTION_KEY,
  REDUCED_MOTION_QUERY,
  isReducedMotionSet,
  setReducedMotion,
  prefersReducedMotionMedia,
  reducedMotion,
  liveEnv,
  type MatchMedia,
  type ReducedMotionStore,
} from "@/presentation/ui/reducedMotion";

/** An in-memory store for the explicit-setting cases (no jsdom dependency). */
function memStore(initial: Record<string, string> = {}): ReducedMotionStore {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

/** A `matchMedia` stub that reports `matches` for the reduce-motion query. */
function mm(matches: boolean): MatchMedia {
  return (query) => ({
    matches: query === REDUCED_MOTION_QUERY ? matches : false,
  });
}

describe("reducedMotion — explicit player setting", () => {
  it("defaults to off (false) when unset", () => {
    expect(isReducedMotionSet(memStore())).toBe(false);
  });

  it("round-trips the setting through the store", () => {
    const store = memStore();
    setReducedMotion(true, store);
    expect(store.getItem(REDUCED_MOTION_KEY)).toBe("true");
    expect(isReducedMotionSet(store)).toBe(true);

    setReducedMotion(false, store);
    expect(store.getItem(REDUCED_MOTION_KEY)).toBe("false");
    expect(isReducedMotionSet(store)).toBe(false);
  });

  it("reads any non-'true' stored value as off", () => {
    expect(isReducedMotionSet(memStore({ [REDUCED_MOTION_KEY]: "yes" }))).toBe(
      false,
    );
    expect(isReducedMotionSet(memStore({ [REDUCED_MOTION_KEY]: "1" }))).toBe(
      false,
    );
  });

  it("degrades to off when no store is available", () => {
    expect(isReducedMotionSet(undefined)).toBe(false);
  });

  it("degrades to off when the store throws", () => {
    const throwing: ReducedMotionStore = {
      getItem: () => {
        throw new Error("storage disabled");
      },
      setItem: () => {
        throw new Error("storage disabled");
      },
    };
    expect(isReducedMotionSet(throwing)).toBe(false);
    // setReducedMotion is best-effort: a throwing store must not propagate.
    expect(() => setReducedMotion(true, throwing)).not.toThrow();
  });
});

describe("reducedMotion — OS-level prefers-reduced-motion media query", () => {
  it("is true only when the reduce-motion media query matches", () => {
    expect(prefersReducedMotionMedia(mm(true))).toBe(true);
    expect(prefersReducedMotionMedia(mm(false))).toBe(false);
  });

  it("queries the exact (prefers-reduced-motion: reduce) media string", () => {
    const spy = vi.fn((_q: string) => ({ matches: true }));
    expect(prefersReducedMotionMedia(spy)).toBe(true);
    expect(spy).toHaveBeenCalledWith(REDUCED_MOTION_QUERY);
  });

  it("degrades to false when matchMedia is unavailable or throws", () => {
    expect(prefersReducedMotionMedia(undefined)).toBe(false);
    const throwing: MatchMedia = () => {
      throw new Error("no matchMedia");
    };
    expect(prefersReducedMotionMedia(throwing)).toBe(false);
  });
});

describe("reducedMotion — combined flag (setting OR media)", () => {
  it("is the OR of the setting and the media preference", () => {
    const off = { store: memStore(), matchMedia: mm(false) };
    const settingOnly = {
      store: memStore({ [REDUCED_MOTION_KEY]: "true" }),
      matchMedia: mm(false),
    };
    const mediaOnly = { store: memStore(), matchMedia: mm(true) };
    const both = {
      store: memStore({ [REDUCED_MOTION_KEY]: "true" }),
      matchMedia: mm(true),
    };

    expect(reducedMotion(off)).toBe(false);
    expect(reducedMotion(settingOnly)).toBe(true);
    expect(reducedMotion(mediaOnly)).toBe(true);
    expect(reducedMotion(both)).toBe(true);
  });

  it("degrades to false when neither signal is available", () => {
    expect(reducedMotion({})).toBe(false);
  });
});

describe("reducedMotion — live environment (jsdom)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("reads the live localStorage setting by default", () => {
    expect(reducedMotion({ matchMedia: mm(false) })).toBe(false);
    setReducedMotion(true);
    expect(isReducedMotionSet()).toBe(true);
    // Default env reads live localStorage; jsdom matchMedia reports no preference.
    expect(reducedMotion({ matchMedia: mm(false) })).toBe(true);
  });

  it("liveEnv snapshots a usable store from jsdom localStorage", () => {
    const env = liveEnv();
    expect(env.store).toBeDefined();
    setReducedMotion(true, env.store);
    expect(localStorage.getItem(REDUCED_MOTION_KEY)).toBe("true");
  });
});
