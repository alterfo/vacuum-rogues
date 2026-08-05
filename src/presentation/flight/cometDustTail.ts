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

const TAIL_SPEED = 0.2;
const LIFE_MIN = 1600;
const LIFE_MAX = 3400;
const SPREAD = 0.32;
const EMIT_RATE = 0.05;

export class CometDustTail {
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

  get count(): number {
    let n = 0;
    for (const m of this.pool) if (m.active) n++;
    return n;
  }

  get slots(): readonly DustMote[] {
    return this.pool;
  }

  reset(): void {
    for (const m of this.pool) m.active = false;
    this.emitAcc = 0;
  }

  spawn(hx: number, hy: number, ux: number, uy: number): boolean {
    const slot = this.pool.find((m) => !m.active);
    if (!slot) return false;
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
    slot.size = 0.7 + this.rng() * 0.8;
    slot.active = true;
    return true;
  }

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

export function moteAlpha(m: DustMote): number {
  if (m.life <= 0) return 0;
  return Math.max(0, 1 - m.age / m.life);
}

export function moteScale(m: DustMote): number {
  if (m.life <= 0) return 0;
  const t = Math.min(1, m.age / m.life);
  return m.size * (1 - 0.6 * t);
}

export function moteLifeFraction(m: DustMote): number {
  if (m.life <= 0) return 1;
  return Math.max(0, Math.min(1, m.age / m.life));
}

export function lerpHex(a: number, b: number, t: number): number {
  const k = Math.max(0, Math.min(1, t));
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * k);
  const g = Math.round(ag + (bg - ag) * k);
  const bl = Math.round(ab + (bb - ab) * k);
  return (r << 16) | (g << 8) | bl;
}
