/**
 * Combat orbital clock (pure, PixiJS-free).
 *
 * Planet orbital position is a pure function of `SpaceFlightScene.currentDay`
 * (`gameDays + distanceTraveled/DISTANCE_PER_DAY + waitDayAccum + combatDayAccum`).
 * During a real-time in-flight fight the ship sits still, so neither the
 * move-distance source nor the wait-turn source (`advanceWaitTime`, gated off while
 * a fight is active) advances `currentDay` — and the planets freeze on their orbital
 * path even though the fight (bullets, return fire) runs in real time. A stationary
 * fight still passes time, so the orbital day must keep rising during the *real-time*
 * portion of the fight and hold only while the active pause is up.
 *
 * This is that one decision, isolated as a pure function so it unit-tests without a
 * rendering context (the scene threads in the live combat/pause flags and `dt`): given
 * the fight state and the frame delta, return the fractional orbital-day increment to
 * add for this frame. It feeds a presentation-only accumulator and never advances the
 * real calendar (`gameDays`) — combat keeps deliberately freezing the calendar/NPC sim
 * (no save/state impact) while the world keeps visibly orbiting.
 */

/**
 * ms of real time per orbital/wait day (день = секунда, US-070). Shared with
 * `SpaceFlightScene.MS_PER_WAIT_DAY` so combat orbit pacing matches a wait-turn from
 * a single source of truth.
 */
export const MS_PER_ORBITAL_DAY = 1000;

/** The fight state + frame timing the combat-day increment is decided from. */
export interface CombatOrbitClockInput {
  /** A fight is engaged (`CombatModule.isActive`). */
  readonly inCombat: boolean;
  /** The active pause is up (`combatPause.paused`) — everything freezes. */
  readonly paused: boolean;
  /** Frame delta in ms. */
  readonly dt: number;
  /** Time-scale multiplier (`ShipPhysics.timeScale`). */
  readonly timeScale: number;
}

/**
 * Fractional orbital days to advance this frame. Advances **only** during the
 * real-time portion of a fight (`inCombat && !paused`); returns 0 otherwise (no
 * fight, or paused) so the existing move-distance / wait-turn day sources stay the
 * only sources outside combat and the active pause freezes everything. `dt` is
 * clamped to one day so a backgrounded tab's huge resume frame can't flush a long
 * stretch at once (mirrors `advanceWaitTime`).
 */
export function combatOrbitalDayIncrement(
  input: CombatOrbitClockInput,
): number {
  const { inCombat, paused, dt, timeScale } = input;
  if (!inCombat || paused) return 0;
  const clampedDt = Math.min(Math.max(dt, 0), MS_PER_ORBITAL_DAY);
  return (clampedDt * (timeScale ?? 1)) / MS_PER_ORBITAL_DAY;
}
