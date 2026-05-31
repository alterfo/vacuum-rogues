import { Container, Graphics, Text } from 'pixi.js';
import type { Planet } from '@/domain/Planet';

/**
 * Info panel displaying planet details when clicked
 * Positioned in top-right corner below map title
 */
export class PlanetInfoPanel {
  public readonly container: Container;
  private readonly planet: Planet;
  private readonly panelWidth: number = 220;
  private readonly panelHeight: number = 140;

  constructor(planet: Planet, screenWidth: number, _screenHeight: number) {
    this.planet = planet;
    this.container = new Container();

    // Position panel at top-right, below any existing UI
    this.container.x = screenWidth - 240;
    this.container.y = 80;

    this.render();
  }

  /**
   * Render panel background and planet information
   */
  render(): void {
    // Background with border
    const background = new Graphics();
    background.rect(0, 0, this.panelWidth, this.panelHeight);
    background.fill({ color: 0x000000, alpha: 0.8 });
    background.stroke({ color: 0x00ffff, width: 2 });
    this.container.addChild(background);

    // Planet name (title)
    const titleText = new Text({
      text: this.planet.name,
      style: {
        fontFamily: 'Courier New',
        fontSize: 14,
        fill: 0x00ffff,
        fontWeight: 'bold',
      },
    });
    titleText.x = 10;
    titleText.y = 10;
    this.container.addChild(titleText);

    // Planet type
    const typeText = new Text({
      text: `Тип: ${this.getPlanetTypeRussian(this.planet.type)}`,
      style: {
        fontFamily: 'Courier New',
        fontSize: 11,
        fill: 0xaaaaaa,
      },
    });
    typeText.x = 10;
    typeText.y = 40;
    this.container.addChild(typeText);

    // Orbital radius
    const orbitText = new Text({
      text: `Орбита: ${this.planet.orbitalRadius}px`,
      style: {
        fontFamily: 'Courier New',
        fontSize: 11,
        fill: 0xaaaaaa,
      },
    });
    orbitText.x = 10;
    orbitText.y = 60;
    this.container.addChild(orbitText);

    // Hint text
    const hintText = new Text({
      text: 'Корабль направляется\nк планете',
      style: {
        fontFamily: 'Courier New',
        fontSize: 10,
        fill: 0x88ccff,
        align: 'left',
      },
    });
    hintText.x = 10;
    hintText.y = 90;
    this.container.addChild(hintText);
  }

  /**
   * Get Russian translation for planet type
   */
  private getPlanetTypeRussian(type: string): string {
    const translations: Record<string, string> = {
      TERRESTRIAL: 'Земной',
      GAS_GIANT: 'Газовый гигант',
      ICE: 'Ледяной',
      VOLCANIC: 'Вулканический',
      INDUSTRIAL: 'Промышленный',
      HABITAT: 'Обитаемый',
    };
    return translations[type] ?? type;
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    // Remove from parent if attached
    if (this.container.parent) {
      this.container.parent.removeChild(this.container);
    }

    // Destroy all children and container
    this.container.destroy({ children: true });
  }
}
