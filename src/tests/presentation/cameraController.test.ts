import { describe, it, expect, vi } from "vitest";
import { Container } from "pixi.js";
import { CameraController } from "@/presentation/flight/CameraController";
import type { Renderer } from "@/presentation/Renderer";
import type { ShipPhysics } from "@/systems/ShipPhysics";

/** Minimal ship-physics stand-in exposing only what the camera reads. */
function makeShip(over: Partial<ShipPhysics> = {}): ShipPhysics {
  return {
    shipX: 0,
    shipY: 0,
    shipAngle: 0,
    isMoving: false,
    currentSpeed: 0,
    getSpeedFraction: () => 0,
    ...over,
  } as unknown as ShipPhysics;
}

function makeHarness(
  ship: ShipPhysics | null = makeShip(),
  boundaryRadius = 10000,
): {
  camera: CameraController;
  gameLayer: Container;
  shipRef: { current: ShipPhysics | null };
} {
  const gameLayer = new Container();
  const renderer = {
    app: {
      screen: { width: 800, height: 600 },
      canvas: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
    },
    gameLayer,
  } as unknown as Renderer;

  const shipRef = { current: ship };
  // Star at screen centre; default to a generous boundary so the pan-clamp does
  // not interfere with the small pans most tests apply. Pass a small boundary to
  // exercise clampPan itself.
  const camera = new CameraController(renderer, {
    getShipPhysics: () => shipRef.current,
    getStarCenter: () => ({ x: 400, y: 300 }),
    boundaryRadius,
  });
  return { camera, gameLayer, shipRef };
}

describe("CameraController (extracted from SpaceFlightScene)", () => {
  it("inverts pan + zoom in screenToWorld", () => {
    const { camera } = makeHarness();
    camera.setPan(100, 50);
    expect(camera.screenToWorld(100, 50)).toEqual({ x: 0, y: 0 });
    expect(camera.screenToWorld(300, 250)).toEqual({ x: 200, y: 200 });
  });

  it("clamps zoom to [MIN_ZOOM, MAX_ZOOM] in setZoom", () => {
    const { camera } = makeHarness();
    camera.setZoom(99);
    expect(camera.zoom).toBe(camera.MAX_ZOOM);
    camera.setZoom(0.001);
    expect(camera.zoom).toBe(camera.MIN_ZOOM);
  });

  it("applies the transform to the game layer and fans out via onTransform", () => {
    const { camera, gameLayer } = makeHarness();
    const seen = vi.fn();
    camera.onTransform = seen;
    camera.setPan(120, -40);
    expect(gameLayer.x).toBe(120);
    expect(gameLayer.y).toBe(-40);
    expect(seen).toHaveBeenCalledWith(1, 120, -40);
  });

  it("keeps the world point under the cursor fixed when wheel-zooming", () => {
    const { camera } = makeHarness();
    const before = camera.screenToWorld(400, 300);
    camera.zoomAtClient(-100, 400, 300); // negative deltaY → zoom in
    expect(camera.zoom).toBeGreaterThan(1);
    const after = camera.screenToWorld(400, 300);
    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
  });

  it("centres the ship at screen centre on centerOnShip()", () => {
    const { camera } = makeHarness(makeShip({ shipX: 1000, shipY: 1000 }));
    camera.centerOnShip();
    const atCentre = camera.screenToWorld(400, 300);
    expect(atCentre.x).toBeCloseTo(1000, 5);
    expect(atCentre.y).toBeCloseTo(1000, 5);
  });

  it("focusOnWorld puts the requested world point at screen centre", () => {
    const { camera } = makeHarness();
    camera.focusOnWorld(700, 500);
    expect(camera.screenToWorld(400, 300)).toEqual({ x: 700, y: 500 });
  });

  it("worldViewport reflects the current pan/zoom rectangle", () => {
    const { camera } = makeHarness();
    camera.setPan(0, 0);
    const vp = camera.worldViewport();
    expect(vp).toEqual({ minX: 0, minY: 0, maxX: 800, maxY: 600 });
  });

  it("follows a moving ship across update() ticks (no-op when stopped)", () => {
    const { camera } = makeHarness(
      makeShip({
        shipX: 2000,
        shipY: 0,
        isMoving: true,
        currentSpeed: 1,
        getSpeedFraction: () => 1,
      }),
    );
    const idlePan = camera.panX;
    // A stopped, lead-free camera does nothing; a moving ship pulls the pan.
    camera.update();
    expect(camera.panX).not.toBe(idlePan);
  });

  it("does nothing on update() with no ship physics", () => {
    const { camera, shipRef } = makeHarness(null);
    shipRef.current = null;
    expect(() => camera.update()).not.toThrow();
  });

  it("clampPan stops the pan at the backdrop edge when zoomed in", () => {
    // boundaryRadius 400 → half = 500. At zoom 1, star at (400,300), screen
    // 800×600: panX clamps to [-100, 100], panY to [-200, 200].
    const { camera } = makeHarness(makeShip(), 400);
    camera.setPan(9999, -9999);
    expect(camera.panX).toBe(100);
    expect(camera.panY).toBe(-200);
  });

  it("clampPan centres the system on each axis when zoomed out past the bound", () => {
    // boundaryRadius 400 → half = 500. At zoom 0.25 the viewport is wider than
    // the bound, so panXMin > panXMax and the axis is centred regardless of the
    // requested pan: X → (575+25)/2 = 300, Y → (400+50)/2 = 225.
    const { camera } = makeHarness(makeShip(), 400);
    camera.setZoom(0.25);
    camera.setPan(9999, -9999);
    expect(camera.panX).toBe(300);
    expect(camera.panY).toBe(225);
  });
});
