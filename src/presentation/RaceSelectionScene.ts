import { Container, Graphics, Text } from 'pixi.js';
import { GameScene } from './GameScene';
import type { Renderer } from './Renderer';
import type { GameEngine } from '@/systems/GameEngine';
import { RaceRegistry } from '@/systems/RaceRegistry';
import type { Race } from '@/domain/Race';
import { RaceType, SceneType } from '@/types';
import { logger } from '@/utils/logger';

/**
 * Race Selection Scene - allows player to choose their race before starting the game
 */
export class RaceSelectionScene extends GameScene {
  private gameEngine: GameEngine | null = null;
  private mainContainer: Container | null = null;
  private selectedRace: RaceType = RaceType.HUMAN;

  constructor(renderer: Renderer) {
    super(renderer);
  }

  initialize(context?: { gameEngine: GameEngine }): void {
    if (!context?.gameEngine) {
      throw new Error('RaceSelectionScene requires gameEngine in context');
    }

    this.gameEngine = context.gameEngine;
    this.mainContainer = new Container();
    this.renderer.uiLayer.addChild(this.mainContainer);

    this.render();

    logger.info('RaceSelectionScene initialized');
  }

  update(_deltaTime: number): void {
    // Static scene, no updates
  }

  destroy(): void {
    if (this.mainContainer) {
      this.mainContainer.destroy({ children: true });
      this.mainContainer = null;
    }

    this.gameEngine = null;

    logger.info('RaceSelectionScene destroyed');
  }

  /**
   * Render the race selection UI
   */
  private render(): void {
    if (!this.mainContainer) return;

    const screenWidth = this.renderer.app.screen.width;
    const screenHeight = this.renderer.app.screen.height;

    // Background
    const background = new Graphics();
    background.rect(0, 0, screenWidth, screenHeight);
    background.fill({ color: 0x000510 });
    this.mainContainer.addChild(background);

    // Title
    const title = new Text({
      text: 'ВЫБЕРИТЕ РАСУ',
      style: {
        fontFamily: 'Courier New',
        fontSize: 28,
        fill: 0x00ffff,
        fontWeight: 'bold',
        letterSpacing: 4,
      },
    });
    title.anchor.set(0.5);
    title.x = screenWidth / 2;
    title.y = 60;
    this.mainContainer.addChild(title);

    // Render race cards in a grid
    const races = RaceRegistry.getAllRaces();
    const cardWidth = 280;
    const cardHeight = 200;
    const gap = 20;
    const startX = (screenWidth - (cardWidth * 3 + gap * 2)) / 2;
    const startY = 130;

    for (let i = 0; i < races.length; i++) {
      const race = races[i];
      const row = Math.floor(i / 3);
      const col = i % 3;
      const x = startX + col * (cardWidth + gap);
      const y = startY + row * (cardHeight + gap);

      this.renderRaceCard(race, x, y, cardWidth, cardHeight);
    }

    // Start button
    this.renderStartButton(screenWidth / 2, screenHeight - 80);
  }

  /**
   * Render a single race card
   */
  private renderRaceCard(race: Race, x: number, y: number, width: number, height: number): void {
    if (!this.mainContainer) return;

    const cardContainer = new Container();
    cardContainer.x = x;
    cardContainer.y = y;

    // Card background
    const isSelected = race.type === this.selectedRace;
    const cardBg = new Graphics();
    cardBg.rect(0, 0, width, height);
    cardBg.fill({ color: isSelected ? 0x1a3a4a : 0x0a1a2a, alpha: 0.95 });
    cardBg.stroke({ color: isSelected ? 0x00ffff : 0x444444, width: isSelected ? 3 : 2 });
    cardBg.eventMode = 'static';
    cardBg.cursor = 'pointer';
    cardContainer.addChild(cardBg);

    // Race name
    const raceName = new Text({
      text: race.name.toUpperCase(),
      style: {
        fontFamily: 'Courier New',
        fontSize: 18,
        fill: isSelected ? 0x00ffff : 0xffffff,
        fontWeight: 'bold',
      },
    });
    raceName.x = 10;
    raceName.y = 10;
    cardContainer.addChild(raceName);

    // Race description
    const description = RaceRegistry.getRaceDescription(race.type);
    const descText = new Text({
      text: description,
      style: {
        fontFamily: 'Courier New',
        fontSize: 11,
        fill: 0xcccccc,
        wordWrap: true,
        wordWrapWidth: width - 20,
        lineHeight: 14,
      },
    });
    descText.x = 10;
    descText.y = 35;
    cardContainer.addChild(descText);

    // Unique mechanic
    const mechanicText = new Text({
      text: `✦ ${race.uniqueMechanic.description}`,
      style: {
        fontFamily: 'Courier New',
        fontSize: 11,
        fill: 0xffaa00,
        wordWrap: true,
        wordWrapWidth: width - 20,
      },
    });
    mechanicText.x = 10;
    mechanicText.y = 90;
    cardContainer.addChild(mechanicText);

    // Stats
    const stats = this.getRaceStatsText(race);
    const statsText = new Text({
      text: stats,
      style: {
        fontFamily: 'Courier New',
        fontSize: 10,
        fill: 0xaaaaaa,
        lineHeight: 14,
      },
    });
    statsText.x = 10;
    statsText.y = 120;
    cardContainer.addChild(statsText);

    // Click handler
    cardBg.on('pointerdown', () => {
      this.selectRace(race.type);
    });

    // Hover effect
    cardBg.on('pointerover', () => {
      if (race.type !== this.selectedRace) {
        cardBg.clear();
        cardBg.rect(0, 0, width, height);
        cardBg.fill({ color: 0x152535, alpha: 0.98 });
        cardBg.stroke({ color: 0x00aaaa, width: 2 });
      }
    });

    cardBg.on('pointerout', () => {
      if (race.type !== this.selectedRace) {
        cardBg.clear();
        cardBg.rect(0, 0, width, height);
        cardBg.fill({ color: 0x0a1a2a, alpha: 0.95 });
        cardBg.stroke({ color: 0x444444, width: 2 });
      }
    });

    this.mainContainer.addChild(cardContainer);
  }

  /**
   * Get formatted stats text for race
   */
  private getRaceStatsText(race: Race): string {
    const lines = [];

    lines.push(`Корпус: ${race.shipBaseline.hullHP}`);
    lines.push(`Щиты: ${race.shipBaseline.shields}`);
    lines.push(`Скорость: ${race.shipBaseline.speed.toFixed(1)}`);
    lines.push(`Уворот: ${race.shipBaseline.evasion.toFixed(1)}`);

    return lines.join('\n');
  }

  /**
   * Select a race
   */
  private selectRace(raceType: RaceType): void {
    this.selectedRace = raceType;
    logger.info(`Selected race: ${raceType}`);

    // Re-render to update selection
    this.refresh();
  }

  /**
   * Render start game button
   */
  private renderStartButton(x: number, y: number): void {
    if (!this.mainContainer) return;

    const buttonContainer = new Container();
    buttonContainer.x = x;
    buttonContainer.y = y;

    const buttonWidth = 300;
    const buttonHeight = 50;

    // Button background
    const btnBg = new Graphics();
    btnBg.rect(-buttonWidth / 2, -buttonHeight / 2, buttonWidth, buttonHeight);
    btnBg.fill({ color: 0x004488, alpha: 0.9 });
    btnBg.stroke({ color: 0x00ffff, width: 2 });
    buttonContainer.addChild(btnBg);

    // Button text
    const btnText = new Text({
      text: 'НАЧАТЬ ИГРУ',
      style: {
        fontFamily: 'Courier New',
        fontSize: 20,
        fill: 0xffffff,
        fontWeight: 'bold',
      },
    });
    btnText.anchor.set(0.5);
    btnText.y = 0;
    buttonContainer.addChild(btnText);

    // Make button interactive
    buttonContainer.eventMode = 'static';
    buttonContainer.cursor = 'pointer';
    buttonContainer.on('pointerdown', () => {
      this.startGame();
    });

    // Hover effects
    buttonContainer.on('pointerover', () => {
      btnBg.clear();
      btnBg.rect(-buttonWidth / 2, -buttonHeight / 2, buttonWidth, buttonHeight);
      btnBg.fill({ color: 0x0066aa, alpha: 1.0 });
      btnBg.stroke({ color: 0x00ffff, width: 3 });
    });

    buttonContainer.on('pointerout', () => {
      btnBg.clear();
      btnBg.rect(-buttonWidth / 2, -buttonHeight / 2, buttonWidth, buttonHeight);
      btnBg.fill({ color: 0x004488, alpha: 0.9 });
      btnBg.stroke({ color: 0x00ffff, width: 2 });
    });

    this.mainContainer.addChild(buttonContainer);
  }

  /**
   * Start the game with selected race
   */
  private async startGame(): Promise<void> {
    if (!this.gameEngine) return;

    logger.info(`Starting game with race: ${this.selectedRace}`);

    // Pass selected race to GameEngine for player creation
    await this.gameEngine.transitionTo(SceneType.STAR_MAP, {
      gameEngine: this.gameEngine,
      selectedRace: this.selectedRace,
    });
  }

  /**
   * Refresh the UI
   */
  private refresh(): void {
    if (this.mainContainer) {
      this.mainContainer.destroy({ children: true });
      this.mainContainer = new Container();
      this.renderer.uiLayer.addChild(this.mainContainer);
      this.render();
    }
  }
}
