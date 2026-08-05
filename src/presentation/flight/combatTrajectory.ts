import { SHIP_STOP_THRESHOLD } from "@/systems/ShipPhysics";

export interface Vec2 {
  x: number;
  y: number;
}

export interface ShipMotionProfile {
  maxSpeed: number;
  rotationSpeed: number;
}

export const SHIP_ROTATION_SPEED = Math.PI / 2 / 300; // rad/ms

export const PREVIEW_STEP_MS = 50;

export function combatReach(
  profile: ShipMotionProfile,
  roundMs: number,
): number {
  return Math.max(0, profile.maxSpeed) * Math.max(0, roundMs);
}

export function minTurnRadius(profile: ShipMotionProfile): number {
  return profile.rotationSpeed > 0
    ? profile.maxSpeed / profile.rotationSpeed
    : Infinity;
}

export function clampDestinationToReach(
  from: Vec2,
  to: Vec2,
  reach: number,
): { dest: Vec2; reachable: boolean } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist <= reach || dist === 0) {
    return { dest: { x: to.x, y: to.y }, reachable: dist <= reach };
  }
  const k = reach / dist;
  return {
    dest: { x: from.x + dx * k, y: from.y + dy * k },
    reachable: false,
  };
}

export function previewTrajectory(
  profile: ShipMotionProfile,
  from: Vec2,
  heading: number,
  dest: Vec2,
  reach: number,
  stepMs: number = PREVIEW_STEP_MS,
): Vec2[] {
  const points: Vec2[] = [{ x: from.x, y: from.y }];
  const speed = Math.max(0, profile.maxSpeed);
  const step = Math.max(1, stepMs);
  const maxTurn = profile.rotationSpeed * step;
  if (speed <= 0 || reach <= 0) return points;

  let px = from.x;
  let py = from.y;
  let ang = heading;
  let traveled = 0;
  const maxSamples = Math.ceil(reach / (speed * step)) + 4;
  for (let i = 0; i < maxSamples; i++) {
    const dx = dest.x - px;
    const dy = dest.y - py;
    if (Math.sqrt(dx * dx + dy * dy) <= SHIP_STOP_THRESHOLD) break;
    if (traveled >= reach) break;

    const targetAngle = Math.atan2(dy, dx);
    let diff = targetAngle - ang;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    ang += Math.abs(diff) <= maxTurn ? diff : Math.sign(diff) * maxTurn;

    const move = Math.min(speed * step, reach - traveled);
    px += Math.cos(ang) * move;
    py += Math.sin(ang) * move;
    traveled += move;
    points.push({ x: px, y: py });
  }
  return points;
}

export interface PathFollower {
  setPath(points: Vec2[]): void;
}

export function applyPlannedMovement(
  dest: Vec2 | null,
  physics: PathFollower | null | undefined,
): boolean {
  if (!dest || !physics) return false;
  physics.setPath([{ x: dest.x, y: dest.y }]);
  return true;
}
