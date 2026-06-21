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
import { dustParticleTexture, softGlowTexture } from "../gradientTexture";
import { CometDustTail, moteAlpha, moteScale } from "./cometDustTail";
import type { FlightModule } from "./FlightModule";

/** Per-comet hard cap on simultaneously-live dust motes (FPS bound). */
const MAX_TAIL_PARTICLES = 64;
/** Base scale of the 64 px dust sprite (×{@link moteScale} per mote). */
const TAIL_SPRITE_SCALE = 1.15;
/** Global tail opacity multiplier (additive, on top of per-mote fade). */
const TAIL_ALPHA = 0.55;
/** softGlowTexture is 256 px (r 128); 0.45 → a ~58 px icy head glow. */
const HEAD_SCALE = 0.45;
/** Icy white-blue head + dust tints. */
const HEAD_TINT = 0xd8eaff;
const TAIL_TINT = 0xcfe4ff;
/** Distance band (world px from the star) over which the comet fades in/out. */
const TAIL_FULL = 1500;
const TAIL_FADE = 2200;

/** A single drifting rock or flyby comet in the foreground asteroid field. */
interface AsteroidMote {
  graphics: Graphics;
  x: number;
  y: number;
  vx: number; // px/ms (asteroids only)
  vy: number;
  spin: number; // rad/ms (asteroids only)
  comet: boolean;
  // Hyperbolic flyby state — comets only. Unlike the old closed ellipse, a comet
  // follows an OPEN hyperbola (e > 1): it enters at the field edge, sweeps past
  // the star once, and leaves; a fresh flyby is built each pass (never periodic).
  flyby: CometFlyby | null; // hyperbola params + entry/exit sweep range
  theta: number; // current true anomaly along the sweep (rad), thetaStart→thetaEnd
  thetaSpeed: number; // rad/ms sweep rate (always advances toward thetaEnd)
  cometCooldown: number; // ms left offscreen before a fresh comet flies in (0 = active)
  // Particle-comet visuals (comets only; null when no 2D canvas is available —
  // jsdom / unit tests — so the module degrades without throwing).
  head: Sprite | null; // glowing icy head (softGlowTexture sprite)
  tail: CometDustTail | null; // pure dust-tail emitter (PixiJS-free)
  tailLayer: ParticleContainer | null; // the visual particle container
  particles: Particle[]; // pooled visuals, mirrored 1:1 with tail.slots
}

/**
 * Owns the occasional foreground asteroids/comets drifting through the system
 * (US-070 #1). They live in **world space** (the star's frame) so they pan and
 * zoom with the world rather than sliding across the screen as the ship moves —
 * they belong to the system, not the camera. A high zIndex keeps them reading
 * in front of the ship/planets ("foreground" flybys). The field stays sparse:
 * each one respawns at the system edge once it drifts past it.
 *
 * The field is centred on the system's star, which sits at the screen centre in
 * world coordinates (the same centre {@link StarRenderer} derives), so the
 * module computes its own centre from the renderer rather than coupling to the
 * star module.
 */
export class AsteroidBelt implements FlightModule {
  private readonly gameLayer: Container;
  /** World position of the star centre (the field is centred on the star). */
  private readonly centerX: number;
  private readonly centerY: number;

  private asteroidContainer: Container | null = null;
  private asteroids: AsteroidMote[] = [];

  constructor(renderer: Renderer, gameLayer: Container) {
    this.gameLayer = gameLayer;
    this.centerX = renderer.app.screen.width / 2;
    this.centerY = renderer.app.screen.height / 2;
  }

  // ---------------------------------------------------------------------------
  // FlightModule lifecycle
  // ---------------------------------------------------------------------------

  initialize(): void {
    this.createAsteroids();
  }

  update(deltaTime: number, _bgElapsed: number): void {
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

  /** Number of asteroids/comets currently in the field (test/inspection hook). */
  get count(): number {
    return this.asteroids.length;
  }

  // ---------------------------------------------------------------------------
  // Creation + drawing
  // ---------------------------------------------------------------------------

  /**
   * Spawn a few asteroids/comets that drift through the system (US-070 #1).
   * They live in **world space** (the star's frame) so they pan and zoom with the
   * world rather than sliding across the screen as the ship moves — they belong
   * to the system, not the camera. A high zIndex keeps them reading in front of
   * the ship/planets ("foreground" flybys). The field stays sparse: each one
   * respawns at the system edge once it drifts past it.
   */
  private createAsteroids(): void {
    this.asteroidContainer = new Container();
    this.asteroidContainer.eventMode = "none";
    this.asteroidContainer.zIndex = 120; // in front of ship (110) / planets
    const count = 8;
    const cometCount = 2; // a couple of single-pass comet flybys among the rocks
    for (let i = 0; i < count; i++) {
      const g = new Graphics();
      g.eventMode = "none";
      this.asteroidContainer.addChild(g);
      const a: AsteroidMote = {
        graphics: g,
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
        tail: null,
        tailLayer: null,
        particles: [],
      };
      if (a.comet) this.setupCometVisuals(a);
      this.drawAsteroid(a);
      this.respawnAsteroid(a, true);
      this.asteroids.push(a);
    }
    // World-space (moves with the system), above the ship/planets.
    this.gameLayer.addChild(this.asteroidContainer);
  }

  /**
   * Build the particle-comet visuals (head glow sprite + dust-tail emitter +
   * pooled particle layer). Soft edges come from the baked `softGlowTexture` /
   * `dustParticleTexture` alpha — NOT a per-frame BlurFilter
   * (`feedback-no-blur-filters-flight`). All three are null when no 2D canvas is
   * available (jsdom / unit tests); the comet then falls back to a small drawn
   * nucleus and the tail is simply absent — no throw.
   */
  private setupCometVisuals(a: AsteroidMote): void {
    const container = this.asteroidContainer;
    if (!container) return;

    const dustTex = dustParticleTexture();
    if (dustTex) {
      const layer = new ParticleContainer({
        // x/y, scale (vertex) and alpha (color) all change per frame.
        dynamicProperties: { position: true, vertex: true, color: true },
      });
      layer.blendMode = "add";
      layer.eventMode = "none";
      a.tail = new CometDustTail(MAX_TAIL_PARTICLES);
      a.tailLayer = layer;
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
      // Tail below the head: insert at the back of the field container.
      container.addChildAt(layer, 0);
    }

    const headTex = softGlowTexture();
    if (headTex) {
      const head = new Sprite(headTex);
      head.anchor.set(0.5);
      head.scale.set(HEAD_SCALE);
      head.tint = HEAD_TINT;
      head.blendMode = "add";
      head.eventMode = "none";
      a.head = head;
      container.addChild(head); // above the tail layer
    }
  }

  /** Draw an irregular grey rock (or the comet's fallback nucleus). */
  private drawAsteroid(a: AsteroidMote): void {
    const g = a.graphics;
    g.clear();
    if (a.comet) {
      // The comet's glow + dust tail are particle/sprite-based (see
      // setupCometVisuals + updateAsteroids). When no baked head texture is
      // available (jsdom), draw a minimal icy nucleus so it still reads — no
      // flat wedge/circle tail.
      if (!a.head) {
        const r = 13 + Math.random() * 5;
        g.circle(0, 0, r * 0.9).fill({ color: 0xcce4ff, alpha: 0.9 });
        g.circle(0, 0, r * 0.4).fill({ color: 0xeef6ff, alpha: 0.96 });
      }
      return;
    }
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
      // a couple of craters
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

  /** Radius of the asteroid field around the star (world units). */
  private asteroidFieldRadius(): number {
    return SYSTEM_GEOMETRY.boundaryRadius * 1.1;
  }

  /**
   * Place an asteroid in world space: it enters at the system edge and drifts
   * across toward the far side (passing near the star). `initial` instead
   * scatters it somewhere inside the field so the first batch isn't all bunched
   * at the rim.
   */
  private respawnAsteroid(a: AsteroidMote, initial = false): void {
    const cx = this.centerX;
    const cy = this.centerY;
    const R = this.asteroidFieldRadius();

    if (a.comet) {
      // Open hyperbolic flyby (e > 1): the comet enters at the field edge,
      // sweeps once past the star (perihelion inside the field), and leaves —
      // never a closed orbit. A fresh flyby is built each pass.
      const flyby = buildCometFlyby(cx, cy, R);
      a.flyby = flyby;
      const sweep = flyby.thetaEnd - flyby.thetaStart;
      // Cross the whole entry→exit sweep over ~45–90 s (gentle, like the old orbit).
      a.thetaSpeed = sweep / (45000 + Math.random() * 45000);
      a.cometCooldown = 0;
      // An initial (scene-start) comet starts somewhere mid-sweep so the first
      // one isn't pinned to the rim; a respawn enters cleanly at the edge.
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
    if (a.comet) {
      // A fresh flyby starts with an empty tail (old motes belonged to the prior
      // pass, possibly across the field) and the head shown at the entry point.
      a.tail?.reset();
      this.hideTail(a);
      if (a.head) {
        a.head.x = a.x;
        a.head.y = a.y;
        a.head.visible = true;
      }
    }
  }

  /** Push every pooled dust particle to fully transparent (comet hidden). */
  private hideTail(a: AsteroidMote): void {
    for (const part of a.particles) part.alpha = 0;
  }

  /** Mirror the pure emitter's live motes onto the pooled PixiJS particles. */
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
      } else {
        part.alpha = 0;
      }
    }
  }

  /** Drift + spin the asteroids in world space, respawning past the field edge. */
  private updateAsteroids(deltaTime: number): void {
    if (this.asteroids.length === 0) return;
    const cx = this.centerX;
    const cy = this.centerY;
    const limit = this.asteroidFieldRadius() * 1.15;
    const limitSq = limit * limit;
    for (const a of this.asteroids) {
      if (a.comet) {
        // Offscreen between passes: a fresh comet flies in once cooldown elapses.
        if (a.cometCooldown > 0) {
          a.cometCooldown -= deltaTime;
          if (a.cometCooldown <= 0) {
            this.drawAsteroid(a);
            this.respawnAsteroid(a); // shows head + resets tail
            a.graphics.visible = true;
          }
          continue;
        }
        // Advance along the open hyperbola (Kepler-lite: uniform sweep rate).
        a.theta += a.thetaSpeed * deltaTime;
        if (!a.flyby || a.theta >= a.flyby.thetaEnd) {
          // Swept past the exit edge: the comet leaves; a fresh one returns later.
          a.graphics.visible = false;
          if (a.head) a.head.visible = false;
          a.tail?.reset();
          this.hideTail(a);
          a.cometCooldown = 8000 + Math.random() * 12000; // 8–20 s gap
          continue;
        }
        const p = hyperbolaPoint(a.flyby.params, a.theta);
        a.x = p.x;
        a.y = p.y;
        // Anti-sunward unit vector (solar wind blows the dust away from the star).
        const sunDx = a.x - cx;
        const sunDy = a.y - cy;
        const dist = Math.hypot(sunDx, sunDy) || 1;
        const ux = sunDx / dist;
        const uy = sunDy / dist;
        // Head/tail visible only in the inner system (orbit 2-3 zone). Fully
        // visible inside 1500 px, faded out by 2200 px.
        const fade =
          dist <= TAIL_FULL
            ? 1
            : dist >= TAIL_FADE
              ? 0
              : 1 - (dist - TAIL_FULL) / (TAIL_FADE - TAIL_FULL);
        // Glowing head follows the hyperbola (fallback nucleus on graphics too).
        a.graphics.x = a.x;
        a.graphics.y = a.y;
        a.graphics.alpha = fade;
        if (a.head) {
          a.head.x = a.x;
          a.head.y = a.y;
          a.head.alpha = fade;
        }
        // Dust tail: emit at the head while visible; motes drift anti-sunward in
        // world space (the ParticleContainer sits at the field origin, so the
        // trail is left behind as the head sweeps on).
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
