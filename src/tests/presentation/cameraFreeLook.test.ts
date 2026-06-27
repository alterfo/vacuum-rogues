import { describe, it, expect, beforeEach } from "vitest";
import { CameraController } from "@/presentation/flight/CameraController";
import type { Renderer } from "@/presentation/Renderer";
import type { ShipPhysics } from "@/systems/ShipPhysics";

/**
 * Regression: the player asked to be able to look around (pan) WHILE the ship is
 * flying. The motion-follow used to re-centre on the ship every frame, snapping
 * the view back over any manual pan. A manual pan now suspends the follow until
 * the next flight leg or an explicit return-to-ship (⊙ button).
 */
function makeShip(over: Partial<ShipPhysics> = {}): ShipPhysics {
  return {
    isMoving: true,
    currentSpeed: 2,
    shipX: 500,
    shipY: 300,
    shipAngle: 0,
    getSpeedFraction: () => 1,
    ...over,
  } as unknown as ShipPhysics;
}

function makeCamera(ship: ShipPhysics): CameraController {
  const gameLayer = { scale: { set: () => {} }, x: 0, y: 0 };
  const renderer = {
    app: { screen: { width: 1280, height: 720 } },
    gameLayer,
  } as unknown as Renderer;
  return new CameraController(renderer, {
    getShipPhysics: () => ship,
    getStarCenter: () => ({ x: 640, y: 360 }),
    boundaryRadius: 1_000_000, // huge → clampPan never interferes
  });
}

describe("CameraController free-look while moving", () => {
  let ship: ShipPhysics;
  let cam: CameraController;

  beforeEach(() => {
    ship = makeShip();
    cam = makeCamera(ship);
  });

  it("follows the ship while moving (no manual pan)", () => {
    cam.update(); // engages follow on the first moving frame
    const beforeX = cam.panX;
    cam.update();
    // The eased follow keeps nudging the pan toward centring the ship.
    expect(cam.panX).not.toBe(beforeX);
  });

  it("does NOT snap back to the ship after a manual pan (free-look)", () => {
    cam.update(); // prevMoving → true, follow engaged
    cam.pan(120, -80); // player drags the view away mid-flight
    const panned = { x: cam.panX, y: cam.panY };

    // Several frames pass with the ship still flying.
    cam.update();
    cam.update();
    cam.update();

    // The view stays exactly where the player left it — the follow is suspended.
    expect(cam.panX).toBe(panned.x);
    expect(cam.panY).toBe(panned.y);
  });

  it("re-engages the follow on the next fresh flight leg", () => {
    cam.update();
    cam.pan(200, 200); // free-look suspends follow
    const panned = cam.panX;
    cam.update();
    expect(cam.panX).toBe(panned); // still suspended

    // Ship stops, then starts a brand-new flight.
    (ship as { isMoving: boolean }).isMoving = false;
    (ship as { currentSpeed: number }).currentSpeed = 0;
    cam.update(); // prevMoving → false
    (ship as { isMoving: boolean }).isMoving = true;
    (ship as { currentSpeed: number }).currentSpeed = 2;
    cam.update(); // standstill → moving re-engages the follow

    expect(cam.panX).not.toBe(panned); // following again
  });

  it("re-engages immediately on an explicit return-to-ship (⊙)", () => {
    cam.update();
    cam.pan(300, 150); // free-look
    const panned = cam.panX;
    cam.startReturn(); // ⊙ button
    cam.update();
    expect(cam.panX).not.toBe(panned); // lerps back toward the ship
  });

  // Playtest report (2026-06-27, Issue 2): looking around via the minimap while
  // the ship was moving snapped straight back — focusOnWorld (the radar
  // drag-to-pan) did not suspend the motion-follow the way a manual pan does.
  it("does NOT snap back after a minimap-drag focus while moving (free-look)", () => {
    cam.update(); // prevMoving → true, follow engaged
    cam.focusOnWorld(900, 100); // player drags the radar to look elsewhere
    const focused = { x: cam.panX, y: cam.panY };

    // Several frames pass with the ship still flying.
    cam.update();
    cam.update();
    cam.update();

    // The view stays where the radar drag put it — the follow is suspended.
    expect(cam.panX).toBe(focused.x);
    expect(cam.panY).toBe(focused.y);
  });

  it("re-engages the follow after a minimap focus on the next fresh flight leg", () => {
    cam.update();
    cam.focusOnWorld(900, 100); // minimap free-look suspends follow
    const focused = cam.panX;
    cam.update();
    expect(cam.panX).toBe(focused); // still suspended

    (ship as { isMoving: boolean }).isMoving = false;
    (ship as { currentSpeed: number }).currentSpeed = 0;
    cam.update(); // prevMoving → false
    (ship as { isMoving: boolean }).isMoving = true;
    (ship as { currentSpeed: number }).currentSpeed = 2;
    cam.update(); // standstill → moving re-engages the follow

    expect(cam.panX).not.toBe(focused);
  });
});
