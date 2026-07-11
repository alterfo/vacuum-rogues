import { describe, it, expect } from "vitest";
import {
  arrivalHeadingFromExitVector,
  departureVectorFromExitPoint,
} from "@/presentation/flight/warpHeading";

describe("Bug 4: arrivalHeadingFromExitVector", () => {
  it("points the same way as exitVector — the continuation of travel", () => {
    const exitVector = { x: 0.6, y: -0.8 };
    const heading = arrivalHeadingFromExitVector(exitVector);
    expect(heading).toBeCloseTo(Math.atan2(exitVector.y, exitVector.x), 10);
  });

  it("is NOT the inversion (entryVector = -exitVector) — that would face the ship backwards", () => {
    const exitVector = { x: 1, y: 0 };
    const entryVector = { x: -exitVector.x, y: -exitVector.y };
    const heading = arrivalHeadingFromExitVector(exitVector);
    const invertedHeading = Math.atan2(entryVector.y, entryVector.x);
    expect(heading).not.toBeCloseTo(invertedHeading, 5);
    expect(heading).toBeCloseTo(0, 10); // due-east exit → arrives facing east
  });

  it("matches straight-down and straight-up exits exactly", () => {
    expect(arrivalHeadingFromExitVector({ x: 0, y: 1 })).toBeCloseTo(
      Math.PI / 2,
      10,
    );
    expect(arrivalHeadingFromExitVector({ x: 0, y: -1 })).toBeCloseTo(
      -Math.PI / 2,
      10,
    );
  });
});

describe("Task 2: departureVectorFromExitPoint", () => {
  const center = { x: 1000, y: 1000 };

  it("returns the fallback exitVector with no captured exit point", () => {
    const fallback = { x: 0.6, y: -0.8 };
    expect(departureVectorFromExitPoint(null, center, fallback)).toEqual(
      fallback,
    );
  });

  it("matches the fallback exitVector exactly for a routine (straight-line) exit point", () => {
    const exitVector = { x: 0.6, y: -0.8 };
    const R = 2800;
    const exitPoint = {
      x: center.x + exitVector.x * R,
      y: center.y + exitVector.y * R,
    };
    const departure = departureVectorFromExitPoint(
      exitPoint,
      center,
      exitVector,
    );
    expect(departure.x).toBeCloseTo(exitVector.x, 10);
    expect(departure.y).toBeCloseTo(exitVector.y, 10);
  });

  it("derives the REAL departure angle for a near-edge flee exit point (Task 2 fix)", () => {
    const exitVector = { x: 1, y: 0 }; // stale straight-line direction (unused)
    const exitPoint = { x: center.x, y: center.y - 2800 }; // fled straight "up"
    const departure = departureVectorFromExitPoint(
      exitPoint,
      center,
      exitVector,
    );
    expect(departure.x).toBeCloseTo(0, 10);
    expect(departure.y).toBeCloseTo(-1, 10);
  });

  it("degrades to the fallback when the exit point coincides with the centre (no NaN)", () => {
    const fallback = { x: 0.6, y: -0.8 };
    const departure = departureVectorFromExitPoint(center, center, fallback);
    expect(departure).toEqual(fallback);
  });
});
