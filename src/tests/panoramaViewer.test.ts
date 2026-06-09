import { describe, it, expect } from "vitest";
import {
  PanoramaViewer,
  createPanoramaViewer,
  wrapPan,
} from "@/presentation/PanoramaViewer";
import { Container, Texture } from "pixi.js";

/** Read the private uPanX uniform the shader reacts to. */
function uPanX(v: PanoramaViewer): number {
  return (v as unknown as { uniforms: { uniforms: { uPanX: number } } })
    .uniforms.uniforms.uPanX;
}

describe("wrapPan", () => {
  it("leaves values already in [0,1) unchanged", () => {
    expect(wrapPan(0)).toBe(0);
    expect(wrapPan(0.4)).toBeCloseTo(0.4);
  });

  it("wraps values >= 1 back into [0,1)", () => {
    expect(wrapPan(1)).toBeCloseTo(0);
    expect(wrapPan(1.2)).toBeCloseTo(0.2);
    expect(wrapPan(2.75)).toBeCloseTo(0.75);
  });

  it("wraps negative values into [0,1)", () => {
    expect(wrapPan(-0.25)).toBeCloseTo(0.75);
    expect(wrapPan(-1.1)).toBeCloseTo(0.9);
  });
});

describe("PanoramaViewer", () => {
  const opts = { texture: Texture.EMPTY, width: 1280, height: 720 };

  it("renders without errors when the panorama texture resolves", () => {
    const v = new PanoramaViewer(opts);
    expect(v).toBeInstanceOf(PanoramaViewer);
    expect(v.container).toBeInstanceOf(Container);
    expect(v.panX).toBe(0);
    v.destroy();
  });

  it("panning past 1.0 wraps back toward 0.0", () => {
    const v = new PanoramaViewer(opts);
    v.setPanX(1.0);
    expect(v.panX).toBeCloseTo(0);
    v.setPanX(1.2);
    expect(v.panX).toBeCloseTo(0.2);
    expect(v.panX).toBeGreaterThanOrEqual(0);
    expect(v.panX).toBeLessThan(1);
    v.destroy();
  });

  it("wraps negative pan into [0,1)", () => {
    const v = new PanoramaViewer(opts);
    v.setPanX(-0.25);
    expect(v.panX).toBeCloseTo(0.75);
    v.destroy();
  });

  it("accumulates relative pan via panBy and wraps around", () => {
    const v = new PanoramaViewer(opts);
    v.panBy(0.6);
    expect(v.panX).toBeCloseTo(0.6);
    v.panBy(0.6); // 1.2 -> wraps to 0.2
    expect(v.panX).toBeCloseTo(0.2);
    expect(v.panX).toBeGreaterThanOrEqual(0);
    expect(v.panX).toBeLessThan(1);
    v.destroy();
  });

  it("mirrors panX onto the uPanX uniform the shader reads", () => {
    const v = new PanoramaViewer(opts);
    v.setPanX(0.3);
    expect(uPanX(v)).toBeCloseTo(0.3);
    v.panBy(0.5);
    expect(uPanX(v)).toBeCloseTo(0.8);
    v.destroy();
  });

  it("updates the projection aspect on resize", () => {
    const v = new PanoramaViewer(opts);
    v.resize(800, 800);
    const aspect = (
      v as unknown as { uniforms: { uniforms: { uAspect: number } } }
    ).uniforms.uniforms.uAspect;
    expect(aspect).toBeCloseTo(1);
    v.destroy();
  });

  it("tolerates a double destroy()", () => {
    const v = new PanoramaViewer(opts);
    v.destroy();
    expect(() => v.destroy()).not.toThrow();
  });
});

describe("createPanoramaViewer", () => {
  it("returns a viewer for a valid texture", () => {
    const v = createPanoramaViewer({
      texture: Texture.EMPTY,
      width: 1024,
      height: 768,
    });
    expect(v).toBeInstanceOf(PanoramaViewer);
    v?.destroy();
  });
});
