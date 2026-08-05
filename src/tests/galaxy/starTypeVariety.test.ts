import { describe, it, expect } from "vitest";
import { StarType } from "@/types";
import { SeededRNG } from "@/utils/seededRNG";
import {
  STAR_TYPE_WEIGHTS,
  STAR_MAP_PREFIX,
  pickStarType,
} from "@/systems/galaxy/starTypeDistribution";
import { GalaxySimulator } from "@/systems/GalaxySimulator";

describe("pickStarType (weighted galaxy star-type distribution)", () => {
  it("is deterministic for the same seed", () => {
    const a = pickStarType(new SeededRNG("sys_star_7"));
    const b = pickStarType(new SeededRNG("sys_star_7"));
    expect(a).toBe(b);
  });

  it("never emits a BLACK_HOLE (no star-map art for it)", () => {
    for (let i = 0; i < 500; i++) {
      expect(pickStarType(new SeededRNG(`bh_${i}`))).not.toBe(
        StarType.BLACK_HOLE,
      );
    }
  });

  it("produces every art-backed star type across many draws, yellow commonest", () => {
    const counts = new Map<StarType, number>();
    const N = 3000;
    for (let i = 0; i < N; i++) {
      const t = pickStarType(new SeededRNG(`draw_${i}`));
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    for (const [type] of STAR_TYPE_WEIGHTS) {
      expect(counts.get(type) ?? 0).toBeGreaterThan(0);
    }
    const yellow = counts.get(StarType.YELLOW_DWARF) ?? 0;
    expect(yellow).toBeGreaterThan(0);
    expect(yellow).toBeLessThan(N); // not every sun is yellow
    for (const [type, count] of counts) {
      if (type !== StarType.YELLOW_DWARF) {
        expect(yellow).toBeGreaterThanOrEqual(count); // yellow is commonest
      }
    }
  });

  it("roughly tracks the configured weights", () => {
    const total = STAR_TYPE_WEIGHTS.reduce((s, [, w]) => s + w, 0);
    const counts = new Map<StarType, number>();
    const N = 8000;
    for (let i = 0; i < N; i++) {
      const t = pickStarType(new SeededRNG(`w_${i}`));
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    for (const [type, weight] of STAR_TYPE_WEIGHTS) {
      const expected = weight / total;
      const actual = (counts.get(type) ?? 0) / N;
      expect(Math.abs(actual - expected)).toBeLessThan(0.05);
    }
  });
});

describe("STAR_MAP_PREFIX (each type resolves to its star-map prefix)", () => {
  it("maps every weighted star type to a star_maps art prefix", () => {
    for (const [type] of STAR_TYPE_WEIGHTS) {
      expect(STAR_MAP_PREFIX[type]).toBeTruthy();
    }
  });

  it("maps each type to its expected prefix", () => {
    expect(STAR_MAP_PREFIX[StarType.YELLOW_DWARF]).toBe("yellow");
    expect(STAR_MAP_PREFIX[StarType.RED_DWARF]).toBe("red_dwarf");
    expect(STAR_MAP_PREFIX[StarType.BLUE_GIANT]).toBe("blue_giant");
    expect(STAR_MAP_PREFIX[StarType.WHITE_DWARF]).toBe("white_dwarf");
    expect(STAR_MAP_PREFIX[StarType.NEUTRON]).toBe("neutron");
  });

  it("has no prefix for BLACK_HOLE (no art)", () => {
    expect(STAR_MAP_PREFIX[StarType.BLACK_HOLE]).toBeUndefined();
  });
});

describe("GalaxySimulator seeds varied star types", () => {
  it("a generated galaxy is not a field of identical yellow suns", async () => {
    const galaxy = await new GalaxySimulator().generateGalaxy(
      "star-variety",
      40,
    );
    const types = new Set(galaxy.systems.map((s) => s.starType));
    expect(types.size).toBeGreaterThan(1);
    const yellow = galaxy.systems.filter(
      (s) => s.starType === StarType.YELLOW_DWARF,
    ).length;
    expect(yellow).toBeLessThan(galaxy.systems.length);
    for (const s of galaxy.systems) {
      expect(STAR_MAP_PREFIX[s.starType]).toBeTruthy();
    }
  });

  it("is deterministic per seed", async () => {
    const a = await new GalaxySimulator().generateGalaxy("repeatable", 20);
    const b = await new GalaxySimulator().generateGalaxy("repeatable", 20);
    expect(a.systems.map((s) => s.starType)).toEqual(
      b.systems.map((s) => s.starType),
    );
  });
});
