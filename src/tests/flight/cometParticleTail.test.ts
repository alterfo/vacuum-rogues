import { describe, it, expect } from "vitest";
import {
  CometDustTail,
  moteAlpha,
  moteScale,
  type DustMote,
} from "@/presentation/flight/cometDustTail";

const half = (): number => 0.5;

function mote(over: Partial<DustMote> = {}): DustMote {
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

describe("CometDustTail (pure dust-tail emitter)", () => {
  it("spawns motes AT the head when emitting", () => {
    const tail = new CometDustTail(64, half);
    expect(tail.count).toBe(0);

    tail.update(50, 100, 200, 1, 0, true);

    expect(tail.count).toBeGreaterThan(0);
    const fresh = tail.slots.find((m) => m.active && m.age === 0);
    expect(fresh).toBeDefined();
    expect(fresh!.x).toBe(100);
    expect(fresh!.y).toBe(200);
  });

  it("does not emit while the head is hidden (emitting = false)", () => {
    const tail = new CometDustTail(64, half);
    tail.update(200, 0, 0, 1, 0, false);
    expect(tail.count).toBe(0);
  });

  it("drifts motes ANTI-SUNWARD over subsequent frames", () => {
    const tail = new CometDustTail(64, half);
    tail.spawn(0, 0, 1, 0);
    const before = tail.slots.find((m) => m.active)!;
    expect(before.x).toBe(0);

    tail.update(100, 0, 0, 1, 0, false);
    tail.update(100, 0, 0, 1, 0, false);

    const after = tail.slots.find((m) => m.active)!;
    expect(after.x).toBeGreaterThan(0); // moved along +x (away from the star)
    expect(after.y).toBeCloseTo(0, 6); // no spread with the deterministic rng
  });

  it("fades + shrinks a mote over its lifetime", () => {
    const young = mote({ age: 0, life: 1000 });
    const mid = mote({ age: 500, life: 1000 });
    const spent = mote({ age: 1000, life: 1000 });

    expect(moteAlpha(young)).toBeCloseTo(1, 6);
    expect(moteAlpha(mid)).toBeCloseTo(0.5, 6);
    expect(moteAlpha(spent)).toBeCloseTo(0, 6);

    expect(moteScale(young)).toBeGreaterThan(moteScale(mid));
    expect(moteScale(mid)).toBeGreaterThan(moteScale(spent));
  });

  it("prunes (recycles) a spent mote once it outlives its life", () => {
    const tail = new CometDustTail(64, half);
    tail.spawn(0, 0, 1, 0); // life = 2250 ms with the deterministic rng
    expect(tail.count).toBe(1);

    tail.update(3000, 0, 0, 1, 0, false); // age past life, no new spawns
    expect(tail.count).toBe(0);
  });

  it("never exceeds the pool bound, even under heavy emission", () => {
    const tail = new CometDustTail(8, half);
    for (let i = 0; i < 400; i++) {
      tail.update(16, 0, 0, 1, 0, true);
      expect(tail.count).toBeLessThanOrEqual(8);
    }
    expect(tail.count).toBe(8);
  });

  it("spawn is a no-op returning false when the pool is full", () => {
    const tail = new CometDustTail(3, half);
    expect(tail.spawn(0, 0, 1, 0)).toBe(true);
    expect(tail.spawn(0, 0, 1, 0)).toBe(true);
    expect(tail.spawn(0, 0, 1, 0)).toBe(true);
    expect(tail.count).toBe(3);
    expect(tail.spawn(0, 0, 1, 0)).toBe(false); // full
    expect(tail.count).toBe(3);
  });

  it("reset() drops all live motes", () => {
    const tail = new CometDustTail(8, half);
    tail.spawn(0, 0, 1, 0);
    tail.spawn(0, 0, 1, 0);
    expect(tail.count).toBe(2);
    tail.reset();
    expect(tail.count).toBe(0);
  });

  it("dt = 0 (active-pause frame) ages nothing, drifts nothing, emits nothing", () => {
    const tail = new CometDustTail(8, half);
    tail.spawn(0, 0, 1, 0);
    const m = tail.slots.find((s) => s.active)!;
    const { x, y, age } = m;

    tail.update(0, 50, 60, 1, 0, true);

    expect(tail.count).toBe(1); // no spawn
    expect(m.x).toBe(x); // no drift
    expect(m.y).toBe(y);
    expect(m.age).toBe(age); // no aging
  });

  it("moteAlpha / moteScale guard a zero-life mote (no NaN)", () => {
    const dead = mote({ life: 0, age: 0 });
    expect(moteAlpha(dead)).toBe(0);
    expect(moteScale(dead)).toBe(0);
  });
});
