import { describe, it, expect } from "vitest";
import {
  rollEncounter,
  DEFAULT_ENCOUNTER_CONFIG,
  type EncounterConfig,
  type EncounterSystemView,
  type Encounter,
  type EncounterType,
} from "@/systems/encounters/encounterGenerator";

const safe: EncounterSystemView = { id: "sys-safe", danger: 0 };
const hostile: EncounterSystemView = { id: "sys-hostile", danger: 1 };

function sweep(
  system: EncounterSystemView,
  count: number,
  cfg: EncounterConfig = DEFAULT_ENCOUNTER_CONFIG,
  player = {},
): Encounter[] {
  const out: Encounter[] = [];
  for (let i = 0; i < count; i++) {
    const e = rollEncounter(system, `seed-${i}`, player, cfg);
    if (e) out.push(e);
  }
  return out;
}

function typeCounts(encs: Encounter[]): Record<EncounterType, number> {
  const c: Record<EncounterType, number> = {
    derelict: 0,
    anomaly: 0,
    distress: 0,
  };
  for (const e of encs) c[e.type]++;
  return c;
}

describe("rollEncounter — determinism", () => {
  it("is deterministic by (system, seed): same inputs ⇒ same encounter", () => {
    for (let i = 0; i < 50; i++) {
      const a = rollEncounter(hostile, `s${i}`, { level: 3 });
      const b = rollEncounter(hostile, `s${i}`, { level: 3 });
      expect(a).toEqual(b);
    }
  });

  it("a numeric seed and its string form agree", () => {
    expect(rollEncounter(hostile, 42)).toEqual(rollEncounter(hostile, "42"));
  });

  it("different systems with the same seed can diverge (id is system-keyed)", () => {
    const a = rollEncounter(hostile, "x", {}, FLOOD);
    const b = rollEncounter(safe, "x", {}, FLOOD);
    expect(a?.id).not.toEqual(b?.id);
    expect(a?.id).toBe("enc:sys-hostile:x");
    expect(b?.id).toBe("enc:sys-safe:x");
  });

  it("stamps a stable id of the form enc:<systemId>:<seed>", () => {
    const e = rollEncounter(hostile, "seed-1", {}, FLOOD);
    expect(e?.id).toBe("enc:sys-hostile:seed-1");
    expect(e?.systemId).toBe("sys-hostile");
  });
});

const FLOOD: EncounterConfig = {
  ...DEFAULT_ENCOUNTER_CONFIG,
  baseChance: 1,
  maxChance: 1,
  minGap: 0,
};

describe("rollEncounter — rate limit (spice, not a flood)", () => {
  it("returns null when stepsSinceLastEncounter < minGap", () => {
    const cfg = { ...FLOOD, minGap: 4 };
    expect(
      rollEncounter(hostile, "s", { stepsSinceLastEncounter: 0 }, cfg),
    ).toBeNull();
    expect(
      rollEncounter(hostile, "s", { stepsSinceLastEncounter: 3 }, cfg),
    ).toBeNull();
  });

  it("allows an encounter once the gap is met", () => {
    const cfg = { ...FLOOD, minGap: 4 };
    expect(
      rollEncounter(hostile, "s", { stepsSinceLastEncounter: 4 }, cfg),
    ).not.toBeNull();
  });

  it("undefined stepsSinceLastEncounter is treated as eligible (first roll)", () => {
    const cfg = { ...FLOOD, minGap: 4 };
    expect(rollEncounter(hostile, "s", {}, cfg)).not.toBeNull();
  });

  it("at the default base rate, encounters are a minority of rolls", () => {
    const N = 400;
    const encs = sweep(safe, N); // danger 0 ⇒ pure baseChance ~0.15
    expect(encs.length).toBeGreaterThan(0);
    expect(encs.length).toBeLessThan(N * 0.35); // nowhere near a flood
  });
});

describe("rollEncounter — chance scaling by danger", () => {
  it("a hostile system fires more often than a safe one", () => {
    const N = 400;
    const safeEncs = sweep(safe, N);
    const hostileEncs = sweep(hostile, N);
    expect(hostileEncs.length).toBeGreaterThan(safeEncs.length);
  });

  it("clamps the per-roll chance at maxChance", () => {
    const cfg: EncounterConfig = {
      ...DEFAULT_ENCOUNTER_CONFIG,
      baseChance: 0.5,
      dangerChanceBoost: 1.5,
      maxChance: 0.6,
    };
    const N = 400;
    const encs = sweep(hostile, N, cfg);
    expect(encs.length).toBeLessThanOrEqual(N * 0.6 + N * 0.08); // ~maxChance + noise
  });
});

describe("rollEncounter — type weighting", () => {
  it("at zero danger, all three types appear and derelict (highest weight) leads", () => {
    const counts = typeCounts(sweep(safe, 600, FLOOD));
    expect(counts.derelict).toBeGreaterThan(0);
    expect(counts.anomaly).toBeGreaterThan(0);
    expect(counts.distress).toBeGreaterThan(0);
    expect(counts.derelict).toBeGreaterThan(counts.distress);
  });

  it("danger lifts the distress (ambush-bait) share", () => {
    const safeShare = typeCounts(sweep(safe, 600, FLOOD)).distress / 600;
    const hostileShare = typeCounts(sweep(hostile, 600, FLOOD)).distress / 600;
    expect(hostileShare).toBeGreaterThan(safeShare);
  });
});

describe("rollEncounter — danger + reward scaling", () => {
  it("hostile-system encounters carry higher danger than safe ones", () => {
    const safeAvg = avg(sweep(safe, 400, FLOOD).map((e) => e.danger));
    const hostileAvg = avg(sweep(hostile, 400, FLOOD).map((e) => e.danger));
    expect(hostileAvg).toBeGreaterThan(safeAvg);
    expect(safeAvg).toBeGreaterThanOrEqual(0);
    expect(hostileAvg).toBeLessThanOrEqual(1);
  });

  it("rewardScale is ≥1 and rises with system danger", () => {
    const s = rollEncounter(safe, "k", {}, FLOOD)!;
    const h = rollEncounter(hostile, "k", {}, FLOOD)!;
    expect(s.rewardScale).toBeGreaterThanOrEqual(1);
    expect(h.rewardScale).toBeGreaterThan(s.rewardScale);
  });

  it("rewardScale rises with player level", () => {
    const lo = rollEncounter(hostile, "k", { level: 1 }, FLOOD)!;
    const hi = rollEncounter(hostile, "k", { level: 10 }, FLOOD)!;
    expect(hi.rewardScale).toBeGreaterThan(lo.rewardScale);
  });

  it("a hostile pirate rep nudges encounter danger up", () => {
    const neutral = rollEncounter(hostile, "k", { pirateRep: 0 }, FLOOD)!;
    const hated = rollEncounter(hostile, "k", { pirateRep: -100 }, FLOOD)!;
    expect(hated.danger).toBeGreaterThanOrEqual(neutral.danger);
  });
});

function avg(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}
