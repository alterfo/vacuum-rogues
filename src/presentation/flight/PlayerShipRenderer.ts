import { Container, Graphics, Sprite } from "pixi.js";
import type { Renderer } from "../Renderer";
import type { ShipPhysics } from "@/systems/ShipPhysics";
import { pickVariant } from "../textures";
import { pointAlongPath } from "@/utils/flightGeometry";
import type { FlightModule } from "./FlightModule";

/** A display object that may carry filters (for recursive filter disposal). */
interface FilterableNode {
  filters?: { destroy?: () => void }[] | { destroy?: () => void } | null;
  children?: FilterableNode[];
}

/**
 * Renders the player's ship: the procedural hull (or the ranger sprite when art
 * is available), the soft volumetric glow behind it, the heading-target
 * crosshair, and the cosmetic take-off arc that plays when lifting off a planet.
 *
 * The module owns the ship's display objects on the game layer and reads the
 * authoritative position/heading from the injected {@link ShipPhysics} every
 * frame. The host scene keeps the flight logic (physics step, day counting,
 * landing/docking/warp) and reads {@link container} for the ship's world
 * position; it defers to the module while the take-off arc is active
 * ({@link isArcActive}) so no game-days are burned during the flourish.
 */
export class PlayerShipRenderer implements FlightModule {
  private readonly gameLayer: Container;
  private readonly shipPhysics: ShipPhysics;

  private shipContainer: Container | null = null;
  private shipGraphics: Graphics | null = null;
  // Soft volumetric glow blob behind the ship — gives 3D presence against the
  // dark backdrop. Created once and blurred; not redrawn per frame so the filter
  // texture stays stable.
  private shipGlow: Graphics | null = null;
  // Player-ship art (if available); falls back to the procedural triangle.
  private shipSprite: Sprite | null = null;
  // Heading 0 points +X (east); the ship art faces "down" (nose at the bottom of
  // the image), so the sprite is pre-rotated -90° (counter-clockwise) to align
  // art-forward with the heading. Verified live in US-070 Round 4.
  private readonly SHIP_SPRITE_ROTATION = -Math.PI / 2;
  private readonly SHIP_SIZE = 20;

  // Heading-target crosshair (pulsing) shown while the ship flies to a point.
  private targetIndicator: Graphics | null = null;

  // Cosmetic take-off arc: when the ship lifts off a planet it flies a short
  // outward curve before autopilot engages. Driven by a fixed-speed walk along
  // this polyline; the flight physics stays parked at the end point so no
  // game-days are burned and the day/landing logic in updateShip is bypassed.
  private takeoffArc: { x: number; y: number }[] | null = null;
  private takeoffArcDist = 0;
  private static readonly TAKEOFF_ARC_SPEED = 0.5; // px/ms

  // Animation clock (ms) pushed in from the scene each frame — drives the
  // engine-flame pulse and the target-crosshair pulse.
  private bgElapsed = 0;

  // Lowercased hull class (e.g. "heavy_freighter") used to pick per-hull ship
  // art. Empty ⇒ no specific hull known; the renderer falls back to ranger art.
  private readonly hullClassKey: string;

  // `hull_cruiser` (gear-catalog & garrison-power-ceiling plan, 2026-07-19) has
  // no dedicated ship art yet — reuses the Destroyer's key until dedicated
  // "cruiser" art is generated, mirroring `NpcShipSprite`'s
  // OVERMIND→"patrol" reuse-until-drawn pattern (`assetCoverage.test.ts`
  // enforces every `player_ships/<hullClass>` prefix actually resolves).
  private static readonly HULL_ART_ALIAS: Record<string, string> = {
    cruiser: "destroyer",
  };

  constructor(
    _renderer: Renderer,
    gameLayer: Container,
    shipPhysics: ShipPhysics,
    hullClass = "",
  ) {
    this.gameLayer = gameLayer;
    this.shipPhysics = shipPhysics;
    const key = hullClass.toLowerCase();
    this.hullClassKey = PlayerShipRenderer.HULL_ART_ALIAS[key] ?? key;
  }

  // ---------------------------------------------------------------------------
  // FlightModule lifecycle
  // ---------------------------------------------------------------------------

  initialize(): void {
    this.createShip();
    this.createTargetIndicator();
  }

  update(deltaTime: number, bgElapsed: number): void {
    this.bgElapsed = bgElapsed;
    if (this.takeoffArc) {
      // Take-off flourish in progress: walk the cosmetic arc (sets the container).
      this.updateTakeoff(deltaTime);
    } else if (this.shipContainer) {
      // Otherwise mirror the authoritative physics position/heading.
      this.shipContainer.x = this.shipPhysics.shipX;
      this.shipContainer.y = this.shipPhysics.shipY;
      this.shipContainer.rotation = this.shipPhysics.shipAngle;
    }
    this.drawShip();
    this.updateTargetIndicator();
  }

  destroy(): void {
    for (const obj of [this.shipContainer, this.targetIndicator]) {
      if (!obj) continue;
      this.disposeFiltersDeep(obj as unknown as FilterableNode);
      if (obj.parent) obj.parent.removeChild(obj);
      // typeof guard so this survives partial PixiJS test mocks whose Graphics
      // stand-in has no destroy() (the real Graphics always does).
      if (typeof obj.destroy === "function" && !obj.destroyed) {
        obj.destroy({ children: true });
      }
    }
    this.shipContainer = null;
    this.shipGraphics = null;
    this.shipGlow = null;
    this.shipSprite = null;
    this.targetIndicator = null;
    this.takeoffArc = null;
    this.takeoffArcDist = 0;
  }

  // ---------------------------------------------------------------------------
  // Public surface read by the host scene
  // ---------------------------------------------------------------------------

  /** The ship's world-space container (or null before initialize()/after destroy). */
  get container(): Container | null {
    return this.shipContainer;
  }

  /** True while the cosmetic take-off arc is playing (physics is parked). */
  isArcActive(): boolean {
    return this.takeoffArc !== null;
  }

  /**
   * Begin the cosmetic take-off arc (the scene builds the polyline and parks the
   * physics at its end). Positions the ship container at the arc's start; the
   * per-frame walk then happens in {@link updateTakeoff} via {@link update}.
   */
  startTakeoffArc(arc: { x: number; y: number }[]): void {
    this.takeoffArc = arc;
    this.takeoffArcDist = 0;
    if (this.shipContainer && arc.length > 0) {
      this.shipContainer.x = arc[0].x;
      this.shipContainer.y = arc[0].y;
    }
  }

  // ---------------------------------------------------------------------------
  // Filter helper
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
  // Ship creation + drawing
  // ---------------------------------------------------------------------------

  private createShip(): void {
    this.shipContainer = new Container();

    // Volumetric glow blob drawn FIRST so it sits behind the hull/sprite. A soft
    // blue halo reads as depth and keeps the ship visible against dark space.
    // Whether the active hull is the sprite or the procedural triangle, this glow
    // is the "behind the ship" depth cue — for the sprite case it stands in for
    // an outline filter (no @pixi/filter-outline dependency in this project).
    this.shipGlow = new Graphics();
    this.shipGlow.eventMode = "none";
    this.shipContainer.addChild(this.shipGlow);

    this.shipGraphics = new Graphics();
    this.shipContainer.addChild(this.shipGraphics);

    // Prefer per-hull ship art keyed by the installed hull class (so buying a
    // new hull changes the ship's look), then the generic ranger hull, then the
    // procedural triangle (drawShip skips the hull when a sprite is present).
    const shipTex =
      (this.hullClassKey &&
        pickVariant("player_ships", this.hullClassKey, "player_ship")) ||
      pickVariant("ships", "ranger", "player_ship");
    if (shipTex) {
      const sp = new Sprite(shipTex);
      sp.anchor.set(0.5);
      const size = this.SHIP_SIZE * 2.6;
      sp.width = size;
      sp.height = size;
      sp.rotation = this.SHIP_SPRITE_ROTATION;
      sp.eventMode = "none";
      this.shipSprite = sp;
      this.shipContainer.addChild(sp);
    }

    // Tight radial halo that hugs the hull silhouette (playtest 2 ⑤ — the old
    // single big circle + strong blur read as a flat oversized smear). Three
    // concentric circles with decreasing alpha give a smooth radial falloff that
    // fades just past the hull edge; a GENTLE blur softens the bands into a
    // continuous gradient without ballooning the halo the way strength-8 did.
    // The outer radius peeks just past the active hull representation — the
    // sprite (~2.6× the procedural triangle) gets a slightly wider halo.
    this.drawShipGlow();

    // Draw ship body (procedural triangle; no-op hull when a sprite is used)
    this.drawShip();

    this.shipContainer.zIndex = 110; // player ship above NPCs and planets
    this.shipContainer.x = this.shipPhysics.shipX;
    this.shipContainer.y = this.shipPhysics.shipY;
    this.shipContainer.pivot.set(0, 0);

    this.gameLayer.addChild(this.shipContainer);
  }

  /**
   * Draw the soft depth halo behind the ship: a tight radial falloff made of
   * stacked concentric circles with decreasing alpha (brightest at the centre,
   * fading at the rim) — no BlurFilter (per-frame blurs removed for FPS). Sized
   * to hug the hull silhouette and peek just past its edge — never a flat
   * oversized smear (playtest 2 ⑤). Drawn once (not per frame).
   */
  private drawShipGlow(): void {
    if (!this.shipGlow) return;
    this.shipGlow.clear();
    // Outer radius hugs the hull: the sprite art is ~2.6× the procedural
    // triangle, so it gets a slightly wider halo to peek past the artwork edge.
    const outerR = this.shipSprite
      ? this.SHIP_SIZE * 1.4
      : this.SHIP_SIZE * 0.95;
    // Many thin concentric fills (largest/faintest → smallest/brightest) stack
    // into a smooth radial falloff WITHOUT a BlurFilter (per-frame blurs removed
    // for FPS). The glow is small, so stacked fills read as a soft halo.
    const GLOW_LAYERS = 10;
    for (let i = 0; i < GLOW_LAYERS; i++) {
      const t = i / (GLOW_LAYERS - 1); // 0 outer → 1 inner
      const r = outerR * (1 - 0.62 * t);
      const alpha = 0.05 + 0.04 * t;
      this.shipGlow.circle(0, 0, r).fill({ color: 0x3a6fd0, alpha });
    }
  }

  /**
   * Create target indicator (crosshair showing where ship is heading)
   */
  private createTargetIndicator(): void {
    this.targetIndicator = new Graphics();
    this.targetIndicator.eventMode = "none"; // decorative — never intercept clicks
    this.targetIndicator.visible = false; // Hidden by default
    this.gameLayer.addChild(this.targetIndicator);
  }

  /**
   * Update target indicator position and visibility
   */
  private updateTargetIndicator(): void {
    if (!this.targetIndicator) return;

    const distance = this.shipPhysics.getDistanceToTarget();

    // Show indicator only if ship is moving toward a far enough point AND it's a
    // bare point-move, not an auto-plotted route. On a route the dashed route
    // line + destination marker already show where the ship is going, so the
    // pulsing crosshair is just noise (playtest: hide it during route flight).
    if (
      this.shipPhysics.isMoving &&
      distance > 20 &&
      !this.shipPhysics.isFollowingRoute()
    ) {
      this.targetIndicator.visible = true;
      this.targetIndicator.clear();

      // Draw pulsing crosshair at target position
      const targetX = this.shipPhysics.getTargetX();
      const targetY = this.shipPhysics.getTargetY();

      const size = 15;
      const pulse = Math.sin(this.bgElapsed / 200) * 0.3 + 0.7; // Pulsing effect

      // Crosshair lines
      this.targetIndicator.moveTo(targetX - size, targetY);
      this.targetIndicator.lineTo(targetX + size, targetY);
      this.targetIndicator.moveTo(targetX, targetY - size);
      this.targetIndicator.lineTo(targetX, targetY + size);
      this.targetIndicator.stroke({ width: 2, color: 0x00ffff, alpha: pulse });

      // Center circle
      this.targetIndicator.circle(targetX, targetY, 4);
      this.targetIndicator.stroke({
        width: 1,
        color: 0x00ffff,
        alpha: pulse * 0.8,
      });
    } else {
      this.targetIndicator.visible = false;
    }
  }

  private drawShip(): void {
    if (!this.shipGraphics) return;
    this.shipGraphics.clear();

    // When ship art is present, the sprite is the hull — skip the procedural
    // triangle (it would draw on top of the sprite).
    if (this.shipSprite) return;

    const size = this.SHIP_SIZE;

    // Main hull — drawn as a fill, then re-stroked with a crisp cyan rim so the
    // silhouette reads clearly against dark space.
    const hull = [
      size,
      0,
      -size * 0.7,
      -size * 0.6,
      -size * 0.4,
      0,
      -size * 0.7,
      size * 0.6,
    ];
    this.shipGraphics.poly(hull).fill({ color: 0x4488cc });
    this.shipGraphics
      .poly(hull)
      .stroke({ color: 0x44ccff, alpha: 0.9, width: 1.5 });

    // Cockpit
    this.shipGraphics
      .poly([
        size * 0.3,
        0,
        -size * 0.2,
        -size * 0.25,
        -size * 0.2,
        size * 0.25,
      ])
      .fill({ color: 0x88ccff });

    // Engine glow (visible when ship is moving). bgElapsed is in ms, so /80 gives
    // a ~0.5 s pulse; the alpha now swings 0.10–1.0 (amplitude 0.45) for a strong
    // engine flicker, and the flame reaches further (0.7× vs 0.5×).
    if (this.shipPhysics.isMoving) {
      const enginePulse = 0.5 + 0.5 * Math.sin(this.bgElapsed / 80);
      this.shipGraphics
        .poly([
          -size * 0.5,
          -size * 0.4,
          -size * 0.5 - size * 0.7 * enginePulse,
          0,
          -size * 0.5,
          size * 0.4,
        ])
        .fill({
          color: 0x00ffff,
          alpha: 0.55 + 0.45 * Math.sin(this.bgElapsed / 80),
        });
    }

    // Engine lights
    this.shipGraphics.fill({ color: 0x00ffff, alpha: 0.8 });
    this.shipGraphics.circle(-size * 0.5, -size * 0.3, 2);
    this.shipGraphics.circle(-size * 0.5, size * 0.3, 2);
  }

  // ---------------------------------------------------------------------------
  // Take-off arc (cosmetic outward curve when lifting off a planet)
  // ---------------------------------------------------------------------------

  /**
   * Advance the cosmetic take-off arc: walk the ship container along the outward
   * curve at a constant speed, facing the direction of travel. The flight physics
   * is already parked at the arc's end point, so when the walk completes the ship
   * simply stays there and normal autopilot resumes.
   */
  private updateTakeoff(deltaTime: number): void {
    if (!this.takeoffArc || !this.shipContainer) return;
    this.takeoffArcDist +=
      PlayerShipRenderer.TAKEOFF_ARC_SPEED *
      Math.min(deltaTime, 100) *
      (this.shipPhysics.timeScale ?? 1);
    const sample = pointAlongPath(this.takeoffArc, this.takeoffArcDist);
    this.shipContainer.x = sample.x;
    this.shipContainer.y = sample.y;
    this.shipContainer.rotation = sample.heading;
    this.shipPhysics.shipAngle = sample.heading; // keep physics heading in sync
    if (sample.done) {
      this.finishTakeoff();
    }
  }

  /**
   * End the take-off arc: snap to the parked end point and clear the arc. Public
   * so the host scene can cancel an in-progress arc when a fresh course is set
   * (a no-op when no arc is active).
   */
  finishTakeoff(): void {
    if (!this.takeoffArc) return;
    const end = this.takeoffArc[this.takeoffArc.length - 1];
    this.takeoffArc = null;
    this.takeoffArcDist = 0;
    this.shipPhysics.teleport(end.x, end.y);
    if (this.shipContainer) {
      this.shipContainer.x = end.x;
      this.shipContainer.y = end.y;
    }
  }
}
