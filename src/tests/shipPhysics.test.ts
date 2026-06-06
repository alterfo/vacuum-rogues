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
});
