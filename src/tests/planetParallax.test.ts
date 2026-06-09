import { describe, it, expect } from "vitest";
import {
  computeParallaxTargetX,
  clampPanoramaX,
} from "@/presentation/PlanetScene";

describe("computeParallaxTargetX", () => {
  const baseX = -50;
  const maxOffset = 30;
  const screenWidth = 1280;

  it("returns baseX when mouse is at centre", () => {
    const result = computeParallaxTargetX(
      screenWidth / 2,
      screenWidth,
      baseX,
      maxOffset,
    );
    expect(result).toBeCloseTo(baseX);
  });

  it("returns baseX - maxOffset when mouse is at left edge", () => {
    const result = computeParallaxTargetX(0, screenWidth, baseX, maxOffset);
    expect(result).toBeCloseTo(baseX - maxOffset);
  });

  it("returns baseX + maxOffset when mouse is at right edge", () => {
    const result = computeParallaxTargetX(
      screenWidth,
      screenWidth,
      baseX,
      maxOffset,
    );
    expect(result).toBeCloseTo(baseX + maxOffset);
  });

  it("interpolates linearly between edges", () => {
    const quarterX = screenWidth / 4;
    const result = computeParallaxTargetX(
      quarterX,
      screenWidth,
      baseX,
      maxOffset,
    );
    // norm at x=screenWidth/4 is -0.5 → result = baseX + (-0.5)*maxOffset
    expect(result).toBeCloseTo(baseX - maxOffset * 0.5);
  });
});

describe("clampPanoramaX (bounds guard used by parallax)", () => {
  it("centres a narrow panorama", () => {
    expect(clampPanoramaX(0, 800, 1280)).toBeCloseTo(240);
  });

  it("clamps a wide panorama to the left edge (x=0)", () => {
    expect(clampPanoramaX(100, 2000, 1280)).toBe(0);
  });

  it("clamps a wide panorama to the right edge", () => {
    expect(clampPanoramaX(-1000, 2000, 1280)).toBe(-(2000 - 1280));
  });
});
