/**
 * Ship-wreck drift + staggered loot emission — the death-aftermath physics of a destroyed ship.
 * Pure, PixiJS-free.
 *
 * Task 14 of the pause-and-plan combat rework
 * (`docs/plans/20260713-tactical-pause-combat-rework.md`). Today a kill spawns a one-shot
 * `shipDeathFx` spark burst and `LootDropHandler` dumps every cargo dot at a single fixed point at
 * the instant of death. This module adds the missing middle: an **actual wreck** that inherits the
 * destroyed ship's last velocity/heading and coasts on with that inertia (a slow drag decay + a
 * lazy tumble) before fading out, and a **staggered loot schedule** so cargo dots peel off the
 * *drifting* wreck over its lifetime rather than all at once at the death point.
 *
 * It owns only the geometry/timing — no PixiJS, no scene, no domain deps — so the drift kinematics
 * and the emission scheduler are unit-tested standalone, the same discipline as `combatPlanning` /
 * `combatTrajectory` / `combatGravity` / `combatMissile` / `combatAfterburner` / `combatBanking`.
 * The renderer (`combatWreckRenderer.ts`) mirrors a `WreckState` 1:1 onto a hull-silhouette
 * `Graphics`; the execute-phase loop steps the wreck each frame and spawns a `LootDropHandler` dot
 * at the wreck's live position for each `dueLootEmissions` index. Live tuning comes from `WRECK` in
 * `balance.ts`; the scene passes it in so tune-in-one-place holds.
 */

/** Tuning for wreck drift + fade + loot cadence; mirrors `WRECK` in `balance.ts`. */
export interface WreckConfig {
  /** Fraction of velocity retained per ms of drift (drag): `v_next = v × driftRetentionPerMs^dt`.
   *  In `(0,1]`; nearer 1 = the wreck coasts farther before slowing. */
  driftRetentionPerMs: number;
  /** Total wreck lifetime (ms) from death to despawn. */
  lifeMs: number;
  /** Fade-out window (ms) at the end of life — the wreck holds full alpha, then eases to 0. */
  fadeMs: number;
  /** Tumble spin (radians/ms) added per unit inherited speed (px/ms) — a fast-dying ship
   *  tumbles harder; a stationary kill barely rotates. */
  spinRatePerSpeed: number;
}

/** Module-local default, mirroring `WRECK` so this file stays import-light for tests. */
export const DEFAULT_WRECK: WreckConfig = {
  driftRetentionPerMs: 0.9994,
  lifeMs: 5000,
  fadeMs: 1200,
  spinRatePerSpeed: 4,
};

/** A drifting wreck: live world position, velocity, heading (tumbling) and age. */
export interface WreckState {
  /** World x. */
  x: number;
  /** World y. */
  y: number;
  /** Velocity x (px/ms) — inherited from the ship, decays via drag. */
  vx: number;
  /** Velocity y (px/ms) — inherited from the ship, decays via drag. */
  vy: number;
  /** Heading (radians), inherited from the ship's `shipAngle`, drifts by `spinRate`. */
  angle: number;
  /** Tumble rate (radians/ms), fixed at spawn from the inherited speed. */
  spinRate: number;
  /** Age since death (ms). */
  ageMs: number;
  /** Total lifetime (ms) — despawn once `ageMs ≥ lifeMs`. */
  lifeMs: number;
}

/** Velocity vector (px/ms) for a ship heading `angle` at scalar `speed` — the caller derives the
 *  wreck's inherited velocity from `ShipPhysics.shipAngle` + `currentSpeed`. A non-finite input
 *  yields a zero vector. */
export function shipVelocity(
  angle: number,
  speed: number,
): { vx: number; vy: number } {
  if (!Number.isFinite(angle) || !Number.isFinite(speed)) {
    return { vx: 0, vy: 0 };
  }
  return { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed };
}

/**
 * Spawn a wreck at the destroyed ship's world position, inheriting its velocity (`vx`/`vy`,
 * px/ms) and heading (`angle`). The tumble rate is fixed here at `spinRatePerSpeed × speed` (a
 * faster ship spins harder), so the wreck reads as a coasting, slowly-rotating hull. Non-finite
 * inputs are guarded to 0.
 */
export function spawnWreck(
  x: number,
  y: number,
  vx: number,
  vy: number,
  angle: number,
  config: WreckConfig = DEFAULT_WRECK,
): WreckState {
  const sx = Number.isFinite(x) ? x : 0;
  const sy = Number.isFinite(y) ? y : 0;
  const svx = Number.isFinite(vx) ? vx : 0;
  const svy = Number.isFinite(vy) ? vy : 0;
  const speed = Math.hypot(svx, svy);
  return {
    x: sx,
    y: sy,
    vx: svx,
    vy: svy,
    angle: Number.isFinite(angle) ? angle : 0,
    spinRate: Math.max(0, config.spinRatePerSpeed) * speed,
    ageMs: 0,
    lifeMs: Math.max(0, config.lifeMs),
  };
}

/**
 * Advance a wreck one frame (`dtMs`): drift by its current velocity, apply drag decay to that
 * velocity, tumble the heading, and age it. Returns a **new** state (the input is never mutated —
 * a done wreck is returned unchanged, so a stale despawn call is idempotent). A non-positive
 * `dtMs`, or a wreck already at/over its life, returns the state unchanged. Read despawn via
 * {@link isWreckDone} and the loot cadence via {@link dueLootEmissions}.
 */
export function advanceWreck(
  state: WreckState,
  dtMs: number,
  config: WreckConfig = DEFAULT_WRECK,
): WreckState {
  if (!(dtMs > 0) || isWreckDone(state)) return state;
  const decay = Math.pow(clamp01(config.driftRetentionPerMs), dtMs);
  return {
    ...state,
    x: state.x + state.vx * dtMs,
    y: state.y + state.vy * dtMs,
    vx: state.vx * decay,
    vy: state.vy * decay,
    angle: state.angle + state.spinRate * dtMs,
    ageMs: state.ageMs + dtMs,
  };
}

/** True once the wreck has outlived its `lifeMs` and should be despawned. */
export function isWreckDone(state: WreckState): boolean {
  return state.ageMs >= state.lifeMs;
}

/**
 * The wreck's render alpha over its life: full opacity until the fade window opens
 * (`lifeMs − fadeMs`), then a linear ease to 0 at `lifeMs`. A spent (age ≥ life) wreck reads as 0.
 */
export function wreckAlpha(
  state: WreckState,
  config: WreckConfig = DEFAULT_WRECK,
): number {
  if (state.lifeMs <= 0 || state.ageMs >= state.lifeMs) return 0;
  const fade = Math.max(0, Math.min(config.fadeMs, state.lifeMs));
  const fadeStart = state.lifeMs - fade;
  if (fade <= 0 || state.ageMs <= fadeStart) return 1;
  return clamp01((state.lifeMs - state.ageMs) / fade);
}

/**
 * The emission schedule for `count` loot dots spread evenly across `spreadMs` of the wreck's
 * drift: emission `i` fires at `(i + 0.5) / count × spreadMs`, so every drop peels off the
 * *drifting* wreck at an interior instant (never all at once at the death point) and they trail out
 * along the drift path. Returns an ascending array of emission times (ms since death); an empty
 * array for a non-positive count. The interior offset (`+0.5`) keeps every emission strictly inside
 * `(0, spreadMs)`, so a per-frame sweep starting at age 0 catches them all.
 */
export function wreckLootEmissionTimes(
  count: number,
  spreadMs: number,
): number[] {
  const n = Math.max(0, Math.floor(count));
  if (n === 0) return [];
  const span = Math.max(0, spreadMs);
  const times: number[] = [];
  for (let i = 0; i < n; i++) times.push(((i + 0.5) / n) * span);
  return times;
}

/**
 * Indices in `times` that come due this frame — those whose emission time falls in
 * `[prevAgeMs, currAgeMs)`. The caller steps the wreck (updating its age + position), then spawns a
 * loot dot at the wreck's *current* position for each returned index, so cargo trails out of the
 * drifting hull instead of appearing all at once. Half-open (inclusive lower / exclusive upper) so
 * that, driving `prevAgeMs` = the age *before* this frame's advance and `currAgeMs` = the age
 * *after*, each scheduled drop fires on exactly one frame across the drift. A non-advancing frame
 * (`currAgeMs ≤ prevAgeMs`) yields none.
 */
export function dueLootEmissions(
  prevAgeMs: number,
  currAgeMs: number,
  times: readonly number[],
): number[] {
  if (!(currAgeMs > prevAgeMs)) return [];
  const due: number[] = [];
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    if (t >= prevAgeMs && t < currAgeMs) due.push(i);
  }
  return due;
}

/** Clamp to `[0,1]`; a non-finite input reads as 0. */
function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}
