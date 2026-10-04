import { describe, it, expect } from "vitest";
import { buildArcadeLevel } from "@/systems/blackHoleArcade/arcadeLevels";
import {
  ARCADE_ENEMY_DEFS,
  difficultyScale,
} from "@/systems/blackHoleArcade/arcadeEnemies";
import {
  ARCADE_FIELD_W,
  ARCADE_TOTAL_LEVELS,
} from "@/systems/blackHoleArcade/arcadeConfig";

const levels = Array.from({ length: ARCADE_TOTAL_LEVELS }, (_, i) =>
  buildArcadeLevel(i + 1),
);

function budget(level: number): number {
  const plan = levels[level - 1];
  const scale = difficultyScale(level);
  return plan.spawns.reduce(
    (sum, s) => sum + ARCADE_ENEMY_DEFS[s.type].hp * scale.hp,
    0,
  );
}

describe("arcade level generator", () => {
  it("builds all fifty levels deterministically", () => {
    expect(levels).toHaveLength(50);
    expect(JSON.stringify(buildArcadeLevel(17))).toBe(
      JSON.stringify(buildArcadeLevel(17)),
    );
    expect(JSON.stringify(buildArcadeLevel(17))).not.toBe(
      JSON.stringify(buildArcadeLevel(18)),
    );
  });

  it("clamps out-of-range requests", () => {
    expect(buildArcadeLevel(0).level).toBe(1);
    expect(buildArcadeLevel(999).level).toBe(50);
  });

  it("every spawn list is time-sorted, inside the field and consistent", () => {
    for (const plan of levels) {
      const times = plan.spawns.map((s) => s.atMs);
      expect(times).toEqual([...times].sort((a, b) => a - b));
      expect(plan.totalEnemies).toBe(plan.spawns.length);
      for (const s of plan.spawns) {
        expect(s.x).toBeGreaterThanOrEqual(0);
        expect(s.x).toBeLessThanOrEqual(ARCADE_FIELD_W);
        expect(s.atMs).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("only uses enemies unlocked at that level", () => {
    for (const plan of levels) {
      for (const s of plan.spawns) {
        if (s.type === "carrier" || s.type === "cruiser" || s.type === "boss")
          continue;
        expect(ARCADE_ENEMY_DEFS[s.type].minLevel).toBeLessThanOrEqual(
          plan.level,
        );
      }
    }
  });

  it("introduces new enemy kinds as the run progresses", () => {
    const kinds = (n: number) =>
      new Set(levels[n - 1].spawns.map((s) => s.type));
    expect(kinds(1).size).toBeLessThan(kinds(20).size);
    expect(kinds(20).size).toBeLessThanOrEqual(kinds(50).size + 1);
    expect(kinds(1).has("sniper")).toBe(false);
    const seenByThirty = new Set(
      levels.slice(0, 30).flatMap((p) => p.spawns.map((s) => s.type)),
    );
    for (const type of [
      "spinner",
      "sniper",
      "mineLayer",
      "armored",
      "bomber",
      "diver",
      "strafer",
      "tank",
      "turret",
    ] as const) {
      expect(seenByThirty.has(type)).toBe(true);
    }
  });

  it("puts a boss every tenth level and a cruiser every fifth", () => {
    for (const plan of levels) {
      const last = plan.spawns[plan.spawns.length - 1];
      if (plan.level % 10 === 0) {
        expect(plan.bossType).toBe("boss");
        expect(last.type).toBe("boss");
        expect(last.variant).toBe(plan.level / 10 - 1);
      } else if (plan.level % 5 === 0) {
        expect(plan.bossType).toBe("cruiser");
        expect(last.type).toBe("cruiser");
      } else {
        expect(plan.bossType).toBeNull();
        expect(
          plan.spawns.some((s) => s.type === "boss" || s.type === "cruiser"),
        ).toBe(false);
      }
    }
  });

  it("gets harder: total enemy toughness grows, trending upward across the run", () => {
    expect(budget(50)).toBeGreaterThan(budget(1) * 8);
    expect(budget(25)).toBeGreaterThan(budget(5) * 2);
    for (let l = 1; l + 10 <= 50; l += 5) {
      expect(budget(l + 10)).toBeGreaterThan(budget(l));
    }
  });

  it("scrolls faster and changes theme every ten levels", () => {
    expect(levels[49].scrollSpeed).toBeGreaterThan(levels[0].scrollSpeed);
    expect(new Set(levels.map((p) => p.theme)).size).toBe(5);
    expect(levels[0].theme).toBe(0);
    expect(levels[9].theme).toBe(0);
    expect(levels[10].theme).toBe(1);
    expect(levels[49].theme).toBe(4);
  });

  it("first level hands out a power-up capsule early", () => {
    const first = levels[0].spawns.find((s) => s.type === "carrier");
    expect(first).toBeDefined();
    expect(first!.drop).toBe("power");
    expect(first!.atMs).toBeLessThan(6000);
  });

  it("every level has capsules and lasts a reasonable time", () => {
    for (const plan of levels) {
      expect(
        plan.spawns.filter((s) => s.type === "carrier").length,
      ).toBeGreaterThanOrEqual(2);
      const span = plan.spawns[plan.spawns.length - 1].atMs;
      expect(span).toBeGreaterThan(35000);
      expect(span).toBeLessThan(75000);
    }
  });
});
