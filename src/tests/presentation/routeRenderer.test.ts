import { describe, it, expect } from "vitest";
import { Container, Graphics } from "pixi.js";
import { RouteRenderer } from "@/presentation/flight/RouteRenderer";

describe("RouteRenderer (extracted route overlay)", () => {
  it("draws a route line and mounts it on the game layer", () => {
    const gameLayer = new Container();
    const route = new RouteRenderer(gameLayer);

    expect(route.graphics).toBeNull();
    expect(gameLayer.children.length).toBe(0);

    const path = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ];
    route.drawRoute(path);

    expect(route.graphics).not.toBeNull();
    expect(route.graphics).toBeInstanceOf(Graphics);
    expect(gameLayer.children.length).toBe(1);
    expect(gameLayer.children[0]).toBe(route.graphics);
    expect(route.graphics?.eventMode).toBe("none");
  });

  it("draws only the cyan course line — no yellow per-day tick crosses (playtest4 B)", () => {
    const gameLayer = new Container();
    const route = new RouteRenderer(gameLayer);
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

    expect(strokeColors).toContain(0x00ffff);
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

    expect(gameLayer.children.length).toBe(1);
    expect(route.graphics).not.toBe(first);
    expect(first?.destroyed).toBe(true);
  });

  it("draws landing/navigation markers onto the existing overlay", () => {
    const gameLayer = new Container();
    const route = new RouteRenderer(gameLayer);

    expect(() => route.drawLandingMarker(10, 10)).not.toThrow();
    expect(route.graphics).toBeNull();

    route.drawRoute([
      { x: 0, y: 0 },
      { x: 100, y: 100 },
    ]);
    expect(() => route.drawLandingMarker(100, 100)).not.toThrow();
    expect(() => route.drawNavigationMarker(50, 50)).not.toThrow();

    expect(gameLayer.children.length).toBe(1);
  });

  it("draws a one-day-travel marker distinct from the removed per-day tick pattern", () => {
    const gameLayer = new Container();
    const route = new RouteRenderer(gameLayer);

    expect(() => route.drawDayMarker(10, 10)).not.toThrow();
    expect(route.graphics).toBeNull();

    route.drawRoute([
      { x: 0, y: 0 },
      { x: 2000, y: 0 },
    ]);
    expect(() => route.drawDayMarker(500, 0)).not.toThrow();

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

    expect(strokeColors).toContain(0xff00ff);
    expect(strokeColors).not.toContain(0xffee66);

    const polyInstructions = (
      route.graphics!.context as unknown as {
        instructions: {
          action: string;
          data: {
            path?: { instructions: { action: string; data: unknown[] }[] };
          };
        }[];
      }
    ).instructions
      .filter((i) => i.action === "stroke" && i.data.path)
      .flatMap((i) => i.data.path!.instructions)
      .filter((pi) => pi.action === "poly");
    expect(polyInstructions.length).toBe(1);
    expect(polyInstructions[0].data[1]).toBe(true);
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

    expect(() => route.clearRoute()).not.toThrow();
  });
});
