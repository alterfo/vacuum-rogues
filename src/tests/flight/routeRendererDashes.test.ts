/**
 * Playtest 2 finding ③ (broken dashes): the route line "disappears and
 * resumes" along the sun-bypass arc. Root cause: RouteRenderer dashed each
 * polyline segment INDEPENDENTLY with `Math.floor(segLen / period)` dashes —
 * the bypass spline's segments are ~10px each (shorter than the 30px dash
 * period), so the whole curved arc rendered ZERO dashes while the long
 * straight tangent legs rendered normally.
 *
 * Contract under test: the dash pattern walks the WHOLE polyline with its
 * phase carried across vertices — no undashed stretch longer than one dash
 * period anywhere along the route. Uses real PixiJS Graphics and reads the
 * recorded GraphicsContext instructions (no WebGL needed).
 */
import { describe, it, expect } from "vitest";
import { Container, Graphics } from "pixi.js";
import { RouteRenderer } from "@/presentation/flight/RouteRenderer";
import {
  avoidStarPath,
  dashedPolyline,
  type Point,
} from "@/utils/flightGeometry";

const DASH = 20;
const GAP = 10;
const PERIOD = DASH + GAP;

/** Cumulative arc length of each vertex of a polyline. */
function cumulativeLengths(points: Point[]): number[] {
  const acc = [0];
  for (let i = 1; i < points.length; i++) {
    acc.push(
      acc[i - 1] +
        Math.hypot(
          points[i].x - points[i - 1].x,
          points[i].y - points[i - 1].y,
        ),
    );
  }
  return acc;
}

/**
 * Arc-length position of a point that lies ON the polyline: find the segment
 * whose endpoints bracket it (|ap| + |pb| ≈ |ab|) and interpolate.
 */
function arcPosition(points: Point[], acc: number[], p: Point): number {
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const ab = acc[i + 1] - acc[i];
    if (ab === 0) continue;
    const ap = Math.hypot(p.x - a.x, p.y - a.y);
    const pb = Math.hypot(b.x - p.x, b.y - p.y);
    if (Math.abs(ap + pb - ab) < 1e-3) return acc[i] + ap;
  }
  throw new Error(`point (${p.x}, ${p.y}) is not on the polyline`);
}

/**
 * Extract the dash strokes (the FIRST stroke instruction — the cyan course
 * line) from the renderer's Graphics as [start, end] arc-positions on `route`.
 */
function dashIntervals(g: Graphics, route: Point[]): [number, number][] {
  const acc = cumulativeLengths(route);
  const instructions = (
    g.context as unknown as {
      instructions: {
        action: string;
        data: { path?: { instructions: { action: string; data: number[] }[] } };
      }[];
    }
  ).instructions;
  const stroke = instructions.find((i) => i.action === "stroke");
  expect(stroke?.data.path).toBeDefined();
  const ops = stroke!.data.path!.instructions;
  const intervals: [number, number][] = [];
  let runStart: number | null = null;
  let runEnd = 0;
  for (const op of ops) {
    const p = { x: op.data[0], y: op.data[1] };
    if (op.action === "moveTo") {
      if (runStart !== null) intervals.push([runStart, runEnd]);
      runStart = arcPosition(route, acc, p);
      runEnd = runStart;
    } else if (op.action === "lineTo") {
      runEnd = arcPosition(route, acc, p);
    }
  }
  if (runStart !== null) intervals.push([runStart, runEnd]);
  return intervals;
}

/** Longest stretch of the route NOT covered by any dash interval. */
function maxUncoveredGap(intervals: [number, number][], total: number): number {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  let max = 0;
  let cursor = 0;
  for (const [s, e] of sorted) {
    if (s - cursor > max) max = s - cursor;
    if (e > cursor) cursor = e;
  }
  if (total - cursor > max) max = total - cursor;
  return max;
}

describe("RouteRenderer dash continuity (playtest 2 ③: no broken dashes)", () => {
  it("dashes the sun-bypass arc with no gap longer than one dash period", () => {
    // A route that wraps the star: dense ~10px spline segments in the middle.
    const start = { x: -800, y: 40 };
    const path = avoidStarPath(start.x, start.y, 800, -40, 0, 0, 390);
    const route = [start, ...path];
    expect(path.length).toBeGreaterThan(20); // sanity: it IS a bypass arc

    const layer = new Container();
    const renderer = new RouteRenderer(layer);
    renderer.drawRoute(route, 500);

    const total = cumulativeLengths(route)[route.length - 1];
    const intervals = dashIntervals(renderer.graphics!, route);
    // The arc region must be dashed like the straight legs: nowhere along the
    // route is there an undashed stretch longer than one dash period.
    expect(maxUncoveredGap(intervals, total)).toBeLessThanOrEqual(PERIOD + 1);
    renderer.clearRoute();
  });
});

describe("dashedPolyline (pure dash walk)", () => {
  it("alternates dash/gap along a single straight segment", () => {
    const dashes = dashedPolyline(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      DASH,
      GAP,
    );
    // 100px = 3 full periods (20 dash + 10 gap) + a final 10px partial dash.
    expect(dashes.length).toBe(4);
    expect(dashes[0][0].x).toBeCloseTo(0);
    expect(dashes[0][dashes[0].length - 1].x).toBeCloseTo(20);
    expect(dashes[1][0].x).toBeCloseTo(30);
    expect(dashes[3][dashes[3].length - 1].x).toBeCloseTo(100);
  });

  it("carries the dash phase across vertices shorter than the period", () => {
    // 30 chained 7px segments: every vertex falls mid-pattern.
    const pts: Point[] = [];
    for (let i = 0; i <= 30; i++) pts.push({ x: i * 7, y: 0 });
    const dashes = dashedPolyline(pts, DASH, GAP);
    expect(dashes.length).toBeGreaterThan(0);
    // Every full dash run measures one dashLength of arc (partial last run ok).
    for (let d = 0; d < dashes.length - 1; d++) {
      const run = dashes[d];
      let len = 0;
      for (let i = 1; i < run.length; i++) {
        len += Math.hypot(run[i].x - run[i - 1].x, run[i].y - run[i - 1].y);
      }
      expect(len).toBeCloseTo(DASH, 6);
    }
    // Consecutive runs are separated by exactly one gapLength.
    for (let d = 1; d < dashes.length; d++) {
      const prevEnd = dashes[d - 1][dashes[d - 1].length - 1];
      const start = dashes[d][0];
      expect(Math.hypot(start.x - prevEnd.x, start.y - prevEnd.y)).toBeCloseTo(
        GAP,
        6,
      );
    }
  });

  it("bends a dash across a corner instead of breaking it", () => {
    // L-shaped polyline with the corner mid-dash (at 15px into a 20px dash).
    const dashes = dashedPolyline(
      [
        { x: 0, y: 0 },
        { x: 15, y: 0 },
        { x: 15, y: 50 },
      ],
      DASH,
      GAP,
    );
    // First dash spans the corner: 15px horizontal + 5px vertical.
    const first = dashes[0];
    expect(first[0]).toEqual({ x: 0, y: 0 });
    const last = first[first.length - 1];
    expect(last.x).toBeCloseTo(15);
    expect(last.y).toBeCloseTo(5);
  });

  it("returns no dashes for degenerate input", () => {
    expect(dashedPolyline([], DASH, GAP)).toEqual([]);
    expect(dashedPolyline([{ x: 1, y: 1 }], DASH, GAP)).toEqual([]);
  });
});
