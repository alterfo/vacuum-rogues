import { polar, type BulletSpec } from "./arcadeBullets";
import {
  ARCADE_BOSS_SWEEP_MARGIN,
  ARCADE_BULLET_SPEED_HARD_CAP,
  ARCADE_DIFFICULTY,
  ARCADE_FIELD_H,
  ARCADE_FIELD_W,
  ARCADE_HULL_DIFFICULTY,
  ARCADE_RUN_DIFFICULTY_DAMAGE_SHARE,
  ARCADE_RUN_DIFFICULTY_SPEED_SHARE,
} from "./arcadeConfig";
import { randomRange } from "./arcadeRng";
import type {
  ArcadeBulletKind,
  ArcadeEnemy,
  ArcadeEnemyTypeId,
  ArcadeSpawn,
} from "./arcadeTypes";

export type ArcadeMoveKind =
  | "straight"
  | "weave"
  | "dive"
  | "hover"
  | "strafe"
  | "ground"
  | "tank"
  | "carrier"
  | "boss";

export type ArcadePatternKind =
  | "aimed"
  | "spread"
  | "ring"
  | "spiral"
  | "rain"
  | "mines"
  | "burst";

export interface FirePattern {
  kind: ArcadePatternKind;
  intervalMs: number;
  delayMs: number;
  count: number;
  speed: number;
  spreadDeg: number;
  bullet: ArcadeBulletKind;
  damage: number;
}

export interface ArcadeEnemyDef {
  id: ArcadeEnemyTypeId;
  radius: number;
  hp: number;
  speed: number;
  contactDamage: number;
  score: number;
  move: ArcadeMoveKind;
  minLevel: number;
  tier: "small" | "medium" | "large" | "mini" | "boss";
  ground: boolean;
  dropChance: number;
  patterns: readonly FirePattern[];
}

function pattern(
  kind: ArcadePatternKind,
  intervalMs: number,
  count: number,
  speed: number,
  damage: number,
  bullet: ArcadeBulletKind,
  spreadDeg = 0,
  delayMs = 500,
): FirePattern {
  return { kind, intervalMs, delayMs, count, speed, spreadDeg, bullet, damage };
}

export const ARCADE_ENEMY_DEFS: Readonly<
  Record<ArcadeEnemyTypeId, ArcadeEnemyDef>
> = {
  scout: {
    id: "scout",
    radius: 16,
    hp: 18,
    speed: 230,
    contactDamage: 12,
    score: 10,
    move: "straight",
    minLevel: 1,
    tier: "small",
    ground: false,
    dropChance: 0.05,
    patterns: [],
  },
  weaver: {
    id: "weaver",
    radius: 16,
    hp: 22,
    speed: 180,
    contactDamage: 12,
    score: 15,
    move: "weave",
    minLevel: 1,
    tier: "small",
    ground: false,
    dropChance: 0.06,
    patterns: [pattern("aimed", 1800, 1, 330, 8, "enemyNeedle", 0, 700)],
  },
  diver: {
    id: "diver",
    radius: 15,
    hp: 20,
    speed: 260,
    contactDamage: 22,
    score: 20,
    move: "dive",
    minLevel: 3,
    tier: "small",
    ground: false,
    dropChance: 0.06,
    patterns: [],
  },
  gunship: {
    id: "gunship",
    radius: 26,
    hp: 90,
    speed: 120,
    contactDamage: 20,
    score: 40,
    move: "hover",
    minLevel: 2,
    tier: "medium",
    ground: false,
    dropChance: 0.14,
    patterns: [pattern("spread", 1500, 3, 300, 9, "enemyOrb", 28, 400)],
  },
  bomber: {
    id: "bomber",
    radius: 30,
    hp: 130,
    speed: 90,
    contactDamage: 24,
    score: 60,
    move: "hover",
    minLevel: 6,
    tier: "medium",
    ground: false,
    dropChance: 0.16,
    patterns: [pattern("ring", 2200, 10, 220, 8, "enemyOrb", 0, 600)],
  },
  sniper: {
    id: "sniper",
    radius: 24,
    hp: 80,
    speed: 150,
    contactDamage: 20,
    score: 55,
    move: "hover",
    minLevel: 9,
    tier: "medium",
    ground: false,
    dropChance: 0.16,
    patterns: [pattern("aimed", 1700, 1, 620, 16, "enemyBig", 0, 900)],
  },
  carrier: {
    id: "carrier",
    radius: 30,
    hp: 160,
    speed: 75,
    contactDamage: 24,
    score: 80,
    move: "carrier",
    minLevel: 4,
    tier: "large",
    ground: false,
    dropChance: 1,
    patterns: [],
  },
  strafer: {
    id: "strafer",
    radius: 18,
    hp: 28,
    speed: 300,
    contactDamage: 14,
    score: 25,
    move: "strafe",
    minLevel: 5,
    tier: "small",
    ground: false,
    dropChance: 0.07,
    patterns: [pattern("spread", 260, 1, 380, 6, "enemyNeedle", 0, 200)],
  },
  turret: {
    id: "turret",
    radius: 20,
    hp: 45,
    speed: 0,
    contactDamage: 0,
    score: 20,
    move: "ground",
    minLevel: 1,
    tier: "small",
    ground: true,
    dropChance: 0.08,
    patterns: [pattern("aimed", 1400, 1, 340, 8, "enemyOrb", 0, 600)],
  },
  tank: {
    id: "tank",
    radius: 26,
    hp: 110,
    speed: 60,
    contactDamage: 0,
    score: 45,
    move: "tank",
    minLevel: 3,
    tier: "medium",
    ground: true,
    dropChance: 0.14,
    patterns: [pattern("spread", 1800, 3, 300, 9, "enemyOrb", 24, 500)],
  },
  mineLayer: {
    id: "mineLayer",
    radius: 26,
    hp: 120,
    speed: 110,
    contactDamage: 22,
    score: 60,
    move: "hover",
    minLevel: 8,
    tier: "medium",
    ground: false,
    dropChance: 0.16,
    patterns: [pattern("mines", 1300, 1, 90, 18, "enemyMine", 0, 700)],
  },
  armored: {
    id: "armored",
    radius: 34,
    hp: 340,
    speed: 70,
    contactDamage: 30,
    score: 100,
    move: "straight",
    minLevel: 10,
    tier: "large",
    ground: false,
    dropChance: 0.3,
    patterns: [pattern("spread", 420, 2, 420, 8, "enemyNeedle", 10, 600)],
  },
  spinner: {
    id: "spinner",
    radius: 28,
    hp: 150,
    speed: 100,
    contactDamage: 24,
    score: 70,
    move: "hover",
    minLevel: 12,
    tier: "medium",
    ground: false,
    dropChance: 0.18,
    patterns: [pattern("spiral", 120, 3, 260, 7, "enemyOrb", 0, 600)],
  },
  cruiser: {
    id: "cruiser",
    radius: 52,
    hp: 900,
    speed: 80,
    contactDamage: 40,
    score: 400,
    move: "boss",
    minLevel: 5,
    tier: "mini",
    ground: false,
    dropChance: 1,
    patterns: [
      pattern("aimed", 1400, 5, 340, 10, "enemyOrb", 40, 700),
      pattern("ring", 3200, 12, 200, 9, "enemyOrb", 0, 1500),
      pattern("aimed", 300, 1, 480, 6, "enemyNeedle", 0, 900),
    ],
  },
  boss: {
    id: "boss",
    radius: 70,
    hp: 3200,
    speed: 90,
    contactDamage: 50,
    score: 2000,
    move: "boss",
    minLevel: 10,
    tier: "boss",
    ground: false,
    dropChance: 1,
    patterns: [],
  },
};

export function bossPatterns(variant: number, phase: number): FirePattern[] {
  const v = variant;
  if (phase <= 0) {
    return [
      pattern("spread", 1300, 5 + v, 320, 10, "enemyOrb", 50, 900),
      pattern("aimed", 500, 1, 520, 7, "enemyNeedle", 0, 700),
    ];
  }
  if (phase === 1) {
    return [
      pattern("ring", 1900, 14 + 2 * v, 240, 10, "enemyOrb", 0, 600),
      pattern("spiral", 130, 2 + Math.floor(v / 2), 270, 8, "enemyOrb", 0, 400),
      pattern("aimed", 900, 3, 460, 8, "enemyNeedle", 20, 800),
    ];
  }
  return [
    pattern("rain", 150, 1, 360 + v * 10, 9, "enemyNeedle", 0, 300),
    pattern("spiral", 100, 4, 300, 9, "enemyOrb", 0, 300),
    pattern("spread", 1100, 9, 340, 10, "enemyBig", 80, 600),
  ];
}

export function enemyPatterns(enemy: ArcadeEnemy): readonly FirePattern[] {
  if (enemy.type === "boss") return bossPatterns(enemy.variant, enemy.phase);
  return ARCADE_ENEMY_DEFS[enemy.type].patterns;
}

export function hullDifficulty(maxHull: number): number {
  if (!Number.isFinite(maxHull) || maxHull <= ARCADE_HULL_DIFFICULTY.baseHull) {
    return 1;
  }
  const doublings = Math.log2(maxHull / ARCADE_HULL_DIFFICULTY.baseHull);
  return Math.min(
    ARCADE_HULL_DIFFICULTY.cap,
    1 + ARCADE_HULL_DIFFICULTY.perDoubling * doublings,
  );
}

export function difficultyScale(
  level: number,
  run = 1,
): {
  hp: number;
  damage: number;
  bulletSpeed: number;
  fireInterval: number;
} {
  const n = Math.max(0, level - 1);
  const extra = Math.max(0, run - 1);
  return {
    hp: (1 + ARCADE_DIFFICULTY.hpPerLevel * n) * (1 + extra),
    damage:
      (1 + ARCADE_DIFFICULTY.damagePerLevel * n) *
      (1 + extra * ARCADE_RUN_DIFFICULTY_DAMAGE_SHARE),
    bulletSpeed: Math.min(
      ARCADE_BULLET_SPEED_HARD_CAP,
      Math.min(
        ARCADE_DIFFICULTY.bulletSpeedCap,
        1 + ARCADE_DIFFICULTY.bulletSpeedPerLevel * n,
      ) *
        (1 + extra * ARCADE_RUN_DIFFICULTY_SPEED_SHARE),
    ),
    fireInterval: Math.max(
      ARCADE_DIFFICULTY.fireIntervalFloor,
      1 - ARCADE_DIFFICULTY.fireRatePerLevel * n,
    ),
  };
}

export function createEnemy(
  id: number,
  spawn: ArcadeSpawn,
  level: number,
  groundY: number,
  run = 1,
): ArcadeEnemy {
  const def = ARCADE_ENEMY_DEFS[spawn.type];
  const scale = difficultyScale(level, run);
  const hp = Math.round(
    def.hp * scale.hp * (spawn.type === "boss" ? 1 + spawn.variant * 0.35 : 1),
  );
  const patterns =
    spawn.type === "boss" ? bossPatterns(spawn.variant, 0) : def.patterns;
  const startY = spawn.y ?? (def.ground ? groundY : -def.radius - 20);
  return {
    id,
    type: spawn.type,
    variant: spawn.variant,
    x: spawn.x,
    y: startY,
    vx: 0,
    vy: 0,
    radius: def.radius,
    hp,
    maxHp: hp,
    ageMs: 0,
    originX: spawn.x,
    param: spawn.param,
    dir: spawn.dir >= 0 ? 1 : -1,
    fireTimers: patterns.map((p) => p.delayMs),
    phase: 0,
    hitFlashMs: 0,
    drop: spawn.drop,
    ground: def.ground,
    isBoss: def.tier === "boss" || def.tier === "mini",
    spawnTimerMs: 1800,
    holdMs: 0,
  };
}

export interface EnemyContext {
  playerX: number;
  playerY: number;
  scrollSpeed: number;
  level: number;
  difficulty: number;
  rng: { rngState: number };
  nextId: () => number;
}

export interface EnemyUpdateResult {
  bullets: BulletSpec[];
  spawns: ArcadeSpawn[];
}

const BOSS_HOVER_Y = 170;

function applyMovement(
  enemy: ArcadeEnemy,
  def: ArcadeEnemyDef,
  dtSec: number,
  ctx: EnemyContext,
): void {
  const ageSec = enemy.ageMs / 1000;
  switch (def.move) {
    case "straight":
      enemy.y += def.speed * dtSec;
      break;
    case "weave": {
      enemy.y += def.speed * dtSec;
      const amplitude = enemy.param > 0 ? enemy.param : 110;
      enemy.x = enemy.originX + Math.sin(ageSec * 3.2 * enemy.dir) * amplitude;
      break;
    }
    case "dive": {
      if (enemy.ageMs < 650) {
        enemy.y += def.speed * 0.6 * dtSec;
      } else {
        if (enemy.vx === 0 && enemy.vy === 0) {
          const dx = ctx.playerX - enemy.x;
          const dy = ctx.playerY - enemy.y;
          const len = Math.hypot(dx, dy) || 1;
          enemy.vx = (dx / len) * def.speed * 2;
          enemy.vy = (dy / len) * def.speed * 2;
        }
        enemy.x += enemy.vx * dtSec;
        enemy.y += enemy.vy * dtSec;
      }
      break;
    }
    case "hover": {
      const hoverY = enemy.param > 0 ? enemy.param : 190;
      const hoverMs = 6500;
      if (enemy.y < hoverY && enemy.vy === 0) {
        enemy.y += def.speed * dtSec;
      } else if (enemy.vy === 0 && enemy.ageMs < hoverMs + 2000) {
        enemy.x += Math.sin(ageSec * 1.4 * enemy.dir) * 40 * dtSec;
        if (enemy.ageMs > hoverMs) enemy.vy = 1;
      } else {
        enemy.vy = 1;
        enemy.y += def.speed * 1.8 * dtSec;
      }
      break;
    }
    case "strafe": {
      const laneY = enemy.param > 0 ? enemy.param : 220;
      if (enemy.ageMs === 0)
        enemy.x = enemy.dir > 0 ? -30 : ARCADE_FIELD_W + 30;
      if (enemy.y < laneY) enemy.y += def.speed * dtSec;
      else enemy.x += enemy.dir * def.speed * dtSec;
      break;
    }
    case "ground":
      enemy.y += ctx.scrollSpeed * dtSec;
      break;
    case "tank": {
      enemy.y += ctx.scrollSpeed * dtSec;
      enemy.x += enemy.dir * def.speed * dtSec;
      if (enemy.x < 60) enemy.dir = 1;
      if (enemy.x > ARCADE_FIELD_W - 60) enemy.dir = -1;
      break;
    }
    case "carrier": {
      enemy.y += def.speed * dtSec;
      enemy.x = enemy.originX + Math.sin(ageSec * 1.1 * enemy.dir) * 70;
      break;
    }
    case "boss": {
      if (enemy.holdMs <= 0 && enemy.y < BOSS_HOVER_Y) {
        enemy.y = Math.min(BOSS_HOVER_Y, enemy.y + def.speed * 1.4 * dtSec);
        if (enemy.y >= BOSS_HOVER_Y) enemy.holdMs = 0.001;
      } else {
        enemy.holdMs += dtSec * 1000;
        const hold = enemy.holdMs / 1000;
        const ramp = Math.min(1, hold / 2);
        const eased = ramp * ramp * (3 - 2 * ramp);
        const reach =
          ARCADE_FIELD_W / 2 - enemy.radius - ARCADE_BOSS_SWEEP_MARGIN;
        const span = Math.min(enemy.type === "boss" ? 210 : 170, reach) * eased;
        const rate = 0.8 + enemy.variant * 0.06;
        enemy.x = ARCADE_FIELD_W / 2 + Math.sin(hold * rate) * span;
        enemy.y = BOSS_HOVER_Y + Math.sin(hold * 0.5) * 24 * eased;
      }
      break;
    }
  }
}

function updatePhase(enemy: ArcadeEnemy): void {
  if (enemy.type !== "boss") return;
  const ratio = enemy.hp / enemy.maxHp;
  const phase = ratio > 0.66 ? 0 : ratio > 0.33 ? 1 : 2;
  if (phase !== enemy.phase) {
    enemy.phase = phase;
    enemy.fireTimers = bossPatterns(enemy.variant, phase).map((p) => p.delayMs);
  }
}

function emitPattern(
  enemy: ArcadeEnemy,
  p: FirePattern,
  ctx: EnemyContext,
  scale: ReturnType<typeof difficultyScale>,
): BulletSpec[] {
  const speed = p.speed * scale.bulletSpeed;
  const damage = Math.round(p.damage * scale.damage);
  const radius =
    p.bullet === "enemyBig"
      ? 11
      : p.bullet === "enemyMine"
        ? 15
        : p.bullet === "enemyNeedle"
          ? 4
          : 6;
  const make = (
    x: number,
    y: number,
    angleFromDownDeg: number,
    spd: number,
  ): BulletSpec => {
    const v = polar(spd, 180 - angleFromDownDeg);
    return {
      owner: "enemy",
      kind: p.bullet,
      x,
      y,
      vx: v.vx,
      vy: v.vy,
      radius,
      damage,
      ttlMs: p.bullet === "enemyMine" ? 9000 : 0,
    };
  };
  const out: BulletSpec[] = [];
  const aimDeg =
    (Math.atan2(ctx.playerX - enemy.x, ctx.playerY - enemy.y) * 180) / Math.PI;
  switch (p.kind) {
    case "aimed":
    case "burst": {
      for (let i = 0; i < p.count; i++) {
        const offset =
          p.count > 1 ? (i / (p.count - 1) - 0.5) * p.spreadDeg : 0;
        out.push(make(enemy.x, enemy.y, aimDeg + offset, speed));
      }
      break;
    }
    case "spread": {
      for (let i = 0; i < p.count; i++) {
        const offset =
          p.count > 1 ? (i / (p.count - 1) - 0.5) * p.spreadDeg : 0;
        out.push(make(enemy.x, enemy.y, offset, speed));
      }
      break;
    }
    case "ring": {
      const base = (enemy.ageMs / 40) % 360;
      for (let i = 0; i < p.count; i++) {
        out.push(make(enemy.x, enemy.y, base + (360 / p.count) * i, speed));
      }
      break;
    }
    case "spiral": {
      const base = (enemy.ageMs * 0.32) % 360;
      for (let i = 0; i < p.count; i++) {
        out.push(make(enemy.x, enemy.y, base + (360 / p.count) * i, speed));
      }
      break;
    }
    case "rain": {
      const x = randomRange(ctx.rng, 20, ARCADE_FIELD_W - 20);
      out.push(make(x, -10, 0, speed));
      break;
    }
    case "mines": {
      const dx = randomRange(ctx.rng, -30, 30);
      out.push(make(enemy.x + dx, enemy.y + 10, 0, speed));
      break;
    }
  }
  return out;
}

export function updateEnemy(
  enemy: ArcadeEnemy,
  dtMs: number,
  ctx: EnemyContext,
): EnemyUpdateResult {
  const def = ARCADE_ENEMY_DEFS[enemy.type];
  const dtSec = dtMs / 1000;
  const result: EnemyUpdateResult = { bullets: [], spawns: [] };

  applyMovement(enemy, def, dtSec, ctx);
  enemy.ageMs += dtMs;
  if (enemy.hitFlashMs > 0)
    enemy.hitFlashMs = Math.max(0, enemy.hitFlashMs - dtMs);
  updatePhase(enemy);

  const onScreen = enemy.y > 10 && enemy.y < ARCADE_FIELD_H - 60;
  const scale = difficultyScale(ctx.level, ctx.difficulty);
  const patterns = enemyPatterns(enemy);
  for (let i = 0; i < patterns.length; i++) {
    enemy.fireTimers[i] = (enemy.fireTimers[i] ?? patterns[i].delayMs) - dtMs;
    if (enemy.fireTimers[i] > 0) continue;
    if (!onScreen) {
      enemy.fireTimers[i] = 0;
      continue;
    }
    result.bullets.push(...emitPattern(enemy, patterns[i], ctx, scale));
    enemy.fireTimers[i] = patterns[i].intervalMs * scale.fireInterval;
  }

  if (enemy.type === "carrier") {
    enemy.spawnTimerMs -= dtMs;
    if (enemy.spawnTimerMs <= 0 && enemy.y > 20 && enemy.y < 500) {
      enemy.spawnTimerMs = 2600;
      for (const side of [-1, 1]) {
        result.spawns.push({
          atMs: 0,
          type: "scout",
          x: Math.min(ARCADE_FIELD_W - 30, Math.max(30, enemy.x + side * 34)),
          y: enemy.y,
          variant: 0,
          param: 0,
          dir: 1,
          drop: null,
        });
      }
    }
  }
  return result;
}
