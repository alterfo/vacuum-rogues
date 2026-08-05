import { describe, it, expect } from "vitest";
import { ShipPhysics } from "@/systems/ShipPhysics";

describe("ShipPhysics", () => {
  it("starts parked at spawn position", () => {
    const p = new ShipPhysics(100, 200);
    expect(p.shipX).toBe(100);
    expect(p.shipY).toBe(200);
    expect(p.isMoving).toBe(false);
    expect(p.currentSpeed).toBe(0);
  });

  it("teleport resets position and target without residual motion", () => {
    const p = new ShipPhysics(0, 0, 0.1);
    p.setTarget(1000, 1000);
    p.update(100); // advances toward the target
    p.teleport(500, 300);
    expect(p.shipX).toBe(500);
    expect(p.shipY).toBe(300);
    expect(p.isMoving).toBe(false);
    expect(p.currentSpeed).toBe(0);
    p.update(100);
    expect(p.isMoving).toBe(false);
    expect(p.currentSpeed).toBe(0);
  });

  it("setTarget causes the ship to start moving", () => {
    const p = new ShipPhysics(0, 0, 0.1);
    p.setTarget(500, 0);
    expect(p.isMoving).toBe(true);
    p.update(200);
    expect(p.shipX).toBeGreaterThan(0);
  });

  it("arrives and parks when close enough to target", () => {
    const p = new ShipPhysics(0, 0, 0.5);
    p.setTarget(3, 0); // within STOP_THRESHOLD (8px)
    p.update(200);
    expect(p.isMoving).toBe(false);
    expect(p.currentSpeed).toBe(0);
  });

  it("getSpeedFraction returns 0 when stopped and approaches 1 at cruise", () => {
    const p = new ShipPhysics(0, 0, 0.1);
    expect(p.getSpeedFraction()).toBe(0);
    p.setTarget(5000, 0);
    for (let i = 0; i < 50; i++) p.update(50);
    expect(p.getSpeedFraction()).toBeGreaterThan(0.5);
    expect(p.getSpeedFraction()).toBeLessThanOrEqual(1.0);
  });

  it("setPath([]) with empty array does nothing", () => {
    const p = new ShipPhysics(100, 200, 0.1);
    p.setPath([]);
    expect(p.isMoving).toBe(false);
    expect(p.shipX).toBe(100);
    expect(p.shipY).toBe(200);
  });

  it("setPath with multiple waypoints starts moving and hasPath is true", () => {
    const p = new ShipPhysics(0, 0, 0.5);
    p.setPath([
      { x: 100, y: 0 },
      { x: 200, y: 0 },
      { x: 300, y: 0 },
    ]);
    expect(p.isMoving).toBe(true);
    expect(p.hasPath()).toBe(true);
  });

  it("setPath: ship travels through waypoints and arrives at final destination", () => {
    const p = new ShipPhysics(0, 0, 1.0);
    p.setPath([
      { x: 50, y: 0 },
      { x: 100, y: 0 },
    ]);
    for (let i = 0; i < 500; i++) p.update(100);
    expect(p.isMoving).toBe(false);
    expect(p.hasPath()).toBe(false);
    expect(p.shipX).toBeCloseTo(100, 0);
  });

  it("stop() halts the ship in place and clears the path mid-flight", () => {
    const p = new ShipPhysics(0, 0, 0.5);
    p.setPath([
      { x: 500, y: 0 },
      { x: 1000, y: 0 },
    ]);
    p.update(100); // start moving
    expect(p.isMoving).toBe(true);
    const x = p.shipX;
    const y = p.shipY;
    p.stop();
    expect(p.isMoving).toBe(false);
    expect(p.currentSpeed).toBe(0);
    expect(p.hasPath()).toBe(false);
    expect(p.shipX).toBe(x);
    expect(p.shipY).toBe(y);
    p.update(100);
    expect(p.isMoving).toBe(false);
    expect(p.shipX).toBe(x);
  });

  it("update() clamps deltaTime at 100ms — lag spike behaves like 100ms frame", () => {
    const p1 = new ShipPhysics(0, 0, 0.5);
    const p2 = new ShipPhysics(0, 0, 0.5);
    p1.setTarget(5000, 0);
    p2.setTarget(5000, 0);
    p1.update(100);
    p2.update(1000); // should be clamped to 100
    expect(p1.shipX).toBeCloseTo(p2.shipX, 5);
    expect(p1.currentSpeed).toBeCloseTo(p2.currentSpeed, 5);
  });

  describe("arc-only momentum movement", () => {
    const ROTATION_SPEED = Math.PI / 2 / 300; // rad/ms (mirrors ShipPhysics)

    it("a target directly behind is reached by arcing — speed never collapses to a pivot", () => {
      const maxSpeed = 0.1;
      const p = new ShipPhysics(0, 0, maxSpeed);
      p.shipAngle = 0; // pointing +x; target is directly behind (-x)
      p.setTarget(-1000, 0);

      const dt = 16;
      const maxStep = ROTATION_SPEED * dt;
      let prevAngle = p.shipAngle;
      let minSpeedWhileMoving = Infinity;
      let maxHeadingStep = 0;
      let maxForwardX = -Infinity; // proves the ship advances FORWARD, not pivots
      let arrived = false;

      for (let i = 0; i < 5000; i++) {
        p.update(dt);
        if (!p.isMoving) {
          arrived = true;
          break;
        }
        minSpeedWhileMoving = Math.min(minSpeedWhileMoving, p.currentSpeed);
        maxForwardX = Math.max(maxForwardX, p.shipX);
        let step = Math.abs(p.shipAngle - prevAngle);
        while (step > Math.PI) step = Math.abs(step - 2 * Math.PI);
        maxHeadingStep = Math.max(maxHeadingStep, step);
        prevAngle = p.shipAngle;
      }

      expect(arrived).toBe(true); // looped around and reached the target
      expect(p.getDistanceToTarget()).toBeLessThanOrEqual(8); // at the destination
      expect(minSpeedWhileMoving).toBeGreaterThan(0);
      expect(maxForwardX).toBeGreaterThan(5);
      expect(maxHeadingStep).toBeLessThanOrEqual(maxStep + 1e-9);
    });

    it("at cruise the turn radius equals maxSpeed/rotationSpeed (≈19px) — bounded below", () => {
      const maxSpeed = 0.1;
      const p = new ShipPhysics(0, 0, maxSpeed);
      p.setTarget(100_000, 0); // long straight leg to reach cruise speed
      for (let i = 0; i < 300; i++) p.update(16);
      expect(p.currentSpeed).toBeCloseTo(maxSpeed, 6); // at cruise

      p.setTarget(0, -100_000);
      const before = { x: p.shipX, y: p.shipY, a: p.shipAngle };
      p.update(16);
      const ds = Math.hypot(p.shipX - before.x, p.shipY - before.y);
      let da = Math.abs(p.shipAngle - before.a);
      while (da > Math.PI) da = Math.abs(da - 2 * Math.PI);
      const radius = ds / da;
      expect(radius).toBeCloseTo(maxSpeed / ROTATION_SPEED, 0); // ≈19px
    });

    it("an off-axis target still decelerates to a full stop at the destination", () => {
      const p = new ShipPhysics(0, 0, 0.1);
      p.shipAngle = Math.PI / 2; // pointing +y; target is off to the side (+x)
      p.setTarget(1000, 0);
      for (let i = 0; i < 5000 && p.isMoving; i++) p.update(16);
      expect(p.isMoving).toBe(false);
      expect(p.currentSpeed).toBe(0);
      expect(p.getDistanceToTarget()).toBeLessThanOrEqual(8);
    });

    it("intermediate waypoints are flown through without stopping (speed stays high)", () => {
      const p = new ShipPhysics(0, 0, 0.1);
      p.setPath([
        { x: 500, y: 0 },
        { x: 1000, y: 0 },
      ]);
      for (let i = 0; i < 80; i++) p.update(16);
      expect(p.currentSpeed).toBeCloseTo(0.1, 2);
      let minSpeedAcrossCorner = Infinity;
      for (let i = 0; i < 60; i++) {
        p.update(16);
        if (p.isMoving) {
          minSpeedAcrossCorner = Math.min(minSpeedAcrossCorner, p.currentSpeed);
        }
      }
      expect(minSpeedAcrossCorner).toBeGreaterThan(0.05); // flew through the waypoint
    });

    it("a close, off-axis destination is reached — never orbited forever (soft-lock regression)", () => {
      const perpendicularDistances = [10, 15, 20, 25];
      for (const d of perpendicularDistances) {
        const fromRest = new ShipPhysics(0, 0, 0.1);
        fromRest.shipAngle = 0;
        fromRest.setTarget(0, d);
        let i = 0;
        for (; i < 5000 && fromRest.isMoving; i++) fromRest.update(16);
        expect(fromRest.isMoving).toBe(false); // arrived, did not orbit
        expect(fromRest.getDistanceToTarget()).toBeLessThanOrEqual(8);
        expect(i).toBeLessThan(5000); // within a bounded number of frames

        const atCruise = new ShipPhysics(0, 0, 0.1);
        atCruise.shipAngle = 0;
        atCruise.currentSpeed = 0.1;
        atCruise.isMoving = true;
        atCruise.setTarget(0, d);
        let j = 0;
        for (; j < 5000 && atCruise.isMoving; j++) atCruise.update(16);
        expect(atCruise.isMoving).toBe(false);
        expect(atCruise.getDistanceToTarget()).toBeLessThanOrEqual(8);

        const viaPath = new ShipPhysics(0, 0, 0.1);
        viaPath.shipAngle = 0;
        viaPath.setPath([{ x: 0, y: d }]);
        let k = 0;
        for (; k < 5000 && viaPath.isMoving; k++) viaPath.update(16);
        expect(viaPath.isMoving).toBe(false);
        expect(viaPath.getDistanceToTarget()).toBeLessThanOrEqual(8);
      }
    });

    it("straight-line travel timing is unchanged (aligned target ⇒ full forward speed)", () => {
      const p = new ShipPhysics(0, 0, 0.1);
      p.setTarget(5000, 0); // dead ahead (aligned), far enough never to decelerate
      for (let i = 0; i < 300; i++) p.update(16);
      expect(p.currentSpeed).toBeCloseTo(0.1, 6); // at full cruise
      expect(p.shipY).toBeCloseTo(0, 6); // no sideways drift on a straight leg
      expect(p.shipX).toBeGreaterThan(0);
    });
  });
});
