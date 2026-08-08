import { hashStr } from "@/utils/hashStr";

export interface Point {
  x: number;
  y: number;
}

export function hashToAngle(s: string): number {
  return (hashStr(s) / 0xffffffff) * Math.PI * 2;
}

export function planetOrbitPosition(
  orbitalRadius: number,
  baseAngle: number,
  day: number,
  center: Point,
): Point {
  const periodDays = 400 * Math.pow(orbitalRadius / 600, 1.5);
  const angle = baseAngle + ((Math.PI * 2) / periodDays) * day;
  return {
    x: center.x + Math.cos(angle) * orbitalRadius,
    y: center.y + Math.sin(angle) * orbitalRadius,
  };
}

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
  let t = ((sx - fx) * dx + (sy - fy) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cxp = fx + dx * t;
  const cyp = fy + dy * t;
  if (Math.hypot(sx - cxp, sy - cyp) >= R) return [{ x: tx, y: ty }];

  const arcR = R * 1.01;
  const thetaA = Math.atan2(fy - sy, fx - sx);
  const thetaB = Math.atan2(ty - sy, tx - sx);
  const dA = Math.hypot(fx - sx, fy - sy);
  const dB = Math.hypot(tx - sx, ty - sy);

  let around = thetaB - thetaA;
  while (around > Math.PI) around -= 2 * Math.PI;
  while (around < -Math.PI) around += 2 * Math.PI;
  if (Math.abs(around) < 1e-3) around = Math.PI; // near-coincident bearings
  const sigma = around >= 0 ? 1 : -1;

  const betaA = dA > arcR ? Math.acos(arcR / dA) : 0;
  const betaB = dB > arcR ? Math.acos(arcR / dB) : 0;
  const phi1 = thetaA + sigma * betaA; // entry tangent bearing on the ring
  const phi2 = thetaB - sigma * betaB; // exit tangent bearing on the ring

  let sweep = phi2 - phi1;
  while (sweep > Math.PI) sweep -= 2 * Math.PI;
  while (sweep < -Math.PI) sweep += 2 * Math.PI;
  if (sigma > 0 && sweep < 0) sweep += 2 * Math.PI;
  if (sigma < 0 && sweep > 0) sweep -= 2 * Math.PI;

  const steps = Math.max(10, Math.round((Math.abs(sweep) / Math.PI) * 14));
  const control: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = phi1 + sweep * (i / steps);
    control.push({ x: sx + Math.cos(a) * arcR, y: sy + Math.sin(a) * arcR });
  }
  const smoothed = catmullRomSpline(control, 8);
  smoothed.push({ x: tx, y: ty });

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
  const dot = px * (planetX - mx) + py * (planetY - my);
  const sign = dot > 0 ? -1 : 1;
  return bowedPath(shipX, shipY, ap.x, ap.y, sign * bowFrac);
}

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

export interface PathSample {
  x: number;
  y: number;
  heading: number;
  done: boolean;
}

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

export function questMarkerRadius(displayRadius: number, margin = 10): number {
  return displayRadius + margin;
}

export interface HyperbolaParams {
  focusX: number;
  focusY: number;
  perihelion: number;
  eccentricity: number;
  orientation: number;
}

function semiLatusRectum(p: HyperbolaParams): number {
  return p.perihelion * (1 + p.eccentricity);
}

export function hyperbolaPoint(p: HyperbolaParams, theta: number): Point {
  const denom = Math.max(1e-6, 1 + p.eccentricity * Math.cos(theta));
  const r = semiLatusRectum(p) / denom;
  const bearing = p.orientation + theta;
  return {
    x: p.focusX + r * Math.cos(bearing),
    y: p.focusY + r * Math.sin(bearing),
  };
}

export function hyperbolaAsymptoteAngle(eccentricity: number): number {
  return Math.acos(-1 / eccentricity);
}

export function hyperbolaTrueAnomalyAtRadius(
  p: HyperbolaParams,
  radius: number,
): number {
  const cosTheta = (semiLatusRectum(p) / radius - 1) / p.eccentricity;
  return Math.acos(Math.max(-1, Math.min(1, cosTheta)));
}

export interface CometFlyby {
  params: HyperbolaParams;
  thetaStart: number;
  thetaEnd: number;
}

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

export function shouldReaim(
  endpoint: Point,
  freshLead: Point,
  threshold: number,
): boolean {
  return (
    Math.hypot(freshLead.x - endpoint.x, freshLead.y - endpoint.y) > threshold
  );
}

export interface LeadSmootherOptions {
  alpha: number;
  maxStepPx: number;
}

export function smoothLeadPoint(
  previous: Point | null,
  raw: Point,
  opts: LeadSmootherOptions,
): Point {
  if (!previous) return { x: raw.x, y: raw.y };
  const alpha = Math.max(0, Math.min(1, opts.alpha));
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

export interface ReaimGateState {
  endpoint: Point;
  lastReplotMs: number;
}

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
