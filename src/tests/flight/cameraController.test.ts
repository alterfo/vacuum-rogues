/**
 * CameraController test suite — general behaviour (extracted from
 * SpaceFlightScene in the SOLID refactor) plus the F3 pan-clamp regression
 * (letsplay 2026-06-10): the player ship spawns at the system boundary
 * (SYSTEM_GEOMETRY.boundaryRadius from the star), and the camera pan-clamp
 * must allow centring that spawn point at ANY zoom level and screen size —
 * otherwise the player cannot find their own ship. The old clamp bound the
 * viewport *edges* to ±boundaryRadius·1.25 around the star, which silently
 * forbade centring edge spawns at default zoom on full-HD screens and at low
 * zooms on 720p. The sky backdrop is screen-fixed (skyContainer, not the
 * panned gameLayer), so panning can never reveal a backdrop edge — the clamp
 * only needs to keep the focus point inside the ship-reachable area.
 */
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

// ── F3 clamp harness (star at screen centre, real system boundary) ──────────

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
  };
  return { cam: new CameraController(renderer, deps), centerX, centerY };
}

/** Pan that puts world point (wx, wy) at screen centre for the camera's zoom. */
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
    // Default entry vector {x:0, y:1} → spawn at (cx, cy + BOUNDARY) = (640, 3160).
    // setZoom clamps the requested zoom to MAX_ZOOM (2.0) — assert that
    // explicitly so the clamping is visible, not hidden in the helper.
    const { cam } = makeCamera(1280, 720);
    cam.setZoom(3.5);
    expect(cam.zoom).toBe(cam.MAX_ZOOM);
    const want = centringPan(cam, 1280, 720, 640, 360 + BOUNDARY);
    cam.setPan(want.x, want.y);
    expect(cam.panX).toBeCloseTo(want.x, 6);
    expect(cam.panY).toBeCloseTo(want.y, 6);
  });

  it("centres the edge spawn at default zoom 1.0 on a full-HD screen (x-axis)", () => {
    // entryVector {x:1, y:0} → spawn at (960 + 2800, 540) on 1920×1080.
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
    // Ask to centre a point 2× past the boundary — must be pulled back so the
    // focus point sits within [center ± boundaryRadius].
    cam.focusOnWorld(centerX, centerY + BOUNDARY * 2);
    const focusY = (sh / 2 - cam.panY) / cam.zoom;
    expect(focusY).toBeLessThanOrEqual(centerY + BOUNDARY + 1e-6);
    expect(focusY).toBeGreaterThanOrEqual(centerY - BOUNDARY - 1e-6);
  });
});

// ── General behaviour harness (movable ship, generous boundary) ─────────────

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

  it("clampPan keeps the focus point inside [star ± boundaryRadius]", () => {
    // F3 semantics: the world point at screen centre is clamped to the
    // ship-reachable square. boundaryRadius 400, star (400,300), screen
    // 800×600, zoom 1: focus x ∈ [0, 800] → panX = sw/2 - focusX·z ∈ [-400, 400];
    // focus y ∈ [-100, 700] → panY = sh/2 - focusY·z ∈ [-400, 400].
    const { camera } = makeHarness(makeShip(), 400);
    camera.setPan(9999, -9999);
    expect(camera.panX).toBe(400);
    expect(camera.panY).toBe(-400);
  });

  it("clampPan still bounds the focus point when zoomed out", () => {
    // Same focus bounds at zoom 0.25: focus x ∈ [0, 800] → panX ∈ [200, 400];
    // focus y ∈ [-100, 700] → panY ∈ [125, 325].
    const { camera } = makeHarness(makeShip(), 400);
    camera.setZoom(0.25);
    camera.setPan(9999, -9999);
    expect(camera.panX).toBe(400);
    expect(camera.panY).toBe(125);
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
