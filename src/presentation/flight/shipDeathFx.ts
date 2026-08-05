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

const SPEED_MIN = 0.08;
const SPEED_MAX = 0.26;
const LIFE_MIN = 320;
const LIFE_MAX = 620;
const SIZE_MIN = 0.7;
const SIZE_MAX = 1.6;
const ANGLE_JITTER = 0.4;

export class ShipDeathFx {
  readonly max: number;
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

  get count(): number {
    let n = 0;
    for (const m of this.pool) if (m.active) n++;
    return n;
  }

  get slots(): readonly ExplosionMote[] {
    return this.pool;
  }

  isActive(): boolean {
    return this.count > 0;
  }

  reset(): void {
    for (const m of this.pool) m.active = false;
  }

  spawn(cx: number, cy: number): number {
    let spawned = 0;
    for (let i = 0; i < this.burst; i++) {
      const slot = this.pool.find((m) => !m.active);
      if (!slot) break; // pool full — never exceed `max`
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

export function explosionMoteAlpha(m: ExplosionMote): number {
  if (m.life <= 0) return 0;
  return Math.max(0, 1 - m.age / m.life);
}

export function explosionMoteScale(m: ExplosionMote): number {
  if (m.life <= 0) return 0;
  const t = Math.min(1, m.age / m.life);
  return m.size * (1 - 0.7 * t);
}

export function explosionMoteLifeFraction(m: ExplosionMote): number {
  if (m.life <= 0) return 1;
  return Math.max(0, Math.min(1, m.age / m.life));
}
