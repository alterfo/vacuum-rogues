import { describe, it, expect } from "vitest";
import {
  computeGalaxyThreat,
  type ThreatLevel,
} from "@/systems/galaxy/GalaxyStatusIndicator";

const WARNING = 0.35;
const TOTAL = 30;

function ids(n: number, prefix = "s"): string[] {
  return Array.from({ length: n }, (_, i) => `${prefix}${i}`);
}

describe("computeGalaxyThreat — threat level at representative shares", () => {
  it("safe when overmind share is below 20% (2/30 ≈ 7%)", () => {
    const r = computeGalaxyThreat(ids(2), [], TOTAL, WARNING);
    expect(r.overmindCount).toBe(2);
    expect(r.pirateCount).toBe(0);
    expect(r.totalSystems).toBe(TOTAL);
    expect(r.overmindShare).toBeCloseTo(2 / TOTAL);
    expect(r.threatLevel).toBe<ThreatLevel>("safe");
  });

  it("safe at exactly 0% overmind", () => {
    const r = computeGalaxyThreat([], [], TOTAL, WARNING);
    expect(r.threatLevel).toBe<ThreatLevel>("safe");
  });

  it("caution when overmind share in [20%, 35%) — 7/30 ≈ 23%", () => {
    const r = computeGalaxyThreat(ids(7), [], TOTAL, WARNING);
    expect(r.overmindShare).toBeCloseTo(7 / TOTAL);
    expect(r.threatLevel).toBe<ThreatLevel>("caution");
  });

  it("caution at exactly 20% boundary (6/30)", () => {
    const r = computeGalaxyThreat(ids(6), [], TOTAL, WARNING);
    expect(r.threatLevel).toBe<ThreatLevel>("caution");
  });

  it("warning when overmind share >= warningThreshold 0.35 — 11/30 ≈ 37%", () => {
    const r = computeGalaxyThreat(ids(11), [], TOTAL, WARNING);
    expect(r.overmindShare).toBeCloseTo(11 / TOTAL);
    expect(r.threatLevel).toBe<ThreatLevel>("warning");
  });

  it("warning at exactly warningThreshold boundary — 10.5/30 rounded: use 11", () => {
    // smallest integer share >= 0.35 × 30 = 10.5 → 11
    const r = computeGalaxyThreat(ids(11), [], TOTAL, WARNING);
    expect(r.threatLevel).toBe<ThreatLevel>("warning");
  });

  it("critical when overmind share >= 0.45 — 14/30 ≈ 47%", () => {
    const r = computeGalaxyThreat(ids(14), [], TOTAL, WARNING);
    expect(r.overmindShare).toBeCloseTo(14 / TOTAL);
    expect(r.threatLevel).toBe<ThreatLevel>("critical");
  });

  it("pirate share reported separately; does NOT affect threat level", () => {
    // 2 overmind (safe), 10 pirate (high, but pirate doesn't drive threat)
    const r = computeGalaxyThreat(ids(2, "o"), ids(10, "p"), TOTAL, WARNING);
    expect(r.overmindCount).toBe(2);
    expect(r.pirateCount).toBe(10);
    expect(r.pirateShare).toBeCloseTo(10 / TOTAL);
    expect(r.hostileShare).toBeCloseTo(12 / TOTAL);
    expect(r.threatLevel).toBe<ThreatLevel>("safe"); // only overmind drives level
  });

  it("returns all zeros for empty galaxy (totalSystemCount=0)", () => {
    const r = computeGalaxyThreat([], [], 0, WARNING);
    expect(r.overmindShare).toBe(0);
    expect(r.pirateShare).toBe(0);
    expect(r.hostileShare).toBe(0);
    expect(r.totalSystems).toBe(0);
    expect(r.threatLevel).toBe<ThreatLevel>("safe");
  });

  it("hostileShare equals overmindShare + pirateShare", () => {
    const r = computeGalaxyThreat(ids(4, "o"), ids(3, "p"), TOTAL, WARNING);
    expect(r.hostileShare).toBeCloseTo(r.overmindShare + r.pirateShare);
  });
});
