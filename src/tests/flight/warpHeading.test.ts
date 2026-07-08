import { describe, it, expect } from "vitest";
import { arrivalHeadingFromExitVector } from "@/presentation/flight/warpHeading";

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
