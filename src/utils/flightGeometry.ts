/**
 * Pure geometry helpers for the space-flight UI. Kept free of PixiJS so they can
 * be unit-tested directly (the presentation classes that use them are otherwise
 * hard to test in isolation).
 */

import { hashStr } from "@/utils/hashStr";

export interface Point {
  x: number;
  y: number;
}

/**
 * Map an arbitrary string (e.g. a planet id) to a stable angle in [0, 2π).
 * Used to give each planet a deterministic, distinct starting point on its
 * orbit so positions are reproducible across scene reloads (US-070 #9).
 */
export function hashToAngle(s: string): number {
  return (hashStr(s) / 0xffffffff) * Math.PI * 2;
}

/**
 * The boundary point (on the hyperjump edge, `boundaryRadius` from `center`) a
 * pending hyperjump flies to before the jump fires (Task 9 iv).
 *
 * When the warp was re-plotted while the ship was already inside the system
 * (`fromMidSystem` — the flee/re-plot case, ship at `ship`), it returns the
 * NEAREST usable escape point: the boundary point radially outward from the
 * ship's current position. A fleeing ship thus jumps from the closest edge
 * instead of beelining across the whole system to the exit-direction edge past
 * its pursuers (the dominant campaign death path). Otherwise (a fresh system
 * entry) it returns the exit-direction edge, the established spatial behaviour.
 *
 * The destination is fixed by the pending warp's `targetSystemId`; the exit
 * point is purely positional, so the shorter crossing never changes where the
 * ship arrives. A radial-out escape also never crosses the star (it lies behind
 * the ship), so it needs no avoidance detour. A ship exactly at the centre has
 * no meaningful "nearest" direction and degrades to the exit-direction edge.
 */
export function warpEdgePoint(
  ship: Point,
  center: Point,
  exitVector: Point,
  boundaryRadius: number,
  fromMidSystem: boolean,
): Point {
  if (fromMidSystem) {
    const dx = ship.x - center.x;
    const dy = ship.y - center.y;
    const d = Math.hypot(dx, dy);
    if (d > 1e-6) {
      return {
        x: center.x + (dx / d) * boundaryRadius,
        y: center.y + (dy / d) * boundaryRadius,
      };
    }
  }
  return {
    x: center.x + exitVector.x * boundaryRadius,
    y: center.y + exitVector.y * boundaryRadius,
  };
}

/**
 * Compose a pending hyperjump's edge point ({@link warpEdgePoint}) with the
 * star-avoidance route to it ({@link avoidStarPath}) — the one-shot route plan
 * `SpaceFlightScene` runs whenever a warp is pending on scene entry.
 */
export function planWarpEdgeRoute(
  ship: Point,
  center: Point,
  exitVector: Point,
  boundaryRadius: number,
  fromMidSystem: boolean,
  avoidCenter: Point,
  avoidRadius: number,
): { edge: Point; routePath: Point[] } {
  const edge = warpEdgePoint(
    ship,
    center,
    exitVector,
    boundaryRadius,
    fromMidSystem,
  );
  const routePath = avoidStarPath(
    ship.x,
    ship.y,
    edge.x,
    edge.y,
    avoidCenter.x,
    avoidCenter.y,
    avoidRadius,
  );
  return { edge, routePath };
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
 * Project (x,y) radially out to at least `minR` from (cx,cy). Points already
 * outside are returned unchanged; a point exactly on the center is pushed out
 * along +x (deterministic). Used to clamp navigation targets outside the sun's
 * exclusion ring — a click ON the star must not become a destination inside it
 * (playtest 2 ③: the ship flew into the sun).
 */
export function clampOutsideRadius(
  x: number,
  y: number,
  cx: number,
  cy: number,
  minR: number,
): Point {
  const dx = x - cx;
  const dy = y - cy;
  const dist = Math.hypot(dx, dy);
  if (dist >= minR) return { x, y };
  if (dist < 1e-9) return { x: cx + minR, y: cy };
  const k = minR / dist;
  return { x: cx + dx * k, y: cy + dy * k };
}

/**
 * Dash a polyline into stroke runs of `dashLength` separated by `gapLength`,
 * with the pattern phase carried ACROSS vertices — a dash that reaches a corner
 * bends around it instead of restarting. Each returned run is the point list of
 * one dash (≥ 2 points). Replaces per-segment dashing, which drew ZERO dashes
 * on segments shorter than the dash period — the sun-bypass spline's ~10px
 * segments left the whole arc invisible (playtest 2 ③: broken dashes).
 */
export function dashedPolyline(
  points: Point[],
  dashLength: number,
  gapLength: number,
): Point[][] {
  const dashes: Point[][] = [];
  if (points.length < 2 || dashLength <= 0 || gapLength < 0) return dashes;
  const period = dashLength + gapLength;
  let phase = 0; // arc-length position within the dash+gap cycle [0, period)
  let run: Point[] | null = null; // dash being built (null while in a gap)
  for (let s = 0; s < points.length - 1; s++) {
    const a = points[s];
    const b = points[s + 1];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    if (segLen === 0) continue;
    const ux = (b.x - a.x) / segLen;
    const uy = (b.y - a.y) / segLen;
    let pos = 0;
    while (pos < segLen - 1e-9) {
      const inDash = phase < dashLength;
      const phaseEnd = inDash ? dashLength : period;
      const step = Math.min(segLen - pos, phaseEnd - phase);
      if (inDash) {
        if (!run) run = [{ x: a.x + ux * pos, y: a.y + uy * pos }];
        run.push({ x: a.x + ux * (pos + step), y: a.y + uy * (pos + step) });
      } else if (run) {
        dashes.push(run);
        run = null;
      }
      pos += step;
      phase += step;
      if (phase >= period - 1e-9) phase = 0;
    }
  }
  if (run) dashes.push(run);
  return dashes;
}

/**
 * A path from (fx,fy) to (tx,ty) that bows around a star at (sx,sy) of radius R
 * instead of cutting through it. Returns just `[{to}]` when the straight segment
 * already clears the star, otherwise a smooth tangent-arc-tangent bypass of
 * waypoints around it plus the destination (US-070 #6). A destination inside
 * the exclusion ring is clamped to the ring edge first — no route may end
 * inside the star (playtest 2 ③: a click on the sun flew the ship into it).
 * Pure — used for both the route preview and execution.
 */
export function avoidStarPath(
  fx: number,
  fy: number,
  toX: number,
  toY: number,
  sx: number,
  sy: number,
  R: number,
): Point[] {
  const { x: tx, y: ty } = clampOutsideRadius(toX, toY, sx, sy, R);
  const dx = tx - fx;
  const dy = ty - fy;
  const len2 = dx * dx + dy * dy || 1;
  // Closest point on the segment to the star.
  let t = ((sx - fx) * dx + (sy - fy) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cxp = fx + dx * t;
  const cyp = fy + dy * t;
  if (Math.hypot(sx - cxp, sy - cyp) >= R) return [{ x: tx, y: ty }];

  // The bypass rides just outside the exclusion ring (R). A hair of margin
  // (1.01R) keeps the Catmull samples outside R on their own so the numerical
  // safety net below stays a genuine fallback. The old 1.15R "outer-glow
  // clearance" was the playtest3 F2 "strange curve" bug: R (390px) is already
  // 2.3× the visual sun (170px), so an extra 15% shoved the route out to 448px
  // — a route grazing the ring at 389px bowed to 448px (59px FARTHER from the
  // star than the straight line it replaced), and crossing the ring by 2px
  // (391→389) snapped from dead-straight to that wide bow. Riding the ring
  // removes the overshoot and the discontinuity while preserving the
  // clearance guarantee (the path never enters the ring).
  const arcR = R * 1.01;
  const thetaA = Math.atan2(fy - sy, fx - sx);
  const thetaB = Math.atan2(ty - sy, tx - sx);
  const dA = Math.hypot(fx - sx, fy - sy);
  const dB = Math.hypot(tx - sx, ty - sy);

  // Detour side: sweep the short way from A's bearing toward B's bearing (the
  // historical behaviour). A real clip implies A and B sit on roughly opposite
  // sides of the star, so this is well-defined; guard the degenerate case.
  let around = thetaB - thetaA;
  while (around > Math.PI) around -= 2 * Math.PI;
  while (around < -Math.PI) around += 2 * Math.PI;
  if (Math.abs(around) < 1e-3) around = Math.PI; // near-coincident bearings
  const sigma = around >= 0 ? 1 : -1;

  // Tangent-line construction (Sprint 3 Task 8). The bypass ENTERS and LEAVES
  // the avoidance ring along lines that are tangent to it, so there is no sharp
  // circumferential→radial corner — the root cause of the old kinks, where a
  // uniform Catmull-Rom through a far destination control point folded back on
  // itself. `beta` is the tangent half-angle from each endpoint; an endpoint
  // inside the ring falls back to a radial entry (beta = 0).
  const betaA = dA > arcR ? Math.acos(arcR / dA) : 0;
  const betaB = dB > arcR ? Math.acos(arcR / dB) : 0;
  const phi1 = thetaA + sigma * betaA; // entry tangent bearing on the ring
  const phi2 = thetaB - sigma * betaB; // exit tangent bearing on the ring

  // Sweep from phi1 to phi2 in the detour direction (a tangent-arc-tangent wrap
  // is the minor arc, ≤ π).
  let sweep = phi2 - phi1;
  while (sweep > Math.PI) sweep -= 2 * Math.PI;
  while (sweep < -Math.PI) sweep += 2 * Math.PI;
  if (sigma > 0 && sweep < 0) sweep += 2 * Math.PI;
  if (sigma < 0 && sweep > 0) sweep -= 2 * Math.PI;

  // Dense, EVENLY spaced control points on the ring from the entry tangent point
  // through to the exit tangent point (~14 per semicircle). Equal spacing means
  // uniform Catmull-Rom cannot overshoot — there is no spacing disparity and no
  // corner for it to ring around.
  const steps = Math.max(10, Math.round((Math.abs(sweep) / Math.PI) * 14));
  const control: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = phi1 + sweep * (i / steps);
    control.push({ x: sx + Math.cos(a) * arcR, y: sy + Math.sin(a) * arcR });
  }
  const smoothed = catmullRomSpline(control, 8);
  // The far destination is deliberately NOT a spline control point: appending it
  // as a straight tangent segment keeps the exit-tangent junction smooth and
  // avoids the overshoot a distant control point would induce.
  smoothed.push({ x: tx, y: ty });

  // Numerical safety net: should any interior sample dip below the hard radius R
  // (only reachable via the rare in-ring beta=0 fallback), rebuild that
  // contiguous run as a monotonic boundary arc — clearance holds without the
  // fold a naive radial push-out would create. The final point is the true
  // destination — leave it intact.
  const inside = (p: Point) => Math.hypot(p.x - sx, p.y - sy) < R;
  let i = 0;
  while (i < smoothed.length - 1) {
    if (!inside(smoothed[i])) {
      i++;
      continue;
    }
    let j = i;
    while (j < smoothed.length - 1 && inside(smoothed[j])) j++;
    const aPrev =
      i > 0
        ? Math.atan2(smoothed[i - 1].y - sy, smoothed[i - 1].x - sx)
        : Math.atan2(smoothed[i].y - sy, smoothed[i].x - sx);
    const aNext = Math.atan2(smoothed[j].y - sy, smoothed[j].x - sx);
    let span = aNext - aPrev;
    while (span > Math.PI) span -= 2 * Math.PI;
    while (span < -Math.PI) span += 2 * Math.PI;
    const runLen = j - i;
    for (let k = 0; k < runLen; k++) {
      const a = aPrev + (span * (k + 1)) / (runLen + 1);
      smoothed[i + k] = { x: sx + Math.cos(a) * R, y: sy + Math.sin(a) * R };
    }
    i = j;
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
 * The star-avoidance path, falling back to a landing spiral-in when the
 * straight shot is clear of the star but a planet destination was hinted —
 * the single flight-path derivation shared by planning and executing a route
 * (SpaceFlightScene.planRouteTo / executeRouteTo, "drawn == flown" contract).
 */
export function computeFlightPath(
  fx: number,
  fy: number,
  tx: number,
  ty: number,
  star: { centerX: number; centerY: number; avoidRadius: number },
  landingApproachOffset: number,
  landing?: { planetX: number; planetY: number; planetRadius: number },
): Point[] {
  const path = avoidStarPath(
    fx,
    fy,
    tx,
    ty,
    star.centerX,
    star.centerY,
    star.avoidRadius,
  );
  if (landing && path.length <= 1) {
    return spiralApproachPath(
      fx,
      fy,
      landing.planetX,
      landing.planetY,
      landing.planetRadius,
      landingApproachOffset,
    );
  }
  return path;
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
    // Strict <: a sample landing EXACTLY on the total length falls through to
    // the done:true return below, honouring the documented "reaches/exceeds"
    // contract (so a route of exactly one day draws no mid-route day marker
    // on top of its end marker).
    if (dist < acc + seg) {
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
 * Compute the approach waypoint for a planet: a point on the ship-facing edge
 * of the planet disc, offset outward by `offset` px.  Routing to this point
 * instead of the planet centre prevents the preview line from cutting through
 * the disc, while the auto-land trigger (which fires when the ship is within
 * `LANDING_RANGE` of the surface) ensures the ship still lands on arrival.
 *
 * Live report (2026-07-19, Task 10 "autopilot hangs and thinks"): when the
 * ship is ALREADY closer to the planet than `planetRadius + offset` — but not
 * yet inside the real, smaller auto-land trigger radius
 * (`planetRadius + LANDING_RANGE`, `PlanetManager.ts`) — backing off
 * `radius + offset` from the planet along the ship's own bearing overshoots
 * PAST the ship, producing an "approach point" a few px from the ship's
 * current position pointed the wrong way. `executeRouteTo` then computes a
 * near-zero-length path that never advances the ship into real landing
 * range; the live autopilot re-decides "land" every tick and re-issues the
 * same stuck route forever. Once inside that ring there is no bow left to
 * fly — head straight at the planet centre; the proactive auto-land check
 * fires well before the ship would ever reach the surface.
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
  if (dist <= planetRadius + offset) {
    return { x: planetX, y: planetY };
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

/**
 * Radius (world px) of a planet's quest-indicator ring. It is a halo just
 * *outside* the planet disc so it scales with the (now large) planet rather than
 * sitting inside it as a stray small circle (bug: a fixed 25px ring read as a
 * random circle on the planet surface once planets render large, US-070 #3).
 */
export function questMarkerRadius(displayRadius: number, margin = 10): number {
  return displayRadius + margin;
}

// ---------------------------------------------------------------------------
// Hyperbolic flyby (open, single-pass comet trajectory)
// ---------------------------------------------------------------------------

/**
 * Parameters of a hyperbolic flyby focused on the star. A conic with the focus
 * at the star has the polar form `r(θ) = p / (1 + e·cos θ)` where `θ` is the
 * true anomaly (0 at perihelion), `e > 1` for a hyperbola, and the semi-latus
 * rectum `p = q·(1 + e)` with `q` the perihelion distance. The bound branch (the
 * one that wraps the focus) exists for `|θ| < acos(−1/e)`; outside that the body
 * has escaped to infinity along an asymptote. This is the open analogue of the
 * elliptical orbit the comets used to fly — a single pass, never periodic.
 */
export interface HyperbolaParams {
  /** Focus (star centre) world x. */
  focusX: number;
  /** Focus (star centre) world y. */
  focusY: number;
  /** Perihelion distance `q` (closest approach to the focus), world px. */
  perihelion: number;
  /** Eccentricity `e` — must be > 1 for an open (hyperbolic) path. */
  eccentricity: number;
  /** World bearing (rad) of the perihelion direction from the focus. */
  orientation: number;
}

/** Semi-latus rectum `p = q·(1 + e)` for a focus-centred conic. */
function semiLatusRectum(p: HyperbolaParams): number {
  return p.perihelion * (1 + p.eccentricity);
}

/**
 * World point on the hyperbola at true anomaly `theta` (0 = perihelion). Valid
 * on the bound branch `|theta| < hyperbolaAsymptoteAngle(e)`; at the asymptote
 * the radius diverges. The denominator is clamped to a small positive value so a
 * caller that walks slightly past the asymptote gets a finite (far) point rather
 * than a sign-flipped jump onto the other branch.
 */
export function hyperbolaPoint(p: HyperbolaParams, theta: number): Point {
  const denom = Math.max(1e-6, 1 + p.eccentricity * Math.cos(theta));
  const r = semiLatusRectum(p) / denom;
  const bearing = p.orientation + theta;
  return {
    x: p.focusX + r * Math.cos(bearing),
    y: p.focusY + r * Math.sin(bearing),
  };
}

/**
 * True anomaly of the asymptote (`θ_max = acos(−1/e)`): the limiting angle at
 * which the hyperbolic radius diverges. The incoming/outgoing asymptotes are at
 * `orientation ± θ_max`, symmetric about the perihelion direction.
 */
export function hyperbolaAsymptoteAngle(eccentricity: number): number {
  return Math.acos(-1 / eccentricity);
}

/**
 * The (positive) true anomaly at which the body crosses a given `radius` from
 * the focus. The incoming crossing is at `−` this value, the outgoing at `+`.
 * For any `radius ≥ perihelion` this is strictly inside the asymptote angle, so
 * a flyby entering at the field edge is always well-defined.
 */
export function hyperbolaTrueAnomalyAtRadius(
  p: HyperbolaParams,
  radius: number,
): number {
  const cosTheta = (semiLatusRectum(p) / radius - 1) / p.eccentricity;
  return Math.acos(Math.max(-1, Math.min(1, cosTheta)));
}

/** A single-pass comet flyby: hyperbola params plus the entry/exit sweep range. */
export interface CometFlyby {
  params: HyperbolaParams;
  /** True anomaly at entry (negative — incoming, at the field edge). */
  thetaStart: number;
  /** True anomaly at exit (positive — outgoing, at the field edge). */
  thetaEnd: number;
}

/**
 * Build a comet flyby focused on the star at (`focusX`,`focusY`): an open
 * hyperbola (`e > 1`) whose perihelion sits well inside the field and whose
 * entry/exit happen at `fieldRadius`. The comet sweeps the true anomaly once
 * from `thetaStart` (incoming, at the edge) through 0 (perihelion) to `thetaEnd`
 * (outgoing, at the edge) and never returns. `rng` is injectable for
 * deterministic tests (defaults to `Math.random`).
 */
export function buildCometFlyby(
  focusX: number,
  focusY: number,
  fieldRadius: number,
  rng: () => number = Math.random,
): CometFlyby {
  const eccentricity = 1.15 + rng() * 0.85; // 1.15–2.0, always > 1
  const perihelion = fieldRadius * (0.12 + rng() * 0.33); // 12–45% of field
  const orientation = rng() * Math.PI * 2;
  const params: HyperbolaParams = {
    focusX,
    focusY,
    perihelion,
    eccentricity,
    orientation,
  };
  const thetaEdge = hyperbolaTrueAnomalyAtRadius(params, fieldRadius);
  return { params, thetaStart: -thetaEdge, thetaEnd: thetaEdge };
}

/**
 * Whether a route aimed at a *moving* target should be re-plotted: true once the
 * target's fresh (lead) position has drifted more than `threshold` world px from
 * the current route endpoint. The threshold naturally throttles re-aims — each
 * re-plot resets the endpoint to the fresh lead, so it won't fire again until the
 * target drifts another `threshold`. Lets the ship continuously correct its
 * course toward an orbiting planet / manoeuvring NPC instead of flying to where
 * the target *was* and only correcting on arrival.
 */
export function shouldReaim(
  endpoint: Point,
  freshLead: Point,
  threshold: number,
): boolean {
  return (
    Math.hypot(freshLead.x - endpoint.x, freshLead.y - endpoint.y) > threshold
  );
}

// ---------------------------------------------------------------------------
// Smooth chase steering (auto-follow / combat-pursuit anti-stutter)
// ---------------------------------------------------------------------------

/** Tuning for {@link smoothLeadPoint}. */
export interface LeadSmootherOptions {
  /**
   * EMA weight in (0,1]: the fraction of the gap to the fresh `raw` lead closed
   * per update. Smaller = heavier smoothing (more lag, less jitter).
   */
  alpha: number;
  /**
   * Hard cap (world px) on how far the smoothed point may move in a single
   * update — bounds the per-frame aim delta even when a noisy target-velocity
   * estimate whips `raw` a long way.
   */
  maxStepPx: number;
}

/**
 * Smooth a fresh (noisy) intercept/lead point toward its previous smoothed
 * value: an EMA step of `alpha` toward `raw`, then clamped so the point never
 * moves more than `maxStepPx` in one update. With no `previous` value the raw
 * point is adopted verbatim (first frame of a chase).
 *
 * Why: the live chase derives the target's velocity from its *rendered* heading
 * (`cos/sin(rotation) × npcSpeed`), which wobbles frame-to-frame on an arcing
 * NPC; `solveInterceptPoint` multiplies that wobble by the (large) time to
 * intercept, so the raw lead jumps tens of px per frame and the aim oscillates.
 * Blending toward the previous value removes the whip while still tracking a
 * steadily-moving target (the smoothed point converges monotonically — it never
 * overshoots, since `alpha ≤ 1` and the clamp only ever shortens the step).
 */
export function smoothLeadPoint(
  previous: Point | null,
  raw: Point,
  opts: LeadSmootherOptions,
): Point {
  if (!previous) return { x: raw.x, y: raw.y };
  const alpha = Math.max(0, Math.min(1, opts.alpha));
  // Guard the clamp the same way as alpha: a negative cap would flip the step
  // direction (k < 0 → move *away* from `raw`); clamp to 0 (freeze) instead.
  const maxStepPx = Math.max(0, opts.maxStepPx);
  let dx = (raw.x - previous.x) * alpha;
  let dy = (raw.y - previous.y) * alpha;
  const step = Math.hypot(dx, dy);
  if (step > maxStepPx && step > 1e-9) {
    const k = maxStepPx / step;
    dx *= k;
    dy *= k;
  }
  return { x: previous.x + dx, y: previous.y + dy };
}

/** State the re-aim gate ({@link shouldReplotRoute}) carries between frames. */
export interface ReaimGateState {
  /** The route endpoint the ship is currently steering toward. */
  endpoint: Point;
  /** Timestamp (ms) of the last curved-route re-plot. */
  lastReplotMs: number;
}

/**
 * Decide whether a moving-target chase should re-plot its *curved* route now —
 * the hysteresis that keeps continuous turn-rate steering from thrashing the
 * spline every frame. Re-plots only when BOTH:
 *   1. at least `minIntervalMs` has elapsed since the last re-plot (time
 *      hysteresis — even a large drift won't re-plot more than once per
 *      interval), and
 *   2. the fresh lead has drifted past `thresholdPx` from the current endpoint
 *      (the existing {@link shouldReaim} distance gate).
 *
 * Sub-threshold jitter therefore never re-plots, and a fast-manoeuvring target
 * re-plots at most once per interval — the continuous heading nudge (driven by
 * {@link smoothLeadPoint}) handles everything in between.
 */
export function shouldReplotRoute(
  state: ReaimGateState,
  freshLead: Point,
  thresholdPx: number,
  nowMs: number,
  minIntervalMs: number,
): boolean {
  if (nowMs - state.lastReplotMs < minIntervalMs) return false;
  return shouldReaim(state.endpoint, freshLead, thresholdPx);
}
