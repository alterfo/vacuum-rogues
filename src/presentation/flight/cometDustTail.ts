/**
 * Pure (PixiJS-free) dust-tail particle emitter for the flyby comets
 * (natural-comet rework, 2026-06-20, Task 2). Replaces the flat `poly`-wedge
 * tail with a soft particle stream: a mote spawns at the comet head, drifts
 * anti-sunward (away from the star) with a little spread, and fades + shrinks
 * over its lifetime before being recycled.
 *
 * It owns a FIXED pool of motes, so the live count is HARD-BOUNDED (the FPS
 * guard from `project-system-map-baseline-fps`) and spent motes recycle with no
 * allocation churn. The renderer (`AsteroidBelt`) mirrors each pool slot 1:1
 * onto a PixiJS `Particle`; like `combatPause`, this module carries no PixiJS so
 * the spawn/age/drift/prune logic is unit-tested standalone.
 */
export interface DustMote {
  x: number;
  y: number;
  vx: number; // px/ms
  vy: number; // px/ms
  age: number; // ms since spawn
  life: number; // ms total lifetime
  size: number; // per-mote base scale multiplier
  active: boolean; // false = recycled / free slot
}

/** px/ms anti-sunward base drift (varied per mote). */
const TAIL_SPEED = 0.16;
/** ms lifetime band — a longer life draws a longer trail. */
const LIFE_MIN = 1500;
const LIFE_MAX = 3000;
/** ± perpendicular spread (radians) off the anti-sunward axis. */
const SPREAD = 0.45;
/** motes emitted per ms while the head is visible (~30/s). */
const EMIT_RATE = 0.03;

export class CometDustTail {
  /** Hard upper bound on simultaneously-live motes. */
  readonly max: number;
  private readonly pool: DustMote[];
  private readonly rng: () => number;
  private emitAcc = 0;

  constructor(max = 64, rng: () => number = Math.random) {
    this.max = Math.max(1, Math.floor(max));
    this.rng = rng;
    this.pool = Array.from({ length: this.max }, () => ({
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      age: 0,
      life: 0,
      size: 1,
      active: false,
    }));
  }

  /** Count of live motes — always ≤ {@link max}. */
  get count(): number {
    let n = 0;
    for (const m of this.pool) if (m.active) n++;
    return n;
  }

  /** Every pool slot (live + recycled) for the renderer to mirror 1:1. */
  get slots(): readonly DustMote[] {
    return this.pool;
  }

  /** Drop all motes (a fresh flyby, or teardown). */
  reset(): void {
    for (const m of this.pool) m.active = false;
    this.emitAcc = 0;
  }

  /**
   * Spawn one mote at the head `(hx,hy)` drifting along the anti-sunward unit
   * vector `(ux,uy)`. Returns `false` (a no-op) when the pool is full — the
   * bound that keeps the tail from ever exceeding {@link max}.
   */
  spawn(hx: number, hy: number, ux: number, uy: number): boolean {
    const slot = this.pool.find((m) => !m.active);
    if (!slot) return false;
    // Rotate the anti-sunward axis by a small random spread so the stream fans.
    const a = (this.rng() - 0.5) * 2 * SPREAD;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const dx = ux * cos - uy * sin;
    const dy = ux * sin + uy * cos;
    const speed = TAIL_SPEED * (0.5 + this.rng());
    slot.x = hx;
    slot.y = hy;
    slot.vx = dx * speed;
    slot.vy = dy * speed;
    slot.age = 0;
    slot.life = LIFE_MIN + this.rng() * (LIFE_MAX - LIFE_MIN);
    slot.size = 0.6 + this.rng() * 0.7;
    slot.active = true;
    return true;
  }

  /**
   * Advance one frame: age + drift the live motes (recycling any that outlive
   * their `life`), then — when `emitting` — spawn fresh motes at the head
   * proportional to `dt` (rate-gated and clamped by the pool bound). Read state
   * back via {@link slots} / {@link count}.
   */
  update(
    dt: number,
    hx: number,
    hy: number,
    ux: number,
    uy: number,
    emitting: boolean,
  ): void {
    for (const m of this.pool) {
      if (!m.active) continue;
      m.age += dt;
      if (m.age >= m.life) {
        m.active = false;
        continue;
      }
      m.x += m.vx * dt;
      m.y += m.vy * dt;
    }
    if (!emitting) return;
    this.emitAcc += EMIT_RATE * dt;
    while (this.emitAcc >= 1) {
      this.emitAcc -= 1;
      if (!this.spawn(hx, hy, ux, uy)) {
        this.emitAcc = 0; // pool full — drop the backlog rather than spin
        break;
      }
    }
  }
}

/** Fade factor (1 → 0 over the mote's life) — an alpha multiplier. */
export function moteAlpha(m: DustMote): number {
  if (m.life <= 0) return 0;
  return Math.max(0, 1 - m.age / m.life);
}

/** Scale factor that shrinks over the mote's life — a base-scale multiplier. */
export function moteScale(m: DustMote): number {
  if (m.life <= 0) return 0;
  const t = Math.min(1, m.age / m.life);
  return m.size * (1 - 0.5 * t);
}
