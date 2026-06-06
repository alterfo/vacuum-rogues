import { Container, Graphics, Sprite, TilingSprite } from "pixi.js";
import type { FederatedPointerEvent, Texture } from "pixi.js";
import type { Planet } from "@/domain/Planet";
import { PlanetType } from "@/types";
import { SeededRNG } from "@/utils/seededRNG";
import { getMoonLayer } from "@/utils/moonZOrder";
import { pickVariant } from "./textures";
import { buildSphereMesh, type SphereMesh } from "./sphereMesh";

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
  // Preferred map-backed rendering: a rotating sphere mesh (convex), like the sun.
  private sphere: SphereMesh | null = null;

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
      this.container.addChild(sprite);
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
    shade.mask = maskB;
    this.shadeContainer = shade;

    this.container.addChild(maskA, surface, maskB, shade);
  }

  /**
   * Build a rotating planet from an equirectangular surface map: a TilingSprite
   * clipped to a circle (scrolled horizontally for axial spin) under a lighting
   * layer rotated each frame so the lit hemisphere faces the star.
   */
  private buildEquirectSphere(mapTex: Texture, radius: number): void {
    const W = radius * 2;
    const rng = new SeededRNG(`surf_${this.planet.id}`);

    // No fake lighting overlay: the specular/rim "glints" and the directional
    // terminator read as weird blobs on the disc. Depth comes from the convex
    // sphere mesh (foreshortening) and the parallax background instead.
    this.shadeContainer = null;

    // Preferred: a real rotating sphere mesh (convex foreshortening) — same
    // technique as the sun (US-070: planets convex too).
    const sphere = buildSphereMesh(mapTex, radius);
    if (sphere) {
      this.sphere = sphere;
      // longitude fraction per ms (slow); randomized direction.
      this.axialSpeed =
        (0.00006 + rng.next() * 0.00006) * (rng.next() < 0.5 ? 1 : -1);
      this.container.addChild(sphere.mesh);
      return;
    }

    // Fallback: flat scrolling disc under a circular mask.
    const maskC = new Graphics().circle(0, 0, radius).fill({ color: 0xffffff });
    const tiling = new TilingSprite({ texture: mapTex, width: W, height: W });
    tiling.x = -radius;
    tiling.y = -radius;
    const scale = W / mapTex.height;
    tiling.tileScale.set(scale, scale);
    tiling.eventMode = "none";
    tiling.mask = maskC;
    this.tiling = tiling;
    this.axialSpeed =
      (0.012 + rng.next() * 0.012) * (rng.next() < 0.5 ? 1 : -1);
    this.container.addChild(maskC, tiling);
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

    // Axial rotation: roll the sphere mesh (preferred), else scroll the equirect
    // tiling / procedural strip.
    if (this.sphere) {
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
   * Clean up resources
   */
  destroy(): void {
    // Remove all event listeners
    this.graphics.removeAllListeners();

    // Destroy graphics and container
    this.graphics.destroy();
    this.container.destroy({ children: true });

    // Null out callback reference
    this.clickCallback = null;
  }
}
