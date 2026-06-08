import { Container, Graphics } from "pixi.js";
import { SeededRNG } from "@/utils/seededRNG";

interface DriftAsteroid {
  g: Graphics;
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
  rot: number;
}

interface CometStreak {
  g: Graphics;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
}

interface BgShip {
  g: Graphics;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface DustParticle {
  g: Graphics;
  x: number;
  y: number;
  depth: number;
}

/**
 * Screen-fixed parallax background layer sitting between the deep-space skybox
 * and the game world. Provides slow-drifting asteroids, occasional comet
 * streaks, background silhouette ships, and parallax dust motes.
 * Does NOT receive camera transforms — objects wrap at screen edges.
 */
export class SpaceBackgroundLayer {
  private readonly container: Container;
  private readonly width: number;
  private readonly height: number;

  private readonly driftAsteroids: DriftAsteroid[] = [];
  private readonly activeComets: CometStreak[] = [];
  private cometTimer = 0;
  private cometNextSpawn: number;
  private readonly bgShips: BgShip[] = [];
  private readonly dustParticles: DustParticle[] = [];

  // "Toward camera" asteroid: periodically scales 0.3→1.5 and fades out
  private readonly camAstG: Graphics;
  private camAstX = 0;
  private camAstY = 0;
  private camAstIdle = true;
  private camAstTimer: number;
  private camAstElapsed = 0;
  private camAstDuration = 5000;

  constructor(
    parentContainer: Container,
    insertIndex: number,
    width: number,
    height: number,
    systemId: string,
  ) {
    this.width = width;
    this.height = height;

    this.container = new Container();
    this.container.eventMode = "none";
    parentContainer.addChildAt(this.container, insertIndex);

    const rng = new SeededRNG(`bgLayer_${systemId}`);

    this.createDriftAsteroids(rng);
    this.createBgShips(rng);
    this.createDustParticles(rng);

    // Camera asteroid placeholder — positioned and activated on first trigger
    this.camAstG = this.buildCamAsteroid();
    this.camAstG.alpha = 0;
    this.container.addChild(this.camAstG);
    this.camAstTimer = rng.nextFloat(60000, 90000);

    this.cometNextSpawn = rng.nextFloat(15000, 40000);
  }

  // ---------------------------------------------------------------------------
  // Construction helpers
  // ---------------------------------------------------------------------------

  private createDriftAsteroids(rng: SeededRNG): void {
    const count = rng.nextInt(8, 12);
    for (let i = 0; i < count; i++) {
      const g = new Graphics();
      g.eventMode = "none";
      const size = rng.nextFloat(4, 14);
      this.drawIrregularRock(g, size, rng);
      const a: DriftAsteroid = {
        g,
        x: rng.nextFloat(0, this.width),
        y: rng.nextFloat(0, this.height),
        vx: rng.nextFloat(-0.014, 0.014),
        vy: rng.nextFloat(-0.014, 0.014),
        spin: rng.nextFloat(-0.0006, 0.0006),
        rot: rng.nextFloat(0, Math.PI * 2),
      };
      g.x = a.x;
      g.y = a.y;
      g.rotation = a.rot;
      this.driftAsteroids.push(a);
      this.container.addChild(g);
    }
  }

  private drawIrregularRock(g: Graphics, r: number, rng: SeededRNG): void {
    const sides = 7;
    const pts: number[] = [];
    for (let i = 0; i < sides; i++) {
      const ang = (i / sides) * Math.PI * 2;
      const rr = r * (0.65 + rng.next() * 0.55);
      pts.push(Math.cos(ang) * rr, Math.sin(ang) * rr);
    }
    g.poly(pts).fill({ color: 0x6b6256, alpha: 0.55 });
    g.poly(pts).stroke({ width: 0.8, color: 0x2a251f, alpha: 0.35 });
  }

  private createBgShips(rng: SeededRNG): void {
    const count = rng.nextInt(1, 2);
    for (let i = 0; i < count; i++) {
      const angle = rng.nextFloat(0, Math.PI * 2);
      const speed = rng.nextFloat(0.006, 0.013);
      const g = new Graphics();
      g.eventMode = "none";
      this.drawBgShip(g, angle);
      const s: BgShip = {
        g,
        x: rng.nextFloat(0, this.width),
        y: rng.nextFloat(0, this.height),
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
      };
      g.x = s.x;
      g.y = s.y;
      this.bgShips.push(s);
      this.container.addChild(g);
    }
  }

  private drawBgShip(g: Graphics, angle: number): void {
    g.clear();
    const len = 11;
    const hw = 3;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    // Elongated hull
    g.poly([
      cos * len - sin * hw,
      sin * len + cos * hw,
      cos * len + sin * hw,
      sin * len - cos * hw,
      -cos * len + sin * hw,
      -sin * len - cos * hw,
      -cos * len - sin * hw,
      -sin * len + cos * hw,
    ]).fill({ color: 0x8899aa, alpha: 0.3 });
    // Engine glow at the tail
    g.circle(-cos * (len - 1), -sin * (len - 1), 2).fill({
      color: 0x66aaff,
      alpha: 0.4,
    });
  }

  private createDustParticles(rng: SeededRNG): void {
    const count = 28;
    for (let i = 0; i < count; i++) {
      const depth = rng.nextFloat(0.3, 1.0);
      const r = rng.nextFloat(0.5, 1.8);
      const alpha = rng.nextFloat(0.1, 0.32) * depth;
      const g = new Graphics();
      g.eventMode = "none";
      g.circle(0, 0, r).fill({ color: 0xaabbcc, alpha });
      const p: DustParticle = {
        g,
        x: rng.nextFloat(0, this.width),
        y: rng.nextFloat(0, this.height),
        depth,
      };
      g.x = p.x;
      g.y = p.y;
      this.dustParticles.push(p);
      this.container.addChild(g);
    }
  }

  private buildCamAsteroid(): Graphics {
    const g = new Graphics();
    g.eventMode = "none";
    const pts: number[] = [];
    const r = 20;
    const sides = 8;
    for (let i = 0; i < sides; i++) {
      const ang = (i / sides) * Math.PI * 2;
      const rr = r * (0.7 + (i % 3 === 0 ? 0.35 : 0.15));
      pts.push(Math.cos(ang) * rr, Math.sin(ang) * rr);
    }
    g.poly(pts).fill({ color: 0x554e47, alpha: 0.75 });
    g.poly(pts).stroke({ width: 1, color: 0x2a2520, alpha: 0.45 });
    g.circle(-6, -4, 4).fill({ color: 0x3e3830, alpha: 0.55 });
    g.circle(5, 6, 3).fill({ color: 0x3e3830, alpha: 0.5 });
    return g;
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------

  update(dt: number): void {
    this.updateDriftAsteroids(dt);
    this.updateBgShips(dt);
    this.updateDustParticles(dt);
    this.updateComets(dt);
    this.updateCamAsteroid(dt);
  }

  private updateDriftAsteroids(dt: number): void {
    const { width: w, height: h } = this;
    for (const a of this.driftAsteroids) {
      a.x += a.vx * dt;
      a.y += a.vy * dt;
      a.rot += a.spin * dt;
      if (a.x < -30) a.x += w + 60;
      else if (a.x > w + 30) a.x -= w + 60;
      if (a.y < -30) a.y += h + 60;
      else if (a.y > h + 30) a.y -= h + 60;
      a.g.x = a.x;
      a.g.y = a.y;
      a.g.rotation = a.rot;
    }
  }

  private updateBgShips(dt: number): void {
    const { width: w, height: h } = this;
    for (const s of this.bgShips) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (s.x < -25) s.x += w + 50;
      else if (s.x > w + 25) s.x -= w + 50;
      if (s.y < -25) s.y += h + 50;
      else if (s.y > h + 25) s.y -= h + 50;
      s.g.x = s.x;
      s.g.y = s.y;
    }
  }

  private updateDustParticles(dt: number): void {
    const { width: w } = this;
    for (const p of this.dustParticles) {
      p.x += 0.003 * p.depth * dt;
      if (p.x > w + 5) p.x -= w + 10;
      p.g.x = p.x;
    }
  }

  private updateComets(dt: number): void {
    const { width: w, height: h } = this;

    this.cometTimer += dt;
    if (this.cometTimer >= this.cometNextSpawn) {
      this.cometTimer = 0;
      this.cometNextSpawn = 15000 + Math.random() * 25000;
      this.spawnComet();
    }

    for (let i = this.activeComets.length - 1; i >= 0; i--) {
      const c = this.activeComets[i];
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.life -= dt;
      const t = 1 - c.life / c.maxLife;
      // Fade in quickly, hold, then fade out near the end
      let alpha: number;
      if (t < 0.08) alpha = t / 0.08;
      else if (t > 0.88) alpha = (1 - t) / 0.12;
      else alpha = 1;
      c.g.alpha = alpha * 0.65;
      c.g.x = c.x;
      c.g.y = c.y;

      if (
        c.life <= 0 ||
        c.x < -200 ||
        c.x > w + 200 ||
        c.y < -200 ||
        c.y > h + 200
      ) {
        this.container.removeChild(c.g);
        c.g.destroy();
        this.activeComets.splice(i, 1);
      }
    }
  }

  private spawnComet(): void {
    const { width: w, height: h } = this;
    // Pick a random entry edge and aim toward the opposite half of the screen
    const side = Math.floor(Math.random() * 4);
    let sx: number, sy: number, angle: number;
    switch (side) {
      case 0: // top
        sx = Math.random() * w;
        sy = -20;
        angle = Math.PI * 0.3 + Math.random() * Math.PI * 0.4;
        break;
      case 1: // right
        sx = w + 20;
        sy = Math.random() * h;
        angle = Math.PI * 0.8 + Math.random() * Math.PI * 0.4;
        break;
      case 2: // bottom
        sx = Math.random() * w;
        sy = h + 20;
        angle = Math.PI * 1.3 + Math.random() * Math.PI * 0.4;
        break;
      default: // left
        sx = -20;
        sy = Math.random() * h;
        angle = -Math.PI * 0.2 + Math.random() * Math.PI * 0.4;
    }
    const speed = 0.28 + Math.random() * 0.18;
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed;
    const maxLife = (Math.max(w, h) * 1.6) / speed;

    const g = new Graphics();
    g.eventMode = "none";
    // Tail points opposite to the direction of travel
    const tailAngle = Math.atan2(-vy, -vx);
    const tailLen = 55 + Math.random() * 55;
    // Wide dust tail
    for (let i = 0; i < 6; i++) {
      const spread = (i / 5 - 0.5) * 0.22;
      const ta = tailAngle + spread;
      const tl = tailLen * (1 - Math.abs(spread) * 1.4);
      const hw = 3.5 - Math.abs(spread) * 10;
      if (hw <= 0) continue;
      g.poly([Math.cos(ta) * tl, Math.sin(ta) * tl, 0, -hw, 0, hw]).fill({
        color: 0xc0d8ff,
        alpha: 0.04,
      });
    }
    // Bright spine
    g.poly([
      Math.cos(tailAngle) * tailLen,
      Math.sin(tailAngle) * tailLen,
      0,
      -1.2,
      0,
      1.2,
    ]).fill({ color: 0xe8f4ff, alpha: 0.35 });
    // Nucleus
    g.circle(0, 0, 3.5).fill({ color: 0xd8eeff, alpha: 0.8 });
    g.circle(0, 0, 1.5).fill({ color: 0xffffff, alpha: 1 });

    g.x = sx;
    g.y = sy;
    g.alpha = 0;
    this.container.addChild(g);
    this.activeComets.push({ g, x: sx, y: sy, vx, vy, life: maxLife, maxLife });
  }

  private updateCamAsteroid(dt: number): void {
    if (this.camAstIdle) {
      this.camAstTimer -= dt;
      if (this.camAstTimer <= 0) {
        this.camAstIdle = false;
        this.camAstElapsed = 0;
        this.camAstDuration = 4500 + Math.random() * 2000;
        this.camAstX = this.width * 0.15 + Math.random() * this.width * 0.7;
        this.camAstY = this.height * 0.15 + Math.random() * this.height * 0.7;
        this.camAstG.x = this.camAstX;
        this.camAstG.y = this.camAstY;
        this.camAstG.scale.set(0.3);
        this.camAstG.alpha = 0;
      }
    } else {
      this.camAstElapsed += dt;
      const t = Math.min(this.camAstElapsed / this.camAstDuration, 1);
      const scale = 0.3 + t * 1.2;
      this.camAstG.scale.set(scale);
      // Fade in first half, fade out second half
      this.camAstG.alpha = t < 0.5 ? (t / 0.5) * 0.55 : ((1 - t) / 0.5) * 0.55;
      if (t >= 1) {
        this.camAstG.alpha = 0;
        this.camAstIdle = true;
        this.camAstTimer = 60000 + Math.random() * 30000;
      }
    }
  }

  // ---------------------------------------------------------------------------

  destroy(): void {
    // Destroy any live comet graphics not yet removed
    for (const c of this.activeComets) {
      c.g.destroy();
    }
    if (this.container.parent) {
      this.container.parent.removeChild(this.container);
    }
    this.container.destroy({ children: true });
  }
}
