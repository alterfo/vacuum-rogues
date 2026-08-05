import { describe, it, expect, afterEach, vi } from "vitest";
import { SceneType } from "@/types";
import {
  flagOddity,
  readFlags,
  clearFlags,
  exportFlags,
  ODDITY_FLAGS_KEY,
  MAX_ODDITY_FLAGS,
  type OddityFlagStore,
} from "@/tests/playtest/letsplay/oddityFlags";
import type { Observation } from "@/tests/playtest/letsplay/observe";
import type { Action } from "@/tests/playtest/letsplay/PlayerPolicy";

function memStore(initial: Record<string, string> = {}): OddityFlagStore {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

function throwingStore(): OddityFlagStore {
  const boom = (): never => {
    throw new Error("storage blocked");
  };
  return { getItem: boom, setItem: boom, removeItem: boom };
}

function makeObs(overrides: Partial<Observation> = {}): Observation {
  return {
    scene: SceneType.SPACE_FLIGHT,
    hasPlayer: true,
    player: null,
    system: null,
    currentPlanet: null,
    npcs: [],
    hostiles: [],
    quests: [],
    legalActions: [],
    ...overrides,
  };
}

const moveAction: Action = { kind: "move" };

describe("oddityFlags — flagOddity/readFlags (injectable store)", () => {
  it("readFlags returns [] for an empty/absent store", () => {
    expect(readFlags(memStore())).toEqual([]);
  });

  it("flagOddity appends a correctly-shaped entry", () => {
    const store = memStore();
    flagOddity(makeObs(), 3, moveAction, "тень на радаре", store);

    const flags = readFlags(store);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({
      step: 3,
      scene: SceneType.SPACE_FLIGHT,
      lastAction: moveAction,
      note: "тень на радаре",
    });
    expect(typeof flags[0].timestamp).toBe("number");
  });

  it("flagOddity accepts a null lastAction and an omitted note", () => {
    const store = memStore();
    flagOddity(makeObs(), 0, null, undefined, store);

    const flags = readFlags(store);
    expect(flags[0].lastAction).toBeNull();
    expect(flags[0].note).toBeUndefined();
  });

  it("appends across multiple calls, preserving order", () => {
    const store = memStore();
    flagOddity(makeObs(), 1, null, "first", store);
    flagOddity(makeObs(), 2, null, "second", store);

    const flags = readFlags(store);
    expect(flags.map((f) => f.note)).toEqual(["first", "second"]);
  });

  it("caps at MAX_ODDITY_FLAGS, rolling the oldest entries off", () => {
    const store = memStore();
    for (let step = 0; step < MAX_ODDITY_FLAGS + 5; step++) {
      flagOddity(makeObs(), step, null, undefined, store);
    }

    const flags = readFlags(store);
    expect(flags).toHaveLength(MAX_ODDITY_FLAGS);
    expect(flags[0].step).toBe(5);
    expect(flags[flags.length - 1].step).toBe(MAX_ODDITY_FLAGS + 4);
  });

  it("clearFlags empties the store", () => {
    const store = memStore();
    flagOddity(makeObs(), 1, null, undefined, store);
    expect(readFlags(store)).toHaveLength(1);

    clearFlags(store);
    expect(readFlags(store)).toEqual([]);
  });

  it("exportFlags round-trips the stored entries as JSON", () => {
    const store = memStore();
    flagOddity(makeObs(), 1, null, "round-trip", store);

    const exported = exportFlags(store);
    expect(JSON.parse(exported)).toEqual(readFlags(store));
  });

  it("readFlags tolerates corrupt JSON in the store", () => {
    const store = memStore({ [ODDITY_FLAGS_KEY]: "{not json" });
    expect(readFlags(store)).toEqual([]);
  });

  it("readFlags tolerates a non-array value in the store", () => {
    const store = memStore({ [ODDITY_FLAGS_KEY]: JSON.stringify({ a: 1 }) });
    expect(readFlags(store)).toEqual([]);
  });

  it("degrades to a no-op/empty-array when every store call throws", () => {
    const store = throwingStore();
    expect(() => flagOddity(makeObs(), 1, null, "note", store)).not.toThrow();
    expect(readFlags(store)).toEqual([]);
    expect(() => clearFlags(store)).not.toThrow();
    expect(exportFlags(store)).toBe("[]");
  });
});

describe("oddityFlags — degrades gracefully without a real localStorage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("flagOddity/readFlags/clearFlags/exportFlags no-op without a global localStorage", () => {
    vi.stubGlobal("localStorage", undefined);

    expect(() => flagOddity(makeObs(), 1, null, "note")).not.toThrow();
    expect(readFlags()).toEqual([]);
    expect(() => clearFlags()).not.toThrow();
    expect(exportFlags()).toBe("[]");
  });
});
