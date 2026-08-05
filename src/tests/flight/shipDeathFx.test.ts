import { describe, it, expect } from "vitest";
import {
  ShipDeathFx,
  explosionMoteAlpha,
  explosionMoteScale,
  explosionMoteLifeFraction,
  type ExplosionMote,
} from "@/presentation/flight/shipDeathFx";

const half = (): number => 0.5;

function mote(over: Partial<ExplosionMote> = {}): ExplosionMote {
  return {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    age: 0,
    life: 1000,
    size: 1,
    active: true,
    ...over,
  };
}

describe("ship-death explosion emitter (radial burst)", () => {
  it("a spawn seeds exactly `burst` sparks centred at the kill point", () => {
    const fx = new ShipDeathFx(32, 24, half);
    expect(fx.isActive()).toBe(false);
    const n = fx.spawn(100, 50);
    expect(n).toBe(24);
    expect(fx.count).toBe(24);
    expect(fx.isActive()).toBe(true);
    for (const m of fx.slots) {
      if (!m.active) continue;
      expect(m.x).toBe(100);
      expect(m.y).toBe(50);
      expect(m.age).toBe(0);
    }
  });

  it("sparks fly outward in all directions (a real radial fan, not one heading)", () => {
    const fx = new ShipDeathFx(64, 48, half);
    fx.spawn(0, 0);
    fx.update(16);
    let posX = false;
    let negX = false;
    let posY = false;
    let negY = false;
    for (const m of fx.slots) {
      if (!m.active) continue;
      if (m.x > 0.001) posX = true;
      if (m.x < -0.001) negX = true;
      if (m.y > 0.001) posY = true;
      if (m.y < -0.001) negY = true;
    }
    expect(posX && negX && posY && negY).toBe(true);
  });

  it("sparks expand outward and fade as they age", () => {
    const fx = new ShipDeathFx(32, 16, half);
    fx.spawn(0, 0);
    const live = fx.slots.find((m) => m.active)!;
    const r0 = Math.hypot(live.x, live.y);
    const a0 = explosionMoteAlpha(live);
    fx.update(200);
    const r1 = Math.hypot(live.x, live.y);
    const a1 = explosionMoteAlpha(live);
    expect(r1).toBeGreaterThan(r0); // flew outward
    expect(a1).toBeLessThan(a0); // faded
  });

  it("the pool is never exceeded under repeated bursts", () => {
    const fx = new ShipDeathFx(32, 24, half);
    for (let i = 0; i < 50; i++) {
      fx.spawn(0, 0);
      fx.update(5); // tiny step — sparks survive, so bursts stack against the bound
      expect(fx.count).toBeLessThanOrEqual(32);
    }
    expect(fx.count).toBe(32);
  });

  it("a crowded pool seeds fewer than `burst` sparks (returns the actual count)", () => {
    const fx = new ShipDeathFx(10, 8, half);
    expect(fx.spawn(0, 0)).toBe(8); // 8 free → all 8
    expect(fx.spawn(0, 0)).toBe(2); // only 2 slots left → just 2
    expect(fx.count).toBe(10);
  });

  it("all sparks expire to an empty pool after their lifetime", () => {
    const fx = new ShipDeathFx(32, 24, half);
    fx.spawn(0, 0);
    expect(fx.count).toBeGreaterThan(0);
    fx.update(1000);
    expect(fx.count).toBe(0);
    expect(fx.isActive()).toBe(false);
  });

  it("reset() drops every live spark (teardown)", () => {
    const fx = new ShipDeathFx(32, 24, half);
    fx.spawn(0, 0);
    expect(fx.count).toBe(24);
    fx.reset();
    expect(fx.count).toBe(0);
    expect(fx.isActive()).toBe(false);
  });

  it("burst is clamped into [1, max]", () => {
    expect(new ShipDeathFx(8, 99, half).burst).toBe(8); // clamped down to max
    expect(new ShipDeathFx(8, 0, half).burst).toBe(1); // clamped up to 1
  });
});

describe("explosion mote shading helpers", () => {
  it("alpha falls from 1 at birth to 0 at death, guarding a recycled slot", () => {
    expect(explosionMoteAlpha(mote({ age: 0, life: 1000 }))).toBeCloseTo(1, 6);
    expect(explosionMoteAlpha(mote({ age: 500, life: 1000 }))).toBeCloseTo(
      0.5,
      6,
    );
    expect(explosionMoteAlpha(mote({ age: 1000, life: 1000 }))).toBeCloseTo(
      0,
      6,
    );
    expect(explosionMoteAlpha(mote({ age: 0, life: 0 }))).toBe(0);
  });

  it("scale shrinks monotonically as the spark cools", () => {
    const young = mote({ age: 0, life: 1000, size: 1 });
    const mid = mote({ age: 500, life: 1000, size: 1 });
    const old = mote({ age: 1000, life: 1000, size: 1 });
    expect(explosionMoteScale(young)).toBeGreaterThan(explosionMoteScale(mid));
    expect(explosionMoteScale(mid)).toBeGreaterThan(explosionMoteScale(old));
    expect(explosionMoteScale(old)).toBeLessThan(
      explosionMoteScale(young) * 0.5,
    );
    expect(explosionMoteScale(mote({ age: 0, life: 0 }))).toBe(0);
  });

  it("lifeFraction maps age → core(0)..ember(1), guarding a recycled slot", () => {
    expect(explosionMoteLifeFraction(mote({ age: 0, life: 1000 }))).toBeCloseTo(
      0,
      6,
    );
    expect(
      explosionMoteLifeFraction(mote({ age: 500, life: 1000 })),
    ).toBeCloseTo(0.5, 6);
    expect(
      explosionMoteLifeFraction(mote({ age: 1000, life: 1000 })),
    ).toBeCloseTo(1, 6);
    expect(explosionMoteLifeFraction(mote({ age: 0, life: 0 }))).toBe(1);
  });
});
