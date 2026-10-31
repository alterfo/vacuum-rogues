import { describe, expect, it } from "vitest";
import { damageNumberMotion } from "@/presentation/flight/DamageNumbers";

describe("damage number motion", () => {
  it("rises with an ease-out curve and fades to zero by the end", () => {
    const start = damageNumberMotion(0);
    expect(start.yOffset).toBe(0);
    expect(start.alpha).toBe(1);

    const mid = damageNumberMotion(0.5);
    expect(mid.yOffset).toBeGreaterThan(0);
    expect(mid.yOffset).toBeLessThan(36);
    expect(mid.alpha).toBeCloseTo(0.75, 5);

    const end = damageNumberMotion(1);
    expect(end.yOffset).toBeCloseTo(36, 5);
    expect(end.alpha).toBe(0);
  });

  it("pops slightly at birth and settles to a stable scale", () => {
    expect(damageNumberMotion(0).scale).toBe(1);
    expect(damageNumberMotion(0.5).scale).toBeGreaterThan(1);
    expect(damageNumberMotion(1).scale).toBeCloseTo(1, 5);
  });
});
