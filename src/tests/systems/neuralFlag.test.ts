import { describe, it, expect } from "vitest";
import {
  isFeatureEnabled,
  setFeatureEnabled,
  isNeuralEnabled,
  setNeuralEnabled,
  FEATURE_FLAG_KEYS,
  NEURAL_ENABLED_KEY,
  type SettingsStore,
} from "@/systems/settings/gameSettings";
import { selectPlayerPolicy } from "../playtest/letsplay/policyGate";
import { HeuristicPolicy } from "../playtest/letsplay/HeuristicPolicy";
import { NeuralPolicy } from "../playtest/letsplay/NeuralPolicy";

/** In-memory Storage subset for the feature-flag persistence tests. */
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

describe("featureFlags — generalised on/off flags (neural is the first)", () => {
  it("the neural flag maps to the neuralEnabled localStorage key", () => {
    expect(FEATURE_FLAG_KEYS.neural).toBe(NEURAL_ENABLED_KEY);
  });

  it("defaults to false on a fresh store", () => {
    expect(isFeatureEnabled("neural", fakeStore())).toBe(false);
  });

  it("round-trips through the store", () => {
    const store = fakeStore();
    setFeatureEnabled("neural", true, store);
    expect(store.map.get(NEURAL_ENABLED_KEY)).toBe("true");
    expect(isFeatureEnabled("neural", store)).toBe(true);
    setFeatureEnabled("neural", false, store);
    expect(isFeatureEnabled("neural", store)).toBe(false);
  });

  it("degrades to false when storage is unavailable", () => {
    expect(isFeatureEnabled("neural", undefined)).toBe(false);
    expect(() => setFeatureEnabled("neural", true, undefined)).not.toThrow();
  });

  it("isNeuralEnabled/setNeuralEnabled are thin aliases over the generic flag", () => {
    const store = fakeStore();
    setNeuralEnabled(true, store);
    // The generic reader sees the same write…
    expect(isFeatureEnabled("neural", store)).toBe(true);
    // …and the generic writer is visible to the neural alias.
    setFeatureEnabled("neural", false, store);
    expect(isNeuralEnabled(store)).toBe(false);
  });
});

describe("policyGate — isNeuralEnabled is the single neural gate", () => {
  it("off (default) ⇒ the heuristic policy, no neural policy / weights touched", () => {
    const policy = selectPlayerPolicy({ enabled: false });
    expect(policy).toBeInstanceOf(HeuristicPolicy);
    expect(policy).not.toBeInstanceOf(NeuralPolicy);
    expect(policy.name).toBe("heuristic");
  });

  it("on ⇒ the neural policy is selected (inert until weights load)", () => {
    const policy = selectPlayerPolicy({ enabled: true });
    expect(policy).toBeInstanceOf(NeuralPolicy);
    expect(policy.name).toBe("neural");
    // No weights passed ⇒ not loaded; decide still works via the heuristic fallback.
    expect((policy as NeuralPolicy).isLoaded).toBe(false);
  });

  it("reads the live flag when `enabled` is not overridden", () => {
    // The no-override path consults the live `isNeuralEnabled()` (localStorage),
    // so drive it explicitly in both directions and restore the lean default.
    setNeuralEnabled(false);
    expect(selectPlayerPolicy().name).toBe("heuristic");
    setNeuralEnabled(true);
    expect(selectPlayerPolicy().name).toBe("neural");
    setNeuralEnabled(false); // restore the off default for any later test
    expect(selectPlayerPolicy().name).toBe("heuristic");
  });

  it("the on-path neural policy still falls back to a legal action (never throws)", () => {
    const policy = selectPlayerPolicy({ enabled: true });
    const obs = {
      scene: "SPACE_FLIGHT",
      hasPlayer: false,
      legalActions: ["wait"],
      hostiles: [],
      quests: [],
    } as unknown as Parameters<typeof policy.decide>[0];
    const action = policy.decide(obs);
    expect(obs.legalActions).toContain(action.kind);
  });
});
