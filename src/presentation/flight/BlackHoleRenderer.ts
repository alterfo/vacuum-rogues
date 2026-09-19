import { Container, Graphics, Sprite } from "pixi.js";
import type { Renderer } from "../Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import { SeededRNG } from "@/utils/seededRNG";
import {
  BLACK_HOLE_EVENT_HORIZON_RADIUS,
  BLACK_HOLE_VISUAL_RADIUS,
  SYSTEM_GEOMETRY,
} from "@/config/balance";
import { blackHoleTexture, softGlowTexture } from "../gradientTexture";
import { reducedMotion } from "../ui/reducedMotion";
import type { FlightModule } from "./FlightModule";

export interface BlackHolePosition {
  x: number;
  y: number;
}

export function blackHolePosition(systemId: string): BlackHolePosition {
  const rng = new SeededRNG(`blackhole_${systemId}`);
  const angle = rng.nextFloat(0, Math.PI * 2);
  const radius = rng.nextFloat(
    SYSTEM_GEOMETRY.innerRadius,
    SYSTEM_GEOMETRY.outerRadius,
  );
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  };
}

export class BlackHoleRenderer implements FlightModule {
  private readonly gameLayer: Container;
  private readonly centerX: number;
  private readonly centerY: number;
  private readonly systemId: string;
  readonly position: BlackHolePosition;
  readonly eventHorizonRadius = BLACK_HOLE_EVENT_HORIZON_RADIUS;
  readonly visualRadius = BLACK_HOLE_VISUAL_RADIUS;

  private container: Container | null = null;
  private halo: Container | null = null;
  private diskContainer: Container | null = null;
  private diskGraphics: Graphics | null = null;
  private core: Graphics | null = null;
  private elapsed = 0;
  private contactActive = false;
  private destroyed = false;

  constructor(
    renderer: Renderer,
    gameEngine: GameEngine | null,
    gameLayer: Container,
  ) {
    this.gameLayer = gameLayer;
    this.centerX = renderer.app.screen.width / 2;
    this.centerY = renderer.app.screen.height / 2;
    this.systemId = gameEngine?.player?.currentSystemId ?? "unknown";
    this.position = blackHolePosition(this.systemId);
  }

  get x(): number {
    return this.centerX + this.position.x;
  }

  get y(): number {
    return this.centerY + this.position.y;
  }

  initialize(): void {
    if (this.destroyed) return;

    this.container = new Container();
    this.container.eventMode = "none";
    this.container.x = this.x;
    this.container.y = this.y;
    this.container.zIndex = 40;

    this.halo = this.buildHalo();
    this.container.addChild(this.halo);

    this.diskContainer = new Container();
    this.diskContainer.eventMode = "none";
    const tex = blackHoleTexture(this.systemId);
    if (tex) {
      const sprite = new Sprite(tex);
      sprite.anchor.set(0.5);
      sprite.eventMode = "none";
      sprite.width = this.visualRadius * 2;
      sprite.height = this.visualRadius * 2;
      this.diskContainer.addChild(sprite);
    } else {
      this.diskGraphics = this.buildFallbackDisk();
      this.diskContainer.addChild(this.diskGraphics);
    }
    this.container.addChild(this.diskContainer);

    this.core = this.buildCore();
    this.container.addChild(this.core);

    this.gameLayer.addChild(this.container);
  }

  update(deltaTime: number, _bgElapsed: number): void {
    if (reducedMotion()) return;
    this.elapsed += deltaTime;
    if (this.diskContainer) {
      this.diskContainer.rotation += 0.00002 * deltaTime;
    }
    if (this.core) {
      const pulse = 1 + Math.sin(this.elapsed * 0.003) * 0.04;
      this.core.scale.set(pulse, pulse);
    }
  }

  updateBlackHoleContact(playerX: number, playerY: number): boolean {
    const dist = Math.hypot(playerX - this.x, playerY - this.y);
    if (dist < this.eventHorizonRadius) {
      if (!this.contactActive) {
        this.contactActive = true;
        return true;
      }
      return false;
    }
    this.contactActive = false;
    return false;
  }

  destroy(): void {
    this.destroyed = true;
    if (this.container) {
      if (this.container.parent)
        this.container.parent.removeChild(this.container);
      if (!this.container.destroyed) this.container.destroy({ children: true });
      this.container = null;
    }
    this.halo = null;
    this.diskContainer = null;
    this.diskGraphics = null;
    this.core = null;
    this.elapsed = 0;
    this.contactActive = false;
  }

  private buildHalo(): Container {
    const halo = new Container();
    halo.eventMode = "none";
    const glowTex = softGlowTexture();
    if (glowTex) {
      const glow = new Sprite(glowTex);
      glow.anchor.set(0.5);
      glow.eventMode = "none";
      glow.width = this.visualRadius * 2.6;
      glow.height = this.visualRadius * 2.6;
      glow.tint = 0x8877dd;
      glow.alpha = 0.5;
      glow.blendMode = "screen";
      halo.addChild(glow);
    } else {
      const g = new Graphics();
      g.eventMode = "none";
      const rings = 12;
      for (let i = 0; i < rings; i++) {
        const t = i / (rings - 1);
        const scale = 1.9 + (0.7 - 1.9) * t;
        g.circle(0, 0, this.visualRadius * scale).fill({
          color: 0x8877dd,
          alpha: 0.02 + 0.03 * t,
        });
      }
      halo.addChild(g);
    }
    halo.blendMode = "screen";
    return halo;
  }

  private buildFallbackDisk(): Graphics {
    const g = new Graphics();
    g.eventMode = "none";
    const ringColors = [0xc9b6ff, 0x9f8dff, 0x6f7cff, 0x543bd8];
    ringColors.forEach((color, i) => {
      const t = ringColors.length === 1 ? 0 : i / (ringColors.length - 1);
      const rx = this.visualRadius * (0.45 + t * 0.5);
      const ry = rx * 0.32;
      g.ellipse(0, 0, rx, ry).stroke({
        color,
        width: 3 + t * 3,
        alpha: 0.12 + t * 0.18,
      });
    });
    return g;
  }

  private buildCore(): Graphics {
    const g = new Graphics();
    g.eventMode = "none";
    g.circle(0, 0, this.eventHorizonRadius * 0.98).fill({
      color: 0x05050a,
    });
    g.circle(0, 0, this.eventHorizonRadius).stroke({
      color: 0xb7a8ff,
      width: 2,
      alpha: 0.8,
    });
    return g;
  }
}
