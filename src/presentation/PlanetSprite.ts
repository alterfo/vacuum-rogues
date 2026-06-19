import { Container, Graphics, Sprite, TilingSprite } from "pixi.js";
import type { FederatedPointerEvent, Texture } from "pixi.js";
import type { Planet } from "@/domain/Planet";
import { PlanetType } from "@/types";
import { SeededRNG } from "@/utils/seededRNG";
import { getMoonLayer } from "@/utils/moonZOrder";
import { pickVariant, pickVariantKey, loadTextureAsync } from "./textures";
import { buildSphereMesh, type SphereMesh } from "./sphereMesh";
import {
  createPlanetRotationFilter,
  type PlanetRotationFilter,
} from "./filters/PlanetRotationFilter";

/** Maps a planet type to its art-asset name prefix (src/assets/planets/<prefix>_NN). */
const PLANET_TEXTURE_PREFIX: Record<PlanetType, string> = {
  [PlanetType.TERRESTRIAL]: "terrestrial",
  [PlanetType.GAS_GIANT]: "gas",
  [PlanetType.ICE]: "ice",
  [PlanetType.VOLCANIC]: "volcanic",
  [PlanetType.INDUSTRIAL]: "industrial",
  [PlanetType.HABITAT]: "habitat",
};

interface Moon {
  graphics: Graphics;
  orbit: number;
  speed: number; // radians per ms
  angle: number;
  squash: number; // vertical squash for a tilted orbit look
  wasBehind: boolean; // tracks current layer to avoid re-parenting every tick
}

/**
 * Build the flat-disc fallback for an equirect planet: a horizontally-scrolling
 * {@link TilingSprite} of the surface map, clipped to a circle. The TilingSprite's
 * origin is its top-left corner, so it is offset by (-radius, -radius) inside a
 * plain wrapper {@link Container}; the circular mask lives in that Container's
 * space centred on the planet origin (0, 0).
 *
 * The mask is a child of the wrapper Container — never of the TilingSprite. A
 * TilingSprite's specialised renderer drops a child mask, so the disc renders as
 * its full rectangle (the "planets render as rectangles, clipped at a straight
 * edge" regression). Wrapping in a plain Container, exactly like the procedural
 * `surface`/maskA path, is the robust clip. Exported for unit testing.
 */
export function buildTilingDisc(
  mapTex: Texture,
  radius: number,
): { surface: Container; tiling: TilingSprite; mask: Graphics } {
  const W = radius * 2;
  const surface = new Container();
  surface.eventMode = "none";

  const tiling = new TilingSprite({ texture: mapTex, width: W, height: W });
  tiling.x = -radius;
  tiling.y = -radius;
  const scale = mapTex.height ? W / mapTex.height : 1;
  tiling.tileScale.set(scale, scale);
  tiling.eventMode = "none";

  const mask = new Graphics().circle(0, 0, radius).fill({ color: 0xffffff });

  surface.addChild(tiling);
  surface.addChild(mask);
  surface.mask = mask;

  return { surface, tiling, mask };
}

/** Per-planet axial spin: a clearly-visible speed and a well-mixed direction. */
export interface PlanetSpin {
  /** Longitude fraction advanced per millisecond. Always positive (a magnitude). */
  speed: number;
  /** Spin direction: +1 (prograde) or -1 (retrograde). */
  direction: number;
}

/** Slowest visible spin: ≈0.0000167 longitude/ms → one rotation per ~60 s. */
const SPIN_SLOWEST = 1 / 60000;
/** Fastest tasteful spin: ≈0.0000833 longitude/ms → one rotation per ~12 s. */
const SPIN_FASTEST = 1 / 12000;
/**
 * The tiling-disc fallback scrolls a TilingSprite in texture px/ms rather than
 * longitude-fraction/ms; this factor converts a {@link planetSpin} speed into
 * that scroll rate so the disc spins at roughly the same perceptual rate as the
 * sphere/filter paths (preserves the legacy filter→tiling speed ratio).
 */
const TILING_SCROLL_SCALE = 200;

/**
 * Pure, seeded axial spin for a planet — a deterministic function of its id.
 *
 * The legacy range (0.00006–0.00012 longitude/ms, ~one turn per 8–17 s) was both
 * too narrow and too uniform, so every planet appeared to spin identically. This
 * widens the band to ~one rotation per 12–60 s — a 5× spread so two planets read
 * as clearly different — and draws the direction independently (~50/50) so some
 * planets spin retrograde. Shared by all three map-backed render paths (GLSL
 * filter, sphere mesh, tiling disc) so a body spins consistently whichever path
 * renders it. The `spin_` seed prefix decorrelates it from the surface-feature
 * RNG (`surf_`) and the moon RNG (`moon_`).
 */
export function planetSpin(planetId: string): PlanetSpin {
  const rng = new SeededRNG(`spin_${planetId}`);
  // Longitude fraction per ms; one full rotation takes 1/speed ms.
  const speed = SPIN_SLOWEST + rng.next() * (SPIN_FASTEST - SPIN_SLOWEST);
  // Independent draw so the sign is well-mixed (not coupled to the speed).
  const direction = rng.next() < 0.5 ? 1 : -1;
  return { speed, direction };
}

/**
 * Visual representation of a planet in the SpaceFlightScene
 * Handles rendering, hover effects, and click interactions
 */
export class PlanetSprite {
  public readonly container: Container;
  public readonly graphics: Graphics;
  public readonly planet: Planet;
  public readonly orbitalRadius: number;
  public angle: number; // Made mutable for rotation
  public screenX: number;
  public screenY: number;
  private readonly centerX: number;
  private readonly centerY: number;
  // Orbital position is a pure function of elapsed game days (not wall-clock
  // time): angle = baseAngle + radPerDay * gameDays. This keeps the planet's
  // position continuous across scene reloads, so after landing it only advances
  // by the days actually spent on the surface (US-070 #9).
  private readonly baseAngle: number;
  private readonly radPerDay: number;
  private isHovered: boolean = false;
  private clickCallback: ((planet: Planet) => void) | null = null;
  private readonly moons: Moon[] = [];
  private readonly backMoonsContainer: Container = new Container();
  private readonly frontMoonsContainer: Container = new Container();
  // Holds the planet body (disc art / rotating sphere). Sits between the back and
  // front moon containers so a deferred equirect upgrade (see buildSphere) keeps
  // the correct z-order without re-parenting moons.
  private readonly bodyContainer: Container = new Container();
  // Guards the async equirect-map upgrade against a sprite torn down mid-load.
  private destroyed = false;
  // Rotating 3D sphere: surface scrolls under a circular mask; shading is
  // oriented so the lit side faces the star, giving a volumetric look.
  private surfaceStrip: Graphics | null = null;
  private shadeContainer: Container | null = null;
  private surfaceWidth = 1;
  private surfaceOffset = 0;
  private axialSpeed = 0;
  // Equirect surface map (preferred): a tiling sprite scrolled horizontally
  // under a circular mask gives a real, seamless axial rotation.
  private tiling: TilingSprite | null = null;
  // Wrapper Container holding the TilingSprite + its circular mask (the masked
  // object). Retained for axial-spin updates and e2eMaskInfo introspection.
  private tilingSurface: Container | null = null;
  private tilingMask: Graphics | null = null;
  // Preferred map-backed rendering: a rotating sphere mesh (convex), like the sun.
  private sphere: SphereMesh | null = null;
  // Preferred-most map-backed rendering: a GLSL sphere-rotation filter on a flat
  // sprite (equirect→sphere projection, circular clip and rim-light in-shader).
  private rotationFilter: PlanetRotationFilter | null = null;

  constructor(
    planet: Planet,
    centerX: number,
    centerY: number,
    baseAngle: number,
    initialDays = 0,
  ) {
    this.planet = planet;
    this.orbitalRadius = planet.orbitalRadius;
    this.baseAngle = baseAngle;
    this.centerX = centerX;
    this.centerY = centerY;

    // Kepler's third law approximation: outer planets have much longer years.
    // The innermost orbit (≈600px) completes a lap in BASE_PERIOD_DAYS.
    const BASE_PERIOD_DAYS = 80;
    const periodDays =
      BASE_PERIOD_DAYS * Math.pow(this.orbitalRadius / 600, 1.5);
    this.radPerDay = (Math.PI * 2) / periodDays;

    this.angle = baseAngle + this.radPerDay * initialDays;

    // Calculate screen position based on orbital radius and angle
    this.screenX = centerX + Math.cos(this.angle) * this.orbitalRadius;
    this.screenY = centerY + Math.sin(this.angle) * this.orbitalRadius;

    // Create PixiJS objects
    this.container = new Container();
    this.graphics = new Graphics();
    // backMoonsContainer must be the first child so moons in the far half of the
    // orbit render behind the planet body and sphere overlay.
    this.container.addChild(this.backMoonsContainer);
    this.container.addChild(this.graphics);
    // Planet body lives here, above the base graphics but below the front moons
    // (createMoons adds frontMoonsContainer last).
    this.container.addChild(this.bodyContainer);

    // Position container at calculated screen coordinates
    this.container.x = this.screenX;
    this.container.y = this.screenY;

    // Initial render
    this.render();
    this.buildSphere();
    this.createMoons(); // adds frontMoonsContainer as the last child
  }

  /**
   * Build the rotating 3D sphere: a horizontally-scrolling surface strip clipped
   * to a circle (axial rotation) plus a shading layer (night side + specular +
   * rim light) that is rotated each frame so the lit side faces the star.
   */
  private buildSphere(): void {
    const { color, radius } = this.getPlanetVisuals(this.planet.type);
    const prefix = PLANET_TEXTURE_PREFIX[this.planet.type];

    // 1) Preferred: equirectangular surface map → genuine axial rotation by
    // scrolling the map under a circular mask, plus a star-facing light layer.
    const mapTex = prefix
      ? pickVariant("planet_maps", prefix, this.planet.id)
      : undefined;
    if (mapTex) {
      this.buildEquirectSphere(mapTex, radius);
      return;
    }

    // The equirect map is in a lazy-loaded category (planet_maps) that is not
    // preloaded, so on the first visit to a system it is not cached yet. Kick off
    // a background load and upgrade the body to the rotating sphere when it
    // arrives; until then fall through to the static disc / procedural body.
    if (prefix) this.scheduleEquirectUpgrade(prefix, radius);

    // 2) Pre-shaded cut-out disc art: reads as 3D from its baked lighting, but
    // does not rotate. Picked deterministically for stable, varied looks.
    const discTex = prefix
      ? pickVariant("planets", prefix, this.planet.id)
      : undefined;
    if (discTex) {
      const sprite = new Sprite(discTex);
      sprite.anchor.set(0.5);
      sprite.width = radius * 2;
      sprite.height = radius * 2;
      sprite.eventMode = "none"; // clicks fall through to the hit-area graphics
      this.bodyContainer.addChild(sprite);
      return;
    }

    // 3) Fallback: procedural rotating sphere (no art for this type yet).
    const rng = new SeededRNG(`surf_${this.planet.id}`);
    const W = radius * 2;

    // --- scrolling surface ---
    const maskA = new Graphics().circle(0, 0, radius).fill({ color: 0xffffff });
    const surface = new Container();
    surface.eventMode = "none";
    const strip = new Graphics();
    strip.rect(-radius - W, -radius, W * 3, W).fill({ color }); // wide base, no gaps
    const feats = rng.nextInt(10, 16);
    for (let i = 0; i < feats; i++) {
      const bx = rng.next() * W - radius;
      const by = rng.nextFloat(-radius, radius);
      const rr = rng.nextFloat(radius * 0.18, radius * 0.5);
      const tint =
        rng.next() < 0.5
          ? this.lightenColor(color, 35)
          : this.darkenColor(color, 35);
      const a = rng.nextFloat(0.3, 0.7);
      for (const dx of [-W, 0, W]) {
        strip
          .ellipse(bx + dx, by, rr, rr * rng.nextFloat(0.6, 1.0))
          .fill({ color: tint, alpha: a });
      }
    }
    surface.addChild(strip);
    // PixiJS 8 only clips with a mask that lives in the scene graph. Parent the
    // mask under the object it masks (rather than as a loose sibling) so the
    // surface is clipped to a circle instead of rendering as its rectangular
    // bounds (Sprint 3: planets were showing up as rectangles).
    surface.addChild(maskA);
    surface.mask = maskA;
    this.surfaceStrip = strip;
    this.surfaceWidth = W;
    // smaller planets appear to spin a touch faster; randomized direction
    this.axialSpeed =
      (0.004 + rng.next() * 0.004) * (rng.next() < 0.5 ? 1 : -1);

    // --- shading (lit from +x; rotated toward the star in update) ---
    const maskB = new Graphics().circle(0, 0, radius).fill({ color: 0xffffff });
    const shade = new Container();
    shade.eventMode = "none";
    const sh = new Graphics();
    sh.circle(-radius * 0.45, 0, radius).fill({ color: 0x000008, alpha: 0.5 }); // night side
    sh.circle(-radius * 0.15, 0, radius).fill({ color: 0x000008, alpha: 0.16 }); // terminator
    // No white specular/rim "glints" — they read as weird blobs (US-070).
    shade.addChild(sh);
    shade.addChild(maskB); // mask must live in the scene graph (see maskA above)
    shade.mask = maskB;
    this.shadeContainer = shade;

    this.bodyContainer.addChild(surface, shade);
  }

  /**
   * Lazily load the planet's equirectangular surface map (a lazy-loaded category
   * not covered by the eager preload) and, once it arrives, replace the static
   * fallback body with the rotating sphere. Fire-and-forget; guarded against a
   * sprite torn down mid-load and against a body that has already been upgraded.
   */
  private scheduleEquirectUpgrade(prefix: string, radius: number): void {
    const key = pickVariantKey("planet_maps", prefix, this.planet.id);
    if (!key) return;
    void loadTextureAsync(key).then((mapTex) => {
      if (!mapTex || this.destroyed) return;
      // Another path already produced a rotating body — leave it alone.
      if (this.rotationFilter || this.sphere || this.tiling) return;
      // Drop the static fallback body and rebuild as a rotating sphere. Destroy
      // children too (procedural strip/shade graphics) but not textures — the
      // disc art is a shared cache entry reused by other planets.
      for (const child of this.bodyContainer.removeChildren()) {
        child.destroy({ children: true });
      }
      this.surfaceStrip = null;
      this.shadeContainer = null;
      this.buildEquirectSphere(mapTex, radius);
    });
  }

  /**
   * Build a rotating planet from an equirectangular surface map: a TilingSprite
   * clipped to a circle (scrolled horizontally for axial spin) under a lighting
   * layer rotated each frame so the lit hemisphere faces the star.
   */
  private buildEquirectSphere(mapTex: Texture, radius: number): void {
    // Per-planet axial spin: a clearly-visible, well-mixed speed + direction,
    // shared by all three render paths below so the body spins identically
    // whichever one renders it (US: varied planet rotation).
    const spin = planetSpin(this.planet.id);

    // No fake lighting overlay: the specular/rim "glints" and the directional
    // terminator read as weird blobs on the disc. Depth comes from the convex
    // sphere mesh / filter (foreshortening) and the parallax background instead.
    this.shadeContainer = null;

    // E2E hook: force the flat TilingSprite-disc fallback path. The GLSL filter
    // and sphere-mesh paths (taken by default in a WebGL renderer) clip
    // in-shader / by geometry, so without this a browser test can never reach —
    // let alone assert on — the TilingSprite disc, which is the only path that
    // can regress to the "planets render as rectangles" bug (Task 2). Setting
    // window.__forcePlanetTilingFallback lets the masking regression smoke build
    // and introspect a real tiling disc. Stripped from production (__DEBUG__).
    const forceTiling =
      __DEBUG__ &&
      typeof window !== "undefined" &&
      (window as unknown as Record<string, unknown>)
        .__forcePlanetTilingFallback === true;

    if (!forceTiling) {
      // Preferred: a GLSL sphere-rotation filter on a flat sprite. The shader
      // does the equirect→sphere projection, circular clip and atmosphere
      // rim-light, and spins on its axis via the uOffset uniform (ART Task 7 /
      // US-075). Longitude fraction per ms; per-planet speed + direction.
      const filterSpeed = spin.speed * spin.direction;
      const filter = createPlanetRotationFilter(mapTex, filterSpeed);
      if (filter) {
        const sprite = new Sprite(mapTex);
        sprite.anchor.set(0.5);
        sprite.width = radius * 2;
        sprite.height = radius * 2;
        sprite.eventMode = "none"; // clicks fall through to the hit-area graphics
        sprite.filters = [filter];
        this.rotationFilter = filter;
        this.bodyContainer.addChild(sprite);
        return;
      }

      // Fallback: a real rotating sphere mesh (convex foreshortening) — same
      // technique as the sun (US-070: planets convex too).
      const sphere = buildSphereMesh(mapTex, radius);
      if (sphere) {
        this.sphere = sphere;
        // Longitude fraction per ms; per-planet speed + direction.
        this.axialSpeed = spin.speed * spin.direction;
        this.bodyContainer.addChild(sphere.mesh);
        return;
      }
    }

    // Fallback: flat scrolling disc under a circular mask. The TilingSprite has a
    // top-left origin, so it is offset by (-radius, -radius) inside a plain
    // wrapper Container and the circular mask is centred on the planet origin
    // (0, 0) in that wrapper's space. The mask MUST be a child of the wrapper
    // Container — NOT of the TilingSprite, whose specialised renderer fails to
    // apply a child mask, leaving the disc rendering as its full rectangle
    // clipped at a straight edge (Task 2: planets-render-as-rectangles
    // regression). This mirrors the known-good procedural `surface`/maskA path.
    const { surface, tiling, mask } = buildTilingDisc(mapTex, radius);
    this.tiling = tiling;
    this.tilingSurface = surface;
    this.tilingMask = mask;
    // texture px/ms = longitude-fraction/ms × the tiling scroll scale.
    this.axialSpeed = spin.speed * spin.direction * TILING_SCROLL_SCALE;
    this.bodyContainer.addChild(surface);
  }

  /** Darken a hex color by an absolute per-channel amount. */
  private darkenColor(color: number, amount: number): number {
    const r = Math.max(0, ((color >> 16) & 0xff) - amount);
    const g = Math.max(0, ((color >> 8) & 0xff) - amount);
    const b = Math.max(0, (color & 0xff) - amount);
    return (r << 16) | (g << 8) | b;
  }

  /** Deterministically give the planet 0–2 small orbiting moons. */
  private createMoons(): void {
    const { radius } = this.getPlanetVisuals(this.planet.type);
    const rng = new SeededRNG(`moon_${this.planet.id}`);
    const count = rng.nextInt(0, 2);
    // frontMoonsContainer is the last child — moons in the near half render over the planet.
    this.container.addChild(this.frontMoonsContainer);
    for (let i = 0; i < count; i++) {
      const g = new Graphics();
      const size = rng.nextFloat(1.8, 3.4);
      g.circle(0, 0, size).fill({ color: 0xbfc4cc });
      g.circle(-size * 0.3, -size * 0.3, size * 0.5).fill({
        color: 0xffffff,
        alpha: 0.4,
      });
      const angle = rng.next() * Math.PI * 2;
      const isBehind = getMoonLayer(angle) === "back";
      if (isBehind) {
        this.backMoonsContainer.addChild(g);
      } else {
        this.frontMoonsContainer.addChild(g);
      }
      this.moons.push({
        graphics: g,
        orbit: radius + rng.nextFloat(10, 22) + i * 6,
        speed: rng.nextFloat(0.0006, 0.0014) * (rng.next() < 0.5 ? 1 : -1),
        angle,
        squash: rng.nextFloat(0.4, 0.8),
        wasBehind: isBehind,
      });
    }
  }

  /**
   * Render planet circle with type-specific color and size
   * Enhanced visibility with strong glow and outline to stand out against starry background
   */
  render(): void {
    this.graphics.clear();

    // Determine color and radius based on planet type
    const { color, radius, hasRings, hasAtmosphere } = this.getPlanetVisuals(
      this.planet.type,
    );

    // Draw strong outer glow (multiple layers for depth)
    this.graphics.circle(0, 0, radius + 16);
    this.graphics.fill({ color, alpha: 0.08 });
    this.graphics.circle(0, 0, radius + 12);
    this.graphics.fill({ color, alpha: 0.12 });
    this.graphics.circle(0, 0, radius + 8);
    this.graphics.fill({ color, alpha: 0.18 });

    // Draw atmosphere for some planet types
    if (hasAtmosphere) {
      this.graphics.circle(0, 0, radius + 5);
      this.graphics.fill({ color, alpha: 0.25 });
    }

    // Draw enhanced hover glow effect
    if (this.isHovered) {
      this.graphics.circle(0, 0, radius + 10);
      this.graphics.fill({ color: 0xffffff, alpha: 0.3 });
      this.graphics.circle(0, 0, radius + 6);
      this.graphics.fill({ color: 0xffffff, alpha: 0.4 });
    }

    // Dark separator ring just outside the planet so it reads against a bright
    // nebula, then a bright crisp outline — together they make the planet pop
    // out of the background (planets were getting lost against the gas clouds).
    this.graphics.circle(0, 0, radius + 4);
    this.graphics.stroke({ color: 0x000000, width: 3, alpha: 0.45 });
    this.graphics.circle(0, 0, radius + 2);
    this.graphics.stroke({
      color: this.lightenColor(color, 110),
      width: 2.5,
      alpha: 0.95,
    });

    // The planet body itself is drawn as a rotating 3D sphere (see buildSphere);
    // here we only draw the base disc as a fallback fill behind it.
    this.graphics.circle(0, 0, radius);
    this.graphics.fill({ color });

    // Draw rings for gas giants (enhanced)
    if (hasRings) {
      const ringInner = radius + 6;
      const ringOuter = radius + 16;

      // Draw ring shadow on planet
      this.graphics.ellipse(0, radius * 0.3, radius * 0.9, radius * 0.15);
      this.graphics.fill({ color: 0x000000, alpha: 0.4 });

      // Draw bright rings with multiple bands
      for (let i = 0; i < 5; i++) {
        const r = ringInner + (ringOuter - ringInner) * (i / 5);
        this.graphics.ellipse(0, 0, r, r * 0.2);
        this.graphics.stroke({
          color: this.lightenColor(color, 40 + i * 10),
          width: 2.5,
          alpha: 0.7 - i * 0.1,
        });
      }
    }
  }

  /**
   * Get visual properties (color, radius, effects) for a planet type
   */
  private getPlanetVisuals(type: PlanetType): {
    color: number;
    radius: number;
    hasRings: boolean;
    hasAtmosphere: boolean;
  } {
    // Planets render large — clearly the dominant bodies in the system but still
    // well under the STAR_RADIUS (170px) sun. Radii reduced by ~⅓ from the first
    // pass so they read as planets, not co-stars (US-070 #4).
    switch (type) {
      case PlanetType.TERRESTRIAL:
        return {
          color: 0x8b7355,
          radius: 80,
          hasRings: false,
          hasAtmosphere: true,
        }; // Brown earth-like
      case PlanetType.GAS_GIANT:
        return {
          color: 0xffa500,
          radius: 100,
          hasRings: true,
          hasAtmosphere: true,
        }; // Orange with rings
      case PlanetType.ICE:
        return {
          color: 0xadd8e6,
          radius: 70,
          hasRings: false,
          hasAtmosphere: false,
        }; // Light blue
      case PlanetType.VOLCANIC:
        return {
          color: 0xff4500,
          radius: 74,
          hasRings: false,
          hasAtmosphere: false,
        }; // Red-orange
      case PlanetType.INDUSTRIAL:
        return {
          color: 0x808080,
          radius: 84,
          hasRings: false,
          hasAtmosphere: true,
        }; // Gray with smog
      case PlanetType.HABITAT:
        return {
          color: 0x00aa44,
          radius: 88,
          hasRings: false,
          hasAtmosphere: true,
        }; // Green habitable
      default:
        return {
          color: 0x8b7355,
          radius: 80,
          hasRings: false,
          hasAtmosphere: true,
        };
    }
  }

  /**
   * Lighten a hex color by a percentage
   */
  private lightenColor(color: number, percent: number): number {
    const r = Math.min(255, ((color >> 16) & 0xff) + percent);
    const g = Math.min(255, ((color >> 8) & 0xff) + percent);
    const b = Math.min(255, (color & 0xff) + percent);
    return (r << 16) | (g << 8) | b;
  }

  /**
   * Enable interactivity and set up event handlers
   * @param onClickCallback Function to call when planet is clicked
   */
  createHitArea(onClickCallback: (planet: Planet) => void): void {
    this.clickCallback = onClickCallback;

    this.graphics.eventMode = "static";
    this.graphics.cursor = "pointer";

    // Click handler
    this.graphics.on("pointerdown", (event) => {
      event.stopPropagation(); // Prevent stage from also handling this click
      if (this.clickCallback) {
        this.clickCallback(this.planet);
      }
    });

    // Hover handlers
    this.graphics.on("pointerover", () => {
      this.setHoverState(true);
    });

    this.graphics.on("pointerout", () => {
      this.setHoverState(false);
    });
  }

  /** Wire additional hover callbacks (for tooltip system in SpaceFlightScene). */
  setTooltipHandlers(
    onOver: (planet: Planet, screenX: number, screenY: number) => void,
    onOut: () => void,
  ): void {
    this.graphics.on("pointerover", (e: FederatedPointerEvent) =>
      onOver(this.planet, e.global.x, e.global.y),
    );
    this.graphics.on("pointerout", onOut);
  }

  /**
   * Update hover state and re-render
   */
  setHoverState(isHover: boolean): void {
    this.isHovered = isHover;
    this.render();
  }

  /**
   * Update planet position for orbital rotation
   * @param deltaTime Time elapsed since last update in milliseconds
   */
  /**
   * Position the planet on its orbit for the given (possibly fractional) game
   * day. Orbital position is a pure function of elapsed game days, so it stays
   * continuous across scene reloads (US-070 #9).
   */
  setOrbitForDay(days: number): void {
    this.angle = this.baseAngle + this.radPerDay * days;
    this.screenX = this.centerX + Math.cos(this.angle) * this.orbitalRadius;
    this.screenY = this.centerY + Math.sin(this.angle) * this.orbitalRadius;
    this.container.x = this.screenX;
    this.container.y = this.screenY;
    this.orientShading();
  }

  /** Rendered planet radius (px) — used by the scene for landing/click ranges. */
  get displayRadius(): number {
    return this.getPlanetVisuals(this.planet.type).radius;
  }

  /**
   * Orbital (tangential) velocity at the planet's CURRENT position, in world px
   * per game-day. Direction is perpendicular to the radius (the orbit tangent),
   * magnitude `orbitalRadius * radPerDay`. Used to lead a pursuit course so the
   * ship aims where the planet will drift, not where it is now (playtest4 C).
   */
  orbitalVelocityPerDay(): { vx: number; vy: number } {
    const speed = this.orbitalRadius * this.radPerDay;
    return {
      vx: -Math.sin(this.angle) * speed,
      vy: Math.cos(this.angle) * speed,
    };
  }

  /** Orient the day/night shading so the lit hemisphere faces the star. */
  private orientShading(): void {
    if (this.shadeContainer) {
      this.shadeContainer.rotation = Math.atan2(
        this.centerY - this.screenY,
        this.centerX - this.screenX,
      );
    }
  }

  update(deltaTime: number): void {
    // Orbital position is no longer advanced here — it is driven by game days
    // via setOrbitForDay(). This method only animates the cosmetic axial spin,
    // shading and moons (wall-clock time is fine for those).

    // Axial rotation: advance the GLSL filter (preferred), else roll the sphere
    // mesh, else scroll the equirect tiling / procedural strip.
    if (this.rotationFilter) {
      this.rotationFilter.advance(deltaTime);
    } else if (this.sphere) {
      this.sphere.advance(this.axialSpeed * deltaTime);
    } else if (this.tiling) {
      this.tiling.tilePosition.x -= this.axialSpeed * deltaTime;
    }
    this.surfaceOffset =
      (this.surfaceOffset + this.axialSpeed * deltaTime + this.surfaceWidth) %
      this.surfaceWidth;
    if (this.surfaceStrip) this.surfaceStrip.x = -this.surfaceOffset;
    // Orient the shading so the lit hemisphere faces the star (system centre).
    this.orientShading();

    // Orbit the moons; re-parent between back/front layers only when the moon
    // crosses the horizontal axis (wasBehind flag prevents re-parenting every tick).
    for (const m of this.moons) {
      m.angle += m.speed * deltaTime;
      m.graphics.x = Math.cos(m.angle) * m.orbit;
      m.graphics.y = Math.sin(m.angle) * m.orbit * m.squash;

      const isBehind = getMoonLayer(m.angle) === "back";
      if (isBehind !== m.wasBehind) {
        m.wasBehind = isBehind;
        if (isBehind) {
          this.backMoonsContainer.addChild(m.graphics);
        } else {
          this.frontMoonsContainer.addChild(m.graphics);
        }
      }
    }
  }

  /**
   * E2E/diagnostics: report the equirect-disc circular mask geometry so a browser
   * test can assert the planet body clips to a circle. Returns `null` when this
   * planet did NOT fall back to the TilingSprite disc (it rendered via the GLSL
   * rotation filter or the sphere mesh, which clip in-shader / by geometry).
   *
   * `maskIsChild` is true when the mask Graphics is a child of the masked wrapper
   * Container (the PixiJS 8 scene-graph requirement). `maskBounds` are the mask's
   * local bounds — a correctly-centred circle has bounds centred on (0, 0).
   * Guarded by __DEBUG__ (stripped from production builds).
   */
  e2eMaskInfo(): {
    maskIsChild: boolean;
    maskBounds: { x: number; y: number; width: number; height: number };
  } | null {
    if (!__DEBUG__) return null;
    if (!this.tilingSurface || !this.tilingMask) return null;
    const maskIsChild = this.tilingSurface.children.includes(this.tilingMask);
    const b = this.tilingMask.getLocalBounds();
    return {
      maskIsChild,
      maskBounds: { x: b.x, y: b.y, width: b.width, height: b.height },
    };
  }

  /** E2E: true when this planet renders via the GLSL rotation filter (F1 path). */
  e2eHasRotationFilter(): boolean {
    if (!__DEBUG__) return false;
    return this.rotationFilter !== null;
  }

  /**
   * E2E/diagnostics (F1): isolate the GLSL-filtered planet body for a pixel
   * assertion — hide every sibling visual this sprite owns (glow ring, moons,
   * labels) so the filtered body is the only thing it draws, and report the
   * on-screen geometry. Returns null when this planet does not use the
   * rotation-filter path. Guarded by __DEBUG__ (stripped from production).
   */
  e2eIsolateFilterBody(): {
    screenX: number;
    screenY: number;
    displayRadius: number;
  } | null {
    if (!__DEBUG__) return null;
    if (!this.rotationFilter) return null;
    for (const child of this.container.children) {
      child.visible = child === this.bodyContainer;
    }
    return {
      screenX: this.screenX,
      screenY: this.screenY,
      displayRadius: this.displayRadius,
    };
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    // Stop any in-flight equirect-map upgrade from touching torn-down objects.
    this.destroyed = true;

    // Remove all event listeners
    this.graphics.removeAllListeners();

    // Dispose the rotation filter (its GL program is shared/cached, so pass the
    // default destroyPrograms=false; the map texture is a shared cache entry and
    // must NOT be destroyed here — other planets reuse it).
    if (this.rotationFilter) {
      this.rotationFilter.destroy();
      this.rotationFilter = null;
    }

    // Destroy graphics and container (children incl. the filtered sprite and the
    // tiling-disc wrapper + its mask).
    this.graphics.destroy();
    this.container.destroy({ children: true });

    // Drop references to torn-down tiling-disc objects so e2eMaskInfo cannot read
    // destroyed Graphics bounds after teardown.
    this.tiling = null;
    this.tilingSurface = null;
    this.tilingMask = null;

    // Null out callback reference
    this.clickCallback = null;
  }
}
