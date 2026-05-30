import type { GameConfig } from '@/types';
import { SceneType, RaceType } from '@/types';
import type { Galaxy } from '@/domain/Galaxy';
import type { GameScene } from '@/presentation/GameScene';
import { Renderer } from '@/presentation/Renderer';
import { SaveManager } from '@/data/SaveManager';
import { ONNXModelRegistry } from '@/ai/ONNXModelRegistry';
import { AdaptiveQualityProfile } from '@/ai/AdaptiveQualityProfile';
import { GlobalExceptionHandler } from '@/exceptions/GlobalExceptionHandler';
import { GameSystemException } from '@/exceptions/GameSystemException';
import { GameValidationException } from '@/exceptions/GameValidationException';
import { logger } from '@/utils/logger';
import { StarMapScene } from '@/presentation/StarMapScene';
import { CombatScene } from '@/presentation/CombatScene';
import { DialogueScene } from '@/presentation/DialogueScene';
import { InventoryScene } from '@/presentation/InventoryScene';
import { MainMenuScene } from '@/presentation/MainMenuScene';
import { SpaceFlightScene } from '@/presentation/SpaceFlightScene';
import { Graphics, Text } from 'pixi.js';
import { GalaxySimulator } from './GalaxySimulator';
import { validatePlayerSettings } from '@/validation/schemas';
import { Race } from '@/domain/Race';
import { SkillTree } from '@/domain/SkillTree';
import { Player } from '@/domain/Player';
import { PlayerShip } from '@/domain/PlayerShip';
import { Inventory } from '@/domain/Inventory';

export class GameEngine {
  public currentScene: GameScene | null = null;
  public galaxy: Galaxy | null = null;
  public player: Player | null = null;
  public readonly saveManager: SaveManager;
  public readonly qualityProfile: AdaptiveQualityProfile;
  public readonly onnxRegistry: ONNXModelRegistry;
  public renderer: Renderer | null = null;

  private exceptionHandler: GlobalExceptionHandler;
  private animationFrameId = 0;
  private lastTime = 0;
  private modalObjects: (Graphics | Text)[] = [];

  constructor() {
    this.qualityProfile = new AdaptiveQualityProfile();
    this.onnxRegistry = new ONNXModelRegistry(this.qualityProfile);
    this.saveManager = new SaveManager();
    this.exceptionHandler = GlobalExceptionHandler.getInstance();
    this.exceptionHandler.onCriticalError = (response) => {
      this.handleCriticalError(response);
    };
  }

  async initialize(config: GameConfig): Promise<void> {
    try {
      // Load settings from localStorage and validate
      const storedSettings = localStorage.getItem('sr_settings');
      if (storedSettings) {
        try {
          validatePlayerSettings(JSON.parse(storedSettings));
          logger.info('Loaded and validated settings from localStorage');
        } catch (error) {
          logger.warn('Invalid settings, using defaults:', error);
        }
      }

      // Initialize Renderer
      const container = document.getElementById('game-container');
      if (!container) {
        throw new GameSystemException('NO_CONTAINER', 'Game container not found in DOM.');
      }
      this.renderer = new Renderer(container);
      await this.renderer.initialize();

      // Check for Canvas2D fallback after renderer init
      const rendererType = (this.renderer.app.renderer as unknown as { type?: string }).type;
      if (rendererType === 'canvas') {
        logger.warn('Canvas2D fallback active — WebGL unavailable');
      }

      // Benchmark device
      this.qualityProfile.benchmark();
      logger.info(`Quality profile: ${this.qualityProfile.level}`);

      // Initialize SaveManager and offer Continue if valid save exists
      const hasSave = await this.saveManager.hasSave();
      if (hasSave) {
        logger.info('Existing save detected');
      }

      // Generate or load Galaxy
      const simulator = new GalaxySimulator();
      const seed = config.seed ?? `SR_${Date.now()}`;
      this.galaxy = simulator.generateGalaxy(seed, config.systemCount ?? 10);
      logger.info(`Initializing with seed: ${seed}`);

      // Start at MAIN_MENU instead of STAR_MAP
      await this.transitionTo(SceneType.MAIN_MENU, { gameEngine: this });

      // Start game loop
      this.lastTime = performance.now();
      this.gameLoop(this.lastTime);
    } catch (error) {
      this.handleError(error as Error);
      throw error;
    }
  }

  async transitionTo(sceneType: SceneType, context?: object): Promise<void> {
    if (!this.renderer) {
      throw new GameSystemException('RENDERER_NOT_READY', 'Renderer not initialized.');
    }

    // Tear down current scene
    if (this.currentScene) {
      this.currentScene.destroy();
      this.currentScene = null;
    }

    // Handle new game creation when transitioning to STAR_MAP and no player exists
    if (sceneType === SceneType.STAR_MAP && !this.player) {
      const humanRace = new Race(
        'HUMAN' as RaceType,
        'Human',
        { piloting: 1 },
        { id: 'human_trait', description: 'Baseline humanity' },
        { tone: 'neutral', formality: 0.5, verbosity: 0.5 },
        { hullHP: 100, shields: 50, energy: 100, speed: 1.0, evasion: 0.8 },
        { buyMultiplier: 1.0, sellMultiplier: 0.9 },
      );
      const skillTree = new SkillTree([]);
      
      this.player = new Player(
        'player',
        'Captain',
        humanRace,
        0,
        1,
        skillTree,
        {},
        { activeQuests: [], completedQuests: [] },
        { entries: [] },
        1000,
        new PlayerShip(
          'Ranger-1',
          'Ranger-1',
          100,
          100,
          50,
          50,
          100,
          100,
          1.0,
          0.8,
          humanRace,
        ),
        new Inventory(),
        '', // currentSystemId placeholder
      );
      
      logger.info('Created new player for game start');
    }

    // Resolve starting system for new game
    if (sceneType === SceneType.STAR_MAP && this.player && this.galaxy) {
      if (!this.player.currentSystemId) {
        this.player.currentSystemId = this.galaxy.systems[0].id;
        this.galaxy.systems[0].explored = true;
        this.galaxy.systems[0].fogOfWar = false;
        logger.info(`New game: starting system set to ${this.player.currentSystemId}`);
      }
    }

    // Instantiate new scene with renderer
    switch (sceneType) {
      case SceneType.MAIN_MENU:
        this.currentScene = new MainMenuScene(this.renderer);
        break;
      case SceneType.STAR_MAP:
        this.currentScene = new StarMapScene(this.renderer);
        break;
      case SceneType.COMBAT:
        this.currentScene = new CombatScene(this.renderer);
        break;
      case SceneType.DIALOGUE:
        this.currentScene = new DialogueScene(this.renderer);
        break;
      case SceneType.INVENTORY:
        this.currentScene = new InventoryScene(this.renderer);
        break;
      case SceneType.SPACE_FLIGHT:
        this.currentScene = new SpaceFlightScene(this.renderer);
        break;
      default:
        throw new GameSystemException('INVALID_SCENE', `Unknown scene type: ${sceneType}`);
    }

    // Prepare context with galaxy and gameEngine for STAR_MAP if available
    const finalContext: Record<string, unknown> = { ...(context ?? {}) };
    if (sceneType === SceneType.STAR_MAP) {
      if (this.galaxy) {
        finalContext.galaxy = this.galaxy;
      }
      finalContext.gameEngine = this;
    }

    this.currentScene.initialize(finalContext);
    logger.info(`Transitioned to scene: ${sceneType}`);
  }

  async saveGame(slotId = 'auto'): Promise<void> {
    if (!this.galaxy || !this.player) {
      throw new GameSystemException('SAVE_NO_STATE', 'Cannot save: no active game state.');
    }

    const { SaveState } = await import('@/domain/SaveState');
    const state = new SaveState(
      this.saveManager.currentVersion,
      this.galaxy,
      this.player,
      [], // persistentDialogs would come from DialogueSystem
      Date.now(),
    );

    await this.saveManager.write(slotId, state);
  }

  handleError(error: Error): void {
    const response = this.exceptionHandler.handle(error);
    logger.error(`GameEngine handled error: ${response.code} - ${response.message}`);

    // Handle validation errors from save loading
    if (error instanceof GameValidationException && error.errorCode === 'SAVE_VALIDATION_FAILED') {
      // Show modal overlay with "Новая игра" button
      this.showErrorModal(
        `Ошибка сохранения: ${error.errorMessage}. Нажмите "Новая игра" для начала новой игры.`,
        false,
        true, // isNewGameButton = true
      );
      return;
    }

    if (!response.recoverable) {
      // Show fatal error modal and offer return to main menu
      this.showErrorModal(response.message, true);
    } else {
      this.showErrorModal(response.message, false);
    }
  }

  private handleCriticalError(response: { message: string }): void {
    // Emergency auto-save to _emergency slot
    if (this.galaxy && this.player) {
      this.saveGame('_emergency').catch((e) => {
        logger.error('Emergency auto-save failed:', e);
      });
    }
    this.showErrorModal(response.message, true);
  }

  private showErrorModal(message: string, _isFatal: boolean, isNewGameButton = false): void {
    if (!this.renderer) return;

    // Clear any existing modal
    this.clearModal();

    const width = this.renderer.app.screen.width;
    const height = this.renderer.app.screen.height;

    // Semi-transparent overlay
    const overlay = new Graphics();
    overlay.fill({ color: 0x000000, alpha: 0.85 });
    overlay.rect(0, 0, width, height);
    overlay.eventMode = 'static';
    this.renderer.uiLayer.addChild(overlay);
    this.modalObjects.push(overlay);

    // Error message text
    const msgText = new Text({
      text: message,
      style: {
        fontFamily: 'Courier New',
        fontSize: 16,
        fill: 0xff4444,
        align: 'center',
        wordWrap: true,
        wordWrapWidth: width * 0.8,
      },
    });
    msgText.anchor.set(0.5);
    msgText.x = width / 2;
    msgText.y = height / 2 - 40;
    this.renderer.uiLayer.addChild(msgText);
    this.modalObjects.push(msgText);

    if (isNewGameButton) {
      const btnText = new Text({
        text: 'Новая игра',
        style: {
          fontFamily: 'Courier New',
          fontSize: 20,
          fill: 0x00ff00,
          fontWeight: 'bold',
        },
      });
      btnText.anchor.set(0.5);
      btnText.x = width / 2;
      btnText.y = height / 2 + 40;
      btnText.eventMode = 'static';
      btnText.cursor = 'pointer';

      btnText.on('pointerdown', () => {
        this.clearModal();
        this.generateDefaultGameState();
        this.transitionTo(SceneType.STAR_MAP).catch((e) => {
          logger.error('Transition after modal failed:', e);
        });
      });

      btnText.on('pointerover', () => { btnText.alpha = 0.7; });
      btnText.on('pointerout', () => { btnText.alpha = 1; });

      this.renderer.uiLayer.addChild(btnText);
      this.modalObjects.push(btnText);
    }
  }

  private clearModal(): void {
    if (!this.renderer) return;
    for (const obj of this.modalObjects) {
      if (obj.parent) {
        this.renderer.uiLayer.removeChild(obj);
      }
      obj.destroy();
    }
    this.modalObjects = [];
  }

  private generateDefaultGameState(): void {
    // Reset player to trigger new game creation in transitionTo
    this.player = null;

    // Generate fresh galaxy
    const simulator = new GalaxySimulator();
    const seed = `SR_${Date.now()}`;
    this.galaxy = simulator.generateGalaxy(seed, 30);
    logger.info(`Generated default game state with seed: ${seed}`);
  }

  private gameLoop = (time: number): void => {
    const deltaTime = time - this.lastTime;
    this.lastTime = time;

    try {
      this.currentScene?.update(deltaTime);
      // PixiJS renders automatically via app.ticker / RAF
    } catch (error) {
      this.handleError(error as Error);
    }

    this.animationFrameId = requestAnimationFrame(this.gameLoop);
  };

  stop(): void {
    cancelAnimationFrame(this.animationFrameId);
    this.currentScene?.destroy();
    this.renderer?.destroy();
    this.onnxRegistry.cleanup();
  }
}
