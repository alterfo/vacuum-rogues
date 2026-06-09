import { Container, Graphics } from "pixi.js";
import type { Renderer } from "../Renderer";
import { SYSTEM_GEOMETRY } from "@/config/balance";
import type { FlightModule } from "./FlightModule";

/** A single drifting rock or orbiting comet in the foreground asteroid field. */
interface AsteroidMote {
  graphics: Graphics;
  x: number;
  y: number;
  vx: number; // px/ms (asteroids only)
  vy: number;
  spin: number; // rad/ms (asteroids only)
  comet: boolean;
  // Orbital parameters — comets only
  orbitA: number; // semi-major axis (world px)
  orbitB: number; // semi-minor axis (world px)
  orbitAngle: number; // current angle (rad)
  orbitSpeed: number; // rad/ms, sign = direction
  orbitTilt: number; // orbit plane rotation in world xy (rad)
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
        comet: false,
        orbitA: 0,
        orbitB: 0,
        orbitAngle: 0,
        orbitSpeed: 0,
        orbitTilt: 0,
      };
      this.drawAsteroid(a);
      this.respawnAsteroid(a, true);
      this.asteroids.push(a);
    }
    // World-space (moves with the system), above the ship/planets.
    this.gameLayer.addChild(this.asteroidContainer);
  }

  /** Draw an irregular grey rock (or a comet with solar-wind tail). */
  private drawAsteroid(a: AsteroidMote): void {
    const g = a.graphics;
    g.clear();
    const r = a.comet ? 13 + Math.random() * 5 : 9 + Math.random() * 14;
    if (a.comet) {
      // Tail in local +x direction; rotation is updated each frame so +x always
      // points anti-sunward (solar wind blows tail away from the star).
      // Photorealistic look: many overlapping narrow wedges at slightly different
      // angles accumulate into a smooth volumetric gradient — no solid triangles.

      // DUST TAIL — 10 wedge layers fanning across ±14° total spread
      const dustColor = 0xd0e0ff;
      for (let i = 0; i < 10; i++) {
        const ang = (i / 9 - 0.5) * 0.24; // ±0.12 rad ≈ ±7°
        const len = r * (28 - i * 0.6);
        const hw = r * (2.6 - i * 0.08); // half-width at origin
        g.poly([Math.cos(ang) * len, Math.sin(ang) * len, 0, -hw, 0, hw]).fill({
          color: dustColor,
          alpha: 0.028,
        });
      }
      // Brighter inner spine — tight wedges
      for (let i = 0; i < 6; i++) {
        const ang = (i / 5 - 0.5) * 0.07;
        const len = r * 18;
        const hw = r * 0.8;
        g.poly([Math.cos(ang) * len, Math.sin(ang) * len, 0, -hw, 0, hw]).fill({
          color: 0xe8f0ff,
          alpha: 0.045,
        });
      }
      // ION TAIL — straight, narrow, blue-white
      g.poly([
        r * 38,
        r * 0.18,
        r * 38,
        -r * 0.18,
        0,
        -r * 0.3,
        0,
        r * 0.3,
      ]).fill({ color: 0x7aacff, alpha: 0.13 });
      g.poly([
        r * 30,
        r * 0.11,
        r * 30,
        -r * 0.11,
        0,
        -r * 0.18,
        0,
        r * 0.18,
      ]).fill({ color: 0x99c2ff, alpha: 0.2 });

      // COMA — stacked diffuse halos around the nucleus
      g.circle(0, 0, r * 5.0).fill({ color: 0x80a8d0, alpha: 0.03 });
      g.circle(0, 0, r * 3.2).fill({ color: 0xa0c0e0, alpha: 0.06 });
      g.circle(0, 0, r * 2.0).fill({ color: 0xc0d8f0, alpha: 0.1 });
      g.circle(0, 0, r * 1.2).fill({ color: 0xd8eaff, alpha: 0.18 });

      // NUCLEUS — icy, compact, with a hot interior point
      g.circle(0, 0, r * 0.9).fill({ color: 0xcce4ff, alpha: 0.92 });
      g.circle(0, 0, r * 0.45).fill({ color: 0xeef6ff, alpha: 0.96 });
      g.circle(0, 0, r * 0.15).fill({ color: 0xffffff, alpha: 1.0 });
    } else {
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
      // Elliptical orbit around the star. Highly eccentric like real comets.
      a.orbitA = R * (0.38 + Math.random() * 0.5); // 38–88% of boundary
      a.orbitB = a.orbitA * (0.2 + Math.random() * 0.45); // b/a = 0.20–0.65
      a.orbitAngle = Math.random() * Math.PI * 2;
      a.orbitSpeed =
        (0.00004 + Math.random() * 0.00008) * (Math.random() < 0.5 ? 1 : -1);
      a.orbitTilt = Math.random() * Math.PI * 2;
      // Set initial world position from orbital parameters
      const cos = Math.cos(a.orbitAngle);
      const sin = Math.sin(a.orbitAngle);
      a.x =
        cx +
        a.orbitA * cos * Math.cos(a.orbitTilt) -
        a.orbitB * sin * Math.sin(a.orbitTilt);
      a.y =
        cy +
        a.orbitA * cos * Math.sin(a.orbitTilt) +
        a.orbitB * sin * Math.cos(a.orbitTilt);
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
        // Advance orbital angle (Kepler-lite: uniform angular speed)
        a.orbitAngle += a.orbitSpeed * deltaTime;
        const cos = Math.cos(a.orbitAngle);
        const sin = Math.sin(a.orbitAngle);
        a.x =
          cx +
          a.orbitA * cos * Math.cos(a.orbitTilt) -
          a.orbitB * sin * Math.sin(a.orbitTilt);
        a.y =
          cy +
          a.orbitA * cos * Math.sin(a.orbitTilt) +
          a.orbitB * sin * Math.cos(a.orbitTilt);
        a.graphics.x = a.x;
        a.graphics.y = a.y;
        // Tail points away from the star (solar wind). local +x → anti-sunward.
        const sunDx = a.x - cx;
        const sunDy = a.y - cy;
        a.graphics.rotation = Math.atan2(sunDy, sunDx);
        // Tail visible only in the inner system (orbit 2-3 zone ≈ 1050–1950 px).
        // Fade in from 2200 px, fully visible inside 1500 px.
        const dist = Math.hypot(sunDx, sunDy);
        const FULL = 1500;
        const FADE = 2200;
        a.graphics.alpha =
          dist <= FULL
            ? 1
            : dist >= FADE
              ? 0
              : 1 - (dist - FULL) / (FADE - FULL);
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
