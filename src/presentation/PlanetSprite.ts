import { Container, Graphics } from 'pixi.js';
import type { Planet } from '@/domain/Planet';
import { PlanetType } from '@/types';

/**
 * Visual representation of a planet in the SpaceFlightScene
 * Handles rendering, hover effects, and click interactions
 */
export class PlanetSprite {
  public readonly container: Container;
  public readonly graphics: Graphics;
  public readonly planet: Planet;
  public readonly orbitalRadius: number;
  public readonly angle: number;
  public readonly screenX: number;
  public readonly screenY: number;
  private isHovered: boolean = false;
  private clickCallback: ((planet: Planet) => void) | null = null;

  constructor(planet: Planet, centerX: number, centerY: number, initialAngle: number) {
    this.planet = planet;
    this.orbitalRadius = planet.orbitalRadius;
    this.angle = initialAngle;

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
   * Adds glow effect when hovered
   */
  render(): void {
    this.graphics.clear();

    // Determine color and radius based on planet type
    const { color, radius } = this.getPlanetVisuals(this.planet.type);

    // Draw glow effect if hovered
    if (this.isHovered) {
      this.graphics.circle(0, 0, radius + 6);
      this.graphics.fill({ color, alpha: 0.3 });
    }

    // Draw planet circle
    this.graphics.circle(0, 0, radius);
    this.graphics.fill({ color });
  }

  /**
   * Get visual properties (color, radius) for a planet type
   */
  private getPlanetVisuals(type: PlanetType): { color: number; radius: number } {
    switch (type) {
      case PlanetType.TERRESTRIAL:
        return { color: 0x8b7355, radius: 12 }; // Brown
      case PlanetType.GAS_GIANT:
        return { color: 0xffa500, radius: 18 }; // Orange
      case PlanetType.ICE:
        return { color: 0xadd8e6, radius: 10 }; // Light blue
      case PlanetType.VOLCANIC:
        return { color: 0xff4500, radius: 11 }; // Red-orange
      case PlanetType.INDUSTRIAL:
        return { color: 0x808080, radius: 13 }; // Gray
      case PlanetType.HABITAT:
        return { color: 0x00ff00, radius: 14 }; // Green
      default:
        return { color: 0x8b7355, radius: 12 }; // Default to terrestrial
    }
  }

  /**
   * Enable interactivity and set up event handlers
   * @param onClickCallback Function to call when planet is clicked
   */
  createHitArea(onClickCallback: (planet: Planet) => void): void {
    this.clickCallback = onClickCallback;

    this.graphics.eventMode = 'static';
    this.graphics.cursor = 'pointer';

    // Click handler
    this.graphics.on('pointerdown', () => {
      if (this.clickCallback) {
        this.clickCallback(this.planet);
      }
    });

    // Hover handlers
    this.graphics.on('pointerover', () => {
      this.setHoverState(true);
    });

    this.graphics.on('pointerout', () => {
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
