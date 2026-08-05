import type { Vec2 } from "./combatTrajectory";

export type { Vec2 };

export type MissileStatus = "flying" | "arrived" | "hit" | "miss" | "expired";

export interface MissileConfig {
  speedPerMs: number;
  baseHitChance: number;
  minHitChance: number;
  evasionPerPx: number;
  homingEvasionFactor: number;
  maxRangeMultiplier: number;
}

export const DEFAULT_MISSILE_CONFIG: MissileConfig = {
  speedPerMs: 0.32,
  baseHitChance: 0.95,
  minHitChance: 0.15,
  evasionPerPx: 0.0016,
  homingEvasionFactor: 0.35,
  maxRangeMultiplier: 2.5,
};

export const MISSILE_ARRIVAL_EPS = 4;

export interface MissileState {
  readonly id: string;
  pos: Vec2;
  heading: number;
  readonly speedPerMs: number;
  readonly damage: number;
  readonly homing: boolean;
  readonly launchPos: Vec2;
  readonly targetLaunchPos: Vec2;
  readonly launchDistance: number;
  targetDisplacement: number;
  prevTargetPos: Vec2 | null;
  distanceFlown: number;
  status: MissileStatus;
}

function dist(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function missileTravelTime(
  distance: number,
  speedPerMs: number,
): number {
  if (speedPerMs <= 0) return Infinity;
  return Math.max(0, distance) / speedPerMs;
}

export function isMissileDone(state: MissileState): boolean {
  return (
    state.status === "hit" ||
    state.status === "miss" ||
    state.status === "expired"
  );
}

export function launchMissile(params: {
  id: string;
  from: Vec2;
  target: Vec2;
  speedPerMs: number;
  damage: number;
  homing: boolean;
}): MissileState {
  const { id, from, target, speedPerMs, damage, homing } = params;
  const launchDistance = dist(from, target);
  const heading = Math.atan2(target.y - from.y, target.x - from.x);
  return {
    id,
    pos: { x: from.x, y: from.y },
    heading,
    speedPerMs,
    damage,
    homing,
    launchPos: { x: from.x, y: from.y },
    targetLaunchPos: { x: target.x, y: target.y },
    launchDistance,
    targetDisplacement: 0,
    prevTargetPos: { x: target.x, y: target.y },
    distanceFlown: 0,
    status: "flying",
  };
}

export function missileHitChance(
  state: MissileState,
  config: MissileConfig = DEFAULT_MISSILE_CONFIG,
): number {
  const effective = state.homing
    ? state.targetDisplacement * Math.max(0, config.homingEvasionFactor)
    : state.targetDisplacement;
  const penalty = Math.max(0, config.evasionPerPx) * Math.max(0, effective);
  const chance = config.baseHitChance - penalty;
  const floor = Math.max(0, config.minHitChance);
  const ceil = Math.max(floor, config.baseHitChance);
  return Math.max(floor, Math.min(ceil, chance));
}

export function advanceMissile(
  state: MissileState,
  targetPos: Vec2 | null,
  dtMs: number,
  config: MissileConfig = DEFAULT_MISSILE_CONFIG,
): MissileState {
  if (state.status !== "flying") return state;

  if (targetPos === null) {
    return { ...state, status: "miss" };
  }

  const dt = Math.max(0, dtMs);

  let targetDisplacement = state.targetDisplacement;
  if (state.prevTargetPos) {
    targetDisplacement += dist(state.prevTargetPos, targetPos);
  }

  const aim = state.homing ? targetPos : state.targetLaunchPos;
  const toAim = dist(state.pos, aim);
  const heading = Math.atan2(aim.y - state.pos.y, aim.x - state.pos.x);

  const step = state.speedPerMs * dt;

  if (toAim <= Math.max(MISSILE_ARRIVAL_EPS, step)) {
    return {
      ...state,
      pos: { x: aim.x, y: aim.y },
      heading,
      targetDisplacement,
      prevTargetPos: { x: targetPos.x, y: targetPos.y },
      distanceFlown: state.distanceFlown + toAim,
      status: "arrived",
    };
  }

  const nx = state.pos.x + Math.cos(heading) * step;
  const ny = state.pos.y + Math.sin(heading) * step;
  const distanceFlown = state.distanceFlown + step;

  const budget = state.launchDistance * Math.max(0, config.maxRangeMultiplier);
  if (distanceFlown > budget) {
    return {
      ...state,
      pos: { x: nx, y: ny },
      heading,
      targetDisplacement,
      prevTargetPos: { x: targetPos.x, y: targetPos.y },
      distanceFlown,
      status: "expired",
    };
  }

  return {
    ...state,
    pos: { x: nx, y: ny },
    heading,
    targetDisplacement,
    prevTargetPos: { x: targetPos.x, y: targetPos.y },
    distanceFlown,
    status: "flying",
  };
}

export function resolveMissileArrival(
  state: MissileState,
  roll: number,
  config: MissileConfig = DEFAULT_MISSILE_CONFIG,
): MissileState {
  if (state.status !== "arrived") return state;
  const chance = missileHitChance(state, config);
  return { ...state, status: roll < chance ? "hit" : "miss" };
}
