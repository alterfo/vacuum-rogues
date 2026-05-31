import { Container, Graphics, Text } from 'pixi.js';
import type { Planet } from '@/domain/Planet';

/**
 * Mini-map showing the current star system with planets and ship position
 * Displayed in the bottom-right corner of the screen
 */
export class SystemMiniMap {
  public readonly container: Container;
  private readonly mapWidth: number = 180;
  private readonly mapHeight: number = 180;
  private readonly mapScale: number = 0.05; // Scale factor for displaying orbits (adjusted for 5x orbital radii)
  private readonly graphics: Graphics;

  constructor(screenWidth: number, screenHeight: number) {
    this.container = new Container();
    // IMPORTANT: Set to 'none' so mini-map doesn't block clicks on space
    this.container.eventMode = 'none';

    this.graphics = new Graphics();
    this.container.addChild(this.graphics);

    // Position mini-map at bottom-right corner
    this.container.x = screenWidth - this.mapWidth - 20;
    this.container.y = screenHeight - this.mapHeight - 20;

    // Draw background
    this.drawBackground();
  }

  /**
   * Draw semi-transparent background for mini-map
   */
  private drawBackground(): void {
    const background = new Graphics();
    background.rect(0, 0, this.mapWidth, this.mapHeight);
    background.fill({ color: 0x000000, alpha: 0.7 });
    background.stroke({ color: 0x00ffff, width: 2 });

    // Add title
    const title = new Text({
      text: 'СИСТЕМА',
      style: {
        fontFamily: 'Courier New',
        fontSize: 10,
        fill: 0x00ffff,
        fontWeight: 'bold',
      },
    });
    title.x = 5;
    title.y = 5;
    background.addChild(title);

    this.container.addChild(background);
  }

  /**
   * Update mini-map with current planet and ship positions
   * @param planets Array of planets in the system
   * @param shipX Ship X position in screen coordinates
   * @param shipY Ship Y position in screen coordinates
   * @param centerX Star center X position
   * @param centerY Star center Y position
   */
  update(planets: Planet[], shipX: number, shipY: number, centerX: number, centerY: number): void {
    this.graphics.clear();

    const mapCenterX = this.mapWidth / 2;
    const mapCenterY = this.mapHeight / 2 + 10; // Offset down to account for title

    // Draw sun at center
    this.graphics.circle(mapCenterX, mapCenterY, 4);
    this.graphics.fill({ color: 0xffaa00 });

    // Draw orbital paths and planets
    for (const planet of planets) {
      const orbitRadius = planet.orbitalRadius * this.mapScale;

      // Draw orbit path (circle)
      this.graphics.circle(mapCenterX, mapCenterY, orbitRadius);
      this.graphics.stroke({ color: 0x444444, width: 1, alpha: 0.5 });

      // Calculate planet position on mini-map based on its orbital radius
      // We need to find the planet's current angle - we'll calculate it from sprites in SpaceFlightScene
      // For now, we'll just draw planet indicators
    }

    // Draw ship position
    const shipRelativeX = (shipX - centerX) * this.mapScale;
    const shipRelativeY = (shipY - centerY) * this.mapScale;
    const shipMapX = mapCenterX + shipRelativeX;
    const shipMapY = mapCenterY + shipRelativeY;

    // Draw ship as triangle
    this.graphics.poly([
      shipMapX + 3,
      shipMapY,
      shipMapX - 2,
      shipMapY - 2,
      shipMapX - 2,
      shipMapY + 2,
    ]);
    this.graphics.fill({ color: 0x4488cc });
  }

  /**
   * Update mini-map with planet sprite positions
   * @param planetSprites Array of planet sprites with current screen positions
   * @param shipX Ship X position
   * @param shipY Ship Y position
   * @param centerX Star center X position
   * @param centerY Star center Y position
   */
  updateWithSprites(
    planetSprites: { planet: Planet; screenX: number; screenY: number }[],
    shipX: number,
    shipY: number,
    centerX: number,
    centerY: number,
  ): void {
    this.graphics.clear();

    const mapCenterX = this.mapWidth / 2;
    const mapCenterY = this.mapHeight / 2 + 10;

    // Draw sun at center
    this.graphics.circle(mapCenterX, mapCenterY, 5);
    this.graphics.fill({ color: 0xffaa00 });
    this.graphics.circle(mapCenterX, mapCenterY, 3);
    this.graphics.fill({ color: 0xffffaa });

    // Draw orbital paths
    const uniqueRadii = new Set<number>();
    for (const sprite of planetSprites) {
      uniqueRadii.add(sprite.planet.orbitalRadius);
    }

    for (const radius of uniqueRadii) {
      const orbitRadius = radius * this.mapScale;
      this.graphics.circle(mapCenterX, mapCenterY, orbitRadius);
      this.graphics.stroke({ color: 0x444444, width: 1, alpha: 0.4 });
    }

    // Draw planets
    for (const sprite of planetSprites) {
      const relativeX = (sprite.screenX - centerX) * this.mapScale;
      const relativeY = (sprite.screenY - centerY) * this.mapScale;
      const planetMapX = mapCenterX + relativeX;
      const planetMapY = mapCenterY + relativeY;

      // Draw planet as small circle with type-based color
      const color = this.getPlanetColor(sprite.planet.type);
      this.graphics.circle(planetMapX, planetMapY, 3);
      this.graphics.fill({ color });
    }

    // Draw ship position
    const shipRelativeX = (shipX - centerX) * this.mapScale;
    const shipRelativeY = (shipY - centerY) * this.mapScale;
    const shipMapX = mapCenterX + shipRelativeX;
    const shipMapY = mapCenterY + shipRelativeY;

    // Draw ship as triangle
    this.graphics.poly([
      shipMapX + 4,
      shipMapY,
      shipMapX - 3,
      shipMapY - 3,
      shipMapX - 3,
      shipMapY + 3,
    ]);
    this.graphics.fill({ color: 0x4488cc });

    // Add ship position indicator border
    this.graphics.circle(shipMapX, shipMapY, 6);
    this.graphics.stroke({ color: 0x00ffff, width: 1 });
  }

  /**
   * Get simplified color for planet type (for mini-map)
   */
  private getPlanetColor(type: string): number {
    switch (type) {
      case 'TERRESTRIAL':
        return 0x8b7355;
      case 'GAS_GIANT':
        return 0xffa500;
      case 'ICE':
        return 0xadd8e6;
      case 'VOLCANIC':
        return 0xff4500;
      case 'INDUSTRIAL':
        return 0x808080;
      case 'HABITAT':
        return 0x00aa44;
      default:
        return 0x8b7355;
    }
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.container.destroy({ children: true });
  }
}
