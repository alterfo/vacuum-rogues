/**
 * Intercept-lead solver, kept PixiJS-free so the pursuit math is unit-tested in
 * isolation (the scene/managers that consume it are otherwise hard to test).
 */

export interface InterceptPoint {
  x: number;
  y: number;
}

/**
 * Predicted intercept point: a shooter at (sx,sy) closing at `shooterSpeed`
 * (px/ms) on a target at (tx,ty) drifting with constant velocity (tvx,tvy)
 * (px/ms). Solves the time-to-intercept quadratic |R + V·t| = shooterSpeed·t
 * for the earliest positive t and returns where the target *will* be at that t,
 * so the pursuer aims ahead of a moving target instead of at where it is now.
 * Re-solved each leg, this curves a chase to lead a crossing target (playtest4
 * C; also the NPC attack/approach lead and the orbiting-planet pursuit lead).
 *
 * Falls back to the target's CURRENT position when there is no positive-time
 * solution — both effectively stationary, or the target outruns the shooter.
 */
export function solveInterceptPoint(
  sx: number,
  sy: number,
  shooterSpeed: number,
  tx: number,
  ty: number,
  tvx: number,
  tvy: number,
): InterceptPoint {
  const rx = tx - sx;
  const ry = ty - sy;
  const a = tvx * tvx + tvy * tvy - shooterSpeed * shooterSpeed;
  const b = 2 * (rx * tvx + ry * tvy);
  const c = rx * rx + ry * ry;
  let t = -1;
  if (Math.abs(a) < 1e-9) {
    // Degenerate (target speed ≈ shooter speed): the quadratic collapses to a
    // linear b·t + c = 0.
    if (Math.abs(b) > 1e-9) t = -c / b;
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      const roots = [(-b - sq) / (2 * a), (-b + sq) / (2 * a)]
        .filter((v) => v > 1e-6)
        .sort((p, q) => p - q);
      if (roots.length) t = roots[0]; // earliest positive intercept time
    }
  }
  if (t <= 0 || !Number.isFinite(t)) return { x: tx, y: ty };
  return { x: tx + tvx * t, y: ty + tvy * t };
}
