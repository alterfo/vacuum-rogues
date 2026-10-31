import { afterEach, describe, expect, it, vi } from "vitest";
import { reducedMotion } from "@/presentation/ui/reducedMotion";

function setMatchMedia(value: boolean | undefined): void {
  vi.stubGlobal("window", {
    matchMedia:
      value === undefined ? undefined : vi.fn(() => ({ matches: value })),
  });
}

describe("reduced motion accessibility seam", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns true when the browser prefers reduced motion", () => {
    setMatchMedia(true);
    expect(reducedMotion()).toBe(true);
  });

  it("returns false when the browser does not prefer reduced motion", () => {
    setMatchMedia(false);
    expect(reducedMotion()).toBe(false);
  });

  it("is safe when matchMedia is unavailable", () => {
    setMatchMedia(undefined);
    expect(reducedMotion()).toBe(false);
  });
});
