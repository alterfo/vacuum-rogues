import { describe, it, expect } from "vitest";
import {
  buildCometFlyby,
  hyperbolaAsymptoteAngle,
  hyperbolaPoint,
  hyperbolaTrueAnomalyAtRadius,
  type HyperbolaParams,
} from "@/utils/flightGeometry";

function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FOCUS_X = 1000;
const FOCUS_Y = 800;
const distToFocus = (p: { x: number; y: number }) =>
  Math.hypot(p.x - FOCUS_X, p.y - FOCUS_Y);

describe("hyperbolaPoint", () => {
  const params: HyperbolaParams = {
    focusX: FOCUS_X,
    focusY: FOCUS_Y,
    perihelion: 400,
    eccentricity: 1.6,
    orientation: 0.7,
  };

  it("places perihelion (theta=0) at the closest-approach distance from the focus", () => {
    expect(distToFocus(hyperbolaPoint(params, 0))).toBeCloseTo(
      params.perihelion,
      6,
    );
  });

  it("is open: distance to the focus falls to a single perihelion then rises monotonically", () => {
    const thetaMax = hyperbolaAsymptoteAngle(params.eccentricity);
    const range = thetaMax * 0.95; // stay just inside the asymptote
    const N = 200;
    const dists: number[] = [];
    for (let i = 0; i <= N; i++) {
      const theta = -range + (2 * range * i) / N;
      dists.push(distToFocus(hyperbolaPoint(params, theta)));
    }
    const minIdx = dists.indexOf(Math.min(...dists));
    expect(minIdx).toBeGreaterThan(N / 2 - 3);
    expect(minIdx).toBeLessThan(N / 2 + 3);
    for (let i = 1; i <= minIdx; i++) {
      expect(dists[i]).toBeLessThan(dists[i - 1] + 1e-6);
    }
    for (let i = minIdx + 1; i <= N; i++) {
      expect(dists[i]).toBeGreaterThan(dists[i - 1] - 1e-6);
    }
  });

  it("is not periodic: the sweep endpoints are far apart, not a return to the start", () => {
    const range = hyperbolaAsymptoteAngle(params.eccentricity) * 0.9;
    const start = hyperbolaPoint(params, -range);
    const end = hyperbolaPoint(params, range);
    expect(distToFocus(start)).toBeGreaterThan(params.perihelion * 2);
    expect(distToFocus(end)).toBeGreaterThan(params.perihelion * 2);
    expect(Math.hypot(end.x - start.x, end.y - start.y)).toBeGreaterThan(
      params.perihelion,
    );
  });

  it("has symmetric incoming/outgoing asymptotes (r(-θ) == r(θ))", () => {
    for (const theta of [0.2, 0.5, 0.9]) {
      expect(distToFocus(hyperbolaPoint(params, theta))).toBeCloseTo(
        distToFocus(hyperbolaPoint(params, -theta)),
        6,
      );
    }
    const thetaMax = hyperbolaAsymptoteAngle(params.eccentricity);
    const inBearing = params.orientation - thetaMax;
    const outBearing = params.orientation + thetaMax;
    expect((inBearing + outBearing) / 2).toBeCloseTo(params.orientation, 6);
  });
});

describe("hyperbolaAsymptoteAngle", () => {
  it("exceeds 90° (the bound branch wraps the focus) and shrinks toward 90° as eccentricity grows", () => {
    const nearParabolic = hyperbolaAsymptoteAngle(1.2);
    const veryOpen = hyperbolaAsymptoteAngle(2.5);
    expect(veryOpen).toBeGreaterThan(Math.PI / 2);
    expect(nearParabolic).toBeGreaterThan(veryOpen);
    expect(nearParabolic).toBeLessThan(Math.PI);
  });
});

describe("buildCometFlyby", () => {
  const fieldRadius = 3000;

  it("produces an eccentricity > 1 (an open hyperbola, never an ellipse)", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const flyby = buildCometFlyby(
        FOCUS_X,
        FOCUS_Y,
        fieldRadius,
        seededRng(seed),
      );
      expect(flyby.params.eccentricity).toBeGreaterThan(1);
    }
  });

  it("puts the perihelion inside the field and enters/exits at the field edge", () => {
    const flyby = buildCometFlyby(FOCUS_X, FOCUS_Y, fieldRadius, seededRng(7));
    expect(flyby.params.perihelion).toBeLessThan(fieldRadius);
    expect(
      distToFocus(hyperbolaPoint(flyby.params, flyby.thetaStart)),
    ).toBeCloseTo(fieldRadius, 4);
    expect(
      distToFocus(hyperbolaPoint(flyby.params, flyby.thetaEnd)),
    ).toBeCloseTo(fieldRadius, 4);
  });

  it("sweeps a symmetric range about perihelion (thetaStart === -thetaEnd, both inside the asymptote)", () => {
    const flyby = buildCometFlyby(FOCUS_X, FOCUS_Y, fieldRadius, seededRng(12));
    expect(flyby.thetaStart).toBeCloseTo(-flyby.thetaEnd, 9);
    expect(flyby.thetaEnd).toBeGreaterThan(0);
    const thetaMax = hyperbolaAsymptoteAngle(flyby.params.eccentricity);
    expect(flyby.thetaEnd).toBeLessThan(thetaMax);
  });

  it("hyperbolaTrueAnomalyAtRadius round-trips: the radius at that anomaly matches", () => {
    const flyby = buildCometFlyby(FOCUS_X, FOCUS_Y, fieldRadius, seededRng(3));
    const targetR = fieldRadius * 0.6;
    const theta = hyperbolaTrueAnomalyAtRadius(flyby.params, targetR);
    expect(distToFocus(hyperbolaPoint(flyby.params, theta))).toBeCloseTo(
      targetR,
      4,
    );
  });
});
