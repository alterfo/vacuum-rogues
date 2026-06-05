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
 * A path from (fx,fy) to (tx,ty) that bows around a star at (sx,sy) of radius R
 * instead of cutting through it. Returns just `[{to}]` when the straight segment
 * already clears the star, otherwise an arc of waypoints around it plus the
 * destination (US-070 #6). Pure — used for both the route preview and execution.
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

  // Bow around: arc waypoints at radius R between the from/to angles.
  const a0 = Math.atan2(fy - sy, fx - sx);
  const a1 = Math.atan2(ty - sy, tx - sx);
  let d = a1 - a0;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  if (Math.abs(d) < 1e-3) d = Math.PI; // near-opposite: go around one side
  // Densely sample the arc so the polyline reads as a smooth bow around the star
  // rather than a few angular chords (US-070 #6). Scale the sample count with the
  // arc's angular span so short bows aren't over-tessellated.
  const steps = Math.max(8, Math.round((Math.abs(d) / Math.PI) * 24));
  const arcR = R * 1.08;
  const pts: Point[] = [];
  for (let i = 1; i < steps; i++) {
    const a = a0 + d * (i / steps);
    pts.push({ x: sx + Math.cos(a) * arcR, y: sy + Math.sin(a) * arcR });
  }
  pts.push({ x: tx, y: ty });
  return pts;
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
