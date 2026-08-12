export enum ManeuverMode {
  CLOSE = "CLOSE",
  ORBIT = "ORBIT",
  BREAK_OFF = "BREAK_OFF",
}

export interface ManeuverInput {
  range: number;
  weaponRange: number;
  selfSpeed: number;
  targetSpeed: number;
  selfX: number;
  selfY: number;
  targetX: number;
  targetY: number;
  hullRatio?: number;
  orbitDir?: 1 | -1;
  grappled?: boolean;
}

export interface ManeuverDecision {
  mode: ManeuverMode;
  heading: number;
}

export const BREAK_OFF_HULL_RATIO = 0.3;
export const ORBIT_RANGE_FRACTION = 0.8;
export const ORBIT_RADIAL_GAIN = 0.6;

export function decideManeuver(input: ManeuverInput): ManeuverDecision {
  const {
    range,
    weaponRange,
    selfX,
    selfY,
    targetX,
    targetY,
    hullRatio = 1,
    orbitDir = 1,
    grappled = false,
  } = input;

  const angleToTarget = Math.atan2(targetY - selfY, targetX - selfX);

  if (hullRatio < BREAK_OFF_HULL_RATIO && !grappled) {
    return {
      mode: ManeuverMode.BREAK_OFF,
      heading: wrapAngle(angleToTarget + Math.PI),
    };
  }

  if (range > weaponRange) {
    return { mode: ManeuverMode.CLOSE, heading: angleToTarget };
  }

  const dir = orbitDir >= 0 ? 1 : -1;
  const tangent = angleToTarget + (dir * Math.PI) / 2;
  const desired = weaponRange * ORBIT_RANGE_FRACTION;
  const radialBias =
    clamp((range - desired) / desired, -1, 1) * ORBIT_RADIAL_GAIN;
  const hx = Math.cos(tangent) + radialBias * Math.cos(angleToTarget);
  const hy = Math.sin(tangent) + radialBias * Math.sin(angleToTarget);
  return { mode: ManeuverMode.ORBIT, heading: Math.atan2(hy, hx) };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function wrapAngle(a: number): number {
  let x = a;
  while (x > Math.PI) x -= 2 * Math.PI;
  while (x <= -Math.PI) x += 2 * Math.PI;
  return x;
}
