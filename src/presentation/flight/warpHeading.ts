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
