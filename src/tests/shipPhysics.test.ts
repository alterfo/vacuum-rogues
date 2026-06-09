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
    // After teleport, update should NOT move toward old target
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
    // Run many frames so the ship reaches cruise speed
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
    // Run until arrival
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
    // Position is unchanged and a further update does not fly back to the target.
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
});
