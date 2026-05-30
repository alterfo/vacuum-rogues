import { GameScene } from './GameScene';
import { Graphics, Text, Container } from 'pixi.js';
import type { GameEngine } from '@/systems/GameEngine';
import { SceneType } from '@/types';
import { logger } from '@/utils/logger';

export class MainMenuScene extends GameScene {
  private background: Graphics | null = null;
  private buttonsContainer: Container | null = null;
  private title: Text | null = null;
  private gameEngine: GameEngine | null = null;
  private messageTimeoutId: ReturnType<typeof setTimeout> | null = null;

  initialize(context?: object): void {
    // Ensure stage is interactive so pointer events reach children
    this.renderer.app.stage.eventMode = 'static';

    this.gameEngine = (context as { gameEngine?: GameEngine })?.gameEngine ?? null;
    this.renderMainMenu();
    logger.info('MainMenuScene initialized');
  }

  update(_deltaTime: number): void {
    // Optional: animate background stars
  }

  destroy(): void {
    if (this.messageTimeoutId) {
      clearTimeout(this.messageTimeoutId);
      this.messageTimeoutId = null;
    }

    this.renderer.clearGameLayer();
    this.renderer.clearUILayer();

    this.background = null;
    this.buttonsContainer = null;
    this.title = null;
    this.gameEngine = null;
    logger.info('MainMenuScene destroyed');
  }

  private renderMainMenu(): void {
    this.renderer.clearGameLayer();
    this.renderer.clearUILayer();

    const width = this.renderer.app.screen.width;
    const height = this.renderer.app.screen.height;

    // Draw dark space background
    this.background = new Graphics();
    this.background.fill({ color: 0x000510 });
    this.background.rect(0, 0, width, height);
    this.renderer.gameLayer.addChild(this.background);

    // Title
    this.title = new Text({
      text: 'КОСМИЧЕСКИЕ РЕЙНДЖЕРЫ\nНЕЙРОСЕТЕВОЕ ВТОРЖЕНИЕ',
      style: {
        fontFamily: 'Courier New',
        fontSize: 32,
        fill: 0x00ffff,
        letterSpacing: 6,
        align: 'center',
        lineHeight: 40,
      },
    });
    this.title.anchor.set(0.5);
    this.title.x = width / 2;
    this.title.y = height / 3;
    this.renderer.uiLayer.addChild(this.title);

    // Buttons container
    this.buttonsContainer = new Container();
    this.buttonsContainer.x = width / 2;
    this.buttonsContainer.y = height / 2;

    // Helper to create clickable text button
    const createButton = (text: string, y: number, callback: () => void, fontSize = 20, color = 0x00ff00) => {
      const buttonText = new Text({
        text,
        style: {
          fontFamily: 'Courier New',
          fontSize,
          fill: color,
          fontWeight: 'bold' as const,
        },
      });
      buttonText.anchor.set(0.5, 0.5);
      buttonText.y = y;
      buttonText.eventMode = 'static';
      buttonText.cursor = 'pointer';

      buttonText.on('pointerdown', () => {
        logger.info(`Button clicked: ${text}`);
        callback();
      });
      buttonText.on('pointerover', () => { buttonText.alpha = 0.7; });
      buttonText.on('pointerout', () => { buttonText.alpha = 1; });
      
      return buttonText;
    };

    const newGameBtn = createButton('Новая игра', 0, () => this.handleNewGame());
    this.buttonsContainer.addChild(newGameBtn);

    const flightBtn = createButton('Полёт', 40, () => this.handleFlight(), 20, 0x00aaff);
    this.buttonsContainer.addChild(flightBtn);

    const continueBtn = createButton('Продолжить', 80, () => this.handleContinue(), 20, 0xffaa00);
    this.buttonsContainer.addChild(continueBtn);

    const onnxBtn = createButton('ONNX Демо', 130, () => this.handleONNXDemo(), 16, 0xff00ff);
    this.buttonsContainer.addChild(onnxBtn);

    this.renderer.uiLayer.addChild(this.buttonsContainer);
  }

  private async handleNewGame(): Promise<void> {
    logger.info('New game selected');
    // Transition to STAR_MAP with fresh galaxy
    if (this.gameEngine) {
      await this.gameEngine.transitionTo(SceneType.STAR_MAP);
    } else {
      logger.error('GameEngine not available!');
    }
  }

  private async handleFlight(): Promise<void> {
    logger.info('Flight demo selected');
    // Transition to SPACE_FLIGHT scene for control demo
    if (this.gameEngine) {
      await this.gameEngine.transitionTo(SceneType.SPACE_FLIGHT);
    } else {
      logger.error('GameEngine not available!');
    }
  }

  private async handleONNXDemo(): Promise<void> {
    logger.info('ONNX Demo selected');
    if (!this.gameEngine?.onnxRegistry) {
      logger.error('GameEngine or onnxRegistry not available!');
      return;
    }

    const registry = this.gameEngine.onnxRegistry;

    try {
      this.showMessage('Загрузка ONNX модели...');
      
      // Load dialogue model (uses fallback if real model unavailable)
      await registry.loadModel('t5_dialogue');
      this.showMessage('Модель загружена!');

      // Run demo inference
      setTimeout(async () => {
        try {
          const { Tensor } = await import('onnxruntime-web');
          const dummyInput = new Tensor('float32', new Float32Array(100).fill(0), [1, 100]);
          
          const startTime = performance.now();
          await registry.infer('t5_dialogue', dummyInput);
          const elapsed = performance.now() - startTime;
          
          this.showMessage(`Инференс: ${elapsed.toFixed(2)}мс`);
          logger.info(`ONNX inference demo completed in ${elapsed.toFixed(2)}ms`);
        } catch (err) {
          logger.warn('ONNX inference demo failed:', err);
          this.showMessage('Инференс не доступен (нет модели)');
        }
      }, 500);
    } catch (error) {
      const err = error as Error;
      logger.warn('ONNX model load failed (expected in dev):', err);
      this.showMessage('Модель недоступна (требуется CDN)');
    }
  }

  private async handleContinue(): Promise<void> {
    logger.info('Continue selected');
    if (!this.gameEngine) {
      logger.error('GameEngine not available for Continue!');
      return;
    }

    try {
      const save = await this.gameEngine.saveManager.read('auto');
      if (save) {
        // Restore state and transition to STAR_MAP
        this.gameEngine.galaxy = save.galaxy;
        this.gameEngine.player = save.player;
        await this.gameEngine.transitionTo(SceneType.STAR_MAP);
      } else {
        // No save available, show message and stay on menu
        logger.warn('No save found for continue');
        this.showMessage('Нет доступных сохранений');
      }
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to load save:', err);
      if (this.gameEngine) {
        this.gameEngine.handleError(err);
      }
    }
  }

  private showMessage(message: string): void {
    const width = this.renderer.app.screen.width;
    const height = this.renderer.app.screen.height;
    
    // Clear previous messages
    if (this.buttonsContainer) {
      for (const child of this.buttonsContainer.children) {
        if (child instanceof Text && child.text.includes('[')) {
          continue;
        }
      }
    }

    const msgText = new Text({
      text: message,
      style: {
        fontFamily: 'Courier New',
        fontSize: 16,
        fill: 0xff4444,
      },
    });
    msgText.anchor.set(0.5);
    msgText.x = width / 2;
    const buttonsY = this.buttonsContainer ? this.buttonsContainer.y : height / 2;
    msgText.y = buttonsY + 100;
    this.renderer.uiLayer.addChild(msgText);

    // Remove after 3 seconds
    this.messageTimeoutId = setTimeout(() => {
      if (msgText.parent) {
        this.renderer.uiLayer.removeChild(msgText);
      }
      msgText.destroy();
      this.messageTimeoutId = null;
    }, 3000);
  }
}
