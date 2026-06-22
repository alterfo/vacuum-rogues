/**
 * Comet-tail SHAPE rework (2026-06-22, Task 3) — the denser, tapered,
 * colour-graded tail with a bright coma. These are NEW assertions layered on
 * top of `cometParticleTail.test.ts` (whose spawn/age/drift/bound assertions are
 * unchanged): they pin the new tail read — a denser stream that still respects
 * the hard pool bound, a tail that tapers head→tip, and the pure head→tail
 * colour-grade helpers the renderer uses to tint each mote.
 */
import { describe, it, expect } from "vitest";
import {
  CometDustTail,
  lerpHex,
  moteLifeFraction,
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

describe("comet tail shape (denser + tapered + graded)", () => {
  it("the denser emitter saturates a production-sized pool without exceeding it", () => {
    const tail = new CometDustTail(96, half);
    for (let i = 0; i < 600; i++) {
      tail.update(16, 0, 0, 1, 0, true);
      expect(tail.count).toBeLessThanOrEqual(96);
    }
    // The stronger emission fills the pool (a dense, continuous trail).
    expect(tail.count).toBe(96);
  });

  it("tapers: scale falls off monotonically from the coma to the tail tip", () => {
    // Same base size, increasing age → progressively smaller motes downstream.
    const head = mote({ age: 0, life: 1000, size: 1 });
    const mid = mote({ age: 400, life: 1000, size: 1 });
    const tip = mote({ age: 900, life: 1000, size: 1 });

    expect(moteScale(head)).toBeGreaterThan(moteScale(mid));
    expect(moteScale(mid)).toBeGreaterThan(moteScale(tip));
    // The tip is meaningfully thinner than the head (a real taper, not flat).
    // Threshold pins the deepened falloff (0.6): with the old 0.5 falloff the
    // tip would read 0.55·head and this would fail — a real regression guard.
    expect(moteScale(tip)).toBeLessThan(moteScale(head) * 0.5);
  });

  it("moteLifeFraction maps age → head(0)..tip(1), guarding a recycled slot", () => {
    expect(moteLifeFraction(mote({ age: 0, life: 1000 }))).toBeCloseTo(0, 6);
    expect(moteLifeFraction(mote({ age: 500, life: 1000 }))).toBeCloseTo(
      0.5,
      6,
    );
    expect(moteLifeFraction(mote({ age: 1000, life: 1000 }))).toBeCloseTo(1, 6);
    // A recycled (life 0) slot reads as fully aged — no NaN.
    expect(moteLifeFraction(mote({ age: 0, life: 0 }))).toBe(1);
  });

  it("lerpHex grades a warm coma colour into a cool tail tip", () => {
    const headTint = 0xfff2d8;
    const tipTint = 0x9fc4ff;
    // Endpoints are exact; the midpoint sits strictly between per channel.
    expect(lerpHex(headTint, tipTint, 0)).toBe(headTint);
    expect(lerpHex(headTint, tipTint, 1)).toBe(tipTint);

    const mid = lerpHex(headTint, tipTint, 0.5);
    const ch = (c: number, sh: number): number => (c >> sh) & 0xff;
    // Blue rises, red falls as the dust cools downstream.
    expect(ch(mid, 0)).toBeGreaterThan(ch(headTint, 0)); // more blue than head
    expect(ch(mid, 0)).toBeLessThan(ch(tipTint, 0)); // less blue than tip
    expect(ch(mid, 16)).toBeLessThan(ch(headTint, 16)); // less red than head
  });

  it("lerpHex clamps t outside [0,1] to the endpoints", () => {
    expect(lerpHex(0x000000, 0xffffff, -1)).toBe(0x000000);
    expect(lerpHex(0x000000, 0xffffff, 2)).toBe(0xffffff);
    expect(lerpHex(0x000000, 0xffffff, 0.5)).toBe(0x808080); // round(127.5) → 128
  });
});
