/**
 * Pure geometry helpers for the space-flight UI. Kept free of PixiJS so they can
 * be unit-tested directly (the presentation classes that use them are otherwise
 * hard to test in isolation).
 */

export interface Point {
  x: number;
  y: number;
}

/** A per-day division mark on a route: a centre point + a perpendicular unit. */
export interface DayTick {
  x: number;
  y: number;
  /** Perpendicular unit vector (draw a short dash along ±(px,py)). */
  px: number;
  py: number;
}

/**
 * Positions of per-day division marks along a route polyline. Walks the
 * polyline accumulating length and emits a tick (with a perpendicular unit
 * vector) every `distancePerDay` pixels — so the player can read how many days
 * the trip takes (US-070 #7).
 */
export function dayTickMarks(
  points: Point[],
  distancePerDay: number,
): DayTick[] {
  const ticks: DayTick[] = [];
  if (distancePerDay <= 0 || points.length < 2) return ticks;

  let acc = 0;
  let nextDay = distancePerDay;
  for (let s = 0; s < points.length - 1; s++) {
    const ax = points[s].x;
    const ay = points[s].y;
    const bx = points[s + 1].x;
    const by = points[s + 1].y;
    const segLen = Math.hypot(bx - ax, by - ay);
    if (segLen === 0) continue;
    const nx = (bx - ax) / segLen;
    const ny = (by - ay) / segLen;
    const px = -ny; // perpendicular to the segment
    const py = nx;
    while (nextDay <= acc + segLen) {
      const d = nextDay - acc;
      ticks.push({ x: ax + nx * d, y: ay + ny * d, px, py });
      nextDay += distancePerDay;
    }
    acc += segLen;
  }
  return ticks;
}

/**
 * Map an arbitrary string (e.g. a planet id) to a stable angle in [0, 2π).
 * Used to give each planet a deterministic, distinct starting point on its
 * orbit so positions are reproducible across scene reloads (US-070 #9).
 */
export function hashToAngle(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // h is a 32-bit int; map its unsigned value into [0, 2π).
  return ((h >>> 0) / 0xffffffff) * Math.PI * 2;
}

/**
 * Catmull-Rom spline through `pts` with `samplesPerSegment` interpolated points
 * per segment. Ghost points at both ends ensure the curve passes through the
 * first and last control points.
 */
export function catmullRomSpline(
  pts: Point[],
  samplesPerSegment: number,
): Point[] {
  if (pts.length < 2) return [...pts];
  const cp: Point[] = [pts[0], ...pts, pts[pts.length - 1]];
  const result: Point[] = [];
  for (let i = 1; i < cp.length - 2; i++) {
    const p0 = cp[i - 1];
    const p1 = cp[i];
    const p2 = cp[i + 1];
    const p3 = cp[i + 2];
    for (let s = 0; s < samplesPerSegment; s++) {
      const t = s / samplesPerSegment;
      const t2 = t * t;
      const t3 = t2 * t;
      result.push({
        x:
          0.5 *
          (2 * p1.x +
            (-p0.x + p2.x) * t +
            (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
            (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y:
          0.5 *
          (2 * p1.y +
            (-p0.y + p2.y) * t +
            (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
            (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  result.push(pts[pts.length - 1]);
  return result;
}

/**
 * A path from (fx,fy) to (tx,ty) that bows around a star at (sx,sy) of radius R
 * instead of cutting through it. Returns just `[{to}]` when the straight segment
 * already clears the star, otherwise a Catmull-Rom smoothed arc of waypoints
 * around it plus the destination (US-070 #6). Pure — used for both the route
 * preview and execution.
 */
export function avoidStarPath(
  fx: number,
  fy: number,
  tx: number,
  ty: number,
  sx: number,
  sy: number,
  R: number,
): Point[] {
  const dx = tx - fx;
  const dy = ty - fy;
  const len2 = dx * dx + dy * dy || 1;
  // Closest point on the segment to the star.
  let t = ((sx - fx) * dx + (sy - fy) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cxp = fx + dx * t;
  const cyp = fy + dy * t;
  if (Math.hypot(sx - cxp, sy - cyp) >= R) return [{ x: tx, y: ty }];

  // Generate sparse arc control points, then smooth with Catmull-Rom so the
  // rendered path has no visible angular chords even at large star-avoid radii.
  const a0 = Math.atan2(fy - sy, fx - sx);
  const a1 = Math.atan2(ty - sy, tx - sx);
  let d = a1 - a0;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  if (Math.abs(d) < 1e-3) d = Math.PI; // near-opposite: go around one side
  // Sparse control points for Catmull-Rom: 4–8 points per semicircle.
  const steps = Math.max(4, Math.round((Math.abs(d) / Math.PI) * 8));
  const arcR = R * 1.08;
  const control: Point[] = [];
  for (let i = 1; i < steps; i++) {
    const a = a0 + d * (i / steps);
    control.push({ x: sx + Math.cos(a) * arcR, y: sy + Math.sin(a) * arcR });
  }
  control.push({ x: tx, y: ty });
  // Smooth the sparse arc polygon into a curve (~4 interpolated points per gap).
  const smoothed = catmullRomSpline(control, 4);
  // The Catmull-Rom curve can bow inward between the arc and a far destination,
  // dipping inside the exclusion circle. Push any such sample radially back out
  // to the circle edge so the flown/preview path never enters the exclusion
  // radius (Task 3). The final point is the true destination — leave it intact.
  for (let i = 0; i < smoothed.length - 1; i++) {
    const ox = smoothed[i].x - sx;
    const oy = smoothed[i].y - sy;
    const dist = Math.hypot(ox, oy);
    if (dist > 1e-6 && dist < R) {
      smoothed[i] = { x: sx + (ox / dist) * R, y: sy + (oy / dist) * R };
    }
  }
  return smoothed;
}

/**
 * Compute the approach waypoint for a planet: a point on the ship-facing edge
 * of the planet disc, offset outward by `offset` px.  Routing to this point
 * instead of the planet centre prevents the preview line from cutting through
 * the disc, while the auto-land trigger (which fires when the ship is within
 * `LANDING_RANGE` of the surface) ensures the ship still lands on arrival.
 */
export function planetApproachPoint(
  shipX: number,
  shipY: number,
  planetX: number,
  planetY: number,
  planetRadius: number,
  offset: number,
): Point {
  const dx = planetX - shipX;
  const dy = planetY - shipY;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-6) {
    return { x: planetX + planetRadius + offset, y: planetY };
  }
  const nx = dx / dist;
  const ny = dy / dist;
  return {
    x: planetX - nx * (planetRadius + offset),
    y: planetY - ny * (planetRadius + offset),
  };
}

/**
 * Convert a point in the minimap's local coordinates (px within the radar box)
 * back to a world coordinate, so a drag on the radar can re-centre the main
 * view there (US-070 #2). `titleOffset` accounts for the radar's title bar.
 */
export function radarToWorld(
  localX: number,
  localY: number,
  mapWidth: number,
  mapHeight: number,
  mapScale: number,
  centerX: number,
  centerY: number,
  titleOffset = 10,
): Point {
  const mapCenterX = mapWidth / 2;
  const mapCenterY = mapHeight / 2 + titleOffset;
  return {
    x: centerX + (localX - mapCenterX) / mapScale,
    y: centerY + (localY - mapCenterY) / mapScale,
  };
}
