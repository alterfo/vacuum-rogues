import { describe, it, expect } from "vitest";
import {
  createEnemy,
  updateEnemy,
  type EnemyContext,
} from "@/systems/blackHoleArcade/arcadeEnemies";
import { ARCADE_FIELD_W } from "@/systems/blackHoleArcade/arcadeConfig";
import type { ArcadeEnemyTypeId } from "@/systems/blackHoleArcade/arcadeTypes";

function ctx(): EnemyContext {
  let id = 1;
  return {
    playerX: 360,
    playerY: 900,
    scrollSpeed: 150,
    level: 10,
    rng: { rngState: 3 },
    nextId: () => id++,
    difficulty: 1,
  } as EnemyContext;
}

function trace(type: ArcadeEnemyTypeId, variant: number, ms: number) {
  const enemy = createEnemy(
    1,
    {
      atMs: 0,
      type,
      x: ARCADE_FIELD_W / 2,
      variant,
      param: 0,
      dir: 1,
      drop: null,
    },
    10,
    -40,
    1,
  );
  const points: { x: number; y: number }[] = [{ x: enemy.x, y: enemy.y }];
  const c = ctx();
  for (let t = 0; t < ms; t += 16) {
    updateEnemy(enemy, 16, c);
    points.push({ x: enemy.x, y: enemy.y });
  }
  return { enemy, points };
}

describe("boss and cruiser motion", () => {
  for (const type of ["boss", "cruiser"] as const) {
    for (let variant = 0; variant < 5; variant++) {
      it(`${type} variant ${variant} moves smoothly, with no teleporting step`, () => {
        const { points } = trace(type, variant, 30000);
        let worst = 0;
        for (let i = 1; i < points.length; i++) {
          worst = Math.max(
            worst,
            Math.hypot(
              points[i].x - points[i - 1].x,
              points[i].y - points[i - 1].y,
            ),
          );
        }
        expect(worst).toBeLessThan(7);
      });
    }
  }

  it("the sweep never pushes the hull past the edges of the field", () => {
    for (const type of ["boss", "cruiser"] as const) {
      for (let variant = 0; variant < 5; variant++) {
        const { enemy, points } = trace(type, variant, 30000);
        for (const p of points) {
          expect(p.x - enemy.radius).toBeGreaterThanOrEqual(0);
          expect(p.x + enemy.radius).toBeLessThanOrEqual(ARCADE_FIELD_W);
        }
      }
    }
  });

  it("the sweep reaches both sides and does not stall", () => {
    const { points } = trace("boss", 2, 30000);
    const xs = points.slice(200).map((p) => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(300);
  });
});
