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
  // Dense control points for Catmull-Rom: 10–14 points per semicircle. More
  // control points → shorter chords before interpolation → smaller residual
  // kinks (Sprint 3 Task 8).
  const steps = Math.max(10, Math.round((Math.abs(d) / Math.PI) * 14));
  // Wide clearance (1.15R) so the arc bows clear of the star's outer glow.
  const arcR = R * 1.15;
  const control: Point[] = [];
  for (let i = 1; i < steps; i++) {
    const a = a0 + d * (i / steps);
    control.push({ x: sx + Math.cos(a) * arcR, y: sy + Math.sin(a) * arcR });
  }
  control.push({ x: tx, y: ty });
  // Smooth the dense arc polygon into a curve (8 interpolated points per gap).
  const smoothed = catmullRomSpline(control, 8);
  // Final Laplacian smoothing pass: replace each interior vertex with the
  // average of its two neighbours. A single iteration erases residual kinks
  // (e.g. at the arc → destination junction) without materially changing the
  // arc's shape. Computed from a pre-pass snapshot so the smoothing is a true
  // single iteration, not a one-sided sweep. Start/end are left untouched (the
  // last point is the true destination).
  const pre = smoothed.map((p) => ({ x: p.x, y: p.y }));
  for (let i = 1; i < smoothed.length - 1; i++) {
    smoothed[i] = {
      x: (pre[i - 1].x + pre[i + 1].x) / 2,
      y: (pre[i - 1].y + pre[i + 1].y) / 2,
    };
  }
  // The Catmull-Rom curve (and the Laplacian pass, which pulls vertices toward
  // the chord) can bow inward between the arc and a far destination, dipping
  // inside the exclusion circle. Push any such sample radially back out to the
  // circle edge — run AFTER smoothing so the clearance invariant always holds.
  // The final point is the true destination — leave it intact (Task 3).
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
 * A smooth arc from (fx,fy) to (tx,ty) that bows out perpendicular to the chord
 * by `bowFrac` of the chord length (signed: positive bows to the left of the
 * travel direction, negative to the right). Returns the forward waypoint list
 * (the start point is dropped — callers prepend the ship's live position when
 * drawing). Used for landing-insertion and take-off arcs so flight reads as
 * curved manoeuvring rather than dead-straight beelines (Task 5).
 */
export function bowedPath(
  fx: number,
  fy: number,
  tx: number,
  ty: number,
  bowFrac: number,
  samplesPerSegment = 8,
): Point[] {
  const dx = tx - fx;
  const dy = ty - fy;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6 || bowFrac === 0) return [{ x: tx, y: ty }];
  const px = -dy / len; // left-perpendicular unit
  const py = dx / len;
  const bow = bowFrac * len;
  const control: Point[] = [
    { x: fx, y: fy },
    { x: (fx + tx) / 2 + px * bow, y: (fy + ty) / 2 + py * bow },
    { x: tx, y: ty },
  ];
  return catmullRomSpline(control, samplesPerSegment).slice(1);
}

/**
 * Curved "spiral-in" approach to a planet: a bowed arc from the ship to the
 * orbit-edge approach point, sweeping wide of the disc then curving in to the
 * edge instead of driving straight at the centre (Task 5). The bow is biased
 * away from the planet centre so it reads as an orbital insertion.
 */
export function spiralApproachPath(
  shipX: number,
  shipY: number,
  planetX: number,
  planetY: number,
  planetRadius: number,
  approachOffset: number,
  bowFrac = 0.18,
): Point[] {
  const ap = planetApproachPoint(
    shipX,
    shipY,
    planetX,
    planetY,
    planetRadius,
    approachOffset,
  );
  const mx = (shipX + ap.x) / 2;
  const my = (shipY + ap.y) / 2;
  const dx = ap.x - shipX;
  const dy = ap.y - shipY;
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len;
  const py = dx / len;
  // Bow away from the planet centre (sweep wide, then curve in to the edge).
  const dot = px * (planetX - mx) + py * (planetY - my);
  const sign = dot > 0 ? -1 : 1;
  return bowedPath(shipX, shipY, ap.x, ap.y, sign * bowFrac);
}

/**
 * Short outward arc a ship flies when lifting off a planet, before autopilot
 * engages (Task 5). `(outX,outY)` is the outward unit direction (planet facing
 * away from the star); the ship rises from the planet edge and curves out to a
 * point `outDist` beyond it. Includes the lift-off start point so the cosmetic
 * animator can drive the whole polyline.
 */
export function takeoffArcPath(
  planetX: number,
  planetY: number,
  outX: number,
  outY: number,
  planetRadius: number,
  outDist: number,
  bowFrac = 0.4,
  samplesPerSegment = 10,
): Point[] {
  const start = {
    x: planetX + outX * planetRadius,
    y: planetY + outY * planetRadius,
  };
  const end = {
    x: planetX + outX * (planetRadius + outDist),
    y: planetY + outY * (planetRadius + outDist),
  };
  const curve = bowedPath(
    start.x,
    start.y,
    end.x,
    end.y,
    bowFrac,
    samplesPerSegment,
  );
  return [start, ...curve];
}

/** A position + heading sampled at an arc-length along a polyline. */
export interface PathSample {
  x: number;
  y: number;
  /** Heading (radians) of the segment the sample falls on. */
  heading: number;
  /** True once `dist` reaches/exceeds the polyline's total length. */
  done: boolean;
}

/**
 * Sample the point `dist` pixels along a polyline, with the heading of the
 * segment it falls on. Used to drive the cosmetic take-off animation at a
 * constant speed without involving the day-counting flight physics (Task 5).
 */
export function pointAlongPath(points: Point[], dist: number): PathSample {
  if (points.length === 0) return { x: 0, y: 0, heading: 0, done: true };
  if (points.length === 1) {
    return { x: points[0].x, y: points[0].y, heading: 0, done: true };
  }
  if (dist <= 0) {
    const h = Math.atan2(points[1].y - points[0].y, points[1].x - points[0].x);
    return { x: points[0].x, y: points[0].y, heading: h, done: false };
  }
  let acc = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (seg === 0) continue;
    const heading = Math.atan2(b.y - a.y, b.x - a.x);
    if (dist <= acc + seg) {
      const t = (dist - acc) / seg;
      return {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        heading,
        done: false,
      };
    }
    acc += seg;
  }
  const last = points[points.length - 1];
  const prev = points[points.length - 2];
  return {
    x: last.x,
    y: last.y,
    heading: Math.atan2(last.y - prev.y, last.x - prev.x),
    done: true,
  };
}

/**
 * Predicted intercept point for a shooter at (sx,sy) moving at `shooterSpeed`
 * (px/ms) chasing a target at (tx,ty) with velocity (tvx,tvy). Solves the
 * quadratic lead so the pursuer heads where the target *will* be — re-solved
 * each leg, this makes the chase curve to lead a crossing target rather than
 * always pointing at its current position (Task 5). Falls back to the target's
 * current position when there is no positive-time solution.
 */
export function leadInterceptPoint(
  sx: number,
  sy: number,
  shooterSpeed: number,
  tx: number,
  ty: number,
  tvx: number,
  tvy: number,
): Point {
  const rx = tx - sx;
  const ry = ty - sy;
  const a = tvx * tvx + tvy * tvy - shooterSpeed * shooterSpeed;
  const b = 2 * (rx * tvx + ry * tvy);
  const c = rx * rx + ry * ry;
  let t = -1;
  if (Math.abs(a) < 1e-9) {
    if (Math.abs(b) > 1e-9) t = -c / b;
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      const roots = [(-b - sq) / (2 * a), (-b + sq) / (2 * a)]
        .filter((v) => v > 1e-6)
        .sort((p, q) => p - q);
      if (roots.length) t = roots[0];
    }
  }
  if (t <= 0 || !Number.isFinite(t)) return { x: tx, y: ty };
  return { x: tx + tvx * t, y: ty + tvy * t };
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
