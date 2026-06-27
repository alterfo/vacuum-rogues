/**
 * Pure (PixiJS-free) ship-death explosion emitter (quest-card-scroll + ship-death
 * plan, 2026-06-27, Task 2). A one-shot radial burst of sparks that fly outward
 * from the dying ship, fading + shrinking over a brief lifetime before being
 * recycled — the visual punctuation a kill was missing.
 *
 * Mirrors {@link CometDustTail}: it owns a FIXED pool of motes, so the live count
 * is HARD-BOUNDED (the FPS guard from `project-system-map-baseline-fps`) and spent
 * motes recycle with no allocation churn. The difference is the emission shape —
 * a comet is a continuous rate-gated stream, an explosion is a single `spawn()`
 * burst that seeds an outward fan of sparks at once and then only ages/prunes.
 * The renderer (a thin flight helper) mirrors each pool slot 1:1 onto a pooled
 * PixiJS `Particle`; like `cometDustTail`/`combatPause` this module carries no
 * PixiJS, so the spawn/age/drift/prune logic is unit-tested standalone.
 */
export interface ExplosionMote {
  x: number;
  y: number;
  vx: number; // px/ms
  vy: number; // px/ms
  age: number; // ms since spawn
  life: number; // ms total lifetime
  size: number; // per-mote base scale multiplier
  active: boolean; // false = recycled / free slot
}

/** px/ms outward radial speed band (varied per spark) — a faster spark flies
 * farther before it cools out. */
const SPEED_MIN = 0.08;
const SPEED_MAX = 0.26;
/** ms lifetime band — a short, punchy flash that clears quickly so it never
 * lingers over the battlefield. */
const LIFE_MIN = 320;
const LIFE_MAX = 620;
/** per-spark base scale multiplier band. */
const SIZE_MIN = 0.7;
const SIZE_MAX = 1.6;
/** ± angular jitter (radians) applied to the otherwise even radial fan, so the
 * burst reads organic rather than a perfect wheel of spokes. */
const ANGLE_JITTER = 0.4;

export class ShipDeathFx {
  /** Hard upper bound on simultaneously-live motes. */
  readonly max: number;
  /** Sparks seeded per {@link spawn} burst (clamped to {@link max}). */
  readonly burst: number;
  private readonly pool: ExplosionMote[];
  private readonly rng: () => number;

  constructor(max = 32, burst = 24, rng: () => number = Math.random) {
    this.max = Math.max(1, Math.floor(max));
    this.burst = Math.max(1, Math.min(this.max, Math.floor(burst)));
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
  get slots(): readonly ExplosionMote[] {
    return this.pool;
  }

  /** True while any spark is still burning (renderer keeps drawing). */
  isActive(): boolean {
    return this.count > 0;
  }

  /** Drop all sparks (a teardown / fresh scene). */
  reset(): void {
    for (const m of this.pool) m.active = false;
  }

  /**
   * Seed one explosion burst centred at `(cx,cy)`: up to {@link burst} sparks fly
   * outward on an evenly-fanned set of angles (with a little jitter), each with a
   * random outward speed, brief lifetime and base size. Returns the number of
   * sparks actually seeded (fewer than `burst` when the pool is already crowded —
   * the bound that keeps the live count ≤ {@link max}).
   */
  spawn(cx: number, cy: number): number {
    let spawned = 0;
    for (let i = 0; i < this.burst; i++) {
      const slot = this.pool.find((m) => !m.active);
      if (!slot) break; // pool full — never exceed `max`
      // Even radial fan + jitter so the burst is symmetric but not mechanical.
      const angle =
        (i / this.burst) * Math.PI * 2 + (this.rng() - 0.5) * ANGLE_JITTER;
      const speed = SPEED_MIN + this.rng() * (SPEED_MAX - SPEED_MIN);
      slot.x = cx;
      slot.y = cy;
      slot.vx = Math.cos(angle) * speed;
      slot.vy = Math.sin(angle) * speed;
      slot.age = 0;
      slot.life = LIFE_MIN + this.rng() * (LIFE_MAX - LIFE_MIN);
      slot.size = SIZE_MIN + this.rng() * (SIZE_MAX - SIZE_MIN);
      slot.active = true;
      spawned++;
    }
    return spawned;
  }

  /**
   * Advance one frame: age + drift every live spark, recycling any that outlive
   * their `life`. Read state back via {@link slots} / {@link count}. There is no
   * continuous emission — an explosion is seeded entirely by {@link spawn}.
   */
  update(dt: number): void {
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
  }
}

/** Fade factor (1 → 0 over the spark's life) — an alpha multiplier. A spent
 * (life ≤ 0) slot reads as fully faded rather than NaN. */
export function explosionMoteAlpha(m: ExplosionMote): number {
  if (m.life <= 0) return 0;
  return Math.max(0, 1 - m.age / m.life);
}

/** Scale factor that shrinks as the spark cools — a base-scale multiplier. The
 * outward motion supplies the expanding-fireball read; each spark itself thins
 * toward its end (×0.7 falloff) so the burst dissipates instead of popping. */
export function explosionMoteScale(m: ExplosionMote): number {
  if (m.life <= 0) return 0;
  const t = Math.min(1, m.age / m.life);
  return m.size * (1 - 0.7 * t);
}

/**
 * Position of a spark along its burn as a fraction in [0,1] (0 = freshly seeded
 * white-hot core, 1 = spent cool ember). Drives the hot→cool colour grade in the
 * renderer; a recycled (life ≤ 0) slot reads as fully aged rather than NaN.
 */
export function explosionMoteLifeFraction(m: ExplosionMote): number {
  if (m.life <= 0) return 1;
  return Math.max(0, Math.min(1, m.age / m.life));
}
