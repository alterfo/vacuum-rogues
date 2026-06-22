import { Container, Graphics, Sprite } from "pixi.js";
import { softGlowTexture } from "./gradientTexture";
import type { Texture } from "pixi.js";
import type { Renderer } from "./Renderer";
import { SeededRNG } from "@/utils/seededRNG";
import type { FlightModule } from "./flight/FlightModule";
import { pickVariant, pickVariantKey, loadTextureAsync } from "./textures";
import { BACKGROUND_DIM } from "@/config/balance";

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
  graphics: Graphics;
  baseAlpha: number;
  phase: number;
  speed: number;
}

interface StarLayer {
  container: Container;
  // Parallax depth: on-screen pan shift = cameraPan * depth (smaller = farther
  // and slower). zoomDepth: how much the layer scales with camera zoom.
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
  // Slow organic spin (rad/frame) applied to the whole cluster so the swarm
  // feels alive rather than a static dot field. Tiny (±0.0002) → barely
  // perceptible per frame, like the existing per-frame drift.
  rotSpeed: number;
}

/** Camera state the parallax systems read each frame. */
export interface BackgroundCamera {
  panX: number;
  panY: number;
  zoom: number;
}

/** Ship velocity (heading + speed) the foreground dust streaks read. */
export interface BackgroundShipVelocity {
  angle: number;
  speed: number;
}

/**
 * Owns the entire flight background: the screen-fixed deep-space backdrop
 * (nebula clouds, star fields, glowing swarms, twinkle hero stars), the
 * mid-ground parallax layer (slow-drifting asteroids, comet streaks, silhouette
 * ships, parallax dust motes), the foreground speed-streak dust, and the edge
 * vignette.
 *
 * Sky elements live inside the injected `skyContainer` (a screen-space layer the
 * scene owns and tears down); the mid-ground sits just above it; dust + vignette
 * go on the renderer's UI layer. The layer never receives a camera transform —
 * its elements are individually parallaxed each frame from the injected camera
 * state, so panning/zooming never exposes a hard background edge.
 */
export class SpaceBackgroundLayer implements FlightModule {
  private readonly renderer: Renderer;
  private readonly skyContainer: Container;
  private readonly systemId: string;
  private readonly getCamera: () => BackgroundCamera;
  private destroyed = false;

  // Mid-ground parallax container (sits above the sky, below the game world).
  private readonly midground = new Container();

  private readonly driftAsteroids: DriftAsteroid[] = [];
  private readonly activeComets: CometStreak[] = [];
  private cometTimer = 0;
  private cometNextSpawn = 0;
  private readonly bgShips: BgShip[] = [];
  private readonly dustParticles: DustParticle[] = [];

  // "Toward camera" asteroid: periodically scales 0.3→1.5 and fades out
  private camAstG: Graphics | null = null;
  private camAstX = 0;
  private camAstY = 0;
  private camAstIdle = true;
  private camAstTimer = 0;
  private camAstElapsed = 0;
  private camAstDuration = 5000;

  // Screen-fixed deep-space backdrop systems (children of skyContainer).
  private nebulaBackdropSprite: Sprite | null = null;
  private readonly starLayers: StarLayer[] = [];
  private nebulaeContainer: Container | null = null;
  private readonly nebulaLayers: NebulaLayer[] = []; // Animated nebula clouds
  private readonly twinkleStars: TwinkleStar[] = []; // Bright "hero" stars that pulse
  private twinkleContainer: Container | null = null; // parallaxed with the near layer
  private readonly swarmLayers: SwarmLayer[] = []; // Glowing swarms in the nebula

  // Edge vignette (on the UI layer).
  private vignette: Graphics | null = null;

  // Readability dimmer: full-screen black overlay above all sky content (F2).
  private dimmer: Graphics | null = null;

  constructor(
    renderer: Renderer,
    skyContainer: Container,
    systemId: string,
    getCamera: () => BackgroundCamera,
    // Retained for the constructor contract (the scene + module-contract tests
    // pass a velocity provider). Its only consumer — the foreground speed-streak
    // dust — was removed: those 190 per-frame Graphics redraws hurt FPS and read
    // as "stretching stars".
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

  // ---------------------------------------------------------------------------
  // FlightModule lifecycle
  // ---------------------------------------------------------------------------

  initialize(): void {
    // Sky systems first (children of skyContainer): backdrop → nebulae → stars.
    this.createNebulae(); // Screen-space nebula clouds (skyContainer) + swarms
    this.createStarField(); // Crisp far stars (screen-fixed)
    this.createTwinkleStars(); // Bright pulsing hero stars (screen-fixed)
    this.createDimmer(); // Readability dimmer above the whole sky (F2)
    // Edge vignette (UI layer).
    this.createVignette();
    // Mid-ground parallax layer (between the sky and the game world).
    this.initMidground();
  }

  update(_dt: number, bgElapsed: number): void {
    // Mid-ground parallax.
    this.updateDriftAsteroids(_dt);
    this.updateBgShips(_dt);
    this.updateDustParticles(_dt);
    this.updateComets(_dt);
    this.updateCamAsteroid(_dt);
    // Screen-fixed sky parallax + animation.
    this.updateStarField();
    this.updateNebulae(bgElapsed);
    this.updateSwarms(bgElapsed);
    this.updateTwinkleStars(bgElapsed);
  }

  /**
   * Toggle every background sub-layer this module owns (mid-ground parallax,
   * edge vignette). The screen-fixed sky lives in the
   * scene-owned `skyContainer`, so the scene hides that separately — see
   * SpaceFlightScene.e2eSetBackgroundVisible. Used by E2E tests to get a clean
   * black background for lightweight, diff-friendly screenshots.
   */
  setVisible(visible: boolean): void {
    this.midground.visible = visible;
    if (this.vignette) this.vignette.visible = visible;
    // The readability dimmer is NOT toggled here: it is a child of
    // skyContainer, which the scene hides alongside this call, taking the
    // dimmer with it (no double-dark in E2E screenshots).
  }

  destroy(): void {
    this.destroyed = true;

    // Destroy any live comet graphics not yet removed.
    for (const c of this.activeComets) {
      c.g.destroy();
    }
    // Mid-ground container lives on renderer.stage — remove and destroy it.
    if (this.midground.parent) {
      this.midground.parent.removeChild(this.midground);
    }
    if (!this.midground.destroyed) {
      this.midground.destroy({ children: true });
    }

    // The vignette lives on the UI layer, which the host scene tears down via
    // renderer.clearUILayer() (it removes AND destroys every UI-layer child).
    // Just detach it here so the module is also safe standalone; never destroy
    // it directly (clearUILayer owns that, and avoids a double-free).
    if (this.vignette?.parent) {
      this.vignette.parent.removeChild(this.vignette);
    }

    // The nebula/star/twinkle display objects live inside skyContainer, which the
    // scene owns and destroys (after disposing their BlurFilters) — just drop our
    // references here.
    this.nebulaBackdropSprite = null;
    this.nebulaeContainer = null;
    this.twinkleContainer = null;
    this.vignette = null;
    this.dimmer = null;
    this.camAstG = null;
    this.starLayers.length = 0;
    this.nebulaLayers.length = 0;
    this.twinkleStars.length = 0;
    this.swarmLayers.length = 0;
    this.driftAsteroids.length = 0;
    this.activeComets.length = 0;
    this.bgShips.length = 0;
    this.dustParticles.length = 0;
  }

  /** Blend a hex colour toward white by `amount` [0..1]. */
  private lightenColor(color: number, amount: number): number {
    const r = (color >> 16) & 0xff;
    const g = (color >> 8) & 0xff;
    const b = color & 0xff;
    const lr = Math.round(r + (255 - r) * amount);
    const lg = Math.round(g + (255 - g) * amount);
    const lb = Math.round(b + (255 - b) * amount);
    return (lr << 16) | (lg << 8) | lb;
  }

  // ---------------------------------------------------------------------------
  // Screen-fixed star field
  // ---------------------------------------------------------------------------

  private createStarField(): void {
    const width = this.renderer.app.screen.width;
    const height = this.renderer.app.screen.height;

    // Depth layers, deepest → nearest. `depth` = on-screen pan parallax rate
    // (far moves least → reads as distant); `zoomDepth` = how much it scales with
    // zoom. Stars are laid out in a large field CENTRED on the origin and the
    // whole layer is translated by cameraPan*depth — no per-pan reshuffling/
    // wrapping, so stars don't pop/change as you pan (US-070 parallax fix).
    const cx = width / 2;
    const cy = height / 2;
    // Depth hierarchy (pan parallax rate × cameraPan = on-screen shift per px).
    // Far layer barely moves (deep-background cue); near layer clearly trails
    // behind as you pan (close-foreground cue). The 5.5× ratio between layers
    // makes the depth effect read clearly without stars "flying" off screen.
    // zoomDepth: subtle size change on zoom-in/out — near-layer stars feel
    // like local dust/debris; far-layer stars are unaffected by zoom (infinity).
    // spread: field half-extent in screen-widths/heights; near layer uses more
    // so its larger pan shifts never expose an edge.
    const layerConfigs = [
      // Deepest layer: ultra-dense carpet of faint micro-stars (the "infinity" cue).
      // Very low alpha individually — they stack into a dense milky band rather than
      // isolated dots. No zoom-depth: they sit at infinite distance.
      {
        count: 3400,
        depth: 0.02,
        zoomDepth: 0.0,
        size: [0.18, 0.55],
        alpha: [0.1, 0.42],
        spread: 1.0,
      },
      // Mid layer: slightly larger, begin to show color, visible individually.
      {
        count: 1200,
        depth: 0.08,
        zoomDepth: 0.03,
        size: [0.42, 1.15],
        alpha: [0.28, 0.72],
        spread: 1.3,
      },
      // No near/foreground star layer — foreground is dust streaks only (per art direction).
    ];

    // Weighted color pool: 60% blue-white (hot stellar cores), 15% pure white,
    // 8% cool blue, 8% warm yellow-white, 5% nebula-lit pink, 4% warm orange.
    // This matches photographic star fields where cool/hot stars dominate and
    // a few warm/pink ones signal nebula illumination.
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

  /**
   * A handful of bright "hero" stars with a 4-point glint that gently pulse
   * (twinkle). Only these few are animated per-frame, so it stays cheap.
   */
  private createTwinkleStars(): void {
    const width = this.renderer.app.screen.width;
    const height = this.renderer.app.screen.height;
    const container = new Container();
    // Mix of colors: most blue-white (hot giants), some warm, some pink (nebula-lit).
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

    const count = 60;

    for (let i = 0; i < count; i++) {
      const x = Math.random() * width * 2.2 - width * 0.6;
      const y = Math.random() * height * 2.2 - height * 0.6;
      const color = twinklePool[Math.floor(Math.random() * twinklePool.length)];
      // vary size: most small, a few large "hero" stars
      const r =
        Math.random() < 0.15
          ? 2.2 + Math.random() * 1.4 // bright hero star
          : 1.1 + Math.random() * 1.4; // normal bright star
      const baseAlpha = 0.55 + Math.random() * 0.45;

      const g = new Graphics();
      // outer soft diffraction halo
      g.circle(0, 0, r * 5).fill({ color, alpha: 0.06 });
      g.circle(0, 0, r * 2.8).fill({ color, alpha: 0.18 });
      // 4-point diffraction spike
      const len = r * (r > 2 ? 9 : 6);
      g.moveTo(-len, 0).lineTo(len, 0).moveTo(0, -len).lineTo(0, len);
      g.stroke({ width: r > 2 ? 1.0 : 0.7, color, alpha: 0.45 });
      // bright core
      g.circle(0, 0, r).fill({ color, alpha: 1 });
      g.x = x;
      g.y = y;
      g.alpha = baseAlpha;
      container.addChild(g);

      this.twinkleStars.push({
        graphics: g,
        baseAlpha,
        phase: Math.random() * Math.PI * 2,
        speed: 0.0008 + Math.random() * 0.0018,
      });
    }

    this.skyContainer.addChild(container);
    this.twinkleContainer = container;
  }

  // ---------------------------------------------------------------------------
  // Nebulae, swarms, dust-lane pillars
  // ---------------------------------------------------------------------------

  /**
   * Big, organic, multi-tone nebula clouds spread across the whole system.
   * Each cloud is built from many overlapping soft blobs baked into a single
   * blurred Graphics (drawn once), then only its transform/alpha is animated —
   * slow drift + gentle "breathing" pulse — so it's cheap but feels alive.
   * The palette and layout are seeded from the system id, so every system has a
   * distinct but stable look.
   */
  private createNebulae(): void {
    this.nebulaeContainer = new Container();
    this.nebulaeContainer.eventMode = "none";

    const systemId = this.systemId;
    const rng = new SeededRNG(`nebula_${systemId}`);

    const sw = this.renderer.app.screen.width;
    const sh = this.renderer.app.screen.height;

    // Photorealistic nebula palettes — [dark-outer, mid-body, inner-hot,
    // core-bright, accent]. One palette per available backdrop-art FAMILY so the
    // procedural clouds tint to match the nebula sprite behind them. The index
    // aligns 1:1 with `families` below. Previously only red/blue art was ever
    // selected (green + teal tiles shipped but unused), so most systems showed
    // the same backdrop — every family is now in rotation.
    const palettes = [
      [0x6e0a00, 0xcc2000, 0xff4400, 0xff8800, 0xffbb22], // red — warm red-orange
      [0x05082a, 0x0d1a88, 0x2244cc, 0x4466ff, 0x88aaff], // blue — deep blue-violet
      [0x002a14, 0x0a7a3a, 0x18cc66, 0x44ffaa, 0xaaffcc], // green — emerald
      [0x00222a, 0x067a7a, 0x10cccc, 0x44ffff, 0xaaffff], // teal — cyan
    ];
    const families = ["red", "blue", "green", "teal"];
    const palIdx = rng.nextInt(0, palettes.length - 1);
    const palette = palettes[palIdx];
    const palName = families[palIdx];

    // Backdrop art sprite — lazily loaded so large nebula PNGs don't block boot.
    // Vary the parallax DEPTH layer too (each family ships far/mid/near), giving
    // 4 families × 3 depths = 12 distinct backdrops instead of 2.
    const depths = ["mid", "near", "far"];
    const depth = depths[rng.nextInt(0, depths.length - 1)];
    const backdropKey =
      pickVariantKey("nebula", `${palName}_${depth}`, systemId) ??
      pickVariantKey("nebula", `${palName}_mid`, systemId);
    if (backdropKey) {
      // Show immediately from cache if already loaded (e.g. revisiting system),
      // otherwise load async and splice into skyContainer once ready.
      const mountBackdrop = (tex: Texture): void => {
        if (this.destroyed) return;
        const bg = new Sprite(tex);
        bg.anchor.set(0.5);
        bg.x = sw / 2;
        bg.y = sh / 2;
        const size = Math.max(sw, sh) * 2.4;
        bg.width = size;
        bg.height = size;
        bg.alpha = 0.38;
        bg.eventMode = "none";
        this.nebulaBackdropSprite = bg;
        this.skyContainer.addChildAt(bg, 0);
      };
      const cached =
        pickVariant("nebula", `${palName}_${depth}`, systemId) ??
        pickVariant("nebula", `${palName}_mid`, systemId);
      if (cached) {
        mountBackdrop(cached);
      } else {
        void loadTextureAsync(backdropKey).then((tex) => {
          if (tex && !this.destroyed) mountBackdrop(tex);
        });
      }
    }

    // Clouds are in screen-space (skyContainer), centred on (0,0) relative to
    // nebulaeContainer. nebulaeContainer is placed at screen-centre and translated
    // by cameraPan × NEBULA_DEPTH for gentle parallax — same model as star layers.
    // Each cloud is many overlapping low-alpha circles under screen blend (no
    // BlurFilter — per-frame blurs removed for FPS) reading as a soft gradient.
    const cloudCount = rng.nextInt(4, 6);

    for (let c = 0; c < cloudCount; c++) {
      const cloud = new Container();
      // Symmetric spread so clouds fill and slightly overflow the viewport.
      cloud.x = rng.nextFloat(-sw * 0.7, sw * 0.7);
      cloud.y = rng.nextFloat(-sh * 0.7, sh * 0.7);

      const outerColor = palette[0];
      const bodyColor = palette[rng.nextInt(1, 2)];
      const innerColor = palette[3];
      const coreColor = palette[4];

      // cloudR in screen pixels (was world-px, caused scaling artifacts on zoom).
      const cloudR = rng.nextFloat(200, 450);
      const squash = rng.nextFloat(0.45, 0.92);
      const rot = rng.next() * Math.PI;

      // Smooth multi-hue cloud from a few tinted gradient sprites (haze → body →
      // inner → core), sharing one baked texture — no per-frame BlurFilter. Each
      // is a squashed, rotated soft ellipse; under screen blend they accumulate
      // into a soft nebula. Falls back to stacked translucent circles in jsdom.
      const glowTex = softGlowTexture();
      if (glowTex) {
        const addBlob = (
          diameter: number,
          color: number,
          alpha: number,
        ): void => {
          const s = new Sprite(glowTex);
          s.anchor.set(0.5);
          s.eventMode = "none";
          s.width = diameter;
          s.height = diameter * squash;
          s.rotation = rot;
          s.tint = color;
          s.alpha = alpha;
          cloud.addChild(s);
        };
        addBlob(cloudR * 2.3, outerColor, 0.22); // outer haze
        addBlob(cloudR * 1.7, bodyColor, 0.3); // body
        addBlob(cloudR * 0.9, innerColor, 0.42); // hot inner
        addBlob(cloudR * 0.4, coreColor, 0.6); // luminous core
      } else {
        // Fallback (no canvas): stacked translucent circles per layer.
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

      // Screen blend so the many overlapping translucent fills accumulate into a
      // soft volumetric glow. No BlurFilter — a per-frame GPU blur on every cloud
      // was the FPS killer; the cloud is built from many low-alpha circles that
      // already read as a gradient under screen blend.
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

    // Add behind star layers: backdrop(0) → nebulae(1) → stars(2+).
    this.skyContainer.addChild(this.nebulaeContainer);
  }

  /**
   * A few drifting swarms of tiny glowing motes — the luminous "fireflies" that
   * cluster inside the nebula in the reference shot. Each swarm is a baked
   * Graphics of soft dots (cheap), animated only by a slow drift + breathing
   * pulse on its container.
   */
  private createSwarms(rng: SeededRNG, palette: number[]): void {
    if (!this.nebulaeContainer) return;

    const sw = this.renderer.app.screen.width;
    const sh = this.renderer.app.screen.height;
    const swarmCount = rng.nextInt(3, 6);

    for (let s = 0; s < swarmCount; s++) {
      const container = new Container();
      // Screen-space positions relative to nebulaeContainer origin (screen centre).
      container.x = rng.nextFloat(-sw * 0.55, sw * 0.55);
      container.y = rng.nextFloat(-sh * 0.55, sh * 0.55);

      // Brighten a palette colour toward white for a "glowing" mote.
      const tint = this.lightenColor(
        palette[rng.nextInt(0, palette.length - 1)],
        0.6,
      );
      // Small, tight cluster of luminous motes — like the reference's green
      // "fireflies". Key: small spread + low baseAlpha so they don't coalesce
      // into the cartoon glowing balls that plagued the old version.
      const spread = rng.nextFloat(50, 110);
      const motes = rng.nextInt(22, 44);

      const g = new Graphics();
      for (let m = 0; m < motes; m++) {
        const ang = rng.next() * Math.PI * 2;
        const dist = rng.next() * rng.next() * spread;
        const mx = Math.cos(ang) * dist;
        const my = Math.sin(ang) * dist;
        const r = rng.nextFloat(0.6, 1.8);
        // minimal halo (r×1.6), bright-but-small core
        g.circle(mx, my, r * 1.6).fill({ color: tint, alpha: 0.08 });
        g.circle(mx, my, r).fill({ color: tint, alpha: 0.7 });
      }
      // Each mote is a bright core + a faint r×1.6 halo circle — that two-ring
      // fill reads as a small light orb without any BlurFilter (per-frame blurs
      // removed for FPS). Motes are tiny, so hard edges are imperceptible.
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

  /**
   * Dark dust-lane pillars composited over the nebula clouds with multiply blend.
   * The reference (SR2) shows dark gas columns visible against the lit nebula —
   * elongated, slightly rotated, softly blurred so they read as absorption zones
   * rather than painted stripes.
   */
  private createNebulaPillars(rng: SeededRNG, sw: number, sh: number): void {
    if (!this.nebulaeContainer) return;

    const pillarCount = rng.nextInt(3, 5);
    const glowTex = softGlowTexture();
    for (let p = 0; p < pillarCount; p++) {
      // Position near the core of the nebula, offset slightly.
      const cx = rng.nextFloat(-sw * 0.35, sw * 0.35);
      const cy = rng.nextFloat(-sh * 0.35, sh * 0.35);
      const tilt = rng.nextFloat(-Math.PI * 0.45, Math.PI * 0.45);

      if (glowTex) {
        // One soft, elongated dark gradient ellipse — tinted black under multiply
        // blend it darkens like an absorption lane, fading smoothly at the edges
        // (no per-frame BlurFilter).
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

      // Fallback (no canvas): a column of 3–5 overlapping dark ellipses.
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

  /** Slow drift + spin + breathing pulse so the glowing swarms shimmer. */
  private updateSwarms(bgElapsed: number): void {
    for (const s of this.swarmLayers) {
      s.container.x += s.driftX;
      s.container.y += s.driftY;
      // Per-frame spin (same convention as driftX/driftY above — applied once
      // per frame, not scaled by dt) so the cluster slowly turns and feels alive.
      s.container.rotation += s.rotSpeed;
      const pulse =
        1 + Math.sin(bgElapsed * s.pulseSpeed + s.phase) * s.pulseAmp;
      s.container.alpha = Math.max(0, Math.min(1, s.baseAlpha * pulse));
    }
  }

  /** Slow drift + gentle "breathing" pulse so the nebulae feel alive. */
  private updateNebulae(bgElapsed: number): void {
    // Nebulae live in skyContainer (screen-space) — they don't scale with gameLayer
    // zoom, so depth remains consistent at any zoom level. Gentle parallax
    // (NEBULA_DEPTH ≈ 0.04) is midway between far stars (0.02) and mid stars (0.08).
    const NEBULA_DEPTH = 0.04;
    if (this.nebulaeContainer) {
      const cam = this.getCamera();
      const cx = this.renderer.app.screen.width / 2;
      const cy = this.renderer.app.screen.height / 2;
      this.nebulaeContainer.x = cx + cam.panX * NEBULA_DEPTH;
      this.nebulaeContainer.y = cy + cam.panY * NEBULA_DEPTH;
    }

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

  /** Twinkle the few bright hero stars by oscillating their alpha. */
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

    // Nebula art backdrop drifts almost imperceptibly (0.01) — it reads as an
    // infinite-distance cosmic cloud that barely reacts to local camera motion.
    if (this.nebulaBackdropSprite) {
      this.nebulaBackdropSprite.x = cx + cam.panX * 0.01;
      this.nebulaBackdropSprite.y = cy + cam.panY * 0.01;
    }

    // Each depth layer is a centred field translated by cameraPan*depth. Stars
    // also scale slightly with zoom (except the deepest layer — it's at infinity
    // and never scales). No Math.max clamp: stars can shrink at zoom-out, giving
    // the correct depth cue that distant stars look smaller when you step back.
    for (const layer of this.starLayers) {
      const s = Math.max(0.4, 1 + (cam.zoom - 1) * layer.zoomDepth);
      layer.container.scale.set(s);
      layer.container.x = cx + cam.panX * layer.depth;
      layer.container.y = cy + cam.panY * layer.depth;
    }

    // Twinkle stars ride with the mid layer — bright distant stars, not foreground.
    if (this.twinkleContainer) {
      this.twinkleContainer.x = cx + cam.panX * 0.08;
      this.twinkleContainer.y = cy + cam.panY * 0.08;
    }
  }

  // ---------------------------------------------------------------------------
  // Readability dimmer (F2 — nebula drowns the game layer)
  // ---------------------------------------------------------------------------

  /**
   * Full-screen black overlay added as the LAST child of skyContainer so it
   * uniformly darkens every sky element beneath it (nebula art backdrop,
   * procedural clouds, star fields, twinkle stars) while the game world — drawn
   * above the sky — keeps full contrast. Strength comes from BACKGROUND_DIM in
   * `src/config/balance.ts`. The nebula backdrop sprite is async-mounted at
   * index 0, so it always lands below this overlay regardless of load order.
   */
  private createDimmer(): void {
    if (this.dimmer) return; // initialize() must not stack a second overlay
    const d = new Graphics();
    // Sized once at initialize (the layer has no resize handler); the 1.5×
    // overdraw absorbs moderate window growth, like the other sky layers.
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

  // ---------------------------------------------------------------------------
  // Edge vignette (UI layer)
  // ---------------------------------------------------------------------------

  /**
   * Screen-fixed vignette that darkens the edges so the action reads in the
   * centre. Built as stacked edge strokes fading inward (no BlurFilter — a
   * blurred full-screen rect showed up as bands across the whole canvas).
   */
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
    // Added before the HUD so it sits underneath it (above the world). Torn
    // down by clearUILayer on the next scene init.
    this.vignette = v;
    this.renderer.uiLayer.addChild(v);
  }

  // ---------------------------------------------------------------------------
  // Mid-ground parallax (drift asteroids, comets, silhouette ships, dust motes)
  // ---------------------------------------------------------------------------

  private initMidground(): void {
    this.midground.eventMode = "none";
    // Sit just above the screen-fixed sky but below the game world. The scene
    // inserts skyContainer at stage index 0 immediately before building this
    // module, so index 1 places the mid-ground between the sky and gameLayer.
    this.renderer.stage.addChildAt(this.midground, 1);

    const rng = new SeededRNG(`bgLayer_${this.systemId}`);

    this.createDriftAsteroids(rng);
    this.createBgShips(rng);
    this.createDustParticles(rng);

    // Camera asteroid placeholder — positioned and activated on first trigger.
    this.camAstG = this.buildCamAsteroid();
    this.camAstG.alpha = 0;
    this.midground.addChild(this.camAstG);
    this.camAstTimer = rng.nextFloat(60000, 90000);

    this.cometNextSpawn = rng.nextFloat(15000, 40000);
  }

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
      this.midground.addChild(g);
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
      this.midground.addChild(g);
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
      this.midground.addChild(g);
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
        this.midground.removeChild(c.g);
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
    this.midground.addChild(g);
    this.activeComets.push({ g, x: sx, y: sy, vx, vy, life: maxLife, maxLife });
  }

  private updateCamAsteroid(dt: number): void {
    if (!this.camAstG) return;
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
}
