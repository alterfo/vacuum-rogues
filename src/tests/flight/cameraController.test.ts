import { describe, it, expect, vi } from "vitest";
import { Container } from "pixi.js";
import {
  CameraController,
  type CameraControllerDeps,
} from "@/presentation/flight/CameraController";
import type { Renderer } from "@/presentation/Renderer";
import type { ShipPhysics } from "@/systems/ShipPhysics";
import { SYSTEM_GEOMETRY } from "@/config/balance";

const BOUNDARY = SYSTEM_GEOMETRY.boundaryRadius;

function makeCamera(
  screenW: number,
  screenH: number,
): { cam: CameraController; centerX: number; centerY: number } {
  const centerX = screenW / 2;
  const centerY = screenH / 2;
  const renderer = {
    app: { screen: { width: screenW, height: screenH } },
    gameLayer: new Container(),
  } as unknown as Renderer;
  const deps: CameraControllerDeps = {
    getShipPhysics: () => null,
    getStarCenter: () => ({ x: centerX, y: centerY }),
    boundaryRadius: BOUNDARY,
    isInCombat: () => false,
  };
  return { cam: new CameraController(renderer, deps), centerX, centerY };
}

function centringPan(
  cam: CameraController,
  screenW: number,
  screenH: number,
  wx: number,
  wy: number,
): { x: number; y: number } {
  return {
    x: screenW / 2 - wx * cam.zoom,
    y: screenH / 2 - wy * cam.zoom,
  };
}

function expectCentrable(
  screenW: number,
  screenH: number,
  zoom: number,
  shipX: number,
  shipY: number,
): void {
  const { cam } = makeCamera(screenW, screenH);
  cam.setZoom(zoom); // may clamp to MIN/MAX — use the zoom that actually applied
  const want = centringPan(cam, screenW, screenH, shipX, shipY);
  cam.setPan(want.x, want.y);
  expect(cam.panX).toBeCloseTo(want.x, 6);
  expect(cam.panY).toBeCloseTo(want.y, 6);
}

describe("CameraController pan clamp (F3 — ship spawn must be focusable)", () => {
  it("centres the edge spawn (y ≈ 3100+) at MAX_ZOOM on 720p", () => {
    const { cam } = makeCamera(1280, 720);
    cam.setZoom(3.5);
    expect(cam.zoom).toBe(cam.MAX_ZOOM);
    const want = centringPan(cam, 1280, 720, 640, 360 + BOUNDARY);
    cam.setPan(want.x, want.y);
    expect(cam.panX).toBeCloseTo(want.x, 6);
    expect(cam.panY).toBeCloseTo(want.y, 6);
  });

  it("centres the edge spawn at default zoom 1.0 on a full-HD screen (x-axis)", () => {
    expectCentrable(1920, 1080, 1.0, 960 + BOUNDARY, 540);
  });

  it("centres the edge spawn at low zoom 0.5 on 720p (y-axis)", () => {
    expectCentrable(1280, 720, 0.5, 640, 360 + BOUNDARY);
  });

  it("centres every boundary-circle spawn angle at every zoom step", () => {
    for (const zoom of [0.25, 0.5, 1.0, 2.0]) {
      for (let a = 0; a < 8; a++) {
        const angle = (a / 8) * Math.PI * 2;
        expectCentrable(
          1920,
          1080,
          zoom,
          960 + Math.cos(angle) * BOUNDARY,
          540 + Math.sin(angle) * BOUNDARY,
        );
      }
    }
  });

  it("still clamps a focus far beyond the boundary back to the reachable area", () => {
    const sw = 1280;
    const sh = 720;
    const { cam, centerX, centerY } = makeCamera(sw, sh);
    cam.setZoom(1.0);
    cam.focusOnWorld(centerX, centerY + BOUNDARY * 2);
    const focusY = (sh / 2 - cam.panY) / cam.zoom;
    expect(focusY).toBeLessThanOrEqual(centerY + BOUNDARY + 1e-6);
    expect(focusY).toBeGreaterThanOrEqual(centerY - BOUNDARY - 1e-6);
  });
});

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
  const camera = new CameraController(renderer, {
    getShipPhysics: () => shipRef.current,
    getStarCenter: () => ({ x: 400, y: 300 }),
    boundaryRadius,
    isInCombat: () => false,
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
    camera.update(16.67);
    expect(camera.panX).not.toBe(idlePan);
  });

  it("does nothing on update() with no ship physics", () => {
    const { camera, shipRef } = makeHarness(null);
    shipRef.current = null;
    expect(() => camera.update(16.67)).not.toThrow();
  });

  it("clampPan keeps the focus point inside [star ± boundaryRadius]", () => {
    const { camera } = makeHarness(makeShip(), 400);
    camera.setPan(9999, -9999);
    expect(camera.panX).toBe(400);
    expect(camera.panY).toBe(-400);
  });

  it("clampPan still bounds the focus point when zoomed out", () => {
    const { camera } = makeHarness(makeShip(), 400);
    camera.setZoom(0.25);
    camera.setPan(9999, -9999);
    expect(camera.panX).toBe(400);
    expect(camera.panY).toBe(125);
  });
});

describe("CameraController frame-rate independence (jitter fix)", () => {
  function runFor(
    camera: CameraController,
    stepMs: number,
    totalMs: number,
  ): void {
    let elapsed = 0;
    while (elapsed < totalMs - 1e-9) {
      camera.update(stepMs);
      elapsed += stepMs;
    }
  }

  it("updateReturn() converges to the same pan regardless of frame-step size", () => {
    const start = () => {
      const { camera } = makeHarness(makeShip({ shipX: 0, shipY: 0 }));
      camera.setPan(1000, 0);
      camera.startReturn();
      return camera;
    };
    const fastFrames = start();
    runFor(fastFrames, 4, 200); // 50 steps of 4ms
    const slowFrames = start();
    runFor(slowFrames, 40, 200); // 5 steps of 40ms

    expect(Math.abs(fastFrames.panX - 0)).toBeGreaterThan(50); // sanity: still mid-glide
    expect(fastFrames.panX).toBeCloseTo(slowFrames.panX, 3);
    expect(fastFrames.panY).toBeCloseTo(slowFrames.panY, 3);
  });

  it("motion-follow (focusWithLead) lands close together at realistic frame rates (60fps vs 30fps)", () => {
    const start = () => {
      const { camera } = makeHarness(
        makeShip({
          shipX: 2000,
          shipY: 0,
          shipAngle: 0,
          isMoving: true,
          currentSpeed: 1,
          getSpeedFraction: () => 1,
        }),
      );
      return camera;
    };
    const at60fps = start();
    runFor(at60fps, 1000 / 60, 300);
    const at30fps = start();
    runFor(at30fps, 1000 / 30, 300);

    const dx = Math.abs(at60fps.panX - at30fps.panX);
    const dy = Math.abs(at60fps.panY - at30fps.panY);
    expect(dx).toBeLessThan(15);
    expect(dy).toBeLessThan(15);
  });
});

describe("CameraController zoomByFactor (touch pinch — mobile Task 3)", () => {
  const W = 800;
  const H = 600;

  it("multiplies the zoom by the incremental pinch factor", () => {
    const { cam } = makeCamera(W, H);
    expect(cam.zoom).toBe(1);
    cam.zoomByFactor(1.5, 400, 300);
    expect(cam.zoom).toBeCloseTo(1.5, 5);
    cam.zoomByFactor(1.2, 400, 300);
    expect(cam.zoom).toBeCloseTo(1.8, 5); // composes multiplicatively
  });

  it("clamps to MAX_ZOOM on a big spread", () => {
    const { cam } = makeCamera(W, H);
    cam.zoomByFactor(10, 400, 300);
    expect(cam.zoom).toBe(cam.MAX_ZOOM);
  });

  it("clamps to MIN_ZOOM on a big pinch-in", () => {
    const { cam } = makeCamera(W, H);
    cam.zoomByFactor(0.001, 400, 300);
    expect(cam.zoom).toBe(cam.MIN_ZOOM);
  });

  it("keeps the world point under the anchor fixed (zoom toward the fingers)", () => {
    const { cam } = makeCamera(W, H);
    const anchorX = 420;
    const anchorY = 280;
    const before = cam.screenToWorld(anchorX, anchorY);
    cam.zoomByFactor(1.6, anchorX, anchorY);
    const after = cam.screenToWorld(anchorX, anchorY);
    expect(after.x).toBeCloseTo(before.x, 4);
    expect(after.y).toBeCloseTo(before.y, 4);
  });
});
