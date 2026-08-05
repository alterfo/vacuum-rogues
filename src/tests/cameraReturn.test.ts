import { describe, it, expect } from "vitest";
import {
  computeCenterOnPlayerPan,
  isCameraOnPlayer,
} from "@/utils/cameraCenter";

describe("computeCenterOnPlayerPan", () => {
  it("centres ship at (0,0) gives pan of (screenW/2, screenH/2)", () => {
    const result = computeCenterOnPlayerPan(0, 0, 1280, 720, 1.0);
    expect(result.x).toBeCloseTo(640);
    expect(result.y).toBeCloseTo(360);
  });

  it("centres ship at (100,200) with zoom=1 gives correct pan", () => {
    const result = computeCenterOnPlayerPan(100, 200, 1280, 720, 1.0);
    expect(result.x).toBeCloseTo(640 - 100);
    expect(result.y).toBeCloseTo(360 - 200);
  });

  it("respects zoom factor", () => {
    const result = computeCenterOnPlayerPan(100, 200, 1280, 720, 2.0);
    expect(result.x).toBeCloseTo(640 - 200);
    expect(result.y).toBeCloseTo(360 - 400);
  });
});

describe("isCameraOnPlayer", () => {
  it("returns true when pan exactly centres the ship", () => {
    const { x, y } = computeCenterOnPlayerPan(500, 300, 1280, 720, 1.0);
    expect(isCameraOnPlayer(x, y, 500, 300, 1280, 720, 1.0)).toBe(true);
  });

  it("returns true within the default 10px threshold", () => {
    const { x, y } = computeCenterOnPlayerPan(500, 300, 1280, 720, 1.0);
    expect(isCameraOnPlayer(x + 9, y + 9, 500, 300, 1280, 720, 1.0)).toBe(true);
  });

  it("returns false when camera is offset beyond the threshold", () => {
    const { x, y } = computeCenterOnPlayerPan(500, 300, 1280, 720, 1.0);
    expect(isCameraOnPlayer(x + 11, y, 500, 300, 1280, 720, 1.0)).toBe(false);
    expect(isCameraOnPlayer(x, y + 11, 500, 300, 1280, 720, 1.0)).toBe(false);
  });

  it("button should be visible when camera is panned away from ship", () => {
    const shipX = 800;
    const shipY = 400;
    const centered = isCameraOnPlayer(0, 0, shipX, shipY, 1280, 720, 1.0);
    expect(centered).toBe(false); // button should be visible
  });

  it("button should be hidden when camera already centres ship", () => {
    const shipX = 400;
    const shipY = 300;
    const { x, y } = computeCenterOnPlayerPan(shipX, shipY, 1280, 720, 1.0);
    const centered = isCameraOnPlayer(x, y, shipX, shipY, 1280, 720, 1.0);
    expect(centered).toBe(true); // button should be hidden
  });

  it("works correctly with zoom != 1", () => {
    const shipX = 200;
    const shipY = 150;
    const zoom = 1.5;
    const { x, y } = computeCenterOnPlayerPan(shipX, shipY, 1280, 720, zoom);
    expect(isCameraOnPlayer(x, y, shipX, shipY, 1280, 720, zoom)).toBe(true);
    expect(isCameraOnPlayer(x + 20, y, shipX, shipY, 1280, 720, zoom)).toBe(
      false,
    );
  });

  it("custom threshold is respected", () => {
    const { x, y } = computeCenterOnPlayerPan(100, 100, 800, 600, 1.0);
    expect(isCameraOnPlayer(x + 5, y, 100, 100, 800, 600, 1.0, 3)).toBe(false);
    expect(isCameraOnPlayer(x + 2, y, 100, 100, 800, 600, 1.0, 3)).toBe(true);
  });
});
