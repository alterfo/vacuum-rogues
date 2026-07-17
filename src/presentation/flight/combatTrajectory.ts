/**
 * Tactical-combat movement trajectory planning (pure, PixiJS-free).
 *
 * The planning phase of the pause-and-plan combat loop
 * (`docs/plans/20260713-tactical-pause-combat-rework.md`, Task 3) lets the player
 * point-and-click a movement destination for the coming execute window. This module
 * owns the pure geometry behind that UI:
 *
 * - **{@link combatReach}** — how far the ship can plan to travel in one execute
 *   window (`maxSpeed × roundMs`). This is the length the drawn trajectory line is
 *   scaled to, so a more potent engine draws a visibly longer line.
 * - **{@link minTurnRadius}** — the ship's tightest achievable arc (`maxSpeed ÷
 *   rotationSpeed`), the maneuverability constraint the preview must honor.
 * - **{@link clampDestinationToReach}** — clamps a raw click to within reach along
 *   the ship→click ray, so the planned destination is always somewhere the ship can
 *   actually get to this round.
 * - **{@link previewTrajectory}** — the sampled polyline the renderer draws. It
 *   replays the same momentum/arc kinematics as `ShipPhysics.update` (constant
 *   forward cruise + a per-step heading turn bounded by `rotationSpeed`), so an
 *   off-axis destination curves in — never the straight-line fantasy the momentum
 *   ship can't actually fly (`flight/CLAUDE.md`: "no rotate-in-place").
 * - **{@link applyPlannedMovement}** — hands the confirmed destination to
 *   `ShipPhysics.setPath` as the execute-phase movement primitive (reuse, not a
 *   reinvented path-follower).
 *
 * Kept a pure module (no PixiJS / no scene deps) so it unit-tests standalone, the
 * same discipline as `combatPlanning` / `combatRounds`.
 */

import { SHIP_STOP_THRESHOLD } from "@/systems/ShipPhysics";

/** A 2-D point in world coordinates. */
export interface Vec2 {
  x: number;
  y: number;
}

/**
 * The ship kinematics the trajectory preview reads: engine potency ({@link maxSpeed})
 * and maneuverability ({@link rotationSpeed}). Both are read live off the player's
 * `ShipPhysics` at plan time.
 */
export interface ShipMotionProfile {
  /** Max cruise speed, px/ms — the engine "potency" that scales the reach length. */
  maxSpeed: number;
  /** Turn rate, rad/ms — the "maneuverability" that bounds the achievable arc. */
  rotationSpeed: number;
}

/**
 * Fixed player-ship turn rate (rad/ms). Mirrors the internal `rotationSpeed` in
 * `ShipPhysics` (90° / 300ms) — kept here as an exported constant so the scene can
 * build a {@link ShipMotionProfile} without `ShipPhysics` exposing its private field,
 * and so the preview's arc matches what the ship will actually fly.
 */
export const SHIP_ROTATION_SPEED = Math.PI / 2 / 300; // rad/ms

/** Default sampling step (ms) for {@link previewTrajectory}'s polyline. */
export const PREVIEW_STEP_MS = 50;

/**
 * Maximum distance (px) the ship can plan to travel during one execute window — the
 * length the trajectory preview line is scaled to. A pure product of engine potency
 * (`maxSpeed`) and the round duration, so a faster engine plans a longer course.
 * Never negative.
 */
export function combatReach(
  profile: ShipMotionProfile,
  roundMs: number,
): number {
  return Math.max(0, profile.maxSpeed) * Math.max(0, roundMs);
}

/**
 * Minimum achievable turn radius (px) at cruise — the maneuverability constraint the
 * previewed arc honors. `maxSpeed ÷ rotationSpeed`; `Infinity` for a zero turn rate
 * (a ship that can't turn flies straight forever).
 */
export function minTurnRadius(profile: ShipMotionProfile): number {
  return profile.rotationSpeed > 0
    ? profile.maxSpeed / profile.rotationSpeed
    : Infinity;
}

/**
 * Clamp a clicked destination to within `reach` of `from`, along the from→to ray.
 * A click within reach is returned unchanged (`reachable: true`); a farther click is
 * pulled back onto the reach circle (`reachable: false`) so the planned destination
 * is always somewhere the ship can get to this round. A click at `from` (or a
 * non-positive reach) returns `from` itself.
 */
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

/**
 * The sampled arc polyline the renderer draws from the ship to `dest`. Replays the
 * ship's real momentum kinematics: it always cruises forward at `maxSpeed` and turns
 * toward the target by at most `rotationSpeed × step` each sample — so consecutive
 * segments never turn faster than the ship's real minimum turn radius allows, and an
 * off-axis / behind destination curves in instead of snapping straight to it.
 *
 * Sampling stops when the ship reaches `dest` (within `SHIP_STOP_THRESHOLD`) or when
 * the cumulative arc length reaches `reach` (whichever comes first). The polyline
 * always starts with `from` and has ≥1 point.
 */
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
  // Bound the loop hard (reach / min-step distance) so a degenerate case can't spin.
  const maxSamples = Math.ceil(reach / (speed * step)) + 4;
  for (let i = 0; i < maxSamples; i++) {
    const dx = dest.x - px;
    const dy = dest.y - py;
    if (Math.sqrt(dx * dx + dy * dy) <= SHIP_STOP_THRESHOLD) break;
    if (traveled >= reach) break;

    // Turn toward the target at the bounded rate (never a pivot).
    const targetAngle = Math.atan2(dy, dx);
    let diff = targetAngle - ang;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    ang += Math.abs(diff) <= maxTurn ? diff : Math.sign(diff) * maxTurn;

    // Advance forward, capped so the arc never overshoots the reach length.
    const move = Math.min(speed * step, reach - traveled);
    px += Math.cos(ang) * move;
    py += Math.sin(ang) * move;
    traveled += move;
    points.push({ x: px, y: py });
  }
  return points;
}

/** Minimal `ShipPhysics` surface the movement application needs. */
export interface PathFollower {
  setPath(points: Vec2[]): void;
}

/**
 * Hand a confirmed planned destination to the ship as the execute-phase movement
 * primitive: `setPath([dest])` so `ShipPhysics` arcs to exactly the planned point
 * (the same clamped click the preview drew). A null destination means "hold
 * position" — no path is set. Returns whether a course was applied.
 */
export function applyPlannedMovement(
  dest: Vec2 | null,
  physics: PathFollower | null | undefined,
): boolean {
  if (!dest || !physics) return false;
  physics.setPath([{ x: dest.x, y: dest.y }]);
  return true;
}
