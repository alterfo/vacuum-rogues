import { describe, it, expect, beforeEach } from "vitest";
import {
  getFontKey,
  setFontKey,
  getSpeed,
  setSpeed,
  isNeuralEnabled,
  setNeuralEnabled,
  NEURAL_ENABLED_KEY,
  type SettingsStore,
  type SpeedTarget,
} from "@/systems/settings/gameSettings";
import { GAME_BALANCE } from "@/config/balance";

/** In-memory Storage subset for the neural-flag persistence tests. */
function fakeStore(initial: Record<string, string> = {}): SettingsStore & {
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

describe("gameSettings — neural-AI flag (default off)", () => {
  it("defaults to false on a fresh store", () => {
    expect(isNeuralEnabled(fakeStore())).toBe(false);
  });

  it("setNeuralEnabled(true) persists, and isNeuralEnabled reads it back", () => {
    const store = fakeStore();
    setNeuralEnabled(true, store);
    expect(store.map.get(NEURAL_ENABLED_KEY)).toBe("true");
    expect(isNeuralEnabled(store)).toBe(true);
  });

  it("setNeuralEnabled(false) round-trips back to off", () => {
    const store = fakeStore();
    setNeuralEnabled(true, store);
    setNeuralEnabled(false, store);
    expect(isNeuralEnabled(store)).toBe(false);
  });

  it("treats any non-\"true\" value as off (only exact 'true' counts)", () => {
    expect(isNeuralEnabled(fakeStore({ [NEURAL_ENABLED_KEY]: "1" }))).toBe(
      false,
    );
    expect(isNeuralEnabled(fakeStore({ [NEURAL_ENABLED_KEY]: "yes" }))).toBe(
      false,
    );
    expect(isNeuralEnabled(fakeStore({ [NEURAL_ENABLED_KEY]: "" }))).toBe(
      false,
    );
  });

  describe("degraded storage", () => {
    it("isNeuralEnabled degrades to false when the store is undefined", () => {
      expect(isNeuralEnabled(undefined)).toBe(false);
    });

    it("setNeuralEnabled is a no-op (does not throw) when undefined", () => {
      expect(() => setNeuralEnabled(true, undefined)).not.toThrow();
    });

    it("does not throw when getItem/setItem throw", () => {
      const throwing: SettingsStore = {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
      };
      expect(() => setNeuralEnabled(true, throwing)).not.toThrow();
      expect(isNeuralEnabled(throwing)).toBe(false);
    });
  });
});

describe("gameSettings — font delegates to fontScale", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to M when nothing is stored", () => {
    expect(getFontKey()).toBe("M");
  });

  it("setFontKey persists and getFontKey reads it back", () => {
    setFontKey("L");
    expect(getFontKey()).toBe("L");
    // Delegates to the shared fontScale store under its own key.
    expect(localStorage.getItem("fontScale")).toBe("L");
    setFontKey("S");
    expect(getFontKey()).toBe("S");
  });
});

describe("gameSettings — speed delegates to the engine store", () => {
  it("getSpeed reads the target's gameSpeedMultiplier", () => {
    const target: SpeedTarget = { gameSpeedMultiplier: 2 };
    expect(getSpeed(target)).toBe(2);
  });

  it("setSpeed writes a valid selectable step", () => {
    const target: SpeedTarget = { gameSpeedMultiplier: 1 };
    for (const step of GAME_BALANCE.gameSpeedMultipliers) {
      setSpeed(target, step);
      expect(getSpeed(target)).toBe(step);
    }
  });

  it("setSpeed clamps an unknown multiplier to the default", () => {
    const target: SpeedTarget = { gameSpeedMultiplier: 4 };
    setSpeed(target, 99);
    expect(getSpeed(target)).toBe(GAME_BALANCE.gameSpeedDefault);
  });

  it("setSpeed snaps the dangerous 0 / negative / NaN values to the default (never freezes the game)", () => {
    for (const bad of [0, -1, Number.NaN]) {
      const target: SpeedTarget = { gameSpeedMultiplier: 2 };
      setSpeed(target, bad);
      expect(getSpeed(target)).toBe(GAME_BALANCE.gameSpeedDefault);
    }
  });
});
