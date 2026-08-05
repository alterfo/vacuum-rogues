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

const MAX_EXPLOSION_PARTICLES = 48;
const EXPLOSION_BURST = 28;
const SPARK_SPRITE_SCALE = 0.16;
const SPARK_ALPHA = 0.95;
const EXPLOSION_Z_INDEX = 130;
const SPARK_HOT_TINT = 0xfff2c0;
const SPARK_COOL_TINT = 0xff4d1a;

export class ShipDeathFxRenderer {
  private readonly gameLayer: Container;
  private readonly fx: ShipDeathFx;
  private layer: ParticleContainer | null = null;
  private readonly particles: Particle[] = [];

  constructor(gameLayer: Container) {
    this.gameLayer = gameLayer;
    this.fx = new ShipDeathFx(MAX_EXPLOSION_PARTICLES, EXPLOSION_BURST);
    this.build();
  }

  private build(): void {
    const tex = softGlowTexture();
    if (!tex) return; // jsdom / no-canvas — pure emitter only
    const layer = new ParticleContainer({
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

  get count(): number {
    return this.fx.count;
  }

  isActive(): boolean {
    return this.fx.isActive();
  }

  spawn(x: number, y: number): void {
    if (reducedMotion()) return;
    this.fx.spawn(x, y);
  }

  update(dt: number): void {
    this.fx.update(dt);
    this.sync();
  }

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
