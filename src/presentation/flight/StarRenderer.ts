import { Container, Graphics, Sprite, TilingSprite, Texture } from "pixi.js";
import { softGlowTexture } from "../gradientTexture";
import type { Renderer } from "../Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import { StarType } from "@/types";
import { SeededRNG } from "@/utils/seededRNG";
import { STAR_MAP_PREFIX } from "@/systems/galaxy/starTypeDistribution";
import {
  starAppearanceJitter,
  shiftTemperature,
  GLOW_SPREAD,
  type StarAppearanceJitter,
} from "@/utils/starAppearance";
import { buildSphereMesh, type SphereMesh } from "../sphereMesh";
import { buildTilingDisc } from "../PlanetSprite";
import { pickVariant, pickVariantKey, loadTextureAsync } from "../textures";
import {
  GAME_BALANCE,
  SUN_EXCLUSION_RADIUS,
  SUN_CONTACT_HULL_DAMAGE,
  SUN_CONTACT_DAMAGE_INTERVAL_MS,
} from "@/config/balance";
import { applyDamageWithMode } from "@/systems/combat/godMode";
import type { FlightModule } from "./FlightModule";

interface FilterableNode {
  filters?: { destroy?: () => void }[] | { destroy?: () => void } | null;
  children?: FilterableNode[];
}

export class StarRenderer implements FlightModule {
  private readonly gameEngine: GameEngine | null;
  private readonly gameLayer: Container;
  private destroyed = false;

  readonly centerX: number;
  readonly centerY: number;
  readonly radius = GAME_BALANCE.starRadius;
  readonly avoidRadius = SUN_EXCLUSION_RADIUS;

  private starSurface: Container | null = null; // rotating star surface
  private starHaloContainer: Container | null = null; // blurred glow behind star
  private starTiling: TilingSprite | null = null;
  private sunSphere: SphereMesh | null = null;
  private starElapsed = 0;

  private starTouchActive = false;
  private sunContactDamageTimer = 0;

  constructor(
    renderer: Renderer,
    gameEngine: GameEngine | null,
    gameLayer: Container,
  ) {
    this.gameEngine = gameEngine;
    this.gameLayer = gameLayer;
    this.centerX = renderer.app.screen.width / 2;
    this.centerY = renderer.app.screen.height / 2;
  }

  initialize(): void {
    this.createStar();
  }

  update(deltaTime: number, _bgElapsed: number): void {
    this.updateStar(deltaTime);
  }

  destroy(): void {
    this.destroyed = true;
    for (const obj of [this.starSurface, this.starHaloContainer]) {
      if (!obj) continue;
      this.disposeFiltersDeep(obj as unknown as FilterableNode);
      if (obj.parent) obj.parent.removeChild(obj);
      if (!obj.destroyed) obj.destroy({ children: true });
    }
    this.starSurface = null;
    this.starHaloContainer = null;
    this.starTiling = null;
    this.sunSphere = null;
    this.starElapsed = 0;
    this.starTouchActive = false;
    this.sunContactDamageTimer = 0;
  }

  updateSunContactDamage(
    deltaTime: number,
    playerX: number,
    playerY: number,
    turnRunning: boolean,
    timeScale: number,
  ): boolean {
    const distToStar = Math.hypot(
      playerX - this.centerX,
      playerY - this.centerY,
    );
    const touchingStar = distToStar < this.radius;
    let justStartedBurning = false;
    if (touchingStar && turnRunning) {
      this.sunContactDamageTimer += deltaTime * timeScale;
      const burnPlayer = this.gameEngine?.player;
      const burnShip = burnPlayer?.ship;
      while (this.sunContactDamageTimer >= SUN_CONTACT_DAMAGE_INTERVAL_MS) {
        this.sunContactDamageTimer -= SUN_CONTACT_DAMAGE_INTERVAL_MS;
        if (burnPlayer && burnShip) {
          burnShip.hullHP = applyDamageWithMode(
            burnPlayer.gameMode,
            burnShip.hullHP,
            SUN_CONTACT_HULL_DAMAGE,
            burnShip.maxHull,
          ).hull;
        }
      }
      if (!this.starTouchActive) {
        this.starTouchActive = true;
        justStartedBurning = true;
      }
    } else if (!touchingStar) {
      this.starTouchActive = false;
      this.sunContactDamageTimer = 0;
    }
    return justStartedBurning;
  }

  private disposeFiltersDeep(obj: FilterableNode): void {
    const fs = obj.filters;
    const arr = Array.isArray(fs) ? fs : fs ? [fs] : [];
    for (const f of arr) f.destroy?.();
    for (const child of obj.children ?? []) {
      this.disposeFiltersDeep(child);
    }
  }

  private createStar(): void {
    const R = this.radius;
    const rng = new SeededRNG(
      `star_${this.gameEngine?.player?.currentSystemId ?? "x"}`,
    );

    this.starHaloContainer = this.buildStarHalo(R);
    this.gameLayer.addChild(this.starHaloContainer);

    const sunMap = this.pickStarTexture();
    if (sunMap) {
      this.mountStarMapSurface(R, sunMap);
      this.scheduleStarMapUpgrade(R);
      return;
    }

    const surface = new Container();
    surface.eventMode = "none"; // decorative — never intercept clicks
    surface.x = this.centerX;
    surface.y = this.centerY;

    const disc = new Graphics();
    disc.circle(0, 0, R).fill({ color: 0xff8800 });
    disc.circle(0, 0, R * 0.82).fill({ color: 0xffab1f });
    disc.circle(0, 0, R * 0.55).fill({ color: 0xffd24a });
    const spots = rng.nextInt(22, 30);
    for (let i = 0; i < spots; i++) {
      const ang = rng.next() * Math.PI * 2;
      const dist = rng.next() * R * 0.95;
      const px = Math.cos(ang) * dist;
      const py = Math.sin(ang) * dist;
      const pr = rng.nextFloat(R * 0.08, R * 0.26);
      const dark = rng.next() < 0.5;
      disc.circle(px, py, pr).fill({
        color: dark ? 0xc23a12 : 0xfff0a0,
        alpha: rng.nextFloat(0.25, 0.6),
      });
    }
    disc.circle(0, 0, R * 0.32).fill({ color: 0xfff6cc, alpha: 0.85 });

    const mask = new Graphics();
    mask.circle(0, 0, R).fill({ color: 0xffffff });
    surface.addChild(mask);
    disc.mask = mask;
    surface.addChild(disc);

    this.starSurface = surface;
    this.gameLayer.addChild(surface);

    this.scheduleStarMapUpgrade(R);
  }

  private mountStarMapSurface(R: number, sunMap: Texture): void {
    const surface = new Container();
    surface.eventMode = "none"; // decorative — never intercept clicks
    surface.x = this.centerX;
    surface.y = this.centerY;

    const tint = this.starTint();
    this.sunSphere = buildSphereMesh(sunMap, R, tint);
    const mesh = this.sunSphere?.mesh ?? null;

    if (mesh) {
      surface.addChild(mesh);
    } else {
      const disc = buildTilingDisc(sunMap, R);
      disc.tiling.tint = tint;
      this.starTiling = disc.tiling;
      surface.addChild(disc.surface);
    }

    const limbMask = this.buildStarLimbMask(R);
    surface.addChild(limbMask);
    surface.mask = limbMask;

    this.starSurface = surface;
    this.gameLayer.addChild(surface);
  }

  private scheduleStarMapUpgrade(R: number): void {
    const sp = this.starMapPrefix();
    if (!sp) return;
    if (pickVariant("star_maps", sp.prefix, sp.systemId)) return;
    const key = pickVariantKey("star_maps", sp.prefix, sp.systemId);
    if (!key) return;
    void loadTextureAsync(key).then((mapTex) => {
      if (!mapTex || this.destroyed) return;
      if (this.gameEngine?.player?.currentSystemId !== sp.systemId) return;
      if (this.starSurface) {
        this.gameLayer.removeChild(this.starSurface);
        for (const child of this.starSurface.children) {
          const fs = (
            child as {
              filters?:
                | { destroy?: () => void }[]
                | { destroy?: () => void }
                | null;
            }
          ).filters;
          const arr = Array.isArray(fs) ? fs : fs ? [fs] : [];
          for (const f of arr) f.destroy?.();
        }
        this.starSurface.destroy({ children: true });
        this.starSurface = null;
      }
      this.sunSphere = null;
      this.starTiling = null;
      this.mountStarMapSurface(R, mapTex);
    });
  }

  private starMapPrefix(): { systemId: string; prefix: string } | undefined {
    const systemId = this.gameEngine?.player?.currentSystemId;
    if (!systemId) return undefined;
    const system = this.gameEngine?.galaxy?.systems.find(
      (s) => s.id === systemId,
    );
    if (!system) return undefined;
    const prefix = STAR_MAP_PREFIX[system.starType];
    return prefix ? { systemId, prefix } : undefined;
  }

  private pickStarTexture(): Texture | undefined {
    const sp = this.starMapPrefix();
    if (!sp) return undefined;
    return pickVariant("star_maps", sp.prefix, sp.systemId);
  }

  private buildStarLimbMask(R: number): Sprite {
    const size = Math.ceil(R * 2 + 4);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const cx = size / 2;
    const grad = ctx.createRadialGradient(cx, cx, 0, cx, cx, R);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.78, "rgba(255,255,255,1)");
    grad.addColorStop(1.0, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    const maskTex = Texture.from(canvas);
    const sprite = new Sprite(maskTex);
    sprite.anchor.set(0.5);
    sprite.eventMode = "none";
    return sprite;
  }

  private starJitter(): StarAppearanceJitter {
    return starAppearanceJitter(
      this.gameEngine?.player?.currentSystemId ?? "x",
    );
  }

  private starTint(): number {
    const systemId = this.gameEngine?.player?.currentSystemId;
    const system = this.gameEngine?.galaxy?.systems.find(
      (s) => s.id === systemId,
    );
    let base: number;
    switch (system?.starType) {
      case StarType.RED_DWARF:
        base = 0xff7a4d; // deep red-orange
        break;
      case StarType.BLUE_GIANT:
        base = 0x8fb8ff; // blue-white
        break;
      case StarType.WHITE_DWARF:
        base = 0xfff2e6; // near white
        break;
      case StarType.NEUTRON:
        base = 0xcfe0ff; // cold brilliant
        break;
      default:
        base = 0xffd9a0; // warm yellow sun
    }
    return shiftTemperature(base, this.starJitter().tempShift);
  }

  private buildStarHalo(R: number): Container {
    const halo = new Container();
    halo.eventMode = "none";
    halo.x = this.centerX;
    halo.y = this.centerY;

    const systemId = this.gameEngine?.player?.currentSystemId;
    const system = this.gameEngine?.galaxy?.systems.find(
      (s) => s.id === systemId,
    );

    let glowC = 0xffcc55;
    switch (system?.starType) {
      case StarType.RED_DWARF:
        glowC = 0xff7733;
        break;
      case StarType.BLUE_GIANT:
        glowC = 0x88bbff;
        break;
      case StarType.WHITE_DWARF:
        glowC = 0xffffff;
        break;
      case StarType.NEUTRON:
        glowC = 0xcfe0ff;
        break;
    }

    const jitter = this.starJitter();
    glowC = shiftTemperature(glowC, jitter.tempShift);

    const glowTex = softGlowTexture();
    const outerScale = 4.5 * jitter.coronaScale;
    if (glowTex) {
      const glow = new Sprite(glowTex);
      glow.anchor.set(0.5);
      glow.eventMode = "none";
      glow.width = R * outerScale * 2;
      glow.height = R * outerScale * 2;
      glow.tint = glowC;
      glow.alpha = Math.min(1, (1 / (1 + GLOW_SPREAD)) * jitter.glowIntensity);
      halo.addChild(glow);
    } else {
      const g = new Graphics();
      const RINGS = 30;
      const innerScale = 0.55;
      for (let i = 0; i < RINGS; i++) {
        const t = i / (RINGS - 1); // 0 (outer/faint) → 1 (inner/bright)
        const scale = outerScale + (innerScale - outerScale) * t;
        const alpha = (0.03 + 0.05 * t) * jitter.glowIntensity;
        g.circle(0, 0, R * scale).fill({ color: glowC, alpha });
      }
      halo.addChild(g);
    }

    halo.blendMode = "screen";

    return halo;
  }

  private updateStar(deltaTime: number): void {
    this.starElapsed += deltaTime;

    if (this.sunSphere) {
      this.sunSphere.advance(0.00003 * deltaTime);
    } else if (this.starTiling) {
      this.starTiling.tilePosition.x -= 0.003 * deltaTime;
    } else if (this.starSurface) {
      this.starSurface.rotation += 0.00001 * deltaTime;
    }
  }
}
