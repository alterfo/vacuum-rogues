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

/** A display object that may carry filters (for recursive filter disposal). */
interface FilterableNode {
  filters?: { destroy?: () => void }[] | { destroy?: () => void } | null;
  children?: FilterableNode[];
}

/**
 * Renders the system's central star (sun): the volumetric glow halo, the
 * rotating surface (an equirectangular star map on a hemisphere mesh when
 * available, else a procedural disc), the limb-fade mask, and axial rotation.
 *
 * Also owns the sun-contact hull-damage accounting — the host scene calls
 * {@link updateSunContactDamage} each frame with the ship position and gets back
 * whether a fresh "burning" episode just started (to fire its own toast).
 *
 * The star sits at the centre of the viewport (screen-centre world coordinates),
 * which the host scene reads via {@link centerX}/{@link centerY} for collision,
 * orbit layout and route avoidance ({@link radius}/{@link avoidRadius}).
 */
export class StarRenderer implements FlightModule {
  private readonly gameEngine: GameEngine | null;
  private readonly gameLayer: Container;
  private destroyed = false;

  /** World position of the star centre (collision + avoidance Information Expert). */
  readonly centerX: number;
  readonly centerY: number;
  /** Visual radius of the star disc (world units). */
  readonly radius = GAME_BALANCE.starRadius;
  /** Radius the route planner bows flight paths around so ships skirt the sun. */
  readonly avoidRadius = SUN_EXCLUSION_RADIUS;

  private starSurface: Container | null = null; // rotating star surface
  private starHaloContainer: Container | null = null; // blurred glow behind star
  // Equirect sun map scrolled under a circular mask for real axial rotation
  // (US-070 #4) when the sphere mesh is unavailable.
  private starTiling: TilingSprite | null = null;
  // Preferred sun rendering: an equirect map on a hemisphere mesh (see
  // sphereMesh.ts) so it really turns rather than scrolling flat.
  private sunSphere: SphereMesh | null = null;
  private starElapsed = 0;

  // Latches the star-touch toast so the "Корпус горит!" warning fires once
  // while the ship is inside the star radius, not every frame.
  private starTouchActive = false;
  // Accumulates game-time (ms) spent inside the star radius. Hull damage is
  // applied in discrete SUN_CONTACT_HULL_DAMAGE chunks once this crosses
  // SUN_CONTACT_DAMAGE_INTERVAL_MS, so the hull never drains frame-by-frame.
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

  // ---------------------------------------------------------------------------
  // FlightModule lifecycle
  // ---------------------------------------------------------------------------

  initialize(): void {
    this.createStar();
  }

  update(deltaTime: number, _bgElapsed: number): void {
    this.updateStar(deltaTime);
  }

  destroy(): void {
    this.destroyed = true;
    // The star objects live on the game layer; the host scene normally tears the
    // layer down, but dispose + remove + destroy them here too so the module is
    // self-contained (clean standalone destroy: no children leak on gameLayer).
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

  // ---------------------------------------------------------------------------
  // Sun-contact hull damage (called by the host scene's ship update loop)
  // ---------------------------------------------------------------------------

  /**
   * While the ship is inside the star visual radius, burn the hull in discrete
   * {@link SUN_CONTACT_HULL_DAMAGE} chunks, rate-limited to once per
   * {@link SUN_CONTACT_DAMAGE_INTERVAL_MS} of game time so a graze does not
   * drain the hull frame-by-frame. Returns `true` on the frame a fresh contact
   * episode begins, so the caller can fire its "hull burning" toast once.
   */
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
          // Route through the difficulty-mode damage rule so GOD honours the
          // hull floor here too (the star can't drain a GOD ship to 0); NORMAL
          // and HARD clamp to 0 exactly as the old Math.max(0, …) did.
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

  // ---------------------------------------------------------------------------
  // Filter cleanup (no flight blurs remain — kept to dispose any stray filter)
  // ---------------------------------------------------------------------------

  /** Recursively destroy every filter attached to a display-object subtree. */
  private disposeFiltersDeep(obj: FilterableNode): void {
    const fs = obj.filters;
    const arr = Array.isArray(fs) ? fs : fs ? [fs] : [];
    for (const f of arr) f.destroy?.();
    for (const child of obj.children ?? []) {
      this.disposeFiltersDeep(child);
    }
  }

  // ---------------------------------------------------------------------------
  // Star creation + rotation
  // ---------------------------------------------------------------------------

  /**
   * Create a beautiful star (sun) at the center of the system
   */
  private createStar(): void {
    const R = this.radius;
    const rng = new SeededRNG(
      `star_${this.gameEngine?.player?.currentSystemId ?? "x"}`,
    );

    // Volumetric glow halo — a blurred container in screen blend, placed behind
    // the surface so the star appears to radiate warm light into the void.
    this.starHaloContainer = this.buildStarHalo(R);
    this.gameLayer.addChild(this.starHaloContainer);

    // --- Rotating surface: generated star art if available, else procedural ---
    // Preferred: equirectangular star map projected onto a hemisphere so the
    // surface really turns, tinted per star type. The equirect star_maps are a
    // lazy category (not preloaded), so on the first visit pickStarTexture
    // returns undefined and the procedural sun below renders; a background load
    // then upgrades to the equirect map when it arrives.
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
    // base disc, brighter toward the centre
    disc.circle(0, 0, R).fill({ color: 0xff8800 });
    disc.circle(0, 0, R * 0.82).fill({ color: 0xffab1f });
    disc.circle(0, 0, R * 0.55).fill({ color: 0xffd24a });
    // turbulent surface patches (darker spots + bright flares)
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
    // bright hot core
    disc.circle(0, 0, R * 0.32).fill({ color: 0xfff6cc, alpha: 0.85 });

    // Clip mottling to the disc so nothing spills past the rim.
    const mask = new Graphics();
    mask.circle(0, 0, R).fill({ color: 0xffffff });
    surface.addChild(mask);
    disc.mask = mask;
    surface.addChild(disc);

    this.starSurface = surface;
    this.gameLayer.addChild(surface);

    // Procedural sun for now; upgrade to the equirect star map once it loads.
    this.scheduleStarMapUpgrade(R);
  }

  /**
   * Build the rotating star surface from an equirectangular map (sphere mesh, or
   * a flat scrolling-disc fallback), add the limb-fade mask, and mount it on the
   * game layer. Sets {@link sunSphere}/{@link starTiling}/{@link starSurface}.
   */
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
      // Fallback: flat scrolling disc under a circular mask. A TilingSprite's
      // renderer drops a mask assigned to it (the "rectangles" bug class), so
      // reuse the planet's buildTilingDisc wrapper: the mask lives on a plain
      // wrapper Container, never on the TilingSprite itself.
      const disc = buildTilingDisc(sunMap, R);
      disc.tiling.tint = tint;
      this.starTiling = disc.tiling;
      surface.addChild(disc.surface);
    }

    // Radial limb-fade mask: opaque at center, fades to transparent at edge
    // so the star boundary blends into the halo rather than hard-clipping.
    const limbMask = this.buildStarLimbMask(R);
    surface.addChild(limbMask);
    surface.mask = limbMask;

    this.starSurface = surface;
    this.gameLayer.addChild(surface);
  }

  /**
   * If the current star's equirect map is not cached yet, lazily load it and
   * swap the rotating surface over to it once it arrives. No-op when the map is
   * already in use (re-entry) or absent from the manifest. Guarded against a
   * torn-down scene and against the player having warped away mid-load.
   */
  private scheduleStarMapUpgrade(R: number): void {
    const sp = this.starMapPrefix();
    if (!sp) return;
    // Already rendering the equirect map (it is cached and preferred) → nothing
    // to upgrade.
    if (pickVariant("star_maps", sp.prefix, sp.systemId)) return;
    const key = pickVariantKey("star_maps", sp.prefix, sp.systemId);
    if (!key) return;
    void loadTextureAsync(key).then((mapTex) => {
      if (!mapTex || this.destroyed) return;
      // Player may have warped to another system while the map was loading.
      if (this.gameEngine?.player?.currentSystemId !== sp.systemId) return;
      // Tear down the previous (procedural) surface first.
      if (this.starSurface) {
        this.gameLayer.removeChild(this.starSurface);
        // Container.destroy({children}) does NOT dispose child filters in
        // PixiJS v8, so the procedural sun's BlurFilter would leak on upgrade.
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

  /**
   * Resolve the equirect star-map prefix (e.g. `yellow`, `blue_giant`) for the
   * current system's star type, or undefined when unknown. Shared by
   * {@link pickStarTexture} and {@link scheduleStarMapUpgrade}.
   */
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

  /**
   * Generated star art for the current system's star type (deterministic per
   * system), or undefined to fall back to the procedural sun.
   */
  private pickStarTexture(): Texture | undefined {
    const sp = this.starMapPrefix();
    if (!sp) return undefined;
    // Only equirectangular `star_maps` are valid here: `mountStarMapSurface`
    // UV-wraps the texture onto a hemisphere, so a round `stars/` sprite would
    // be badly distorted. When no star_map is cached yet (first visit, lazy
    // category) we deliberately return undefined so the procedural sun renders;
    // `scheduleStarMapUpgrade` then swaps in the equirect map once it loads.
    return pickVariant("star_maps", sp.prefix, sp.systemId);
  }

  /**
   * Build a Canvas-based radial gradient texture used as an alpha mask over
   * the star surface so the limb fades to transparent instead of hard-clipping.
   * The gradient is opaque from center to 78% radius, then fades to zero at 100%.
   */
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

  /**
   * Deterministic per-system appearance jitter (Task 2): corona size, glow
   * intensity, and colour temperature, seeded by the current `systemId` so two
   * suns of the same {@link StarType} still look distinct.
   */
  private starJitter(): StarAppearanceJitter {
    return starAppearanceJitter(
      this.gameEngine?.player?.currentSystemId ?? "x",
    );
  }

  /**
   * Tint for the equirect sun map: the current system's StarType base nudged by
   * a small per-system colour-temperature shift (Task 2) so same-type suns vary.
   */
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

  /**
   * Diffuse volumetric glow behind the star. ~30 stacked concentric fills
   * (4.5R → 0.55R, brightening inward) under screen blend accumulate into a
   * smooth, ring-free radial falloff — NO BlurFilter (per-frame blurs removed
   * for FPS). A thin bright limb ring at 1.0R gives the star a defined edge.
   */
  private buildStarHalo(R: number): Container {
    const halo = new Container();
    halo.eventMode = "none";
    halo.x = this.centerX;
    halo.y = this.centerY;

    const systemId = this.gameEngine?.player?.currentSystemId;
    const system = this.gameEngine?.galaxy?.systems.find(
      (s) => s.id === systemId,
    );

    // A single warm glow colour for all layers, keyed to star type. Warm
    // yellow/white for sun-likes; cooler tints for exotic stars.
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

    // Per-system jitter (Task 2): nudge the glow colour temperature and scale
    // the corona size + intensity so two same-type suns read as distinct.
    const jitter = this.starJitter();
    glowC = shiftTemperature(glowC, jitter.tempShift);

    // Smooth radial glow from a baked gradient texture (no per-frame BlurFilter —
    // that was the FPS killer). Tint it to the star colour + scale to the corona
    // size; under screen blend it reads as a soft halo. Falls back to a stacked-
    // fill Graphics when no canvas is available (jsdom) — that path bands slightly
    // but never runs in the real game.
    const glowTex = softGlowTexture();
    const outerScale = 4.5 * jitter.coronaScale;
    if (glowTex) {
      const glow = new Sprite(glowTex);
      glow.anchor.set(0.5);
      glow.eventMode = "none";
      glow.width = R * outerScale * 2;
      glow.height = R * outerScale * 2;
      glow.tint = glowC;
      // Base alpha < 1 leaves headroom for the brightening half of glowIntensity.
      // Without it, values > 1 are silently clamped and only dimming is visible.
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

    // Thin bright limb ring at exactly the star radius — a crisp edge without a
    // hard clip. Drawn unblurred (added after the filter is set so it stays
    // sharp on its own layer? no — it shares the halo blur, which is fine: a
    // 2px stroke at 1.0R reads as a soft rim under screen blend).
    const limb = new Graphics();
    limb.circle(0, 0, R).stroke({ color: 0xffffff, alpha: 0.6, width: 2 });
    halo.addChild(limb);

    return halo;
  }

  /**
   * Animate the sun: roll the surface for axial rotation. Falls back to the
   * scrolling disc / procedural container when no mesh/map is available.
   */
  private updateStar(deltaTime: number): void {
    this.starElapsed += deltaTime;

    if (this.sunSphere) {
      // Roll the surface — the hemisphere mesh gives real spherical foreshortening.
      this.sunSphere.advance(0.00012 * deltaTime);
    } else if (this.starTiling) {
      // Fallback: scroll the map horizontally.
      this.starTiling.tilePosition.x -= 0.012 * deltaTime;
    } else if (this.starSurface) {
      this.starSurface.rotation += 0.00004 * deltaTime;
    }
  }
}
