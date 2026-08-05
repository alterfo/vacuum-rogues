import { describe, it, expect } from "vitest";
import { solveInterceptPoint } from "@/utils/intercept";

describe("solveInterceptPoint (playtest4 C: lead a moving target)", () => {
  it("leads a crossing target so the pursuer aims ahead of it", () => {
    const lead = solveInterceptPoint(0, 0, 1, 10, 0, 0, 0.5);
    expect(lead.y).toBeGreaterThan(0);
    const flightTime = Math.hypot(lead.x, lead.y) / 1;
    const targetTime = (lead.y - 0) / 0.5;
    expect(flightTime).toBeCloseTo(targetTime, 3);
  });

  it("leads ahead of a moving NPC (heading-derived velocity)", () => {
    const npcSpeed = 0.2;
    const heading = -Math.PI / 2; // facing -y
    const vx = Math.cos(heading) * npcSpeed;
    const vy = Math.sin(heading) * npcSpeed;
    const lead = solveInterceptPoint(0, 0, 0.3, 300, 0, vx, vy);
    expect(lead.y).toBeLessThan(0); // ahead of the NPC along its heading
  });

  it("returns the target's position for a stationary target", () => {
    const lead = solveInterceptPoint(0, 0, 1, 25, -7, 0, 0);
    expect(lead.x).toBeCloseTo(25);
    expect(lead.y).toBeCloseTo(-7);
  });

  it("falls back to the target when no positive-time intercept exists", () => {
    const lead = solveInterceptPoint(0, 0, 1, 10, 0, 2, 0);
    expect(lead.x).toBeCloseTo(10);
    expect(lead.y).toBeCloseTo(0);
  });

  it("solves the degenerate equal-speed case (linear, not quadratic)", () => {
    const lead = solveInterceptPoint(0, 0, 1, 10, 0, -1, 0);
    expect(lead.x).toBeGreaterThan(0);
    expect(lead.x).toBeLessThan(10); // ahead of where the target started
    expect(lead.y).toBeCloseTo(0);
  });
});
