import { describe, it, expect } from "vitest";
import { Container, Graphics } from "pixi.js";
import { RouteRenderer } from "@/presentation/flight/RouteRenderer";

/**
 * RouteRenderer is stateless with respect to game logic — it owns only the
 * Graphics overlay it draws into and mounts on the injected game layer. A real
 * PixiJS Container exercises the actual scene-graph wiring without a WebGL
 * context, so these tests assert mount/draw/clear behaviour directly.
 */
describe("RouteRenderer (extracted route overlay)", () => {
  it("draws a route line and mounts it on the game layer", () => {
    const gameLayer = new Container();
    const route = new RouteRenderer(gameLayer);

    // No overlay before drawing.
    expect(route.graphics).toBeNull();
    expect(gameLayer.children.length).toBe(0);

    // A 3-point polyline (ship → waypoint → destination).
    const path = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ];
    route.drawRoute(path);

    // The overlay is non-null and added to the container.
    expect(route.graphics).not.toBeNull();
    expect(route.graphics).toBeInstanceOf(Graphics);
    expect(gameLayer.children.length).toBe(1);
    expect(gameLayer.children[0]).toBe(route.graphics);
    // Non-interactive so it can never swallow a ship's click (US-070 #7).
    expect(route.graphics?.eventMode).toBe("none");
  });

  it("draws only the cyan course line — no yellow per-day tick crosses (playtest4 B)", () => {
    const gameLayer = new Container();
    const route = new RouteRenderer(gameLayer);
    // A long straight route that would have spanned several "days".
    route.drawRoute([
      { x: 0, y: 0 },
      { x: 2000, y: 0 },
    ]);

    const instructions = (
      route.graphics!.context as unknown as {
        instructions: {
          action: string;
          data: { style?: { color?: number } };
        }[];
      }
    ).instructions;
    const strokeColors = instructions
      .filter((i) => i.action === "stroke")
      .map((i) => i.data.style?.color);

    // The cyan course line is still drawn …
    expect(strokeColors).toContain(0x00ffff);
    // … but the yellow per-day tick stroke (0xffee66) is gone entirely.
    expect(strokeColors).not.toContain(0xffee66);
  });

  it("replaces the previous overlay when redrawn (no leak)", () => {
    const gameLayer = new Container();
    const route = new RouteRenderer(gameLayer);
    const path = [
      { x: 0, y: 0 },
      { x: 200, y: 200 },
    ];

    route.drawRoute(path);
    const first = route.graphics;
    route.drawRoute(path);

    // Old overlay disposed, exactly one mounted.
    expect(gameLayer.children.length).toBe(1);
    expect(route.graphics).not.toBe(first);
    expect(first?.destroyed).toBe(true);
  });

  it("draws landing/navigation markers onto the existing overlay", () => {
    const gameLayer = new Container();
    const route = new RouteRenderer(gameLayer);

    // Markers are no-ops before a route line exists.
    expect(() => route.drawLandingMarker(10, 10)).not.toThrow();
    expect(route.graphics).toBeNull();

    route.drawRoute([
      { x: 0, y: 0 },
      { x: 100, y: 100 },
    ]);
    expect(() => route.drawLandingMarker(100, 100)).not.toThrow();
    expect(() => route.drawNavigationMarker(50, 50)).not.toThrow();

    // Still a single overlay (markers append to it, not new objects).
    expect(gameLayer.children.length).toBe(1);
  });

  it("draws a one-day-travel marker distinct from the removed per-day tick pattern", () => {
    const gameLayer = new Container();
    const route = new RouteRenderer(gameLayer);

    // No-op before a route line exists (mirrors drawLandingMarker's guard).
    expect(() => route.drawDayMarker(10, 10)).not.toThrow();
    expect(route.graphics).toBeNull();

    route.drawRoute([
      { x: 0, y: 0 },
      { x: 2000, y: 0 },
    ]);
    expect(() => route.drawDayMarker(500, 0)).not.toThrow();

    // Still a single overlay (the marker appends to it, not a new object).
    expect(gameLayer.children.length).toBe(1);

    const instructions = (
      route.graphics!.context as unknown as {
        instructions: {
          action: string;
          data: { style?: { color?: number } };
        }[];
      }
    ).instructions;
    const strokeColors = instructions
      .filter((i) => i.action === "stroke")
      .map((i) => i.data.style?.color);

    // A magenta diamond — distinct from the cyan course line/nav marker, the
    // orange landing marker, and the removed yellow per-day tick (0xffee66).
    expect(strokeColors).toContain(0xff00ff);
    expect(strokeColors).not.toContain(0xffee66);
  });

  it("draws only the cyan course line — no yellow per-day tick crosses (playtest4 B) — still holds with the day marker present", () => {
    const gameLayer = new Container();
    const route = new RouteRenderer(gameLayer);
    route.drawRoute([
      { x: 0, y: 0 },
      { x: 2000, y: 0 },
    ]);
    route.drawDayMarker(500, 0);

    const instructions = (
      route.graphics!.context as unknown as {
        instructions: {
          action: string;
          data: { style?: { color?: number } };
        }[];
      }
    ).instructions;
    const strokeColors = instructions
      .filter((i) => i.action === "stroke")
      .map((i) => i.data.style?.color);

    expect(strokeColors).toContain(0x00ffff);
    expect(strokeColors).not.toContain(0xffee66);
  });

  it("clears the overlay and leaks no children", () => {
    const gameLayer = new Container();
    const route = new RouteRenderer(gameLayer);
    route.drawRoute([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    const overlay = route.graphics;

    route.clearRoute();

    expect(route.graphics).toBeNull();
    expect(gameLayer.children.length).toBe(0);
    expect(overlay?.destroyed).toBe(true);

    // Clearing again is a safe no-op.
    expect(() => route.clearRoute()).not.toThrow();
  });
});
