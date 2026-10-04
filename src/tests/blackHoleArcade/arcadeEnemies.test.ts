import { describe, it, expect } from "vitest";
import {
  ARCADE_ENEMY_DEFS,
  bossPatterns,
  createEnemy,
  difficultyScale,
  hullDifficulty,
  updateEnemy,
  type EnemyContext,
} from "@/systems/blackHoleArcade/arcadeEnemies";
import {
  ARCADE_FIELD_H,
  ARCADE_FIELD_W,
} from "@/systems/blackHoleArcade/arcadeConfig";
import type {
  ArcadeEnemy,
  ArcadeEnemyTypeId,
} from "@/systems/blackHoleArcade/arcadeTypes";

function ctx(overrides: Partial<EnemyContext> = {}): EnemyContext {
  let id = 1000;
  return {
    playerX: 360,
    playerY: 900,
    scrollSpeed: 150,
    level: 1,
    difficulty: 1,
    rng: { rngState: 5 },
    nextId: () => id++,
    ...overrides,
  };
}

function make(
  type: ArcadeEnemyTypeId,
  x = 360,
  extra: Partial<{
    param: number;
    dir: number;
    variant: number;
    level: number;
  }> = {},
): ArcadeEnemy {
  return createEnemy(
    1,
    {
      atMs: 0,
      type,
      x,
      variant: extra.variant ?? 0,
      param: extra.param ?? 0,
      dir: extra.dir ?? 1,
      drop: null,
    },
    extra.level ?? 1,
    -40,
  );
}

function run(enemy: ArcadeEnemy, ms: number, c: EnemyContext = ctx()) {
  const bullets: ReturnType<typeof updateEnemy>["bullets"] = [];
  const spawns: ReturnType<typeof updateEnemy>["spawns"] = [];
  for (let t = 0; t < ms; t += 16) {
    const r = updateEnemy(enemy, 16, c);
    bullets.push(...r.bullets);
    spawns.push(...r.spawns);
  }
  return { bullets, spawns };
}

describe("arcade enemy catalog", () => {
  it("defines fifteen enemy types, both air and ground, with sensible stats", () => {
    const defs = Object.values(ARCADE_ENEMY_DEFS);
    expect(defs).toHaveLength(15);
    expect(defs.some((d) => d.ground)).toBe(true);
    for (const d of defs) {
      expect(d.hp).toBeGreaterThan(0);
      expect(d.radius).toBeGreaterThan(5);
      expect(d.minLevel).toBeGreaterThanOrEqual(1);
      expect(d.dropChance).toBeGreaterThanOrEqual(0);
      expect(d.dropChance).toBeLessThanOrEqual(1);
    }
  });

  it("scales hit points, damage and bullet speed with level, with caps", () => {
    const a = difficultyScale(1);
    const b = difficultyScale(25);
    const c = difficultyScale(50);
    expect(a.hp).toBe(1);
    expect(b.hp).toBeGreaterThan(a.hp);
    expect(c.hp).toBeGreaterThan(b.hp);
    expect(c.damage).toBeGreaterThan(b.damage);
    expect(c.bulletSpeed).toBeLessThanOrEqual(1.6);
    expect(c.fireInterval).toBeGreaterThanOrEqual(0.55);
    expect(
      createEnemy(
        1,
        {
          atMs: 0,
          type: "gunship",
          x: 0,
          variant: 0,
          param: 0,
          dir: 1,
          drop: null,
        },
        50,
        0,
      ).maxHp,
    ).toBeGreaterThan(
      createEnemy(
        1,
        {
          atMs: 0,
          type: "gunship",
          x: 0,
          variant: 0,
          param: 0,
          dir: 1,
          drop: null,
        },
        1,
        0,
      ).maxHp * 5,
    );
  });

  it("later bosses are tougher than early ones", () => {
    expect(make("boss", 360, { variant: 4 }).maxHp).toBeGreaterThan(
      make("boss", 360, { variant: 0 }).maxHp * 2,
    );
  });
});

describe("arcade enemy movement", () => {
  it("straight flyers descend at their speed", () => {
    const e = make("scout");
    const y0 = e.y;
    run(e, 1000);
    expect(e.y - y0).toBeGreaterThan(200);
  });

  it("weavers oscillate around their lane within the amplitude", () => {
    const e = make("weaver", 360, { param: 100 });
    let min = 1e9;
    let max = -1e9;
    for (let i = 0; i < 200; i++) {
      updateEnemy(e, 16, ctx());
      min = Math.min(min, e.x);
      max = Math.max(max, e.x);
    }
    expect(max - min).toBeGreaterThan(120);
    expect(max).toBeLessThanOrEqual(461);
    expect(min).toBeGreaterThanOrEqual(259);
  });

  it("divers hesitate, then lunge at where the player was", () => {
    const e = make("diver", 100);
    e.y = 100;
    run(e, 600);
    expect(e.vx).toBe(0);
    run(e, 200);
    expect(e.vx).toBeGreaterThan(0);
    expect(e.vy).toBeGreaterThan(0);
  });

  it("hover types stop at their hover line, then leave", () => {
    const e = make("gunship", 360, { param: 200 });
    run(e, 3000);
    expect(e.y).toBeGreaterThan(190);
    expect(e.y).toBeLessThan(215);
    run(e, 9000);
    expect(e.y).toBeGreaterThan(400);
  });

  it("strafers cross the field horizontally on their lane", () => {
    const e = make("strafer", 0, { param: 250, dir: 1 });
    run(e, 4000);
    expect(e.x).toBeGreaterThan(ARCADE_FIELD_W / 2);
    expect(Math.abs(e.y - 250)).toBeLessThan(30);
  });

  it("ground units ride the scroll; tanks also bounce at the edges", () => {
    const turret = make("turret");
    const y0 = turret.y;
    run(turret, 1000, ctx({ scrollSpeed: 200 }));
    expect(turret.y - y0).toBeGreaterThan(180);
    expect(turret.x).toBe(360);

    const tank = make("tank", 80, { dir: -1 });
    run(tank, 3000);
    expect(tank.dir).toBe(1);
  });

  it("bosses glide in, then strafe across the middle of the screen", () => {
    const boss = make("boss", 360, { variant: 2 });
    run(boss, 3000);
    expect(boss.y).toBeGreaterThan(140);
    expect(boss.y).toBeLessThan(215);
    const xs: number[] = [];
    for (let i = 0; i < 300; i++) {
      updateEnemy(boss, 16, ctx());
      xs.push(boss.x);
    }
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(150);
  });

  it("carriers release scout escorts", () => {
    const c = make("carrier", 360);
    const { spawns } = run(c, 5000);
    expect(spawns.length).toBeGreaterThanOrEqual(2);
    expect(spawns.every((s) => s.type === "scout" && s.y !== undefined)).toBe(
      true,
    );
  });
});

describe("arcade enemy fire patterns", () => {
  it("gunships fire three-way spreads once on screen", () => {
    const e = make("gunship", 360, { param: 200 });
    const { bullets } = run(e, 2200);
    expect(bullets.length).toBeGreaterThanOrEqual(3);
    const first = bullets.slice(0, 3);
    expect(new Set(first.map((b) => Math.round(b.vx))).size).toBe(3);
    expect(first.every((b) => b.vy > 0)).toBe(true);
  });

  it("nothing fires while still above the screen", () => {
    const e = make("gunship", 360, { param: 200 });
    const early = run(e, 100);
    expect(early.bullets).toHaveLength(0);
  });

  it("bombers fire rings that spread in every direction", () => {
    const e = make("bomber", 360, { param: 200 });
    e.y = 200;
    const { bullets } = run(e, 1500);
    const ring = bullets.slice(0, 10);
    expect(ring).toHaveLength(10);
    expect(ring.some((b) => b.vy < 0)).toBe(true);
    expect(ring.some((b) => b.vy > 0)).toBe(true);
  });

  it("snipers aim at the player with fast heavy shots", () => {
    const e = make("sniper", 100, { param: 200 });
    e.y = 200;
    const { bullets } = run(e, 1500, ctx({ playerX: 600, playerY: 900 }));
    expect(bullets[0].kind).toBe("enemyBig");
    expect(bullets[0].vx).toBeGreaterThan(0);
    expect(Math.hypot(bullets[0].vx, bullets[0].vy)).toBeGreaterThan(550);
  });

  it("spinners rotate their spiral arms over time", () => {
    const e = make("spinner", 360, { param: 200 });
    e.y = 200;
    const { bullets } = run(e, 1200);
    const angles = bullets.map((b) => Math.atan2(b.vy, b.vx));
    expect(new Set(angles.map((a) => a.toFixed(2))).size).toBeGreaterThan(6);
  });

  it("mine layers drop slow, long-lived mines", () => {
    const e = make("mineLayer", 360, { param: 200 });
    e.y = 200;
    const { bullets } = run(e, 1500);
    expect(bullets[0].kind).toBe("enemyMine");
    expect(bullets[0].ttlMs).toBeGreaterThan(5000);
    expect(Math.hypot(bullets[0].vx, bullets[0].vy)).toBeLessThan(150);
  });

  it("higher levels shoot faster and harder", () => {
    const low = make("gunship", 360, { param: 200, level: 1 });
    const high = make("gunship", 360, { param: 200, level: 50 });
    low.y = high.y = 200;
    const a = run(low, 6000, ctx({ level: 1 })).bullets;
    const b = run(high, 6000, ctx({ level: 50 })).bullets;
    expect(b.length).toBeGreaterThan(a.length);
    expect(b[0].damage).toBeGreaterThan(a[0].damage);
  });
});

describe("arcade boss phases", () => {
  it("switches pattern sets as hit points fall and resets the fire timers", () => {
    const boss = make("boss", 360, { variant: 1 });
    boss.y = 170;
    updateEnemy(boss, 16, ctx());
    expect(boss.phase).toBe(0);
    boss.hp = boss.maxHp * 0.5;
    updateEnemy(boss, 16, ctx());
    expect(boss.phase).toBe(1);
    expect(boss.fireTimers).toHaveLength(bossPatterns(1, 1).length);
    boss.hp = boss.maxHp * 0.2;
    updateEnemy(boss, 16, ctx());
    expect(boss.phase).toBe(2);
  });

  it("the last phase rains bullets from the top edge", () => {
    const boss = make("boss", 360, { variant: 0 });
    boss.y = 170;
    boss.hp = boss.maxHp * 0.1;
    const { bullets } = run(boss, 1500);
    expect(bullets.some((b) => b.y < 0 || b.y < 20)).toBe(true);
    expect(bullets.length).toBeGreaterThan(20);
  });

  it("every phase is at least as dense as the one before it", () => {
    for (let v = 0; v < 5; v++) {
      const density = (phase: number) =>
        bossPatterns(v, phase).reduce(
          (n, p) => n + (p.count * 1000) / p.intervalMs,
          0,
        );
      expect(density(1)).toBeGreaterThanOrEqual(density(0));
    }
  });

  it("all bullets stay finite and aimed into the playfield region", () => {
    const boss = make("boss", 360, { variant: 3 });
    boss.y = 170;
    const { bullets } = run(boss, 3000);
    for (const b of bullets) {
      expect(Number.isFinite(b.vx + b.vy + b.x + b.y)).toBe(true);
      expect(b.y).toBeLessThan(ARCADE_FIELD_H);
    }
  });
});

describe("arcade run difficulty from the pilot hull", () => {
  it("is neutral for a small hull and rises gently with bigger ones, with a cap", () => {
    expect(hullDifficulty(0)).toBe(1);
    expect(hullDifficulty(55)).toBe(1);
    expect(hullDifficulty(Number.NaN)).toBe(1);
    const a = hullDifficulty(110);
    const b = hullDifficulty(220);
    const c = hullDifficulty(440);
    expect(a).toBeGreaterThan(1);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    expect(a).toBeLessThan(1.1);
    expect(hullDifficulty(1e9)).toBeLessThanOrEqual(1.25);
  });

  it("toughens enemies, damage and bullet speed a little, never above the hard cap", () => {
    const base = difficultyScale(20, 1);
    const hard = difficultyScale(20, 1.2);
    expect(hard.hp).toBeCloseTo(base.hp * 1.2, 5);
    expect(hard.damage).toBeGreaterThan(base.damage);
    expect(hard.damage).toBeLessThan(base.damage * 1.2);
    expect(hard.bulletSpeed).toBeGreaterThan(base.bulletSpeed);
    expect(difficultyScale(50, 1.25).bulletSpeed).toBeLessThanOrEqual(1.75);
    expect(difficultyScale(5, 0.5)).toEqual(difficultyScale(5, 1));
  });
});
