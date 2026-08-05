export interface InterceptPoint {
  x: number;
  y: number;
}

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
