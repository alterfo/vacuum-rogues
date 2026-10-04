import type { ArcadeBullet, ArcadeBulletKind } from "./arcadeTypes";

export interface BulletSpec {
  owner: "player" | "enemy";
  kind: ArcadeBulletKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  pierce?: number;
  ttlMs?: number;
  homingTurn?: number;
  waveAmp?: number;
  waveFreq?: number;
  wavePhase?: number;
  blast?: number;
}

export function makeBullet(id: number, spec: BulletSpec): ArcadeBullet {
  return {
    id,
    owner: spec.owner,
    kind: spec.kind,
    x: spec.x,
    y: spec.y,
    vx: spec.vx,
    vy: spec.vy,
    radius: spec.radius,
    damage: spec.damage,
    pierce: spec.pierce ?? 0,
    hitIds: [],
    ttlMs: spec.ttlMs ?? 0,
    ageMs: 0,
    homingTurn: spec.homingTurn ?? 0,
    waveBaseX: spec.x,
    waveAmp: spec.waveAmp ?? 0,
    waveFreq: spec.waveFreq ?? 0,
    wavePhase: spec.wavePhase ?? 0,
    blast: spec.blast ?? 0,
    speed: Math.hypot(spec.vx, spec.vy),
  };
}

export function polar(
  speed: number,
  angleDeg: number,
): { vx: number; vy: number } {
  const rad = (angleDeg * Math.PI) / 180;
  return { vx: Math.sin(rad) * speed, vy: -Math.cos(rad) * speed };
}
