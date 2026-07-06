import { describe, it, expect } from "vitest";
import { StarType } from "@/types";
import { Faction } from "@/types/faction";
import { StarSystem } from "@/domain/StarSystem";
import { SeededRNG } from "@/utils/seededRNG";
import {
  SYSTEM_TECH_WEIGHTS,
  HOME_SYSTEM_MIN_TECH,
  GALAXY_MAX_TECH_FLOOR,
  pickSystemTechLevel,
  assignSystemTechLevels,
} from "@/systems/galaxy/systemTechDistribution";
import { GalaxySimulator } from "@/systems/GalaxySimulator";

/**
 * Campaign Task 1 (tech-level generation fix): every system used to keep the
 * hardcoded `StarSystem.techLevel = 1`, and the only tech-1 gear item is a fuel
 * tank — so no weapon or hull was buyable anywhere and military progression
 * (arm-up → battle-ready → Overmind-slayer) was impossible in real sessions.
 * Generation now spreads weighted tech levels with a home-system floor and a
 * galaxy peak floor. These tests assert the *relationships* (shape, floors,
 * determinism, stream isolation) rather than exact magnitudes, so weight tuning
 * won't churn them.
 */

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

describe("pickSystemTechLevel (weighted draw)", () => {
  it("is deterministic for the same seed", () => {
    expect(pickSystemTechLevel(new SeededRNG("tech_7"))).toBe(
      pickSystemTechLevel(new SeededRNG("tech_7")),
    );
  });

  it("only emits tech levels from the weight table", () => {
    const allowed = new Set(SYSTEM_TECH_WEIGHTS.map(([t]) => t));
    for (let i = 0; i < 500; i++) {
      expect(allowed.has(pickSystemTechLevel(new SeededRNG(`t_${i}`)))).toBe(
        true,
      );
    }
  });

  it("roughly tracks the configured weights (distribution shape)", () => {
    const total = SYSTEM_TECH_WEIGHTS.reduce((s, [, w]) => s + w, 0);
    const counts = new Map<number, number>();
    const N = 8000;
    for (let i = 0; i < N; i++) {
      const t = pickSystemTechLevel(new SeededRNG(`shape_${i}`));
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    for (const [tech, weight] of SYSTEM_TECH_WEIGHTS) {
      const expected = weight / total;
      const actual = (counts.get(tech) ?? 0) / N;
      // Every weighted tech appears, at roughly its configured share.
      expect(actual).toBeGreaterThan(0);
      expect(Math.abs(actual - expected)).toBeLessThan(0.05);
    }
  });
});

describe("assignSystemTechLevels", () => {
  it("is deterministic: same seed + same systems ⇒ same assignment", () => {
    const a = mkSystems(30);
    const b = mkSystems(30);
    assignSystemTechLevels(a, "repeat-seed");
    assignSystemTechLevels(b, "repeat-seed");
    expect(a.map((s) => s.techLevel)).toEqual(b.map((s) => s.techLevel));
  });

  it("draws each system from an INDEPENDENT per-system seed stream", () => {
    // The contract that keeps the shared generation RNG byte-identical: each
    // system's roll must come from `${seed}_tech_${i}`, not a shared stream.
    // Verify every non-floored assignment equals that independent draw.
    const systems = mkSystems(40);
    assignSystemTechLevels(systems, "iso-seed");
    systems.forEach((system, i) => {
      const independent = pickSystemTechLevel(
        new SeededRNG(`iso-seed_tech_${i}`),
      );
      const floored =
        (i === 0 && system.techLevel === HOME_SYSTEM_MIN_TECH) ||
        system.techLevel === GALAXY_MAX_TECH_FLOOR;
      if (!floored) expect(system.techLevel).toBe(independent);
      // A floor only ever raises the roll, never lowers it.
      expect(system.techLevel).toBeGreaterThanOrEqual(independent);
    });
  });

  it("floors the home system (systems[0]) at HOME_SYSTEM_MIN_TECH across seeds", () => {
    for (let i = 0; i < 50; i++) {
      const systems = mkSystems(15);
      assignSystemTechLevels(systems, `home_${i}`);
      expect(systems[0].techLevel).toBeGreaterThanOrEqual(HOME_SYSTEM_MIN_TECH);
    }
  });

  it("never lowers a home-system roll that already beats the floor", () => {
    // Find a seed whose independent home draw exceeds the floor, and check the
    // assignment preserves it instead of clamping down.
    for (let i = 0; i < 200; i++) {
      const roll = pickSystemTechLevel(new SeededRNG(`high_${i}_tech_0`));
      if (roll > HOME_SYSTEM_MIN_TECH) {
        const systems = mkSystems(10);
        assignSystemTechLevels(systems, `high_${i}`);
        expect(systems[0].techLevel).toBe(roll);
        return;
      }
    }
    throw new Error("no seed produced a home roll above the floor");
  });

  it("guarantees a galaxy peak of at least GALAXY_MAX_TECH_FLOOR on every seed", () => {
    for (let i = 0; i < 50; i++) {
      const systems = mkSystems(15);
      assignSystemTechLevels(systems, `peak_${i}`);
      const peak = Math.max(...systems.map((s) => s.techLevel));
      expect(peak).toBeGreaterThanOrEqual(GALAXY_MAX_TECH_FLOOR);
    }
  });

  it("produces a varied gradient, not an all-tech-1 galaxy (the original bug)", () => {
    const systems = mkSystems(40);
    assignSystemTechLevels(systems, "varied-galaxy");
    const distinct = new Set(systems.map((s) => s.techLevel));
    expect(distinct.size).toBeGreaterThan(1);
    // Weapon-stocking tech (≥ 3) exists somewhere — gear is actually buyable.
    expect(systems.some((s) => s.techLevel >= 3)).toBe(true);
  });

  it("tolerates an empty system list", () => {
    expect(() => assignSystemTechLevels([], "empty")).not.toThrow();
  });
});

describe("GalaxySimulator seeds varied tech levels", () => {
  it("a generated galaxy carries the tech spread + floors", async () => {
    const galaxy = await new GalaxySimulator().generateGalaxy("tech-gen", 20);
    const techs = galaxy.systems.map((s) => s.techLevel);
    expect(new Set(techs).size).toBeGreaterThan(1); // not all tech 1
    expect(galaxy.systems[0].techLevel).toBeGreaterThanOrEqual(
      HOME_SYSTEM_MIN_TECH,
    );
    expect(Math.max(...techs)).toBeGreaterThanOrEqual(GALAXY_MAX_TECH_FLOOR);
  });

  it("stays deterministic per seed WITH the tech pass (stream isolation)", async () => {
    const a = await new GalaxySimulator().generateGalaxy("tech-repeat", 20);
    const b = await new GalaxySimulator().generateGalaxy("tech-repeat", 20);
    expect(a.systems.map((s) => s.techLevel)).toEqual(
      b.systems.map((s) => s.techLevel),
    );
    // The shared generation stream is untouched: coordinates, star types and
    // economy assignments reproduce exactly alongside the tech pass.
    expect(a.systems.map((s) => s.coordinates)).toEqual(
      b.systems.map((s) => s.coordinates),
    );
    expect(a.systems.map((s) => s.starType)).toEqual(
      b.systems.map((s) => s.starType),
    );
    expect(a.systems.map((s) => s.economyType)).toEqual(
      b.systems.map((s) => s.economyType),
    );
  });
});
