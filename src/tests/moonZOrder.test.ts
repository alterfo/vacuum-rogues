import { describe, it, expect } from "vitest";
import { getMoonLayer } from "@/utils/moonZOrder";

describe("getMoonLayer", () => {
  it("angle 0 is behind planet (far side start)", () => {
    expect(getMoonLayer(0)).toBe("back");
  });

  it("angle π/2 is behind planet (far side mid)", () => {
    expect(getMoonLayer(Math.PI / 2)).toBe("back");
  });

  it("angle just below π is still behind", () => {
    expect(getMoonLayer(Math.PI - 0.001)).toBe("back");
  });

  it("angle π is in front of planet (near side start)", () => {
    expect(getMoonLayer(Math.PI)).toBe("front");
  });

  it("angle 3π/2 is in front of planet (near side mid)", () => {
    expect(getMoonLayer((3 * Math.PI) / 2)).toBe("front");
  });

  it("angle just below 2π is still in front", () => {
    expect(getMoonLayer(Math.PI * 2 - 0.001)).toBe("front");
  });

  it("angle 2π wraps to 0 → behind", () => {
    expect(getMoonLayer(Math.PI * 2)).toBe("back");
  });

  it("handles negative angles correctly (mod normalised)", () => {
    expect(getMoonLayer(-Math.PI / 2)).toBe("front");
    expect(getMoonLayer(-Math.PI)).toBe("front");
    expect(getMoonLayer((-3 * Math.PI) / 2)).toBe("back");
  });

  it("handles angles > 2π (multiple laps)", () => {
    expect(getMoonLayer(5 * Math.PI)).toBe("front");
    expect(getMoonLayer(4 * Math.PI)).toBe("back");
  });
});
