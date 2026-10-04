import { makeBullet, polar, type BulletSpec } from "./arcadeBullets";
import { ARCADE_WEAPON_MAX_LEVEL, type ArcadeVec } from "./arcadeConfig";
import type { ArcadeBullet, ArcadeEnemy, ArcadeWeaponId } from "./arcadeTypes";

export interface WeaponFireResult {
  bullets: BulletSpec[];
  arcTargets: { enemyId: number; damage: number }[];
  arcPoints: ArcadeVec[];
}

export interface WeaponDef {
  id: ArcadeWeaponId;
  color: number;
  intervalMs: (level: number) => number;
}

export const ARCADE_WEAPONS: Readonly<Record<ArcadeWeaponId, WeaponDef>> = {
  vulcan: { id: "vulcan", color: 0xff4d4d, intervalMs: () => 115 },
  laser: { id: "laser", color: 0x4da6ff, intervalMs: () => 85 },
  homing: { id: "homing", color: 0x5eea7a, intervalMs: () => 380 },
  wave: { id: "wave", color: 0x39e0e0, intervalMs: () => 150 },
  plasma: { id: "plasma", color: 0xff9a3c, intervalMs: () => 360 },
  arc: { id: "arc", color: 0xc78bff, intervalMs: () => 95 },
};

const VULCAN_FANS: readonly (readonly number[])[] = [
  [0],
  [-5, 5],
  [-11, 0, 11],
  [-18, -6, 6, 18],
  [-26, -13, 0, 13, 26],
];

const LASER_LANES: readonly (readonly number[])[] = [
  [0],
  [-9, 9],
  [-16, 0, 16],
  [-24, -8, 8, 24],
  [-32, -16, 0, 16, 32],
];

const ARC_CHAIN = [2, 3, 4, 5, 7];
const ARC_RANGE = 460;
const ARC_HOP_RANGE = 230;

function clampLevel(level: number): number {
  return Math.min(ARCADE_WEAPON_MAX_LEVEL, Math.max(1, Math.floor(level)));
}

function vulcan(level: number, x: number, y: number): BulletSpec[] {
  return VULCAN_FANS[level - 1].map((angle) => ({
    owner: "player",
    kind: "pulse",
    x,
    y: y - 18,
    ...polar(1350, angle),
    radius: 5,
    damage: 10,
  }));
}

function laser(level: number, x: number, y: number): BulletSpec[] {
  const damage = 13 + level * 2;
  const pierce = level + 1;
  return LASER_LANES[level - 1].map((offset) => ({
    owner: "player",
    kind: "laser",
    x: x + offset,
    y: y - 20,
    vx: 0,
    vy: -2100,
    radius: 4,
    damage,
    pierce,
  }));
}

function homing(level: number, x: number, y: number): BulletSpec[] {
  const missiles = level * 2;
  const bullets: BulletSpec[] = [];
  for (let i = 0; i < missiles; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const spread = 18 + Math.floor(i / 2) * 14;
    bullets.push({
      owner: "player",
      kind: "missile",
      x: x + side * 14,
      y,
      ...polar(620, side * spread),
      radius: 7,
      damage: 20 + level * 2,
      ttlMs: 2800,
      homingTurn: 5.5,
      blast: 36,
    });
  }
  bullets.push({
    owner: "player",
    kind: "pulse",
    x,
    y: y - 18,
    vx: 0,
    vy: -1300,
    radius: 5,
    damage: 7,
  });
  return bullets;
}

function wave(level: number, x: number, y: number): BulletSpec[] {
  const pairs = Math.ceil((level + 1) / 2);
  const bullets: BulletSpec[] = [];
  for (let i = 0; i < pairs; i++) {
    const amp = 40 + i * 32;
    for (const phase of [0, Math.PI]) {
      bullets.push({
        owner: "player",
        kind: "wave",
        x,
        y: y - 14,
        vx: 0,
        vy: -900,
        radius: 7,
        damage: 11 + level,
        pierce: 1,
        waveAmp: amp,
        waveFreq: 9 - i * 1.4,
        wavePhase: phase,
      });
    }
  }
  return bullets;
}

function plasma(level: number, x: number, y: number): BulletSpec[] {
  const balls = level >= 4 ? 3 : level >= 2 ? 2 : 1;
  const angles = balls === 1 ? [0] : balls === 2 ? [-7, 7] : [-12, 0, 12];
  return angles.map((angle) => ({
    owner: "player",
    kind: "plasma",
    x,
    y: y - 22,
    ...polar(560, angle),
    radius: 15 + level * 1.5,
    damage: 30 + level * 8,
    blast: 60 + level * 14,
  }));
}

function arc(
  level: number,
  x: number,
  y: number,
  enemies: readonly ArcadeEnemy[],
): { targets: { enemyId: number; damage: number }[]; points: ArcadeVec[] } {
  const damage = 8 + level * 2;
  const remaining = enemies.filter(
    (e) => e.y < y && e.y > -40 && Math.hypot(e.x - x, e.y - y) <= ARC_RANGE,
  );
  const targets: { enemyId: number; damage: number }[] = [];
  const points: ArcadeVec[] = [{ x, y: y - 12 }];
  let cx = x;
  let cy = y;
  let range = ARC_RANGE;
  for (let hop = 0; hop < ARC_CHAIN[level - 1]; hop++) {
    let best: ArcadeEnemy | null = null;
    let bestDist = range;
    for (const e of remaining) {
      if (targets.some((t) => t.enemyId === e.id)) continue;
      const d = Math.hypot(e.x - cx, e.y - cy);
      if (d <= bestDist) {
        best = e;
        bestDist = d;
      }
    }
    if (!best) break;
    targets.push({ enemyId: best.id, damage });
    points.push({ x: best.x, y: best.y });
    cx = best.x;
    cy = best.y;
    range = ARC_HOP_RANGE;
  }
  return { targets, points };
}

export function fireWeapon(
  weapon: ArcadeWeaponId,
  rawLevel: number,
  x: number,
  y: number,
  enemies: readonly ArcadeEnemy[],
): WeaponFireResult {
  const level = clampLevel(rawLevel);
  const empty: WeaponFireResult = {
    bullets: [],
    arcTargets: [],
    arcPoints: [],
  };
  switch (weapon) {
    case "vulcan":
      return { ...empty, bullets: vulcan(level, x, y) };
    case "laser":
      return { ...empty, bullets: laser(level, x, y) };
    case "homing":
      return { ...empty, bullets: homing(level, x, y) };
    case "wave":
      return { ...empty, bullets: wave(level, x, y) };
    case "plasma":
      return { ...empty, bullets: plasma(level, x, y) };
    case "arc": {
      const result = arc(level, x, y, enemies);
      return {
        bullets: [],
        arcTargets: result.targets,
        arcPoints: result.points.length > 1 ? result.points : [],
      };
    }
  }
}

export function fireDrone(x: number, y: number): BulletSpec {
  return {
    owner: "player",
    kind: "drone",
    x,
    y: y - 10,
    vx: 0,
    vy: -1100,
    radius: 4,
    damage: 6,
  };
}

export function spawnBullets(
  specs: readonly BulletSpec[],
  nextId: () => number,
): ArcadeBullet[] {
  return specs.map((spec) => makeBullet(nextId(), spec));
}

export function weaponInterval(weapon: ArcadeWeaponId, level: number): number {
  return ARCADE_WEAPONS[weapon].intervalMs(clampLevel(level));
}
