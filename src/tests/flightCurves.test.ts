import { describe, it, expect } from "vitest";
import {
  bowedPath,
  spiralApproachPath,
  takeoffArcPath,
  pointAlongPath,
  avoidStarPath,
  computeFlightPath,
  type Point,
} from "@/utils/flightGeometry";

function maxChordDeviation(points: Point[], from: Point, to: Point): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len; // unit perpendicular
  const ny = dx / len;
  let max = 0;
  for (const p of points) {
    const dev = Math.abs((p.x - from.x) * nx + (p.y - from.y) * ny);
    if (dev > max) max = dev;
  }
  return max;
}

describe("bowedPath (Task 5: curved manoeuvring arc)", () => {
  it("returns a curved multi-point arc ending at the target", () => {
    const path = bowedPath(0, 0, 100, 0, 0.2);
    expect(path.length).toBeGreaterThan(1);
    const last = path[path.length - 1];
    expect(last.x).toBeCloseTo(100);
    expect(last.y).toBeCloseTo(0);
    expect(
      maxChordDeviation(path, { x: 0, y: 0 }, { x: 100, y: 0 }),
    ).toBeGreaterThan(12);
  });

  it("flips bow direction with the sign of bowFrac", () => {
    const up = bowedPath(0, 0, 100, 0, 0.2);
    const down = bowedPath(0, 0, 100, 0, -0.2);
    const upMid = up[Math.floor(up.length / 2)];
    const downMid = down[Math.floor(down.length / 2)];
    expect(Math.sign(upMid.y)).toBe(-Math.sign(downMid.y));
  });

  it("returns a straight single point when bowFrac is zero or degenerate", () => {
    expect(bowedPath(0, 0, 100, 0, 0)).toEqual([{ x: 100, y: 0 }]);
    expect(bowedPath(5, 5, 5, 5, 0.2)).toEqual([{ x: 5, y: 5 }]);
  });
});

describe("spiralApproachPath (Task 5: curved landing insertion)", () => {
  it("ends at the orbit-edge approach point and curves toward it", () => {
    const path = spiralApproachPath(0, 0, 200, 0, 30, 80);
    expect(path.length).toBeGreaterThan(1);
    const last = path[path.length - 1];
    expect(last.x).toBeCloseTo(90);
    expect(last.y).toBeCloseTo(0);
    expect(
      maxChordDeviation(path, { x: 0, y: 0 }, { x: 90, y: 0 }),
    ).toBeGreaterThan(3);
  });

  it("never routes to the planet centre", () => {
    const path = spiralApproachPath(0, 0, 200, 0, 30, 80);
    for (const p of path) {
      expect(Math.hypot(p.x - 200, p.y - 0)).toBeGreaterThan(30);
    }
  });
});

describe("takeoffArcPath (Task 5: outward lift-off arc)", () => {
  it("starts at the planet edge and arcs out beyond it", () => {
    const path = takeoffArcPath(0, 0, 1, 0, 30, 90);
    expect(path.length).toBeGreaterThan(2);
    expect(path[0].x).toBeCloseTo(30);
    expect(path[0].y).toBeCloseTo(0);
    const last = path[path.length - 1];
    expect(last.x).toBeCloseTo(120);
    expect(last.y).toBeCloseTo(0);
    expect(
      maxChordDeviation(path, { x: 30, y: 0 }, { x: 120, y: 0 }),
    ).toBeGreaterThan(8);
  });
});

describe("pointAlongPath (Task 5: take-off animation sampling)", () => {
  const poly: Point[] = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ];

  it("returns the start point at distance 0", () => {
    const s = pointAlongPath(poly, 0);
    expect(s.x).toBeCloseTo(0);
    expect(s.y).toBeCloseTo(0);
    expect(s.done).toBe(false);
  });

  it("interpolates within a segment with that segment's heading", () => {
    const s = pointAlongPath(poly, 15); // 5px into the vertical second segment
    expect(s.x).toBeCloseTo(10);
    expect(s.y).toBeCloseTo(5);
    expect(s.heading).toBeCloseTo(Math.PI / 2);
    expect(s.done).toBe(false);
  });

  it("clamps to the final point and reports done past the end", () => {
    const s = pointAlongPath(poly, 1000);
    expect(s.x).toBeCloseTo(10);
    expect(s.y).toBeCloseTo(10);
    expect(s.done).toBe(true);
  });

  it("reports done at EXACTLY the total length (a one-day route draws no mid-route day marker over its end marker)", () => {
    const s = pointAlongPath(poly, 20); // total polyline length is exactly 20
    expect(s.x).toBeCloseTo(10);
    expect(s.y).toBeCloseTo(10);
    expect(s.done).toBe(true);
  });
});

describe("computeFlightPath (extracted scene routing: star-avoid vs landing spiral)", () => {
  const star = { centerX: 0, centerY: 0, avoidRadius: 300 };

  it("a clear shot with a landing hint takes the spiral-in approach", () => {
    const landing = { planetX: 1000, planetY: 500, planetRadius: 40 };
    const path = computeFlightPath(800, 500, 960, 500, star, 20, landing);
    expect(path).toEqual(spiralApproachPath(800, 500, 1000, 500, 40, 20));
    expect(path.length).toBeGreaterThan(1); // a real curve, not a bare endpoint
  });

  it("a star-blocked route wins over the landing spiral (the bowed path is kept)", () => {
    const landing = { planetX: 520, planetY: 0, planetRadius: 40 };
    const path = computeFlightPath(-500, 0, 500, 0, star, 20, landing);
    expect(path.length).toBeGreaterThan(1); // the avoid path, not the spiral
    expect(path).toEqual(avoidStarPath(-500, 0, 500, 0, 0, 0, 300));
  });

  it("a clear shot with no landing hint is the bare destination leg", () => {
    const path = computeFlightPath(800, 500, 900, 500, star, 20);
    expect(path).toEqual(avoidStarPath(800, 500, 900, 500, 0, 0, 300));
  });
});

describe("route line arc (Task 5: route bends visibly around the sun)", () => {
  it("yields a multi-segment polyline that clears the star", () => {
    const path = avoidStarPath(-500, 0, 500, 0, 0, 0, 300);
    expect(path.length).toBeGreaterThan(2); // curved, not a single straight leg
    const full: Point[] = [{ x: -500, y: 0 }, ...path];
    for (const p of full.slice(0, -1)) {
      expect(Math.hypot(p.x, p.y)).toBeGreaterThanOrEqual(300 - 1e-6);
    }
    expect(
      maxChordDeviation(full, { x: -500, y: 0 }, { x: 500, y: 0 }),
    ).toBeGreaterThan(50);
  });
});

function minTurnAngleDeg(points: Point[]): number {
  let min = 180;
  for (let i = 1; i < points.length - 1; i++) {
    const ax = points[i - 1].x - points[i].x;
    const ay = points[i - 1].y - points[i].y;
    const bx = points[i + 1].x - points[i].x;
    const by = points[i + 1].y - points[i].y;
    const la = Math.hypot(ax, ay);
    const lb = Math.hypot(bx, by);
    if (la < 1e-9 || lb < 1e-9) continue; // skip coincident points
    let cos = (ax * bx + ay * by) / (la * lb);
    cos = Math.max(-1, Math.min(1, cos));
    const deg = (Math.acos(cos) * 180) / Math.PI;
    if (deg < min) min = deg;
  }
  return min;
}

describe("avoidStarPath smoothness (Task 8: no visible kinks)", () => {
  it("produces a dense polyline with no kinks sharper than 20°", () => {
    const path = avoidStarPath(-500, 0, 500, 0, 0, 0, 300);
    expect(path.length).toBeGreaterThanOrEqual(20);
    expect(minTurnAngleDeg(path)).toBeGreaterThanOrEqual(160);
  });

  it("rides just outside the ring at the arc apex, not a wide 1.15R bow (playtest3 F2)", () => {
    const R = 300;
    const path = avoidStarPath(-500, 0, 500, 0, 0, 0, R);
    const apexR = Math.max(
      ...path.slice(0, -1).map((p) => Math.hypot(p.x, p.y)),
    );
    expect(apexR).toBeGreaterThanOrEqual(R);
    expect(apexR).toBeLessThan(R * 1.05);
  });

  it("does not snap from straight to a wide bow at the ring boundary (playtest3 F2)", () => {
    const R = 390; // SUN_EXCLUSION_RADIUS
    const outside = avoidStarPath(-1500, R + 1, 1500, R + 1, 0, 0, R);
    expect(outside).toEqual([{ x: 1500, y: R + 1 }]);

    const inside = avoidStarPath(-1500, R - 1, 1500, R - 1, 0, 0, R);
    const apexR = Math.max(
      ...inside.slice(0, -1).map((p) => Math.hypot(p.x, p.y)),
    );
    expect(apexR).toBeGreaterThanOrEqual(R); // clearance preserved
    expect(apexR).toBeLessThan(R + 12); // small nudge, not a 58px overshoot
  });

  it("stays kink-free for an off-axis (quarter-turn) bypass", () => {
    const path = avoidStarPath(-400, -50, 50, 400, 0, 0, 250);
    expect(path.length).toBeGreaterThanOrEqual(20);
    expect(minTurnAngleDeg(path)).toBeGreaterThanOrEqual(160);
  });

  it("never kinks below 160° (and never clips the star) over random routes", () => {
    let seed = 0x9e3779b1;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0xffffffff;
    };
    for (let k = 0; k < 5000; k++) {
      const sx = (rnd() - 0.5) * 1000;
      const sy = (rnd() - 0.5) * 1000;
      const R = 150 + rnd() * 350;
      const place = () => {
        const ang = rnd() * Math.PI * 2;
        const dist = R * 1.15 + 100 + rnd() * 3000;
        return { x: sx + Math.cos(ang) * dist, y: sy + Math.sin(ang) * dist };
      };
      const a = place();
      const b = place();
      const path = avoidStarPath(a.x, a.y, b.x, b.y, sx, sy, R);
      if (path.length < 3) continue; // straight shot — no arc to check
      expect(minTurnAngleDeg(path)).toBeGreaterThanOrEqual(160);
      for (const p of path.slice(0, -1)) {
        expect(Math.hypot(p.x - sx, p.y - sy)).toBeGreaterThanOrEqual(R - 1e-6);
      }
    }
  });
});
