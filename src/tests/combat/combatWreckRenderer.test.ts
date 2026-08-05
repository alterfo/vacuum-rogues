import { describe, it, expect, vi } from "vitest";
import {
  drawWrecks,
  WRECK_HULL_COLOR,
  WRECK_EMBER_COLOR,
  type WreckRenderSpec,
} from "@/presentation/flight/combatWreckRenderer";

function fakeGraphics() {
  const polys: number[][] = [];
  return {
    polys,
    clear: vi.fn(),
    poly: vi.fn((points: number[]) => {
      polys.push(points);
    }),
    fill: vi.fn(),
  };
}

function wreck(over: Partial<WreckRenderSpec> = {}): WreckRenderSpec {
  return { x: 100, y: 50, angle: 0, alpha: 1, size: 12, ...over };
}

describe("drawWrecks — drifting wreck silhouette (Task 14)", () => {
  it("clears then draws a hull poly + an ember poly per wreck", () => {
    const g = fakeGraphics();
    drawWrecks(g as never, [wreck()]);
    expect(g.clear).toHaveBeenCalledTimes(1);
    expect(g.poly).toHaveBeenCalledTimes(2);
    const colors = g.fill.mock.calls.map((c) => c[0].color);
    expect(colors).toContain(WRECK_HULL_COLOR);
    expect(colors).toContain(WRECK_EMBER_COLOR);
  });

  it("passes the wreck's alpha through to the hull fill", () => {
    const g = fakeGraphics();
    drawWrecks(g as never, [wreck({ alpha: 0.4 })]);
    const hullFill = g.fill.mock.calls.find(
      (c) => c[0].color === WRECK_HULL_COLOR,
    );
    expect(hullFill?.[0].alpha).toBeCloseTo(0.4, 6);
  });

  it("honours a color override", () => {
    const g = fakeGraphics();
    drawWrecks(g as never, [wreck({ color: 0x123456 })]);
    const colors = g.fill.mock.calls.map((c) => c[0].color);
    expect(colors).toContain(0x123456);
    expect(colors).not.toContain(WRECK_HULL_COLOR);
  });

  it("centres the silhouette on the wreck position", () => {
    const g = fakeGraphics();
    drawWrecks(g as never, [wreck({ x: 200, y: 80, size: 10 })]);
    const pts = g.polys[0];
    for (let i = 0; i < pts.length; i += 2) {
      expect(Math.abs(pts[i] - 200)).toBeLessThanOrEqual(10 + 1e-6);
      expect(Math.abs(pts[i + 1] - 80)).toBeLessThanOrEqual(10 + 1e-6);
    }
  });

  it("rotates the silhouette with the wreck's heading", () => {
    const flat = fakeGraphics();
    const turned = fakeGraphics();
    drawWrecks(flat as never, [wreck({ angle: 0 })]);
    drawWrecks(turned as never, [wreck({ angle: Math.PI / 2 })]);
    expect(turned.polys[0]).not.toEqual(flat.polys[0]);
  });

  it("skips a fully-faded or zero-size wreck", () => {
    const g = fakeGraphics();
    drawWrecks(g as never, [
      wreck({ alpha: 0 }),
      wreck({ size: 0 }),
      wreck({ alpha: -0.1 }),
    ]);
    expect(g.clear).toHaveBeenCalledTimes(1);
    expect(g.poly).not.toHaveBeenCalled();
  });

  it("is a no-op (clear only) on an empty list", () => {
    const g = fakeGraphics();
    drawWrecks(g as never, []);
    expect(g.clear).toHaveBeenCalledTimes(1);
    expect(g.poly).not.toHaveBeenCalled();
  });
});
