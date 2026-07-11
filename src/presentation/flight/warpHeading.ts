/**
 * Bug 4: on hyperjump arrival the ship should continue the heading it
 * departed on, not hard-reset to angle 0. `exitVector` is the unit direction
 * the ship was travelling when it left the origin system; the arrival
 * `entryVector` (spawn offset from the new system's centre) is `-exitVector`
 * (US-023 "appear on the side that faces the origin") — so the arrival
 * heading must point the SAME way as `exitVector`, not its inversion, or the
 * ship would visibly face back the way it came.
 */
export function arrivalHeadingFromExitVector(exitVector: {
  x: number;
  y: number;
}): number {
  return Math.atan2(exitVector.y, exitVector.x);
}

/**
 * The real departure direction for a completed hyperjump: the unit vector
 * from `center` to the boundary point the ship actually exited at. A routine
 * jump's `exitPoint` already equals `center + exitVector·boundaryRadius`, so
 * this coincides with `fallbackExitVector` exactly; a genuine flee's near-edge
 * escape point diverges from it, which is the fix for Task 2's entry/exit
 * mismatch (`docs/plans/20260711-autopilot-reliability-fixes.md`).
 */
export function departureVectorFromExitPoint(
  exitPoint: { x: number; y: number } | null,
  center: { x: number; y: number },
  fallbackExitVector: { x: number; y: number },
): { x: number; y: number } {
  if (!exitPoint) return fallbackExitVector;
  const dx = exitPoint.x - center.x;
  const dy = exitPoint.y - center.y;
  const len = Math.hypot(dx, dy);
  return len > 1e-6 ? { x: dx / len, y: dy / len } : fallbackExitVector;
}
