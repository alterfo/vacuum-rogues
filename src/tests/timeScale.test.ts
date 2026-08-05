import { describe, it, expect } from "vitest";
import { ShipPhysics } from "@/systems/ShipPhysics";

describe("ShipPhysics timeScale", () => {
  it("setTimeScale stores the value", () => {
    const p = new ShipPhysics(0, 0);
    p.setTimeScale(2.0);
    expect(p.timeScale).toBe(2.0);
  });

  it("clamps timeScale to a minimum of 0.1", () => {
    const p = new ShipPhysics(0, 0);
    p.setTimeScale(0);
    expect(p.timeScale).toBeGreaterThanOrEqual(0.1);
  });

  it("timeScale=2 produces twice the currentSpeed of timeScale=1 after one frame", () => {
    const dt = 50; // ms — short enough to stay in pure acceleration phase

    const p1 = new ShipPhysics(0, 0);
    p1.setTimeScale(1.0);
    p1.setTarget(1000, 0);
    p1.update(dt);

    const p2 = new ShipPhysics(0, 0);
    p2.setTimeScale(2.0);
    p2.setTarget(1000, 0);
    p2.update(dt);

    expect(p1.currentSpeed).toBeGreaterThan(0);
    expect(p2.currentSpeed).toBeCloseTo(p1.currentSpeed * 2, 5);
  });

  it("timeScale=4 produces four times the currentSpeed of timeScale=1 after one frame", () => {
    const dt = 20;

    const p1 = new ShipPhysics(0, 0);
    p1.setTimeScale(1.0);
    p1.setTarget(10000, 0);
    p1.update(dt);

    const p4 = new ShipPhysics(0, 0);
    p4.setTimeScale(4.0);
    p4.setTarget(10000, 0);
    p4.update(dt);

    expect(p1.currentSpeed).toBeGreaterThan(0);
    expect(p4.currentSpeed).toBeCloseTo(p1.currentSpeed * 4, 5);
  });

  it("timeScale=2 moves the ship further than timeScale=1 for the same dt", () => {
    const dt = 50;

    const p1 = new ShipPhysics(0, 0);
    p1.setTimeScale(1.0);
    p1.setTarget(1000, 0);
    p1.update(dt);

    const p2 = new ShipPhysics(0, 0);
    p2.setTimeScale(2.0);
    p2.setTarget(1000, 0);
    p2.update(dt);

    expect(p2.shipX).toBeGreaterThan(p1.shipX);
  });
});
