import { describe, it, expect } from "vitest";
import { ENCOUNTER_CONFIG, ENCOUNTER_OUTCOME_CONFIG } from "@/config/balance";
import { DEFAULT_ENCOUNTER_CONFIG } from "@/systems/encounters/encounterGenerator";
import { DEFAULT_ENCOUNTER_OUTCOME_CONFIG } from "@/systems/encounters/encounterOutcome";

describe("encounter balance parity", () => {
  it("ENCOUNTER_CONFIG mirrors DEFAULT_ENCOUNTER_CONFIG", () => {
    expect(ENCOUNTER_CONFIG).toEqual(DEFAULT_ENCOUNTER_CONFIG);
  });

  it("ENCOUNTER_OUTCOME_CONFIG mirrors DEFAULT_ENCOUNTER_OUTCOME_CONFIG", () => {
    expect(ENCOUNTER_OUTCOME_CONFIG).toEqual(DEFAULT_ENCOUNTER_OUTCOME_CONFIG);
  });

  it("live tuning stays sane (spice, not a flood; payoffs positive)", () => {
    expect(ENCOUNTER_CONFIG.baseChance).toBeGreaterThan(0);
    expect(ENCOUNTER_CONFIG.baseChance).toBeLessThanOrEqual(
      ENCOUNTER_CONFIG.maxChance,
    );
    expect(ENCOUNTER_CONFIG.maxChance).toBeLessThanOrEqual(1);
    expect(ENCOUNTER_CONFIG.minGap).toBeGreaterThanOrEqual(1);

    expect(ENCOUNTER_OUTCOME_CONFIG.derelictBaseCredits).toBeGreaterThan(0);
    expect(ENCOUNTER_OUTCOME_CONFIG.anomalyBaseCredits).toBeGreaterThan(0);
    expect(ENCOUNTER_OUTCOME_CONFIG.distressBaseCredits).toBeGreaterThan(0);
    expect(ENCOUNTER_OUTCOME_CONFIG.badChanceFloor).toBeGreaterThanOrEqual(0);
    expect(ENCOUNTER_OUTCOME_CONFIG.badChanceFloor).toBeLessThanOrEqual(
      ENCOUNTER_OUTCOME_CONFIG.maxBadChance,
    );
    expect(ENCOUNTER_OUTCOME_CONFIG.maxBadChance).toBeLessThanOrEqual(1);
  });
});
