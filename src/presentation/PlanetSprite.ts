import { Container, Graphics } from "pixi.js";
import type { Planet } from "@/domain/Planet";
import { PlanetType } from "@/types";

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
  private readonly orbitalSpeed: number; // radians per millisecond
  private isHovered: boolean = false;
  private clickCallback: ((planet: Planet) => void) | null = null;

  constructor(
    planet: Planet,
    centerX: number,
    centerY: number,
    initialAngle: number,
  ) {
    this.planet = planet;
    this.orbitalRadius = planet.orbitalRadius;
    this.angle = initialAngle;
    this.centerX = centerX;
    this.centerY = centerY;

    // Slower orbital speeds for planets further from sun (Kepler's third law approximation)
    // Closer planets orbit faster
    this.orbitalSpeed = 0.00005 / Math.sqrt(this.orbitalRadius / 150);

    // Calculate screen position based on orbital radius and angle
    this.screenX = centerX + Math.cos(initialAngle) * this.orbitalRadius;
    this.screenY = centerY + Math.sin(initialAngle) * this.orbitalRadius;

    // Create PixiJS objects
    this.container = new Container();
    this.graphics = new Graphics();
    this.container.addChild(this.graphics);

    // Position container at calculated screen coordinates
    this.container.x = this.screenX;
    this.container.y = this.screenY;

    // Initial render
    this.render();
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

    // Draw bright outline to separate from background
    this.graphics.circle(0, 0, radius + 2);
    this.graphics.stroke({
      color: this.lightenColor(color, 80),
      width: 2,
      alpha: 0.6,
    });

    // Draw planet circle with gradient-like effect
    this.graphics.circle(0, 0, radius);
    this.graphics.fill({ color });

    // Add strong highlight for 3D effect
    this.graphics.circle(-radius * 0.25, -radius * 0.25, radius * 0.45);
    this.graphics.fill({ color: 0xffffff, alpha: 0.35 });

    // Add secondary highlight
    this.graphics.circle(-radius * 0.15, -radius * 0.15, radius * 0.25);
    this.graphics.fill({ color: 0xffffff, alpha: 0.25 });

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
    switch (type) {
      case PlanetType.TERRESTRIAL:
        return {
          color: 0x8b7355,
          radius: 14,
          hasRings: false,
          hasAtmosphere: true,
        }; // Brown earth-like
      case PlanetType.GAS_GIANT:
        return {
          color: 0xffa500,
          radius: 24,
          hasRings: true,
          hasAtmosphere: true,
        }; // Orange with rings
      case PlanetType.ICE:
        return {
          color: 0xadd8e6,
          radius: 12,
          hasRings: false,
          hasAtmosphere: false,
        }; // Light blue
      case PlanetType.VOLCANIC:
        return {
          color: 0xff4500,
          radius: 13,
          hasRings: false,
          hasAtmosphere: false,
        }; // Red-orange
      case PlanetType.INDUSTRIAL:
        return {
          color: 0x808080,
          radius: 15,
          hasRings: false,
          hasAtmosphere: true,
        }; // Gray with smog
      case PlanetType.HABITAT:
        return {
          color: 0x00aa44,
          radius: 16,
          hasRings: false,
          hasAtmosphere: true,
        }; // Green habitable
      default:
        return {
          color: 0x8b7355,
          radius: 14,
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
  update(deltaTime: number): void {
    // Update angle based on orbital speed
    this.angle += this.orbitalSpeed * deltaTime;

    // Keep angle in [0, 2π] range
    if (this.angle > Math.PI * 2) {
      this.angle -= Math.PI * 2;
    }

    // Recalculate screen position
    this.screenX = this.centerX + Math.cos(this.angle) * this.orbitalRadius;
    this.screenY = this.centerY + Math.sin(this.angle) * this.orbitalRadius;

    // Update container position
    this.container.x = this.screenX;
    this.container.y = this.screenY;
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
