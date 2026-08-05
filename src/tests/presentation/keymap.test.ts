import { describe, it, expect } from "vitest";
import {
  DEFAULT_KEYMAP,
  FLIGHT_ACTIONS,
  resolveFlightAction,
  rebind,
  currentKeymap,
  setKeymap,
  resetKeymap,
  sanitizeKeymap,
  normalizeKey,
  keyEventMatches,
  keyLabel,
  KEYMAP_KEY,
  type FlightKeymap,
  type KeymapStore,
} from "@/presentation/input/keymap";

function memStore(initial: Record<string, string> = {}): KeymapStore {
  const data = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

const ev = (key: string, code?: string) => ({ key, code });

describe("keymap — defaults resolve like the old hard-coded handler", () => {
  it("maps Escape/Space/j/i to their actions", () => {
    expect(resolveFlightAction(ev("Escape"), DEFAULT_KEYMAP)).toBe("cancel");
    expect(resolveFlightAction(ev(" "), DEFAULT_KEYMAP)).toBe("runTurn");
    expect(resolveFlightAction(ev("j"), DEFAULT_KEYMAP)).toBe("journal");
    expect(resolveFlightAction(ev("i"), DEFAULT_KEYMAP)).toBe("inventory");
  });

  it("matches Space by event.code too (belt-and-suspenders, as before)", () => {
    expect(
      resolveFlightAction(ev("Unidentified", "Space"), DEFAULT_KEYMAP),
    ).toBe("runTurn");
  });

  it("matches the letter actions case-insensitively (J/I)", () => {
    expect(resolveFlightAction(ev("J"), DEFAULT_KEYMAP)).toBe("journal");
    expect(resolveFlightAction(ev("I"), DEFAULT_KEYMAP)).toBe("inventory");
  });

  it("returns null for an unbound key", () => {
    expect(resolveFlightAction(ev("q"), DEFAULT_KEYMAP)).toBeNull();
    expect(resolveFlightAction(ev("Enter"), DEFAULT_KEYMAP)).toBeNull();
  });

  it("covers every flight action with a distinct default key", () => {
    const keys = FLIGHT_ACTIONS.map((a) => normalizeKey(DEFAULT_KEYMAP[a]));
    expect(new Set(keys).size).toBe(FLIGHT_ACTIONS.length);
  });
});

describe("keymap — rebind + conflict detection (pure)", () => {
  it("rebinds an action to a free key without mutating the input", () => {
    const before = { ...DEFAULT_KEYMAP };
    const res = rebind(DEFAULT_KEYMAP, "journal", "q");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.map.journal).toBe("q");
      expect(resolveFlightAction(ev("q"), res.map)).toBe("journal");
      expect(resolveFlightAction(ev("j"), res.map)).toBeNull();
    }
    expect(DEFAULT_KEYMAP).toEqual(before); // input untouched
  });

  it("rejects a rebind onto a key another action already holds", () => {
    const res = rebind(DEFAULT_KEYMAP, "journal", "i"); // i = inventory
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.conflict).toBe("inventory");
  });

  it("conflict detection is case-insensitive for letters", () => {
    const res = rebind(DEFAULT_KEYMAP, "journal", "I");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.conflict).toBe("inventory");
  });

  it("rebinding an action to the key it already holds is a no-op success", () => {
    const res = rebind(DEFAULT_KEYMAP, "journal", "j");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.map.journal).toBe("j");
  });

  it("rejects an empty key", () => {
    const res = rebind(DEFAULT_KEYMAP, "journal", "");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.conflict).toBe("journal");
  });

  it("rebinds onto Space and resolves it by code afterwards", () => {
    const res = rebind(DEFAULT_KEYMAP, "journal", " ");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.conflict).toBe("runTurn");
  });
});

describe("keymap — persistence (injectable store, defaults intact)", () => {
  it("currentKeymap returns the defaults for an empty/absent store", () => {
    expect(currentKeymap(memStore())).toEqual(DEFAULT_KEYMAP);
    expect(currentKeymap(undefined)).toEqual(DEFAULT_KEYMAP);
  });

  it("setKeymap → currentKeymap round-trips a rebind", () => {
    const store = memStore();
    const res = rebind(DEFAULT_KEYMAP, "inventory", "b");
    expect(res.ok).toBe(true);
    if (res.ok) setKeymap(res.map, store);

    const loaded = currentKeymap(store);
    expect(loaded.inventory).toBe("b");
    expect(resolveFlightAction(ev("b"), loaded)).toBe("inventory");
    expect(loaded.cancel).toBe("Escape");
    expect(loaded.runTurn).toBe(" ");
  });

  it("a partial/corrupt stored map merges over the defaults", () => {
    expect(sanitizeKeymap({ journal: "q" })).toEqual({
      ...DEFAULT_KEYMAP,
      journal: "q",
    });
    expect(sanitizeKeymap({ journal: 42, inventory: "" })).toEqual(
      DEFAULT_KEYMAP,
    );
    expect(sanitizeKeymap(null)).toEqual(DEFAULT_KEYMAP);
  });

  it("a corrupt JSON blob degrades to the defaults", () => {
    const store = memStore({ [KEYMAP_KEY]: "{not json" });
    expect(currentKeymap(store)).toEqual(DEFAULT_KEYMAP);
  });

  it("resetKeymap writes the defaults back", () => {
    const store = memStore();
    const res = rebind(DEFAULT_KEYMAP, "journal", "q");
    if (res.ok) setKeymap(res.map, store);
    resetKeymap(store);
    expect(currentKeymap(store)).toEqual(DEFAULT_KEYMAP);
  });
});

describe("keymap — helpers", () => {
  it("normalizeKey lower-cases letters and maps legacy Spacebar", () => {
    expect(normalizeKey("J")).toBe("j");
    expect(normalizeKey("Spacebar")).toBe(" ");
    expect(normalizeKey("Escape")).toBe("Escape");
  });

  it("keyEventMatches handles Space by key or code", () => {
    expect(keyEventMatches(" ", ev(" "))).toBe(true);
    expect(keyEventMatches(" ", ev("Unidentified", "Space"))).toBe(true);
    expect(keyEventMatches("j", ev("J"))).toBe(true);
    expect(keyEventMatches("j", ev("k"))).toBe(false);
  });

  it("keyLabel produces player-facing labels", () => {
    expect(keyLabel(" ")).toBe("Пробел");
    expect(keyLabel("Escape")).toBe("Esc");
    expect(keyLabel("j")).toBe("J");
    expect(keyLabel("ArrowUp")).toBe("↑");
  });
});

describe("keymap — handler resolution after a rebind", () => {
  it("a remapped key fires the action and the old key goes quiet", () => {
    const map: FlightKeymap = (() => {
      const r = rebind(DEFAULT_KEYMAP, "inventory", "v");
      return r.ok ? r.map : DEFAULT_KEYMAP;
    })();
    expect(resolveFlightAction(ev("v"), map)).toBe("inventory");
    expect(resolveFlightAction(ev("i"), map)).toBeNull();
    expect(resolveFlightAction(ev("Escape"), map)).toBe("cancel");
  });
});
