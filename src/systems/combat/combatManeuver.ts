/**
 * Pure combat-maneuver decision for an aggressive NPC ship (Task 1 of the
 * space-combat-maneuver plan). Given the geometry and engine speeds it decides
 * whether the aggressor should CLOSE on the target, ORBIT it at weapon range
 * (circling/strafing rather than tail-chasing), or BREAK_OFF (flee) — and
 * returns the heading (radians) it should steer along this frame.
 *
 * Real-time-with-turns combat: ships move continuously along this heading while
 * weapons fire once per "ход" elsewhere. Keeping the close → orbit → break-off
 * decision pure makes the state machine unit-testable without PixiJS.
 */

export enum ManeuverMode {
  /** Outside weapon range — drive straight at the target to enter it. */
  CLOSE = "CLOSE",
  /** In range — circle the target (strafe), holding just inside firing range. */
  ORBIT = "ORBIT",
  /** Too damaged or out-matched — flee directly away from the target. */
  BREAK_OFF = "BREAK_OFF",
}

export interface ManeuverInput {
  /** Distance from aggressor to target (world px). */
  range: number;
  /** Weapon range — the band the aggressor wants to orbit just inside. */
  weaponRange: number;
  /** Aggressor cruise speed (px/ms). */
  selfSpeed: number;
  /** Target (player) cruise speed (px/ms). */
  targetSpeed: number;
  /** Aggressor world position. */
  selfX: number;
  selfY: number;
  /** Target world position. */
  targetX: number;
  targetY: number;
  /** Aggressor hull fraction (0..1). Below the break-off threshold it flees. */
  hullRatio?: number;
  /** +1 / -1 — which way to circle (seeded per-ship so foes don't all orbit the
   *  same way). Defaults to clockwise (+1). */
  orbitDir?: 1 | -1;
}

export interface ManeuverDecision {
  mode: ManeuverMode;
  /** Unit heading (radians) the aggressor should steer along this frame. */
  heading: number;
}

/** Hull fraction below which an aggressor breaks off and flees. */
export const BREAK_OFF_HULL_RATIO = 0.3;
/** Orbit radius as a fraction of weapon range (sit comfortably inside firing range). */
export const ORBIT_RANGE_FRACTION = 0.8;
/** How strongly the orbit heading is nudged radially to hold the orbit radius. */
export const ORBIT_RADIAL_GAIN = 0.6;

/**
 * Decide the aggressor's maneuver and heading for this frame. Pure: no PixiJS,
 * no globals — drive it with range/speeds/geometry and assert the result.
 */
export function decideManeuver(input: ManeuverInput): ManeuverDecision {
  const {
    range,
    weaponRange,
    selfSpeed,
    targetSpeed,
    selfX,
    selfY,
    targetX,
    targetY,
    hullRatio = 1,
    orbitDir = 1,
  } = input;

  const angleToTarget = Math.atan2(targetY - selfY, targetX - selfX);

  // BREAK_OFF: too damaged to keep fighting, or out-matched — a target that is
  // faster than the aggressor AND still beyond weapon range can never be caught,
  // so chasing is pointless. Flee directly away from the target.
  const outmatched = targetSpeed > selfSpeed && range > weaponRange;
  if (hullRatio < BREAK_OFF_HULL_RATIO || outmatched) {
    return {
      mode: ManeuverMode.BREAK_OFF,
      heading: wrapAngle(angleToTarget + Math.PI),
    };
  }

  // CLOSE: still outside weapon range — drive straight at the target to enter it.
  if (range > weaponRange) {
    return { mode: ManeuverMode.CLOSE, heading: angleToTarget };
  }

  // ORBIT: in range — circle the target. Steer tangent to the range circle
  // (perpendicular to the line to the target), nudged radially toward the
  // desired orbit radius so the circle holds instead of spiralling in or out.
  const dir = orbitDir >= 0 ? 1 : -1;
  const tangent = angleToTarget + (dir * Math.PI) / 2;
  const desired = weaponRange * ORBIT_RANGE_FRACTION;
  // radialBias > 0 → too far, steer toward the target; < 0 → too close, steer away.
  const radialBias =
    clamp((range - desired) / desired, -1, 1) * ORBIT_RADIAL_GAIN;
  const hx = Math.cos(tangent) + radialBias * Math.cos(angleToTarget);
  const hy = Math.sin(tangent) + radialBias * Math.sin(angleToTarget);
  return { mode: ManeuverMode.ORBIT, heading: Math.atan2(hy, hx) };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Normalize an angle to (-π, π]. */
function wrapAngle(a: number): number {
  let x = a;
  while (x > Math.PI) x -= 2 * Math.PI;
  while (x <= -Math.PI) x += 2 * Math.PI;
  return x;
}
