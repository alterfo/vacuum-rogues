import { Container, Graphics, Sprite } from "pixi.js";
import type { Renderer } from "../Renderer";
import type { ShipPhysics } from "@/systems/ShipPhysics";
import { pickVariant } from "../textures";
import { pointAlongPath } from "@/utils/flightGeometry";
import type { FlightModule } from "./FlightModule";

interface FilterableNode {
  filters?: { destroy?: () => void }[] | { destroy?: () => void } | null;
  children?: FilterableNode[];
}

export class PlayerShipRenderer implements FlightModule {
  private readonly gameLayer: Container;
  private readonly shipPhysics: ShipPhysics;

  private shipContainer: Container | null = null;
  private shipGraphics: Graphics | null = null;
  private shipGlow: Graphics | null = null;
  private shipSprite: Sprite | null = null;
  private readonly SHIP_SPRITE_ROTATION = -Math.PI / 2;
  private readonly SHIP_SIZE = 20;

  private targetIndicator: Graphics | null = null;

  private takeoffArc: { x: number; y: number }[] | null = null;
  private takeoffArcDist = 0;
  private static readonly TAKEOFF_ARC_SPEED = 0.5; // px/ms

  private bgElapsed = 0;

  private readonly hullClassKey: string;

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

  initialize(): void {
    this.createShip();
    this.createTargetIndicator();
  }

  update(deltaTime: number, bgElapsed: number): void {
    this.bgElapsed = bgElapsed;
    if (this.takeoffArc) {
      this.updateTakeoff(deltaTime);
    } else if (this.shipContainer) {
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

  get container(): Container | null {
    return this.shipContainer;
  }

  isArcActive(): boolean {
    return this.takeoffArc !== null;
  }

  startTakeoffArc(arc: { x: number; y: number }[]): void {
    this.takeoffArc = arc;
    this.takeoffArcDist = 0;
    if (this.shipContainer && arc.length > 0) {
      this.shipContainer.x = arc[0].x;
      this.shipContainer.y = arc[0].y;
    }
  }

  private disposeFiltersDeep(obj: FilterableNode): void {
    const fs = obj.filters;
    const arr = Array.isArray(fs) ? fs : fs ? [fs] : [];
    for (const f of arr) f.destroy?.();
    for (const child of obj.children ?? []) {
      this.disposeFiltersDeep(child);
    }
  }

  private createShip(): void {
    this.shipContainer = new Container();

    this.shipGlow = new Graphics();
    this.shipGlow.eventMode = "none";
    this.shipContainer.addChild(this.shipGlow);

    this.shipGraphics = new Graphics();
    this.shipContainer.addChild(this.shipGraphics);

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

    this.drawShipGlow();

    this.drawShip();

    this.shipContainer.zIndex = 110; // player ship above NPCs and planets
    this.shipContainer.x = this.shipPhysics.shipX;
    this.shipContainer.y = this.shipPhysics.shipY;
    this.shipContainer.pivot.set(0, 0);

    this.gameLayer.addChild(this.shipContainer);
  }

  private drawShipGlow(): void {
    if (!this.shipGlow) return;
    this.shipGlow.clear();
    const outerR = this.shipSprite
      ? this.SHIP_SIZE * 1.4
      : this.SHIP_SIZE * 0.95;
    const GLOW_LAYERS = 10;
    for (let i = 0; i < GLOW_LAYERS; i++) {
      const t = i / (GLOW_LAYERS - 1); // 0 outer → 1 inner
      const r = outerR * (1 - 0.62 * t);
      const alpha = 0.05 + 0.04 * t;
      this.shipGlow.circle(0, 0, r).fill({ color: 0x3a6fd0, alpha });
    }
  }

  private createTargetIndicator(): void {
    this.targetIndicator = new Graphics();
    this.targetIndicator.eventMode = "none"; // decorative — never intercept clicks
    this.targetIndicator.visible = false; // Hidden by default
    this.gameLayer.addChild(this.targetIndicator);
  }

  private updateTargetIndicator(): void {
    if (!this.targetIndicator) return;

    const distance = this.shipPhysics.getDistanceToTarget();

    if (
      this.shipPhysics.isMoving &&
      distance > 20 &&
      !this.shipPhysics.isFollowingRoute()
    ) {
      this.targetIndicator.visible = true;
      this.targetIndicator.clear();

      const targetX = this.shipPhysics.getTargetX();
      const targetY = this.shipPhysics.getTargetY();

      const size = 15;
      const pulse = Math.sin(this.bgElapsed / 200) * 0.3 + 0.7; // Pulsing effect

      this.targetIndicator.moveTo(targetX - size, targetY);
      this.targetIndicator.lineTo(targetX + size, targetY);
      this.targetIndicator.moveTo(targetX, targetY - size);
      this.targetIndicator.lineTo(targetX, targetY + size);
      this.targetIndicator.stroke({ width: 2, color: 0x00ffff, alpha: pulse });

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

    if (this.shipSprite) return;

    const size = this.SHIP_SIZE;

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

    this.shipGraphics.fill({ color: 0x00ffff, alpha: 0.8 });
    this.shipGraphics.circle(-size * 0.5, -size * 0.3, 2);
    this.shipGraphics.circle(-size * 0.5, size * 0.3, 2);
  }

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
