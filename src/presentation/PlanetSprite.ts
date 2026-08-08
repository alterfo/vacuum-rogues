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

export interface PlanetSpin {
  speed: number;
  direction: number;
}

const SPIN_SLOWEST = 1 / 60000;
const SPIN_FASTEST = 1 / 12000;
const TILING_SCROLL_SCALE = 200;

export function planetSpin(planetId: string): PlanetSpin {
  const rng = new SeededRNG(`spin_${planetId}`);
  const speed = SPIN_SLOWEST + rng.next() * (SPIN_FASTEST - SPIN_SLOWEST);
  const direction = rng.next() < 0.5 ? 1 : -1;
  return { speed, direction };
}

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
  private readonly baseAngle: number;
  private readonly radPerDay: number;
  private isHovered: boolean = false;
  private clickCallback: ((planet: Planet) => void) | null = null;
  private readonly moons: Moon[] = [];
  private readonly backMoonsContainer: Container = new Container();
  private readonly frontMoonsContainer: Container = new Container();
  private readonly bodyContainer: Container = new Container();
  private destroyed = false;
  private surfaceStrip: Graphics | null = null;
  private shadeContainer: Container | null = null;
  private surfaceWidth = 1;
  private surfaceOffset = 0;
  private axialSpeed = 0;
  private tiling: TilingSprite | null = null;
  private tilingSurface: Container | null = null;
  private tilingMask: Graphics | null = null;
  private sphere: SphereMesh | null = null;
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

    const BASE_PERIOD_DAYS = 400;
    const periodDays =
      BASE_PERIOD_DAYS * Math.pow(this.orbitalRadius / 600, 1.5);
    this.radPerDay = (Math.PI * 2) / periodDays;

    this.angle = baseAngle + this.radPerDay * initialDays;

    this.screenX = centerX + Math.cos(this.angle) * this.orbitalRadius;
    this.screenY = centerY + Math.sin(this.angle) * this.orbitalRadius;

    this.container = new Container();
    this.graphics = new Graphics();
    this.container.addChild(this.backMoonsContainer);
    this.container.addChild(this.graphics);
    this.container.addChild(this.bodyContainer);

    this.container.x = this.screenX;
    this.container.y = this.screenY;

    this.render();
    this.buildSphere();
    this.createMoons(); // adds frontMoonsContainer as the last child
  }

  private buildSphere(): void {
    const { color, radius } = this.getPlanetVisuals(this.planet.type);
    const prefix = PLANET_TEXTURE_PREFIX[this.planet.type];

    const mapTex = prefix
      ? pickVariant("planet_maps", prefix, this.planet.id)
      : undefined;
    if (mapTex) {
      this.buildEquirectSphere(mapTex, radius);
      return;
    }

    if (prefix) this.scheduleEquirectUpgrade(prefix, radius);

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

    const rng = new SeededRNG(`surf_${this.planet.id}`);
    const W = radius * 2;

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
    surface.addChild(maskA);
    surface.mask = maskA;
    this.surfaceStrip = strip;
    this.surfaceWidth = W;
    this.axialSpeed =
      (0.004 + rng.next() * 0.004) * (rng.next() < 0.5 ? 1 : -1);

    const maskB = new Graphics().circle(0, 0, radius).fill({ color: 0xffffff });
    const shade = new Container();
    shade.eventMode = "none";
    const sh = new Graphics();
    sh.circle(-radius * 0.45, 0, radius).fill({ color: 0x000008, alpha: 0.5 }); // night side
    sh.circle(-radius * 0.15, 0, radius).fill({ color: 0x000008, alpha: 0.16 }); // terminator
    shade.addChild(sh);
    shade.addChild(maskB); // mask must live in the scene graph (see maskA above)
    shade.mask = maskB;
    this.shadeContainer = shade;

    this.bodyContainer.addChild(surface, shade);
  }

  private scheduleEquirectUpgrade(prefix: string, radius: number): void {
    const key = pickVariantKey("planet_maps", prefix, this.planet.id);
    if (!key) return;
    void loadTextureAsync(key).then((mapTex) => {
      if (!mapTex || this.destroyed) return;
      if (this.rotationFilter || this.sphere || this.tiling) return;
      for (const child of this.bodyContainer.removeChildren()) {
        child.destroy({ children: true });
      }
      this.surfaceStrip = null;
      this.shadeContainer = null;
      this.buildEquirectSphere(mapTex, radius);
    });
  }

  private buildEquirectSphere(mapTex: Texture, radius: number): void {
    const spin = planetSpin(this.planet.id);

    this.shadeContainer = null;

    const forceTiling =
      __DEBUG__ &&
      typeof window !== "undefined" &&
      (window as unknown as Record<string, unknown>)
        .__forcePlanetTilingFallback === true;

    if (!forceTiling) {
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

      const sphere = buildSphereMesh(mapTex, radius);
      if (sphere) {
        this.sphere = sphere;
        this.axialSpeed = spin.speed * spin.direction;
        this.bodyContainer.addChild(sphere.mesh);
        return;
      }
    }

    const { surface, tiling, mask } = buildTilingDisc(mapTex, radius);
    this.tiling = tiling;
    this.tilingSurface = surface;
    this.tilingMask = mask;
    this.axialSpeed = spin.speed * spin.direction * TILING_SCROLL_SCALE;
    this.bodyContainer.addChild(surface);
  }

  private darkenColor(color: number, amount: number): number {
    const r = Math.max(0, ((color >> 16) & 0xff) - amount);
    const g = Math.max(0, ((color >> 8) & 0xff) - amount);
    const b = Math.max(0, (color & 0xff) - amount);
    return (r << 16) | (g << 8) | b;
  }

  private createMoons(): void {
    const { radius } = this.getPlanetVisuals(this.planet.type);
    const rng = new SeededRNG(`moon_${this.planet.id}`);
    const count = rng.nextInt(0, 2);
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

  render(): void {
    this.graphics.clear();

    const { color, radius, hasRings, hasAtmosphere } = this.getPlanetVisuals(
      this.planet.type,
    );

    this.graphics.circle(0, 0, radius + 16);
    this.graphics.fill({ color, alpha: 0.08 });
    this.graphics.circle(0, 0, radius + 12);
    this.graphics.fill({ color, alpha: 0.12 });
    this.graphics.circle(0, 0, radius + 8);
    this.graphics.fill({ color, alpha: 0.18 });

    if (hasAtmosphere) {
      this.graphics.circle(0, 0, radius + 5);
      this.graphics.fill({ color, alpha: 0.25 });
    }

    if (this.isHovered) {
      this.graphics.circle(0, 0, radius + 10);
      this.graphics.fill({ color: 0xffffff, alpha: 0.3 });
      this.graphics.circle(0, 0, radius + 6);
      this.graphics.fill({ color: 0xffffff, alpha: 0.4 });
    }

    this.graphics.circle(0, 0, radius + 4);
    this.graphics.stroke({ color: 0x000000, width: 3, alpha: 0.45 });
    this.graphics.circle(0, 0, radius + 2);
    this.graphics.stroke({
      color: this.lightenColor(color, 110),
      width: 2.5,
      alpha: 0.95,
    });

    this.graphics.circle(0, 0, radius);
    this.graphics.fill({ color });

    if (hasRings) {
      const ringInner = radius + 6;
      const ringOuter = radius + 16;

      this.graphics.ellipse(0, radius * 0.3, radius * 0.9, radius * 0.15);
      this.graphics.fill({ color: 0x000000, alpha: 0.4 });

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

  private getPlanetVisuals(type: PlanetType): {
    color: number;
    radius: number;
    hasRings: boolean;
    hasAtmosphere: boolean;
  } {
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

  private lightenColor(color: number, percent: number): number {
    const r = Math.min(255, ((color >> 16) & 0xff) + percent);
    const g = Math.min(255, ((color >> 8) & 0xff) + percent);
    const b = Math.min(255, (color & 0xff) + percent);
    return (r << 16) | (g << 8) | b;
  }

  createHitArea(onClickCallback: (planet: Planet) => void): void {
    this.clickCallback = onClickCallback;

    this.graphics.eventMode = "static";
    this.graphics.cursor = "pointer";

    this.graphics.on("pointerdown", (event) => {
      event.stopPropagation(); // Prevent stage from also handling this click
      if (this.clickCallback) {
        this.clickCallback(this.planet);
      }
    });

    this.graphics.on("pointerover", () => {
      this.setHoverState(true);
    });

    this.graphics.on("pointerout", () => {
      this.setHoverState(false);
    });
  }

  setTooltipHandlers(
    onOver: (planet: Planet, screenX: number, screenY: number) => void,
    onOut: () => void,
  ): void {
    this.graphics.on("pointerover", (e: FederatedPointerEvent) =>
      onOver(this.planet, e.global.x, e.global.y),
    );
    this.graphics.on("pointerout", onOut);
  }

  setHoverState(isHover: boolean): void {
    this.isHovered = isHover;
    this.render();
  }

  setOrbitForDay(days: number): void {
    this.angle = this.baseAngle + this.radPerDay * days;
    this.screenX = this.centerX + Math.cos(this.angle) * this.orbitalRadius;
    this.screenY = this.centerY + Math.sin(this.angle) * this.orbitalRadius;
    this.container.x = this.screenX;
    this.container.y = this.screenY;
    this.orientShading();
  }

  get displayRadius(): number {
    return this.getPlanetVisuals(this.planet.type).radius;
  }

  orbitalVelocityPerDay(): { vx: number; vy: number } {
    const speed = this.orbitalRadius * this.radPerDay;
    return {
      vx: -Math.sin(this.angle) * speed,
      vy: Math.cos(this.angle) * speed,
    };
  }

  lightDirection(): { x: number; y: number } {
    const dx = this.centerX - this.screenX;
    const dy = this.centerY - this.screenY;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return { x: 1, y: 0 };
    return { x: dx / len, y: dy / len };
  }

  private orientShading(): void {
    const { x: lx, y: ly } = this.lightDirection();
    if (this.shadeContainer) {
      this.shadeContainer.rotation = Math.atan2(ly, lx);
    }
    this.rotationFilter?.setLightDirection(lx, ly);
  }

  update(deltaTime: number): void {
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
    this.orientShading();

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

  e2eHasRotationFilter(): boolean {
    if (!__DEBUG__) return false;
    return this.rotationFilter !== null;
  }

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

  destroy(): void {
    this.destroyed = true;

    this.graphics.removeAllListeners();

    if (this.rotationFilter) {
      this.rotationFilter.destroy();
      this.rotationFilter = null;
    }

    this.graphics.destroy();
    this.container.destroy({ children: true });

    this.tiling = null;
    this.tilingSurface = null;
    this.tilingMask = null;

    this.clickCallback = null;
  }
}
