/**
 * Missile projectile mechanic — travel time + evasion. Pure, PixiJS-free.
 *
 * Task 7 of the pause-and-plan combat rework
 * (`docs/plans/20260713-tactical-pause-combat-rework.md`). Every weapon class except
 * `WeaponClass.MISSILE` resolves as an instant hit-scan (the `CombatHud` tracer is VFX
 * only). A missile instead becomes a **tracked entity** that travels toward its target over
 * time: it launches from the firing ship, flies at a finite `speedPerMs`, and only resolves
 * hit/miss when it **arrives**. This is what finally consumes the previously flavor-only
 * `WeaponClass.MISSILE` (travel-time) and `WeaponAbility.HOMING` (live re-aim + reduced
 * evasion) fields for real behaviour.
 *
 * **Evasion resolution rule (recorded, Task 7 decision)**: hit probability is resolved *at
 * arrival* and is inversely tied to how far the target **maneuvered during the missile's
 * flight** — the accumulated path length the target travelled from launch to arrival, not
 * its instantaneous speed. A stationary target is hit at `baseHitChance` (near-certain); each
 * px of target travel subtracts `evasionPerPx` from the hit chance, floored at `minHitChance`
 * so a wildly-weaving target can always *possibly* be hit. A **homing** missile re-aims at the
 * target's live position each frame and therefore suffers only `homingEvasionFactor` (<1) of
 * that displacement penalty — homing trades a straight-line flight for evasion resistance. The
 * probability is a pure function of the accumulated displacement; the actual hit/miss is
 * resolved by comparing it against an injected `roll ∈ [0,1)` (`resolveMissileArrival`), so the
 * whole mechanic is deterministic and unit-testable with no RNG in the module.
 *
 * A destroyed / removed target (advance called with a `null` target position) or a target that
 * outruns the missile past its range budget resolves to a terminal `"miss"` / `"expired"`
 * state — never a dangling flying entity (`isMissileDone` / the execute-phase sweep despawn it).
 *
 * Kept a pure module (no PixiJS / no scene deps), unit-tested standalone — the same discipline
 * as `combatPlanning` / `combatTrajectory` / `combatGravity`. Live tuning comes from
 * `MISSILE_COMBAT` in `balance.ts`; the scene passes it in so tune-in-one-place holds.
 */

import type { Vec2 } from "./combatTrajectory";

export type { Vec2 };

/** Terminal (`hit`/`miss`/`expired`) or in-flight (`flying`/`arrived`) missile status. */
export type MissileStatus = "flying" | "arrived" | "hit" | "miss" | "expired";

/** Tuning for the missile flight + evasion resolution; mirrors `MISSILE_COMBAT` in `balance.ts`. */
export interface MissileConfig {
  /** Travel speed (px/ms) — with the launch distance this fixes the travel time. */
  speedPerMs: number;
  /** Hit chance against a target that never moved during the missile's flight (0..1). */
  baseHitChance: number;
  /** Floor on the hit chance — even a wildly-maneuvering target can still be hit (0..1). */
  minHitChance: number;
  /** Hit chance lost per px of target displacement (path length) during the flight. */
  evasionPerPx: number;
  /** A homing missile suffers only this fraction of the displacement penalty (0..1, <1). */
  homingEvasionFactor: number;
  /**
   * Range budget: the missile expires if it flies farther than
   * `launchDistance × maxRangeMultiplier` without arriving — i.e. the target outran it.
   */
  maxRangeMultiplier: number;
}

/** Module-local default, mirroring `MISSILE_COMBAT` so this file stays import-light for tests. */
export const DEFAULT_MISSILE_CONFIG: MissileConfig = {
  speedPerMs: 0.32,
  baseHitChance: 0.95,
  minHitChance: 0.15,
  evasionPerPx: 0.0016,
  homingEvasionFactor: 0.35,
  maxRangeMultiplier: 2.5,
};

/** Distance (px) within which an advancing missile counts as arriving at its aim point. */
export const MISSILE_ARRIVAL_EPS = 4;

/**
 * A live missile entity. Position/heading/status/accumulators mutate as it advances; the
 * launch geometry and per-missile stats are `readonly`. Terminal statuses (`hit`/`miss`/
 * `expired`) are final — advancing a done missile is a no-op.
 */
export interface MissileState {
  readonly id: string;
  /** Current world position (px). */
  pos: Vec2;
  /** Current travel heading (rad). */
  heading: number;
  /** Travel speed (px/ms). */
  readonly speedPerMs: number;
  /** Damage dealt on a resolved hit. */
  readonly damage: number;
  /** Homing missiles re-aim at the live target and resist evasion. */
  readonly homing: boolean;
  /** Where the missile was fired from. */
  readonly launchPos: Vec2;
  /** The target's position at launch — the fixed aim point for a non-homing missile. */
  readonly targetLaunchPos: Vec2;
  /** Straight-line launch distance (px) — the range-budget baseline. */
  readonly launchDistance: number;
  /** Accumulated path length (px) the target has travelled during the flight (evasion input). */
  targetDisplacement: number;
  /** Target position seen on the previous advance, for path-length accumulation. */
  prevTargetPos: Vec2 | null;
  /** Total distance (px) the missile itself has flown, for the range budget. */
  distanceFlown: number;
  status: MissileStatus;
}

function dist(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Time (ms) a missile takes to cover `distance` at `speedPerMs`. `Infinity` for a
 * non-positive speed (a zero-speed missile never arrives). Never negative.
 */
export function missileTravelTime(
  distance: number,
  speedPerMs: number,
): number {
  if (speedPerMs <= 0) return Infinity;
  return Math.max(0, distance) / speedPerMs;
}

/** Terminal-state test — a done missile (`hit`/`miss`/`expired`) despawns; a flying one is kept. */
export function isMissileDone(state: MissileState): boolean {
  return (
    state.status === "hit" ||
    state.status === "miss" ||
    state.status === "expired"
  );
}

/**
 * Launch a missile from `from` at `target`'s current position. Heading points straight at
 * the target; a homing missile will re-aim each frame, a non-homing one flies this fixed line.
 */
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

/**
 * The hit probability the missile would resolve at arrival, given the target displacement
 * accumulated so far — the pure evasion curve: `baseHitChance` minus the per-px penalty
 * (scaled by `homingEvasionFactor` for a homing missile), clamped to `[minHitChance,
 * baseHitChance]`. A stationary target ⇒ `baseHitChance`; a far-travelled one ⇒ `minHitChance`.
 */
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

/**
 * Advance a flying missile by `dtMs` toward its aim point.
 *
 * `targetPos` is the target's *live* position, or `null` when the target has been
 * destroyed/removed — a `null` target immediately resolves the missile to `"miss"` (clean
 * despawn, no dangling entity). A homing missile aims at the live `targetPos`; a non-homing
 * one flies the fixed line to `targetLaunchPos`. The target's frame-to-frame travel is
 * accumulated into `targetDisplacement` (the evasion input). The missile resolves to:
 * - `"arrived"` when it reaches within {@link MISSILE_ARRIVAL_EPS} of its aim (caller then
 *   runs {@link resolveMissileArrival} with a roll to settle hit vs. miss);
 * - `"expired"` when it has flown past its range budget (`launchDistance × maxRangeMultiplier`)
 *   without arriving — the target outran it;
 * - `"miss"` when `targetPos` is `null`.
 *
 * A missile already in a terminal/`arrived` state is returned unchanged (idempotent — advancing
 * a done or arrived entity never moves it).
 */
export function advanceMissile(
  state: MissileState,
  targetPos: Vec2 | null,
  dtMs: number,
  config: MissileConfig = DEFAULT_MISSILE_CONFIG,
): MissileState {
  if (state.status !== "flying") return state;

  // A destroyed/removed target: the missile has nothing to strike — clean miss, no dangling.
  if (targetPos === null) {
    return { ...state, status: "miss" };
  }

  const dt = Math.max(0, dtMs);

  // Accumulate how far the target has maneuvered this frame (the evasion input).
  let targetDisplacement = state.targetDisplacement;
  if (state.prevTargetPos) {
    targetDisplacement += dist(state.prevTargetPos, targetPos);
  }

  // Homing re-aims at the live target; a dumb missile holds its launch-time aim line.
  const aim = state.homing ? targetPos : state.targetLaunchPos;
  const toAim = dist(state.pos, aim);
  const heading = Math.atan2(aim.y - state.pos.y, aim.x - state.pos.x);

  const step = state.speedPerMs * dt;

  // Arrival: this step reaches the aim point (or already within the epsilon).
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

  // Range budget exhausted without arriving — the target outran the missile.
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

/**
 * Settle an `"arrived"` missile into `"hit"` or `"miss"` by comparing its evasion-adjusted
 * {@link missileHitChance} against an injected `roll ∈ [0,1)` — a hit iff `roll < hitChance`.
 * Injecting the roll keeps the module deterministic and RNG-free; the caller supplies the
 * random draw. A missile not in the `"arrived"` state is returned unchanged.
 */
export function resolveMissileArrival(
  state: MissileState,
  roll: number,
  config: MissileConfig = DEFAULT_MISSILE_CONFIG,
): MissileState {
  if (state.status !== "arrived") return state;
  const chance = missileHitChance(state, config);
  return { ...state, status: roll < chance ? "hit" : "miss" };
}
