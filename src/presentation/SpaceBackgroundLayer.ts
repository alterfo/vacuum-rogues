import { Container, Graphics, Sprite } from "pixi.js";
import {
  nebulaCloudTexture,
  softGlowTexture,
  starPointTexture,
} from "./gradientTexture";
import type { Renderer } from "./Renderer";
import { SeededRNG } from "@/utils/seededRNG";
import type { FlightModule } from "./flight/FlightModule";
import { BACKGROUND_DIM } from "@/config/balance";

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

interface NebulaLayer {
  container: Container;
  driftX: number;
  driftY: number;
  pulseAmp: number;
  pulseSpeed: number;
  phase: number;
  baseAlpha: number;
}

interface TwinkleStar {
  graphics: Graphics | Sprite;
  baseAlpha: number;
  phase: number;
  speed: number;
}

interface StarLayer {
  container: Container;
  depth: number;
  zoomDepth: number;
}

interface SwarmLayer {
  container: Container;
  driftX: number;
  driftY: number;
  pulseSpeed: number;
  pulseAmp: number;
  phase: number;
  baseAlpha: number;
  rotSpeed: number;
}

export interface BackgroundCamera {
  panX: number;
  panY: number;
  zoom: number;
}

export interface BackgroundShipVelocity {
  angle: number;
  speed: number;
}

export class SpaceBackgroundLayer implements FlightModule {
  private readonly renderer: Renderer;
  private readonly skyContainer: Container;
  private readonly systemId: string;
  private readonly getCamera: () => BackgroundCamera;

  private readonly midground = new Container();

  private readonly activeComets: CometStreak[] = [];
  private cometTimer = 0;
  private cometNextSpawn = 0;
  private readonly bgShips: BgShip[] = [];
  private readonly dustParticles: DustParticle[] = [];

  private readonly starLayers: StarLayer[] = [];
  private nebulaeContainer: Container | null = null;
  private readonly nebulaLayers: NebulaLayer[] = []; // Animated nebula clouds
  private readonly twinkleStars: TwinkleStar[] = []; // Bright "hero" stars that pulse
  private twinkleContainer: Container | null = null; // parallaxed with the near layer
  private readonly swarmLayers: SwarmLayer[] = []; // Glowing swarms in the nebula

  private vignette: Graphics | null = null;

  private dimmer: Graphics | null = null;

  constructor(
    renderer: Renderer,
    skyContainer: Container,
    systemId: string,
    getCamera: () => BackgroundCamera,
    _getShipVelocity: () => BackgroundShipVelocity | null,
  ) {
    this.renderer = renderer;
    this.skyContainer = skyContainer;
    this.systemId = systemId;
    this.getCamera = getCamera;
  }

  private get width(): number {
    return this.renderer.app.screen.width;
  }

  private get height(): number {
    return this.renderer.app.screen.height;
  }

  initialize(): void {
    this.createNebulae(); // Screen-space nebula clouds (skyContainer) + swarms
    this.createStarField(); // Crisp far stars (screen-fixed)
    this.createTwinkleStars(); // Bright pulsing hero stars (screen-fixed)
    this.createDimmer(); // Readability dimmer above the whole sky (F2)
    this.createVignette();
    this.initMidground();
  }

  update(_dt: number, bgElapsed: number): void {
    this.updateBgShips(_dt);
    this.updateDustParticles(_dt);
    this.updateComets(_dt);
    this.updateStarField();
    this.updateNebulae(bgElapsed);
    this.updateSwarms(bgElapsed);
    this.updateTwinkleStars(bgElapsed);
  }

  setVisible(visible: boolean): void {
    this.midground.visible = visible;
    if (this.vignette) this.vignette.visible = visible;
  }

  destroy(): void {
    for (const c of this.activeComets) {
      c.g.destroy();
    }
    if (this.midground.parent) {
      this.midground.parent.removeChild(this.midground);
    }
    if (!this.midground.destroyed) {
      this.midground.destroy({ children: true });
    }

    if (this.vignette?.parent) {
      this.vignette.parent.removeChild(this.vignette);
    }

    this.nebulaeContainer = null;
    this.twinkleContainer = null;
    this.vignette = null;
    this.dimmer = null;
    this.starLayers.length = 0;
    this.nebulaLayers.length = 0;
    this.twinkleStars.length = 0;
    this.swarmLayers.length = 0;
    this.activeComets.length = 0;
    this.bgShips.length = 0;
    this.dustParticles.length = 0;
  }

  private lightenColor(color: number, amount: number): number {
    const r = (color >> 16) & 0xff;
    const g = (color >> 8) & 0xff;
    const b = color & 0xff;
    const lr = Math.round(r + (255 - r) * amount);
    const lg = Math.round(g + (255 - g) * amount);
    const lb = Math.round(b + (255 - b) * amount);
    return (lr << 16) | (lg << 8) | lb;
  }

  private createStarField(): void {
    const width = this.renderer.app.screen.width;
    const height = this.renderer.app.screen.height;

    const cx = width / 2;
    const cy = height / 2;
    const layerConfigs = [
      {
        count: 5200,
        depth: 0.006,
        zoomDepth: 0.0,
        size: [0.35, 0.85],
        alpha: [0.22, 0.6],
        spread: 1.0,
      },
      {
        count: 1800,
        depth: 0.025,
        zoomDepth: 0.03,
        size: [0.6, 1.5],
        alpha: [0.4, 0.85],
        spread: 1.3,
      },
      {
        count: 480,
        depth: 0.05,
        zoomDepth: 0.05,
        size: [1.1, 2.1],
        alpha: [0.55, 0.95],
        spread: 1.4,
      },
    ];

    const starColorPool: number[] = [];
    const pushColors = (c: number, w: number) => {
      for (let i = 0; i < w; i++) starColorPool.push(c);
    };
    pushColors(0xe8f2ff, 35); // blue-white (dominant)
    pushColors(0xffffff, 20); // pure white
    pushColors(0xccddff, 12); // cool blue
    pushColors(0xfff5e0, 12); // warm yellow-white
    pushColors(0xffd0d0, 10); // nebula-lit pink
    pushColors(0xffc090, 7); // warm orange
    pushColors(0xddccff, 4); // faint violet

    for (const config of layerConfigs) {
      const container = new Container();

      for (let i = 0; i < config.count; i++) {
        const fw = width * config.spread;
        const fh = height * config.spread;
        const x = (Math.random() * 2 - 1) * fw;
        const y = (Math.random() * 2 - 1) * fh;
        const size =
          config.size[0] + Math.random() * (config.size[1] - config.size[0]);
        const alpha =
          config.alpha[0] + Math.random() * (config.alpha[1] - config.alpha[0]);

        const graphics = new Graphics();
        graphics.circle(x, y, size);
        graphics.fill({
          color:
            starColorPool[Math.floor(Math.random() * starColorPool.length)],
          alpha,
        });
        container.addChild(graphics);
      }

      container.x = cx; // field centre starts at screen centre
      container.y = cy;
      this.starLayers.push({
        container,
        depth: config.depth,
        zoomDepth: config.zoomDepth,
      });
      this.skyContainer.addChild(container); // Crisp, screen-fixed backdrop
    }
  }

  private createTwinkleStars(): void {
    const width = this.renderer.app.screen.width;
    const height = this.renderer.app.screen.height;
    const container = new Container();
    const twinkleColors = [
      { c: 0xffffff, w: 8 }, // pure white
      { c: 0xe0eeff, w: 12 }, // blue-white (most common)
      { c: 0xfff5cc, w: 6 }, // warm yellow
      { c: 0xffcccc, w: 5 }, // nebula pink
      { c: 0xffddaa, w: 4 }, // warm orange
      { c: 0xccddff, w: 5 }, // cool blue
    ];
    const twinklePool: number[] = [];
    for (const { c, w } of twinkleColors) {
      for (let k = 0; k < w; k++) twinklePool.push(c);
    }

    const count = 170;
    const heroTex = starPointTexture(true);
    const normalTex = starPointTexture(false);

    for (let i = 0; i < count; i++) {
      const x = Math.random() * width * 2.2 - width * 0.6;
      const y = Math.random() * height * 2.2 - height * 0.6;
      const color = twinklePool[Math.floor(Math.random() * twinklePool.length)];
      const isHero = Math.random() < 0.15;
      const r = isHero
        ? 2.2 + Math.random() * 1.4 // bright hero star
        : 1.1 + Math.random() * 1.4; // normal bright star
      const baseAlpha = 0.55 + Math.random() * 0.45;

      const tex = isHero ? heroTex : normalTex;
      let display: Graphics | Sprite;
      if (tex) {
        const sprite = new Sprite(tex);
        sprite.anchor.set(0.5);
        sprite.tint = color;
        const outerRadius = r * (isHero ? 4.2 : 3.4);
        sprite.scale.set(outerRadius / (tex.width / 2));
        display = sprite;
      } else {
        const g = new Graphics();
        g.circle(0, 0, r * 5).fill({ color, alpha: 0.06 });
        g.circle(0, 0, r * 2.8).fill({ color, alpha: 0.18 });
        g.circle(0, 0, r).fill({ color, alpha: 1 });
        display = g;
      }
      display.x = x;
      display.y = y;
      display.alpha = baseAlpha;
      container.addChild(display);

      this.twinkleStars.push({
        graphics: display,
        baseAlpha,
        phase: Math.random() * Math.PI * 2,
        speed: 0.0008 + Math.random() * 0.0018,
      });
    }

    this.skyContainer.addChild(container);
    this.twinkleContainer = container;
  }

  private createNebulae(): void {
    this.nebulaeContainer = new Container();
    this.nebulaeContainer.eventMode = "none";

    const systemId = this.systemId;
    const rng = new SeededRNG(`nebula_${systemId}`);

    const sw = this.renderer.app.screen.width;
    const sh = this.renderer.app.screen.height;

    const palettes = [
      [0x6e0a00, 0xcc2000, 0xff4400, 0xff8800, 0xffbb22], // red — warm red-orange
      [0x05082a, 0x0d1a88, 0x2244cc, 0x4466ff, 0x88aaff], // blue — deep blue-violet
      [0x002a14, 0x0a7a3a, 0x18cc66, 0x44ffaa, 0xaaffcc], // green — emerald
      [0x00222a, 0x067a7a, 0x10cccc, 0x44ffff, 0xaaffff], // teal — cyan
    ];
    const palIdx = rng.nextInt(0, palettes.length - 1);
    const palette = palettes[palIdx];
    const cloudCount = rng.nextInt(4, 6);

    for (let c = 0; c < cloudCount; c++) {
      const cloud = new Container();
      cloud.x = rng.nextFloat(-sw * 0.7, sw * 0.7);
      cloud.y = rng.nextFloat(-sh * 0.7, sh * 0.7);

      const bodyColor = palette[rng.nextInt(1, 2)];

      const cloudR = rng.nextFloat(200, 450);
      const squash = rng.nextFloat(0.45, 0.92);
      const rot = rng.next() * Math.PI;

      const nebulaTex = nebulaCloudTexture(rng.nextInt(0, 999));
      if (nebulaTex) {
        const s = new Sprite(nebulaTex);
        s.anchor.set(0.5);
        s.eventMode = "none";
        s.width = cloudR * 2.2;
        s.height = cloudR * 2.2 * squash;
        s.rotation = rot;
        s.tint = bodyColor;
        s.alpha = 0.55;
        cloud.addChild(s);
      } else {
        const outerColor = palette[0];
        const innerColor = palette[3];
        const coreColor = palette[4];
        const outerG = new Graphics();
        for (let b = 0; b < 24; b++) {
          const ang = rng.next() * Math.PI * 2;
          const dist = rng.next() * cloudR;
          let bx = Math.cos(ang) * dist;
          let by = Math.sin(ang) * dist * squash;
          const rx = bx * Math.cos(rot) - by * Math.sin(rot);
          const ry = bx * Math.sin(rot) + by * Math.cos(rot);
          bx = rx;
          by = ry;
          const r = rng.nextFloat(55, 140) * (1 - (dist / cloudR) * 0.3);
          outerG
            .circle(bx, by, r)
            .fill({ color: outerColor, alpha: rng.nextFloat(0.05, 0.12) });
        }
        cloud.addChild(outerG);

        const bodyG = new Graphics();
        for (let b = 0; b < 32; b++) {
          const ang = rng.next() * Math.PI * 2;
          const dist = rng.next() * rng.next() * cloudR * 0.85;
          let bx = Math.cos(ang) * dist;
          let by = Math.sin(ang) * dist * squash;
          const rx = bx * Math.cos(rot) - by * Math.sin(rot);
          const ry = bx * Math.sin(rot) + by * Math.cos(rot);
          bx = rx;
          by = ry;
          const r = rng.nextFloat(35, 100) * (1 - (dist / cloudR) * 0.55);
          bodyG
            .circle(bx, by, r)
            .fill({ color: bodyColor, alpha: rng.nextFloat(0.08, 0.2) });
        }
        cloud.addChild(bodyG);

        const innerG = new Graphics();
        for (let b = 0; b < 16; b++) {
          const ang = rng.next() * Math.PI * 2;
          const dist = rng.next() * rng.next() * cloudR * 0.42;
          let bx = Math.cos(ang) * dist;
          let by = Math.sin(ang) * dist * squash;
          const rx = bx * Math.cos(rot) - by * Math.sin(rot);
          const ry = bx * Math.sin(rot) + by * Math.cos(rot);
          bx = rx;
          by = ry;
          const r = rng.nextFloat(18, 55);
          innerG
            .circle(bx, by, r)
            .fill({ color: innerColor, alpha: rng.nextFloat(0.12, 0.28) });
        }
        cloud.addChild(innerG);

        const coreG = new Graphics();
        const coreCount = rng.nextInt(1, 3);
        for (let e = 0; e < coreCount; e++) {
          const ex = rng.nextFloat(-cloudR * 0.15, cloudR * 0.15);
          const ey = rng.nextFloat(-cloudR * 0.15, cloudR * 0.15) * squash;
          const cr = rng.nextFloat(10, 28);
          coreG
            .circle(ex, ey, cr * 2.2)
            .fill({ color: coreColor, alpha: rng.nextFloat(0.08, 0.16) });
          coreG
            .circle(ex, ey, cr)
            .fill({ color: coreColor, alpha: rng.nextFloat(0.22, 0.42) });
        }
        cloud.addChild(coreG);
      }

      cloud.blendMode = "screen";
      cloud.eventMode = "none";

      this.nebulaeContainer.addChild(cloud);
      this.nebulaLayers.push({
        container: cloud,
        driftX: rng.nextFloat(-0.004, 0.004),
        driftY: rng.nextFloat(-0.004, 0.004),
        pulseAmp: rng.nextFloat(0.08, 0.18),
        pulseSpeed: rng.nextFloat(0.0003, 0.0009),
        phase: rng.next() * Math.PI * 2,
        baseAlpha: 1,
      });
    }

    this.createSwarms(rng, palette);
    this.createNebulaPillars(rng, sw, sh);

    this.skyContainer.addChild(this.nebulaeContainer);
  }

  private createSwarms(rng: SeededRNG, palette: number[]): void {
    if (!this.nebulaeContainer) return;

    const sw = this.renderer.app.screen.width;
    const sh = this.renderer.app.screen.height;
    const swarmCount = rng.nextInt(3, 6);

    for (let s = 0; s < swarmCount; s++) {
      const container = new Container();
      container.x = rng.nextFloat(-sw * 0.55, sw * 0.55);
      container.y = rng.nextFloat(-sh * 0.55, sh * 0.55);

      const tint = this.lightenColor(
        palette[rng.nextInt(0, palette.length - 1)],
        0.6,
      );
      const spread = rng.nextFloat(50, 110);
      const motes = rng.nextInt(22, 44);

      const g = new Graphics();
      for (let m = 0; m < motes; m++) {
        const ang = rng.next() * Math.PI * 2;
        const dist = rng.next() * rng.next() * spread;
        const mx = Math.cos(ang) * dist;
        const my = Math.sin(ang) * dist;
        const r = rng.nextFloat(0.6, 1.8);
        g.circle(mx, my, r * 1.6).fill({ color: tint, alpha: 0.08 });
        g.circle(mx, my, r).fill({ color: tint, alpha: 0.7 });
      }
      container.addChild(g);
      this.nebulaeContainer.addChild(container);

      this.swarmLayers.push({
        container,
        driftX: rng.nextFloat(-0.005, 0.005),
        driftY: rng.nextFloat(-0.005, 0.005),
        pulseSpeed: rng.nextFloat(0.0006, 0.0014),
        pulseAmp: rng.nextFloat(0.12, 0.22),
        phase: rng.next() * Math.PI * 2,
        baseAlpha: rng.nextFloat(0.22, 0.45), // much subtler than before
        rotSpeed: rng.nextFloat(-0.0002, 0.0002), // slow organic spin (rad/frame)
      });
    }
  }

  private createNebulaPillars(rng: SeededRNG, sw: number, sh: number): void {
    if (!this.nebulaeContainer) return;

    const pillarCount = rng.nextInt(3, 5);
    const glowTex = softGlowTexture();
    for (let p = 0; p < pillarCount; p++) {
      const cx = rng.nextFloat(-sw * 0.35, sw * 0.35);
      const cy = rng.nextFloat(-sh * 0.35, sh * 0.35);
      const tilt = rng.nextFloat(-Math.PI * 0.45, Math.PI * 0.45);

      if (glowTex) {
        const pillar = new Sprite(glowTex);
        pillar.anchor.set(0.5);
        pillar.eventMode = "none";
        pillar.x = cx;
        pillar.y = cy;
        pillar.width = rng.nextFloat(80, 130);
        pillar.height = rng.nextFloat(240, 360);
        pillar.rotation = tilt;
        pillar.tint = 0x000000;
        pillar.alpha = rng.nextFloat(0.5, 0.72);
        pillar.blendMode = "multiply";
        this.nebulaeContainer.addChild(pillar);
        continue;
      }

      const g = new Graphics();
      const segments = rng.nextInt(3, 5);
      for (let s = 0; s < segments; s++) {
        const along = rng.nextFloat(-80, 80); // offset along the pillar axis
        const perp = rng.nextFloat(-18, 18); // slight wobble perpendicular
        const ex = cx + Math.cos(tilt) * along - Math.sin(tilt) * perp;
        const ey = cy + Math.sin(tilt) * along + Math.cos(tilt) * perp;
        const w = rng.nextFloat(22, 48);
        const h = rng.nextFloat(65, 150);
        g.ellipse(ex, ey, w, h);
        g.fill({ color: 0x000000, alpha: rng.nextFloat(0.55, 0.82) });
      }
      const pillarC = new Container();
      pillarC.addChild(g);
      pillarC.rotation = tilt;
      pillarC.blendMode = "multiply";
      pillarC.eventMode = "none";
      this.nebulaeContainer.addChild(pillarC);
    }
  }

  private updateSwarms(bgElapsed: number): void {
    for (const s of this.swarmLayers) {
      s.container.x += s.driftX;
      s.container.y += s.driftY;
      s.container.rotation += s.rotSpeed;
      const pulse =
        1 + Math.sin(bgElapsed * s.pulseSpeed + s.phase) * s.pulseAmp;
      s.container.alpha = Math.max(0, Math.min(1, s.baseAlpha * pulse));
    }
  }

  private positionNebulae(): void {
    const NEBULA_DEPTH = 0.04;
    if (this.nebulaeContainer) {
      const cam = this.getCamera();
      const cx = this.renderer.app.screen.width / 2;
      const cy = this.renderer.app.screen.height / 2;
      this.nebulaeContainer.x = cx + cam.panX * NEBULA_DEPTH;
      this.nebulaeContainer.y = cy + cam.panY * NEBULA_DEPTH;
    }
  }

  private updateNebulae(bgElapsed: number): void {
    this.positionNebulae();

    const DRIFT_X = 0.006;
    const DRIFT_Y = 0.004;
    for (const n of this.nebulaLayers) {
      n.container.x += n.driftX + DRIFT_X;
      n.container.y += n.driftY + DRIFT_Y;
      const pulse =
        1 + Math.sin(bgElapsed * n.pulseSpeed + n.phase) * n.pulseAmp;
      n.container.alpha = Math.max(0, Math.min(1, n.baseAlpha * pulse));
      const s = 1 + Math.sin(bgElapsed * n.pulseSpeed * 0.7 + n.phase) * 0.03;
      n.container.scale.set(s);
    }
  }

  private updateTwinkleStars(bgElapsed: number): void {
    for (const s of this.twinkleStars) {
      const t = 0.55 + 0.45 * Math.sin(bgElapsed * s.speed + s.phase);
      s.graphics.alpha = s.baseAlpha * t;
    }
  }

  private updateStarField(): void {
    const cam = this.getCamera();
    const cx = this.renderer.app.screen.width / 2;
    const cy = this.renderer.app.screen.height / 2;

    for (const layer of this.starLayers) {
      const s = Math.max(0.4, 1 + (cam.zoom - 1) * layer.zoomDepth);
      layer.container.scale.set(s);
      layer.container.x = cx + cam.panX * layer.depth;
      layer.container.y = cy + cam.panY * layer.depth;
    }

    if (this.twinkleContainer) {
      this.twinkleContainer.x = cx + cam.panX * 0.05;
      this.twinkleContainer.y = cy + cam.panY * 0.05;
    }
  }

  private createDimmer(): void {
    if (this.dimmer) return; // initialize() must not stack a second overlay
    const d = new Graphics();
    d.rect(
      -this.width * 0.25,
      -this.height * 0.25,
      this.width * 1.5,
      this.height * 1.5,
    );
    d.fill({ color: 0x000000, alpha: 1 });
    d.alpha = BACKGROUND_DIM;
    d.eventMode = "none";
    this.dimmer = d;
    this.skyContainer.addChild(d);
  }

  private createVignette(): void {
    const width = this.renderer.app.screen.width;
    const height = this.renderer.app.screen.height;

    const v = new Graphics();
    const bands = 16;
    for (let i = 0; i < bands; i++) {
      const inset = i * 16;
      const alpha = 0.06 * (1 - i / bands);
      v.rect(inset, inset, width - 2 * inset, height - 2 * inset);
      v.stroke({ width: 32, color: 0x000000, alpha });
    }
    v.eventMode = "none"; // never intercept clicks
    this.vignette = v;
    this.renderer.uiLayer.addChild(v);
  }

  private initMidground(): void {
    this.midground.eventMode = "none";
    this.renderer.stage.addChildAt(this.midground, 1);

    const rng = new SeededRNG(`bgLayer_${this.systemId}`);

    this.createBgShips(rng);
    this.createDustParticles(rng);

    this.cometNextSpawn = rng.nextFloat(15000, 40000);
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
      this.midground.addChild(g);
    }
  }

  private drawBgShip(g: Graphics, angle: number): void {
    g.clear();
    const len = 11;
    const hw = 3;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
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
      this.midground.addChild(g);
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
        this.midground.removeChild(c.g);
        c.g.destroy();
        this.activeComets.splice(i, 1);
      }
    }
  }

  private spawnComet(): void {
    const { width: w, height: h } = this;
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
    const speed = 0.09 + Math.random() * 0.06;
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed;
    const maxLife = (Math.max(w, h) * 1.6) / speed;

    const g = new Graphics();
    g.eventMode = "none";
    const tailAngle = Math.atan2(-vy, -vx);
    const tailLen = 55 + Math.random() * 55;
    for (let i = 0; i < 3; i++) {
      const spread = (i / 2 - 0.5) * 0.22;
      const ta = tailAngle + spread;
      const tl = tailLen * (1 - Math.abs(spread) * 1.4);
      const hw = 3.5 - Math.abs(spread) * 10;
      if (hw <= 0) continue;
      g.poly([Math.cos(ta) * tl, Math.sin(ta) * tl, 0, -hw, 0, hw]).fill({
        color: 0xfff6e0,
        alpha: 0.05,
      });
    }
    g.poly([
      Math.cos(tailAngle) * tailLen,
      Math.sin(tailAngle) * tailLen,
      0,
      -1.2,
      0,
      1.2,
    ]).fill({ color: 0xfffdf5, alpha: 0.3 });
    g.circle(0, 0, 3).fill({ color: 0xfffdf5, alpha: 0.7 });
    g.circle(0, 0, 1.3).fill({ color: 0xffffff, alpha: 1 });

    g.x = sx;
    g.y = sy;
    g.alpha = 0;
    this.midground.addChild(g);
    this.activeComets.push({ g, x: sx, y: sy, vx, vy, life: maxLife, maxLife });
  }
}
