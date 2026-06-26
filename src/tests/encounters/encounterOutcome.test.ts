import { describe, it, expect } from "vitest";
import {
  resolveEncounter,
  DEFAULT_ENCOUNTER_OUTCOME_CONFIG,
  type EncounterOutcomeConfig,
} from "@/systems/encounters/encounterOutcome";
import type {
  Encounter,
  EncounterType,
} from "@/systems/encounters/encounterGenerator";

/** Build an encounter with explicit danger/reward for branch-driving. */
function enc(
  type: EncounterType,
  danger = 0.5,
  rewardScale = 1,
  id = `enc:sys:${type}`,
): Encounter {
  return { id, type, systemId: "sys", danger, rewardScale };
}

/** Fixed-value rng so the bad/good branch (and cargo pick) is deterministic. */
const rng = (v: number) => () => v;

describe("resolveEncounter — ignore is always neutral", () => {
  it("returns the ignored outcome with no payoff for any type", () => {
    for (const t of ["derelict", "anomaly", "distress"] as EncounterType[]) {
      const o = resolveEncounter(enc(t, 1, 5), "ignore");
      expect(o.kind).toBe("ignored");
      expect(o.credits).toBeUndefined();
      expect(o.cargo).toBeUndefined();
      expect(o.reputationDelta).toBeUndefined();
      expect(o.startCombat).toBeFalsy();
      expect(o.message.length).toBeGreaterThan(0);
    }
  });
});

describe("resolveEncounter — derelict", () => {
  it("good roll yields salvage: positive credits + cargo, no combat", () => {
    const o = resolveEncounter(enc("derelict"), "engage", rng(0.99));
    expect(o.kind).toBe("salvage");
    expect(o.credits).toBeGreaterThan(0);
    expect(o.cargo?.[0].amount).toBeGreaterThan(0);
    expect(o.startCombat).toBeFalsy();
  });

  it("bad roll yields a trap that starts combat", () => {
    const o = resolveEncounter(enc("derelict"), "engage", rng(0));
    expect(o.kind).toBe("trap");
    expect(o.startCombat).toBe(true);
    expect(o.credits).toBeUndefined();
  });
});

describe("resolveEncounter — anomaly", () => {
  it("good roll yields a bonus: positive credits + data, no combat", () => {
    const o = resolveEncounter(enc("anomaly"), "engage", rng(0.99));
    expect(o.kind).toBe("bonus");
    expect(o.credits).toBeGreaterThan(0);
    expect(o.cargo?.[0].amount).toBeGreaterThan(0);
    expect(o.startCombat).toBeFalsy();
  });

  it("bad roll yields a hazard: a non-combat credit penalty", () => {
    const o = resolveEncounter(enc("anomaly"), "engage", rng(0));
    expect(o.kind).toBe("hazard");
    expect(o.credits).toBeLessThan(0);
    expect(o.startCombat).toBeFalsy();
  });
});

describe("resolveEncounter — distress", () => {
  it("good roll yields a rescue: credits + reputation, no combat", () => {
    const o = resolveEncounter(enc("distress"), "engage", rng(0.99));
    expect(o.kind).toBe("rescue");
    expect(o.credits).toBeGreaterThan(0);
    expect(o.reputationDelta).toBeGreaterThan(0);
    expect(o.startCombat).toBeFalsy();
  });

  it("bad roll yields an ambush that starts combat", () => {
    const o = resolveEncounter(enc("distress"), "engage", rng(0));
    expect(o.kind).toBe("ambush");
    expect(o.startCombat).toBe(true);
  });
});

describe("resolveEncounter — danger scales the bad-outcome odds", () => {
  it("high danger trips the trap where low danger does not (same rng)", () => {
    // rng = 0.3: above the floor (0.1) but below 0.1 + 0.6*danger once danger is high.
    const lowDanger = resolveEncounter(
      enc("derelict", 0.0),
      "engage",
      rng(0.3),
    );
    const highDanger = resolveEncounter(
      enc("derelict", 1.0),
      "engage",
      rng(0.3),
    );
    expect(lowDanger.kind).toBe("salvage");
    expect(highDanger.kind).toBe("trap");
  });

  it("bad-outcome chance is clamped at maxBadChance", () => {
    // rng just above the ceiling stays good even at danger 1.
    const justAbove = DEFAULT_ENCOUNTER_OUTCOME_CONFIG.maxBadChance + 0.01;
    const o = resolveEncounter(enc("derelict", 1.0), "engage", rng(justAbove));
    expect(o.kind).toBe("salvage");
  });
});

describe("resolveEncounter — rewardScale lifts payoffs", () => {
  it("a higher rewardScale yields strictly more salvage credits", () => {
    const lo = resolveEncounter(enc("derelict", 0, 1), "engage", rng(0.99));
    const hi = resolveEncounter(enc("derelict", 0, 3), "engage", rng(0.99));
    expect(hi.credits!).toBeGreaterThan(lo.credits!);
  });

  it("a rewardScale below 1 is floored to 1 (never shrinks below base)", () => {
    const o = resolveEncounter(enc("derelict", 0, 0.2), "engage", rng(0.99));
    expect(o.credits).toBe(
      DEFAULT_ENCOUNTER_OUTCOME_CONFIG.derelictBaseCredits,
    );
  });
});

describe("resolveEncounter — payouts are whole credits", () => {
  it("credits and cargo amounts are integers across fractional scales", () => {
    for (const scale of [1.37, 2.51, 4.09]) {
      const o = resolveEncounter(
        enc("derelict", 0, scale),
        "engage",
        rng(0.99),
      );
      expect(Number.isInteger(o.credits!)).toBe(true);
      expect(Number.isInteger(o.cargo![0].amount)).toBe(true);
    }
    const haz = resolveEncounter(enc("anomaly", 1, 1.5), "engage", rng(0));
    expect(Number.isInteger(haz.credits!)).toBe(true);
  });
});

describe("resolveEncounter — determinism", () => {
  it("the default rng is deterministic by encounter id", () => {
    const a = resolveEncounter(enc("distress", 0.5, 2, "enc:sys:A"), "engage");
    const b = resolveEncounter(enc("distress", 0.5, 2, "enc:sys:A"), "engage");
    expect(a).toEqual(b);
  });

  it("a custom config can shift base payoffs", () => {
    const cfg: EncounterOutcomeConfig = {
      ...DEFAULT_ENCOUNTER_OUTCOME_CONFIG,
      derelictBaseCredits: 1000,
    };
    const o = resolveEncounter(enc("derelict", 0, 1), "engage", rng(0.99), cfg);
    expect(o.credits).toBe(1000);
  });
});
