/**
 * F3 regression (letsplay 2026-06-10): the player ship spawns at the system
 * boundary (SYSTEM_GEOMETRY.boundaryRadius from the star), and the camera
 * pan-clamp must allow centring that spawn point at ANY zoom level and screen
 * size — otherwise the player cannot find their own ship. The old clamp bound
 * the viewport *edges* to ±boundaryRadius·1.25 around the star, which silently
 * forbade centring edge spawns at default zoom on full-HD screens and at low
 * zooms on 720p. The sky backdrop is screen-fixed (skyContainer, not the
 * panned gameLayer), so panning can never reveal a backdrop edge — the clamp
 * only needs to keep the focus point inside the ship-reachable area.
 */
import { describe, it, expect } from "vitest";
import { Container } from "pixi.js";
import {
  CameraController,
  type CameraControllerDeps,
} from "@/presentation/flight/CameraController";
import type { Renderer } from "@/presentation/Renderer";
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
  it("centres the edge spawn (y ≈ 3100+) at requested zoom 3.5 on 720p", () => {
    // Default entry vector {x:0, y:1} → spawn at (cx, cy + BOUNDARY) = (640, 3160).
    expectCentrable(1280, 720, 3.5, 640, 360 + BOUNDARY);
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
