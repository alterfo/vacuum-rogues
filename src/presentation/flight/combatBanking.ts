/**
 * Ship banking/roll — a presentation-only visual tilt correlated with the ship's turn rate.
 * Pure, PixiJS-free.
 *
 * Task 11 of the pause-and-plan combat rework
 * (`docs/plans/20260713-tactical-pause-combat-rework.md`). During the execute window a ship
 * banks *into* its turn — a real aircraft/spacecraft rolls in the direction it is turning. This
 * is **presentation only**: `ShipPhysics`' `shipAngle` / turn math is completely untouched; this
 * module only *reads* the current (signed) turn rate and maps it to a roll angle the renderer
 * applies as a visual tilt. No physics change, no save/schema impact.
 *
 * The mapping is a linear, sign-preserving function of the turn rate, clamped to a sane maximum
 * so a lag-spike or a time-scaled frame with an outsized instantaneous turn rate can never flip
 * the sprite past a believable bank. A small easing helper ({@link approachRoll}) lets the
 * caller ease the live roll toward the target so the tilt reads as a smooth roll-in/roll-out
 * rather than a snap.
 *
 * Kept a pure module (no PixiJS / no scene / no domain deps) unit-tested standalone — the same
 * discipline as `combatPlanning` / `combatTrajectory` / `combatGravity` / `combatMissile` /
 * `combatAfterburner`. Live tuning comes from `BANKING` in `balance.ts`; the scene passes it in
 * so tune-in-one-place holds.
 */

/** Tuning for the banking/roll visual; mirrors `BANKING` in `balance.ts`. */
export interface BankingConfig {
  /** Roll radians produced per unit signed turn rate (radians/ms). */
  rollPerTurnRate: number;
  /** Maximum absolute roll angle (radians) — the sane clamp; the tilt never exceeds it. */
  maxRollAngle: number;
  /** Max roll change per ms when easing the live roll toward the target (smoothing rate). */
  rollSmoothingPerMs: number;
}

/** Module-local default, mirroring `BANKING` so this file stays import-light for tests. */
export const DEFAULT_BANKING: BankingConfig = {
  rollPerTurnRate: 100,
  maxRollAngle: Math.PI / 6,
  rollSmoothingPerMs: 0.004,
};

/** Normalize an angle difference into `[-π, π]` (the shortest signed rotation). */
function wrapAngle(a: number): number {
  let d = a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/**
 * The ship's signed turn rate (radians/ms) between two consecutive headings over `dtMs`.
 * Positive = turning one way, negative = the other (the sign the roll direction follows). The
 * heading delta is wrapped to the shortest rotation so a wrap across ±π never reads as a huge
 * turn. A non-positive `dtMs` (or a non-finite heading) yields `0` — no turn this frame.
 */
export function shipTurnRate(
  prevAngle: number,
  currAngle: number,
  dtMs: number,
): number {
  if (!(dtMs > 0)) return 0;
  if (!Number.isFinite(prevAngle) || !Number.isFinite(currAngle)) return 0;
  return wrapAngle(currAngle - prevAngle) / dtMs;
}

/**
 * The target roll (radians) for a ship turning at the given signed `turnRate` (radians/ms):
 * `turnRate × rollPerTurnRate`, clamped to `±maxRollAngle`. Sign is preserved (banks into the
 * turn), and a zero / non-finite turn rate yields `0` (level flight).
 */
export function bankingAngle(
  turnRate: number,
  config: BankingConfig = DEFAULT_BANKING,
): number {
  if (!Number.isFinite(turnRate) || turnRate === 0) return 0;
  const max = Math.abs(config.maxRollAngle);
  const raw = turnRate * config.rollPerTurnRate;
  return Math.max(-max, Math.min(max, raw));
}

/**
 * Ease the current roll toward `target` at the configured `rollSmoothingPerMs` rate over `dtMs`,
 * so the bank rolls in/out smoothly instead of snapping to `bankingAngle`'s value each frame.
 * Never overshoots the target; a non-positive `dtMs` holds the current roll.
 */
export function approachRoll(
  current: number,
  target: number,
  dtMs: number,
  config: BankingConfig = DEFAULT_BANKING,
): number {
  if (!(dtMs > 0)) return current;
  const maxStep = Math.max(0, config.rollSmoothingPerMs) * dtMs;
  const delta = target - current;
  if (Math.abs(delta) <= maxStep) return target;
  return current + Math.sign(delta) * maxStep;
}
