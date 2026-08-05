import { describe, it, expect } from "vitest";
import {
  hasSeen,
  markSeen,
  resetSeen,
  HELP_SEEN_KEY,
  type OnboardingStore,
} from "@/systems/onboarding/onboardingState";

function fakeStore(initial: Record<string, string> = {}): OnboardingStore & {
  map: Map<string, string>;
} {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    map,
    getItem: (k) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

describe("onboardingState — 'seen' help-key persistence", () => {
  it("an unseen key reads as not-seen on a fresh store", () => {
    expect(hasSeen("welcome", fakeStore())).toBe(false);
  });

  it("markSeen persists, and hasSeen reads it back", () => {
    const store = fakeStore();
    markSeen("welcome", store);
    expect(hasSeen("welcome", store)).toBe(true);
    expect(JSON.parse(store.map.get(HELP_SEEN_KEY) as string)).toEqual([
      "welcome",
    ]);
  });

  it("tracks multiple keys independently and persists across reads", () => {
    const store = fakeStore();
    markSeen("welcome", store);
    markSeen("PLANET", store);
    expect(hasSeen("welcome", store)).toBe(true);
    expect(hasSeen("PLANET", store)).toBe(true);
    expect(hasSeen("TRADE", store)).toBe(false);
  });

  it("markSeen is idempotent (no duplicate entries)", () => {
    const store = fakeStore();
    markSeen("welcome", store);
    markSeen("welcome", store);
    expect(JSON.parse(store.map.get(HELP_SEEN_KEY) as string)).toEqual([
      "welcome",
    ]);
  });

  it("resetSeen clears every seen key", () => {
    const store = fakeStore();
    markSeen("welcome", store);
    markSeen("PLANET", store);
    resetSeen(store);
    expect(hasSeen("welcome", store)).toBe(false);
    expect(hasSeen("PLANET", store)).toBe(false);
  });

  describe("malformed / absent JSON degrades to empty", () => {
    it("absent key reads as not-seen", () => {
      expect(hasSeen("welcome", fakeStore())).toBe(false);
    });

    it("corrupt JSON degrades to not-seen (does not throw)", () => {
      const store = fakeStore({ [HELP_SEEN_KEY]: "{not json" });
      expect(() => hasSeen("welcome", store)).not.toThrow();
      expect(hasSeen("welcome", store)).toBe(false);
    });

    it("non-array JSON (object/number/string) degrades to not-seen", () => {
      expect(
        hasSeen("welcome", fakeStore({ [HELP_SEEN_KEY]: '{"a":1}' })),
      ).toBe(false);
      expect(hasSeen("welcome", fakeStore({ [HELP_SEEN_KEY]: "42" }))).toBe(
        false,
      );
      expect(
        hasSeen("welcome", fakeStore({ [HELP_SEEN_KEY]: '"welcome"' })),
      ).toBe(false);
    });

    it("markSeen recovers from corrupt JSON by starting a fresh set", () => {
      const store = fakeStore({ [HELP_SEEN_KEY]: "garbage" });
      markSeen("welcome", store);
      expect(hasSeen("welcome", store)).toBe(true);
      expect(JSON.parse(store.map.get(HELP_SEEN_KEY) as string)).toEqual([
        "welcome",
      ]);
    });
  });

  describe("degraded storage", () => {
    it("hasSeen degrades to false when the store is undefined", () => {
      expect(hasSeen("welcome", undefined)).toBe(false);
    });

    it("markSeen / resetSeen are no-ops (do not throw) when undefined", () => {
      expect(() => markSeen("welcome", undefined)).not.toThrow();
      expect(() => resetSeen(undefined)).not.toThrow();
    });

    it("does not throw when getItem/setItem/removeItem throw", () => {
      const throwing: OnboardingStore = {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
        removeItem: () => {
          throw new Error("blocked");
        },
      };
      expect(() => markSeen("welcome", throwing)).not.toThrow();
      expect(() => resetSeen(throwing)).not.toThrow();
      expect(hasSeen("welcome", throwing)).toBe(false);
    });
  });
});
