import { describe, it, expect } from "vitest";
import { StarType } from "@/types";
import { Faction } from "@/types/faction";
import { StarSystem } from "@/domain/StarSystem";
import { SeededRNG } from "@/utils/seededRNG";
import { StarSystemSchema } from "@/validation/schemas";
import { BLACK_HOLE_SYSTEM_CHANCE } from "@/config/balance";
import {
  BLACK_HOLE_ANOMALY_MIN_SYSTEMS,
  pickHasBlackHoleAnomaly,
  assignBlackHoleAnomalies,
} from "@/systems/galaxy/blackHoleDistribution";
import { GalaxySimulator } from "@/systems/GalaxySimulator";

function mkSystems(n: number): StarSystem[] {
  return Array.from(
    { length: n },
    (_, i) =>
      new StarSystem(
        `sys-${i}`,
        `Система-${i}`,
        { q: i, r: -i },
        StarType.YELLOW_DWARF,
        [],
        Faction.INDEPENDENT,
        [],
      ),
  );
}

function legacyPayload(): Record<string, unknown> {
  return {
    id: "sys-0",
    name: "Alpha",
    coordinates: { q: 0, r: 0 },
    starType: "YELLOW_DWARF",
    explored: true,
    fogOfWar: false,
  };
}

describe("pickHasBlackHoleAnomaly", () => {
  it("is deterministic for the same seed", () => {
    expect(pickHasBlackHoleAnomaly(new SeededRNG("bh_7"))).toBe(
      pickHasBlackHoleAnomaly(new SeededRNG("bh_7")),
    );
  });

  it("tracks BLACK_HOLE_SYSTEM_CHANCE over a large sample", () => {
    const N = 20000;
    let hits = 0;
    for (let i = 0; i < N; i++) {
      if (pickHasBlackHoleAnomaly(new SeededRNG(`rate_${i}`))) hits++;
    }
    expect(Math.abs(hits / N - BLACK_HOLE_SYSTEM_CHANCE)).toBeLessThan(0.02);
  });
});

describe("assignBlackHoleAnomalies", () => {
  it("is deterministic: same seed + same systems => same assignment", () => {
    const a = mkSystems(30);
    const b = mkSystems(30);
    assignBlackHoleAnomalies(a, "bh-repeat");
    assignBlackHoleAnomalies(b, "bh-repeat");
    expect(a.map((s) => s.hasBlackHoleAnomaly)).toEqual(
      b.map((s) => s.hasBlackHoleAnomaly),
    );
  });

  it("draws each system from an INDEPENDENT per-system seed stream", () => {
    for (let n = 0; n < 200; n++) {
      const seed = `natural_${n}`;
      const systems = mkSystems(12);
      assignBlackHoleAnomalies(systems, seed);
      const anyNatural = systems.some((_, i) =>
        pickHasBlackHoleAnomaly(new SeededRNG(`${seed}_blackhole_${i}`)),
      );
      if (!anyNatural) continue;
      systems.forEach((system, i) => {
        expect(system.hasBlackHoleAnomaly).toBe(
          pickHasBlackHoleAnomaly(new SeededRNG(`${seed}_blackhole_${i}`)),
        );
      });
      return;
    }
    throw new Error("no seed produced a naturally-placed anomaly");
  });

  it("guarantees at least one anomaly for galaxies at or above the threshold", () => {
    for (let i = 0; i < 50; i++) {
      const systems = mkSystems(BLACK_HOLE_ANOMALY_MIN_SYSTEMS);
      assignBlackHoleAnomalies(systems, `guarantee_${i}`);
      expect(systems.some((s) => s.hasBlackHoleAnomaly)).toBe(true);
    }
  });

  it("can produce zero anomalies on galaxies below the threshold", () => {
    let zeroFound = false;
    for (let i = 0; i < 200; i++) {
      const systems = mkSystems(2);
      assignBlackHoleAnomalies(systems, `tiny_${i}`);
      if (!systems.some((s) => s.hasBlackHoleAnomaly)) {
        zeroFound = true;
        break;
      }
    }
    expect(zeroFound).toBe(true);
  });

  it("tolerates an empty system list", () => {
    expect(() => assignBlackHoleAnomalies([], "empty")).not.toThrow();
  });
});

describe("StarSystemSchema black-hole field", () => {
  it("defaults hasBlackHoleAnomaly to false for legacy payloads", () => {
    const parsed = StarSystemSchema.parse(legacyPayload());
    expect(parsed.hasBlackHoleAnomaly).toBe(false);
  });

  it("round-trips an explicit true", () => {
    const parsed = StarSystemSchema.parse({
      ...legacyPayload(),
      hasBlackHoleAnomaly: true,
    });
    expect(parsed.hasBlackHoleAnomaly).toBe(true);
  });
});

describe("GalaxySimulator seeds black-hole anomalies", () => {
  it("a generated galaxy at or above the threshold carries an anomaly", async () => {
    const galaxy = await new GalaxySimulator().generateGalaxy("bh-gen", 12);
    expect(galaxy.systems.some((s) => s.hasBlackHoleAnomaly)).toBe(true);
  });

  it("stays deterministic per seed with the anomaly pass", async () => {
    const a = await new GalaxySimulator().generateGalaxy("bh-repeat", 20);
    const b = await new GalaxySimulator().generateGalaxy("bh-repeat", 20);
    expect(a.systems.map((s) => s.hasBlackHoleAnomaly)).toEqual(
      b.systems.map((s) => s.hasBlackHoleAnomaly),
    );
  });
});
