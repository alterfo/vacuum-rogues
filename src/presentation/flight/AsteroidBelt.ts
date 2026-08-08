import {
  Container,
  Graphics,
  Particle,
  ParticleContainer,
  Sprite,
} from "pixi.js";
import type { Renderer } from "../Renderer";
import { SYSTEM_GEOMETRY } from "@/config/balance";
import {
  buildCometFlyby,
  hyperbolaPoint,
  type CometFlyby,
} from "@/utils/flightGeometry";
import {
  cometHeadTexture,
  dustParticleTexture,
  rockTexture,
  ROCK_VARIANT_COUNT,
} from "../gradientTexture";
import {
  CometDustTail,
  lerpHex,
  moteAlpha,
  moteLifeFraction,
  moteScale,
} from "./cometDustTail";
import type { FlightModule } from "./FlightModule";
import { reducedMotion } from "../ui/reducedMotion";

const MAX_TAIL_PARTICLES = 96;
const TAIL_SPRITE_SCALE = 1.15;
const TAIL_ALPHA = 0.5;
const TAIL_HEAD_TINT = 0xfff0cf;
const TAIL_TIP_TINT = 0x8fbcff;
const HEAD_SCALE = 0.72;
const CORE_SCALE = 0.26;
const HEAD_TINT = 0xd6ecff;
const CORE_TINT = 0xfff4e0;
const TAIL_TINT = 0xcfe4ff;
const TAIL_FULL = 1500;
const TAIL_FADE = 2200;

const ROCK_BASE_SCALE = 0.28;
const ROCK_SCALE_VAR = 0.34;
const ROCK_TINTS = [0xffffff, 0xe8dccb, 0xcfc9bf, 0xd9c7ad, 0xbfc2c0, 0xe0d2bd];

interface AsteroidMote {
  graphics: Graphics;
  rock: Sprite | null;
  x: number;
  y: number;
  vx: number; // px/ms (asteroids only)
  vy: number;
  spin: number; // rad/ms (asteroids only)
  comet: boolean;
  flyby: CometFlyby | null; // hyperbola params + entry/exit sweep range
  theta: number; // current true anomaly along the sweep (rad), thetaStart→thetaEnd
  thetaSpeed: number; // rad/ms sweep rate (always advances toward thetaEnd)
  cometCooldown: number; // ms left offscreen before a fresh comet flies in (0 = active)
  head: Sprite | null; // outer coma halo (cometHeadTexture sprite)
  core: Sprite | null; // bright inner nucleus core (cometHeadTexture sprite)
  tail: CometDustTail | null; // pure dust-tail emitter (PixiJS-free)
  particles: Particle[]; // pooled visuals, mirrored 1:1 with tail.slots
}

export class AsteroidBelt implements FlightModule {
  private readonly gameLayer: Container;
  private readonly centerX: number;
  private readonly centerY: number;

  private asteroidContainer: Container | null = null;
  private asteroids: AsteroidMote[] = [];

  constructor(renderer: Renderer, gameLayer: Container) {
    this.gameLayer = gameLayer;
    this.centerX = renderer.app.screen.width / 2;
    this.centerY = renderer.app.screen.height / 2;
  }

  initialize(): void {
    this.createAsteroids();
  }

  update(deltaTime: number, _bgElapsed: number): void {
    if (reducedMotion()) return;
    this.updateAsteroids(deltaTime);
  }

  destroy(): void {
    if (this.asteroidContainer) {
      if (this.asteroidContainer.parent) {
        this.asteroidContainer.parent.removeChild(this.asteroidContainer);
      }
      if (!this.asteroidContainer.destroyed) {
        this.asteroidContainer.destroy({ children: true });
      }
      this.asteroidContainer = null;
    }
    this.asteroids = [];
  }

  get count(): number {
    return this.asteroids.length;
  }

  private createAsteroids(): void {
    this.asteroidContainer = new Container();
    this.asteroidContainer.eventMode = "none";
    this.asteroidContainer.zIndex = 120; // in front of ship (110) / planets
    const cometCount = 2; // flyby comets only — drifting rocks removed by design
    const count = cometCount;
    for (let i = 0; i < count; i++) {
      const g = new Graphics();
      g.eventMode = "none";
      this.asteroidContainer.addChild(g);
      const a: AsteroidMote = {
        graphics: g,
        rock: null,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        spin: 0,
        comet: i < cometCount,
        flyby: null,
        theta: 0,
        thetaSpeed: 0,
        cometCooldown: 0,
        head: null,
        core: null,
        tail: null,
        particles: [],
      };
      if (a.comet) this.setupCometVisuals(a);
      else this.setupAsteroidVisuals(a);
      this.drawAsteroid(a);
      this.respawnAsteroid(a, true);
      this.asteroids.push(a);
    }
    this.gameLayer.addChild(this.asteroidContainer);
  }

  private setupCometVisuals(a: AsteroidMote): void {
    const container = this.asteroidContainer;
    if (!container) return;

    const dustTex = dustParticleTexture();
    if (dustTex) {
      const layer = new ParticleContainer({
        dynamicProperties: { position: true, vertex: true, color: true },
      });
      layer.blendMode = "add";
      layer.eventMode = "none";
      a.tail = new CometDustTail(MAX_TAIL_PARTICLES);
      a.particles = [];
      for (let i = 0; i < MAX_TAIL_PARTICLES; i++) {
        const part = new Particle({
          texture: dustTex,
          alpha: 0,
          anchorX: 0.5,
          anchorY: 0.5,
          tint: TAIL_TINT,
        });
        layer.addParticle(part);
        a.particles.push(part);
      }
      container.addChildAt(layer, 0);
    }

    const headTex = cometHeadTexture();
    if (headTex) {
      const head = new Sprite(headTex);
      head.anchor.set(0.5);
      head.scale.set(HEAD_SCALE);
      head.tint = HEAD_TINT;
      head.blendMode = "add";
      head.eventMode = "none";
      a.head = head;
      container.addChild(head); // above the tail layer

      const core = new Sprite(headTex);
      core.anchor.set(0.5);
      core.scale.set(CORE_SCALE);
      core.tint = CORE_TINT;
      core.blendMode = "add";
      core.eventMode = "none";
      a.core = core;
      container.addChild(core); // bright nucleus above the halo
    }
  }

  private setupAsteroidVisuals(a: AsteroidMote): void {
    const container = this.asteroidContainer;
    if (!container) return;
    const tex = rockTexture(Math.floor(Math.random() * ROCK_VARIANT_COUNT));
    if (!tex) return; // jsdom — drawn-polygon fallback on `graphics`
    const sprite = new Sprite(tex);
    sprite.anchor.set(0.5);
    sprite.scale.set(ROCK_BASE_SCALE + Math.random() * ROCK_SCALE_VAR);
    sprite.rotation = Math.random() * Math.PI * 2;
    sprite.tint = ROCK_TINTS[Math.floor(Math.random() * ROCK_TINTS.length)];
    sprite.eventMode = "none";
    a.rock = sprite;
    container.addChild(sprite);
  }

  private drawAsteroid(a: AsteroidMote): void {
    const g = a.graphics;
    g.clear();
    if (a.comet) {
      if (!a.head) {
        const r = 13 + Math.random() * 5;
        g.circle(0, 0, r * 0.9).fill({ color: 0xcce4ff, alpha: 0.9 });
        g.circle(0, 0, r * 0.4).fill({ color: 0xeef6ff, alpha: 0.96 });
      }
      return;
    }
    if (a.rock) return;
    {
      const r = 9 + Math.random() * 14;
      const pts: number[] = [];
      const sides = 7;
      for (let i = 0; i < sides; i++) {
        const ang = (i / sides) * Math.PI * 2;
        const rr = r * (0.7 + Math.random() * 0.5);
        pts.push(Math.cos(ang) * rr, Math.sin(ang) * rr);
      }
      g.poly(pts).fill({ color: 0x6b6256, alpha: 0.85 });
      g.poly(pts).stroke({ width: 1, color: 0x2a251f, alpha: 0.6 });
      g.circle(-r * 0.2, -r * 0.1, r * 0.22).fill({
        color: 0x4a443b,
        alpha: 0.7,
      });
      g.circle(r * 0.25, r * 0.2, r * 0.16).fill({
        color: 0x4a443b,
        alpha: 0.6,
      });
    }
  }

  private asteroidFieldRadius(): number {
    return SYSTEM_GEOMETRY.boundaryRadius * 1.1;
  }

  private respawnAsteroid(a: AsteroidMote, initial = false): void {
    const cx = this.centerX;
    const cy = this.centerY;
    const R = this.asteroidFieldRadius();

    if (a.comet) {
      const flyby = buildCometFlyby(cx, cy, R);
      a.flyby = flyby;
      const sweep = flyby.thetaEnd - flyby.thetaStart;
      a.thetaSpeed = sweep / (45000 + Math.random() * 45000);
      a.cometCooldown = 0;
      a.theta = initial
        ? flyby.thetaStart + Math.random() * sweep
        : flyby.thetaStart;
      const p = hyperbolaPoint(flyby.params, a.theta);
      a.x = p.x;
      a.y = p.y;
    } else {
      const speed = 0.012 + Math.random() * 0.03;
      const entryAng = Math.random() * Math.PI * 2;
      a.x = cx + Math.cos(entryAng) * R;
      a.y = cy + Math.sin(entryAng) * R;
      const aimAng = entryAng + Math.PI + (Math.random() - 0.5) * 1.1;
      a.vx = Math.cos(aimAng) * speed;
      a.vy = Math.sin(aimAng) * speed;
      a.spin = (Math.random() - 0.5) * 0.0008;
      if (initial) {
        const rr = Math.sqrt(Math.random()) * R;
        const ang2 = Math.random() * Math.PI * 2;
        a.x = cx + Math.cos(ang2) * rr;
        a.y = cy + Math.sin(ang2) * rr;
      }
    }
    a.graphics.x = a.x;
    a.graphics.y = a.y;
    if (a.rock) {
      a.rock.x = a.x;
      a.rock.y = a.y;
    }
    if (a.comet) {
      a.tail?.reset();
      this.hideTail(a);
      if (a.head) {
        a.head.x = a.x;
        a.head.y = a.y;
        a.head.visible = true;
      }
      if (a.core) {
        a.core.x = a.x;
        a.core.y = a.y;
        a.core.visible = true;
      }
    }
  }

  private hideTail(a: AsteroidMote): void {
    for (const part of a.particles) part.alpha = 0;
  }

  private syncTail(a: AsteroidMote, fade: number): void {
    if (!a.tail) return;
    const slots = a.tail.slots;
    for (let i = 0; i < slots.length; i++) {
      const m = slots[i];
      const part = a.particles[i];
      if (!part) continue;
      if (m.active) {
        part.x = m.x;
        part.y = m.y;
        const sc = TAIL_SPRITE_SCALE * moteScale(m);
        part.scaleX = sc;
        part.scaleY = sc;
        part.alpha = moteAlpha(m) * fade * TAIL_ALPHA;
        part.tint = lerpHex(TAIL_HEAD_TINT, TAIL_TIP_TINT, moteLifeFraction(m));
      } else {
        part.alpha = 0;
      }
    }
  }

  private updateAsteroids(deltaTime: number): void {
    if (this.asteroids.length === 0) return;
    const cx = this.centerX;
    const cy = this.centerY;
    const limit = this.asteroidFieldRadius() * 1.15;
    const limitSq = limit * limit;
    for (const a of this.asteroids) {
      if (a.comet) {
        if (a.cometCooldown > 0) {
          a.cometCooldown -= deltaTime;
          if (a.cometCooldown <= 0) {
            this.drawAsteroid(a);
            this.respawnAsteroid(a); // shows head + resets tail
            a.graphics.visible = true;
          }
          continue;
        }
        a.theta += a.thetaSpeed * deltaTime;
        if (!a.flyby || a.theta >= a.flyby.thetaEnd) {
          a.graphics.visible = false;
          if (a.head) a.head.visible = false;
          if (a.core) a.core.visible = false;
          a.tail?.reset();
          this.hideTail(a);
          a.cometCooldown = 8000 + Math.random() * 12000; // 8–20 s gap
          continue;
        }
        const p = hyperbolaPoint(a.flyby.params, a.theta);
        a.x = p.x;
        a.y = p.y;
        const sunDx = a.x - cx;
        const sunDy = a.y - cy;
        const dist = Math.hypot(sunDx, sunDy) || 1;
        const ux = sunDx / dist;
        const uy = sunDy / dist;
        const fade =
          dist <= TAIL_FULL
            ? 1
            : dist >= TAIL_FADE
              ? 0
              : 1 - (dist - TAIL_FULL) / (TAIL_FADE - TAIL_FULL);
        a.graphics.x = a.x;
        a.graphics.y = a.y;
        a.graphics.alpha = fade;
        const comaRotation = Math.atan2(uy, ux);
        if (a.head) {
          a.head.x = a.x;
          a.head.y = a.y;
          a.head.rotation = comaRotation;
          a.head.alpha = fade;
        }
        if (a.core) {
          a.core.x = a.x;
          a.core.y = a.y;
          a.core.rotation = comaRotation;
          a.core.alpha = fade;
        }
        if (a.tail) {
          a.tail.update(deltaTime, a.x, a.y, ux, uy, fade > 0.04);
          this.syncTail(a, fade);
        }
      } else {
        a.x += a.vx * deltaTime;
        a.y += a.vy * deltaTime;
        a.graphics.x = a.x;
        a.graphics.y = a.y;
        a.graphics.rotation += a.spin * deltaTime;
        if (a.rock) {
          a.rock.x = a.x;
          a.rock.y = a.y;
          a.rock.rotation += a.spin * deltaTime;
        }
        const dx = a.x - cx;
        const dy = a.y - cy;
        if (dx * dx + dy * dy > limitSq) {
          this.drawAsteroid(a);
          this.respawnAsteroid(a);
        }
      }
    }
  }
}
