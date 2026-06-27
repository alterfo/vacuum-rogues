import { Container, Particle, ParticleContainer } from "pixi.js";
import { softGlowTexture } from "../gradientTexture";
import { reducedMotion } from "../ui/reducedMotion";
import { lerpHex } from "./cometDustTail";
import {
  ShipDeathFx,
  explosionMoteAlpha,
  explosionMoteLifeFraction,
  explosionMoteScale,
} from "./shipDeathFx";

/** Hard upper bound on simultaneously-live explosion sparks across all bursts. */
const MAX_EXPLOSION_PARTICLES = 48;
/** Sparks seeded per ship-death burst (clamped to the pool bound above). */
const EXPLOSION_BURST = 28;
/** Base scale of the 256 px softGlow sprite per spark (×{@link explosionMoteScale}). */
const SPARK_SPRITE_SCALE = 0.16;
/** Global additive opacity multiplier on top of each mote's own fade. */
const SPARK_ALPHA = 0.95;
/** zIndex above the ship (110) / asteroids (120) so the blast reads in front. */
const EXPLOSION_Z_INDEX = 130;
/** White-hot core → cooling ember colour grade along each spark's burn. */
const SPARK_HOT_TINT = 0xfff2c0;
const SPARK_COOL_TINT = 0xff4d1a;

/**
 * Thin renderer mirroring the pure {@link ShipDeathFx} emitter onto pooled PixiJS
 * particles on the flight game layer — the visual half of the ship-death blast
 * (quest-card-scroll + ship-death plan, 2026-06-27, Task 3). Mirrors how
 * {@link AsteroidBelt} mirrors {@link CometDustTail}: a FIXED pool of additive
 * glow `Particle`s, 1:1 with the emitter's slots, so there is no per-frame
 * allocation and the live count is hard-bounded (the FPS guard).
 *
 * The renderer carries the only PixiJS — the spawn/age/prune logic stays in the
 * PixiJS-free emitter (unit-tested standalone). Accessibility: a burst is gated
 * on {@link reducedMotion}, so a player who asked for less motion sees no
 * explosion at all (root CLAUDE.md → "Reduced motion").
 *
 * Degrades without a 2D canvas (jsdom / unit tests): {@link softGlowTexture}
 * returns null, so no `ParticleContainer` is built and only the pure emitter runs
 * (its {@link count} still ticks for the wiring test) — no throw.
 */
export class ShipDeathFxRenderer {
  private readonly gameLayer: Container;
  private readonly fx: ShipDeathFx;
  private layer: ParticleContainer | null = null;
  private readonly particles: Particle[] = [];

  constructor(gameLayer: Container, rng: () => number = Math.random) {
    this.gameLayer = gameLayer;
    this.fx = new ShipDeathFx(MAX_EXPLOSION_PARTICLES, EXPLOSION_BURST, rng);
    this.build();
  }

  /** Build the pooled additive particle layer (no-op without a 2D canvas). */
  private build(): void {
    const tex = softGlowTexture();
    if (!tex) return; // jsdom / no-canvas — pure emitter only
    const layer = new ParticleContainer({
      // x/y, scale (vertex) and alpha+tint (color) all change per frame.
      dynamicProperties: { position: true, vertex: true, color: true },
    });
    layer.blendMode = "add";
    layer.eventMode = "none";
    layer.zIndex = EXPLOSION_Z_INDEX;
    for (let i = 0; i < MAX_EXPLOSION_PARTICLES; i++) {
      const part = new Particle({
        texture: tex,
        alpha: 0,
        anchorX: 0.5,
        anchorY: 0.5,
        tint: SPARK_HOT_TINT,
      });
      layer.addParticle(part);
      this.particles.push(part);
    }
    this.gameLayer.addChild(layer);
    this.layer = layer;
  }

  /** Live spark count (pure emitter) — always ≤ the pool bound. */
  get count(): number {
    return this.fx.count;
  }

  /** True while any spark is still burning. */
  isActive(): boolean {
    return this.fx.isActive();
  }

  /**
   * Seed an explosion burst centred at world `(x,y)`. Gated on reduced motion: a
   * player who asked for less motion gets no burst at all.
   */
  spawn(x: number, y: number): void {
    if (reducedMotion()) return;
    this.fx.spawn(x, y);
  }

  /** Advance the burst one frame and mirror it onto the pooled particles. */
  update(dt: number): void {
    this.fx.update(dt);
    this.sync();
  }

  /** Mirror each live emitter mote 1:1 onto its pooled particle. */
  private sync(): void {
    if (!this.layer) return;
    const slots = this.fx.slots;
    for (let i = 0; i < slots.length; i++) {
      const m = slots[i];
      const part = this.particles[i];
      if (!part) continue;
      if (m.active) {
        part.x = m.x;
        part.y = m.y;
        const sc = SPARK_SPRITE_SCALE * explosionMoteScale(m);
        part.scaleX = sc;
        part.scaleY = sc;
        part.alpha = explosionMoteAlpha(m) * SPARK_ALPHA;
        // Grade hot white near the flash → cool ember as the spark spends out.
        part.tint = lerpHex(
          SPARK_HOT_TINT,
          SPARK_COOL_TINT,
          explosionMoteLifeFraction(m),
        );
      } else {
        part.alpha = 0;
      }
    }
  }

  /** Remove + destroy the particle layer and drop all sparks (teardown). */
  destroy(): void {
    this.fx.reset();
    if (this.layer) {
      if (this.layer.parent) this.layer.parent.removeChild(this.layer);
      if (!this.layer.destroyed) this.layer.destroy({ children: true });
      this.layer = null;
    }
    this.particles.length = 0;
  }
}
