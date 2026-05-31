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
  private readonly panelHeight: number = 220; // Increased to fit warp button
  private readonly onTalkToGovernor?: () => void;
  private readonly onWarpToPlanet?: () => void;

  constructor(
    planet: Planet,
    screenWidth: number,
    _screenHeight: number,
    onTalkToGovernor?: () => void,
    onWarpToPlanet?: () => void,
  ) {
    this.planet = planet;
    this.container = new Container();
    this.onTalkToGovernor = onTalkToGovernor;
    this.onWarpToPlanet = onWarpToPlanet;

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

    // Add "Talk to Governor" button if planet has inhabitants
    if (this.planet.inhabitants.length > 0 && this.onTalkToGovernor) {
      const buttonContainer = new Container();
      buttonContainer.x = 10;
      buttonContainer.y = 130;

      // Button background
      const buttonBg = new Graphics();
      buttonBg.rect(0, 0, 200, 30);
      buttonBg.fill({ color: 0x004488, alpha: 0.9 });
      buttonBg.stroke({ color: 0x00ffff, width: 1 });
      buttonContainer.addChild(buttonBg);

      // Button text
      const buttonText = new Text({
        text: 'Поговорить с губернатором',
        style: {
          fontFamily: 'Courier New',
          fontSize: 11,
          fill: 0xffffff,
        },
      });
      buttonText.x = 10;
      buttonText.y = 8;
      buttonContainer.addChild(buttonText);

      // Make button interactive
      buttonContainer.eventMode = 'static';
      buttonContainer.cursor = 'pointer';
      buttonContainer.on('pointerdown', () => {
        if (this.onTalkToGovernor) {
          this.onTalkToGovernor();
        }
      });

      // Hover effects
      buttonContainer.on('pointerover', () => {
        buttonBg.clear();
        buttonBg.rect(0, 0, 200, 30);
        buttonBg.fill({ color: 0x0066aa, alpha: 0.9 });
        buttonBg.stroke({ color: 0x00ffff, width: 2 });
      });
      buttonContainer.on('pointerout', () => {
        buttonBg.clear();
        buttonBg.rect(0, 0, 200, 30);
        buttonBg.fill({ color: 0x004488, alpha: 0.9 });
        buttonBg.stroke({ color: 0x00ffff, width: 1 });
      });

      this.container.addChild(buttonContainer);
    }

    // Add "Warp to Planet" button if callback provided
    if (this.onWarpToPlanet) {
      const warpButtonContainer = new Container();
      warpButtonContainer.x = 10;
      warpButtonContainer.y = this.planet.inhabitants.length > 0 ? 170 : 130;

      // Button background
      const warpBg = new Graphics();
      warpBg.rect(0, 0, 200, 30);
      warpBg.fill({ color: 0x444400, alpha: 0.9 });
      warpBg.stroke({ color: 0xffff00, width: 1 });
      warpButtonContainer.addChild(warpBg);

      // Button text
      const warpText = new Text({
        text: '⚡ Мини-варп к планете',
        style: {
          fontFamily: 'Courier New',
          fontSize: 11,
          fill: 0xffff00,
        },
      });
      warpText.x = 10;
      warpText.y = 8;
      warpButtonContainer.addChild(warpText);

      // Make button interactive
      warpButtonContainer.eventMode = 'static';
      warpButtonContainer.cursor = 'pointer';
      warpButtonContainer.on('pointerdown', () => {
        if (this.onWarpToPlanet) {
          this.onWarpToPlanet();
        }
      });

      // Hover effects
      warpButtonContainer.on('pointerover', () => {
        warpBg.clear();
        warpBg.rect(0, 0, 200, 30);
        warpBg.fill({ color: 0x666600, alpha: 0.9 });
        warpBg.stroke({ color: 0xffff00, width: 2 });
      });
      warpButtonContainer.on('pointerout', () => {
        warpBg.clear();
        warpBg.rect(0, 0, 200, 30);
        warpBg.fill({ color: 0x444400, alpha: 0.9 });
        warpBg.stroke({ color: 0xffff00, width: 1 });
      });

      this.container.addChild(warpButtonContainer);
    }
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
