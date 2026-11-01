import { Graphics, Sprite, type Container } from "pixi.js";
import type { ArcadeEvent } from "@/systems/blackHoleArcade/arcadeTypes";
import type { FxQuality } from "@/systems/blackHoleArcade/arcadeTouch";
import { PICKUP_COLOR, type ArcadeArt } from "./arcadeArt";

interface Particle {
  sprite: Sprite;
  vx: number;
  vy: number;
  ageMs: number;
  lifeMs: number;
  scaleFrom: number;
  scaleTo: number;
  alphaFrom: number;
  drag: number;
}

interface ArcFlash {
  points: { x: number; y: number }[];
  ageMs: number;
}

const ARC_LIFE_MS = 130;

export class ArcadeFx {
  private particles: Particle[] = [];
  private free: Sprite[] = [];
  private arcs: ArcFlash[] = [];
  private arcGfx: Graphics;
  private particleCap = 420;
  private sparkScale = 1;
  private shakeScale = 1;
  private reducedMotion = false;
  shakeMs = 0;
  shakeMag = 0;
  flash = 0;

  constructor(
    private readonly layer: Container,
    private readonly art: ArcadeArt,
    private readonly random: () => number = Math.random,
  ) {
    this.arcGfx = new Graphics();
    this.arcGfx.blendMode = "add";
    layer.addChild(this.arcGfx);
  }

  setQuality(quality: FxQuality): void {
    this.particleCap = quality.particleCap;
    this.sparkScale = quality.sparkScale;
    this.shakeScale = quality.shake;
  }

  setReducedMotion(value: boolean): void {
    this.reducedMotion = value;
    if (value) {
      this.shakeMs = 0;
      this.shakeMag = 0;
      this.flash = 0;
    }
  }

  handle(event: ArcadeEvent, playerX: number, playerY: number): void {
    if (this.reducedMotion) return;
    switch (event.kind) {
      case "explosion":
        this.explosion(event.x, event.y, event.size);
        if (event.size > 100) this.shake(280, 9);
        break;
      case "hit":
        this.spark(event.x, event.y, 0xffe0a0, 0.45, 140);
        break;
      case "blast":
        this.ring(event.x, event.y, event.radius * 2, 0xffa040, 320);
        this.glow(event.x, event.y, event.radius * 2.2, 0xff8a30, 260, 0.8);
        break;
      case "pickup":
        this.pickup(event.x, event.y, PICKUP_COLOR[event.pickup]);
        break;
      case "bombStart":
        this.ring(playerX, playerY, 1900, 0xffffff, 900);
        this.ring(playerX, playerY, 1300, 0xff6a6a, 1100);
        this.flash = 0.85;
        this.shake(700, 12);
        break;
      case "arc":
        this.arcs.push({ points: event.points, ageMs: 0 });
        break;
      case "playerHit":
        this.shake(event.shielded ? 120 : 260, event.shielded ? 3 : 8);
        break;
      case "bossDown":
        this.flash = Math.max(this.flash, 0.7);
        this.shake(900, 14);
        break;
      case "levelClear":
      case "fire":
        break;
    }
  }

  private shake(ms: number, mag: number): void {
    this.shakeMs = Math.max(this.shakeMs, ms);
    this.shakeMag = Math.max(this.shakeMag, mag * this.shakeScale);
  }

  private acquire(texture: Sprite["texture"]): Sprite | null {
    if (this.particles.length >= this.particleCap) return null;
    const sprite = this.free.pop() ?? this.createSprite();
    sprite.texture = texture;
    sprite.visible = true;
    sprite.tint = 0xffffff;
    return sprite;
  }

  private createSprite(): Sprite {
    const sprite = new Sprite();
    sprite.anchor.set(0.5);
    sprite.eventMode = "none";
    sprite.blendMode = "add";
    this.layer.addChild(sprite);
    return sprite;
  }

  private emit(
    texture: Sprite["texture"],
    x: number,
    y: number,
    tint: number,
    sizePx: number,
    scaleTo: number,
    lifeMs: number,
    alpha: number,
    vx = 0,
    vy = 0,
    drag = 0,
  ): void {
    const sprite = this.acquire(texture);
    if (!sprite) return;
    sprite.x = x;
    sprite.y = y;
    sprite.tint = tint;
    sprite.alpha = alpha;
    const base = sizePx / Math.max(1, texture.width || 64);
    sprite.scale.set(base);
    this.particles.push({
      sprite,
      vx,
      vy,
      ageMs: 0,
      lifeMs,
      scaleFrom: base,
      scaleTo: base * scaleTo,
      alphaFrom: alpha,
      drag,
    });
  }

  private glow(
    x: number,
    y: number,
    size: number,
    tint: number,
    lifeMs: number,
    alpha: number,
  ): void {
    this.emit(this.art.glow, x, y, tint, size, 1.6, lifeMs, alpha);
  }

  private ring(
    x: number,
    y: number,
    size: number,
    tint: number,
    lifeMs: number,
  ): void {
    this.emit(this.art.ring, x, y, tint, size * 0.15, 6.6, lifeMs, 0.9);
  }

  private spark(
    x: number,
    y: number,
    tint: number,
    sizeScale: number,
    lifeMs: number,
  ): void {
    this.emit(this.art.spark, x, y, tint, 26 * sizeScale, 0.3, lifeMs, 1);
  }

  private explosion(x: number, y: number, size: number): void {
    this.glow(x, y, size * 2.4, 0xfff2c8, 220, 1);
    this.glow(x, y, size * 2.0, 0xff8a30, 420, 0.85);
    this.glow(x, y, size * 3.2, 0xc03010, 620, 0.4);
    this.ring(x, y, size * 2.2, 0xffc890, 420);
    const count = Math.max(
      2,
      Math.round(Math.min(26, 6 + size / 6) * this.sparkScale),
    );
    for (let i = 0; i < count; i++) {
      const a = this.random() * Math.PI * 2;
      const speed = 90 + this.random() * (180 + size * 2);
      this.emit(
        this.art.spark,
        x,
        y,
        i % 3 === 0 ? 0xffffff : 0xffb050,
        14 + this.random() * 18,
        0.2,
        380 + this.random() * 420,
        1,
        Math.cos(a) * speed,
        Math.sin(a) * speed,
        2.4,
      );
    }
  }

  private pickup(x: number, y: number, color: number): void {
    this.ring(x, y, 140, color, 380);
    this.glow(x, y, 120, color, 300, 0.9);
    const sparks = Math.max(3, Math.round(10 * this.sparkScale));
    for (let i = 0; i < sparks; i++) {
      const a = (i / sparks) * Math.PI * 2;
      this.emit(
        this.art.spark,
        x,
        y,
        color,
        18,
        0.2,
        420,
        1,
        Math.cos(a) * 220,
        Math.sin(a) * 220,
        3,
      );
    }
  }

  update(dtMs: number): void {
    const dtSec = dtMs / 1000;
    let write = 0;
    for (const p of this.particles) {
      p.ageMs += dtMs;
      if (p.ageMs >= p.lifeMs) {
        p.sprite.visible = false;
        this.free.push(p.sprite);
        continue;
      }
      const t = p.ageMs / p.lifeMs;
      const damp = Math.max(0, 1 - p.drag * dtSec);
      p.vx *= damp;
      p.vy *= damp;
      p.sprite.x += p.vx * dtSec;
      p.sprite.y += p.vy * dtSec;
      p.sprite.scale.set(p.scaleFrom + (p.scaleTo - p.scaleFrom) * t);
      p.sprite.alpha = p.alphaFrom * (1 - t) * (1 - t * 0.2);
      this.particles[write++] = p;
    }
    this.particles.length = write;

    this.shakeMs = Math.max(0, this.shakeMs - dtMs);
    if (this.shakeMs === 0) this.shakeMag = 0;
    this.flash = Math.max(0, this.flash - dtMs / 520);
    this.drawArcs(dtMs);
  }

  shakeOffset(): { x: number; y: number } {
    if (this.shakeMs <= 0) return { x: 0, y: 0 };
    const mag = this.shakeMag * Math.min(1, this.shakeMs / 300);
    return {
      x: (this.random() - 0.5) * 2 * mag,
      y: (this.random() - 0.5) * 2 * mag,
    };
  }

  private bolt(
    a: { x: number; y: number },
    b: { x: number; y: number },
  ): number[] {
    const pts: number[] = [a.x, a.y];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const segments = Math.max(3, Math.round(len / 28));
    for (let i = 1; i < segments; i++) {
      const t = i / segments;
      const jitter = (this.random() - 0.5) * 26;
      pts.push(a.x + dx * t + nx * jitter, a.y + dy * t + ny * jitter);
    }
    pts.push(b.x, b.y);
    return pts;
  }

  private drawArcs(dtMs: number): void {
    const g = this.arcGfx;
    g.clear();
    let write = 0;
    for (const arc of this.arcs) {
      arc.ageMs += dtMs;
      if (arc.ageMs >= ARC_LIFE_MS) continue;
      const fade = 1 - arc.ageMs / ARC_LIFE_MS;
      for (let i = 0; i + 1 < arc.points.length; i++) {
        const pts = this.bolt(arc.points[i], arc.points[i + 1]);
        g.poly(pts, false).stroke({
          color: 0xb06bff,
          width: 11,
          alpha: 0.35 * fade,
        });
        g.poly(pts, false).stroke({
          color: 0xe2c4ff,
          width: 5,
          alpha: 0.8 * fade,
        });
        g.poly(pts, false).stroke({ color: 0xffffff, width: 2, alpha: fade });
      }
      this.arcs[write++] = arc;
    }
    this.arcs.length = write;
  }

  destroy(): void {
    for (const p of this.particles) p.sprite.destroy();
    for (const s of this.free) s.destroy();
    this.particles.length = 0;
    this.free.length = 0;
    this.arcs.length = 0;
    this.arcGfx.destroy();
  }
}
