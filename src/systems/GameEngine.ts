import type { GameConfig } from "@/types";
import { SceneType, FactionType } from "@/types";
import { Galaxy } from "@/domain/Galaxy";
import type { GameScene } from "@/presentation/GameScene";
import { Renderer } from "@/presentation/Renderer";
import { preloadTextures } from "@/presentation/textures";
import { SaveManager } from "@/data/SaveManager";
import { ONNXModelRegistry } from "@/ai/ONNXModelRegistry";
import { AdaptiveQualityProfile } from "@/ai/AdaptiveQualityProfile";
import { GlobalExceptionHandler } from "@/exceptions/GlobalExceptionHandler";
import { GameSystemException } from "@/exceptions/GameSystemException";
import { GameValidationException } from "@/exceptions/GameValidationException";
import { logger } from "@/utils/logger";
import { Graphics, Text } from "pixi.js";
import { validatePlayerSettings } from "@/validation/schemas";
import { Player } from "@/domain/Player";
import { NpcSimulator } from "@/systems/npc/NpcSimulator";
import { SeededRNG } from "@/utils/seededRNG";
import type { Quest } from "@/domain/Quest";
import {
  generateQuestBoard,
  type GeneratedQuest,
} from "@/systems/quests/QuestGenerator";
import { buildRegistry } from "@/systems/info/InfoService";
import type { GalacticRegistry } from "@/systems/info/GalacticRegistry";
import { PlayerShip } from "@/domain/PlayerShip";
import { Inventory } from "@/domain/Inventory";
import {
  ShipModule,
  WeaponModule,
  ShieldModule,
  EngineModule,
} from "@/domain/ShipModule";
import type {
  ISaveService,
  IGalaxyService,
  IPlayerService,
  IOnnxService,
  IExceptionHandler,
  IQuestService,
  IEquipmentService,
} from "@/core/ports";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import { GalaxyService, PlayerService, SceneFactory } from "@/core/services";
import { QuestManagerAdapter, EquipmentSystemAdapter } from "@/core/adapters";
import { TextQuestRuntime } from "@/systems/quests/TextQuestRuntime";
import {
  OnnxQuestNarrator,
  type QuestNarrator,
} from "@/ai/adapters/QuestNarrator";

/**
 * Optional DI dependencies for GameEngine.
 * When provided, GameEngine uses DI for better testability.
 * When not provided, GameEngine uses legacy direct instantiation for backward compatibility.
 */
export interface GameEngineDIDependencies {
  saveService: ISaveService;
  galaxyService: IGalaxyService;
  playerService: IPlayerService;
  onnxService: IOnnxService;
  exceptionHandler: IExceptionHandler;
  qualityProfile: AdaptiveQualityProfile;
  questService: IQuestService;
  equipmentService: IEquipmentService;
}

export class GameEngine {
  public currentScene: GameScene | null = null;
  public currentSceneType: SceneType = SceneType.MAIN_MENU;
  public galaxy: Galaxy | null = null;
  public player: Player | null = null;
  // Transient: the ship's world position in the system when the player last left
  // flight for the star map, so a hyperjump can start from where the ship was
  // (not teleport it next to the sun). Cleared once consumed.
  public lastFlightShipPos: { x: number; y: number } | null = null;
  public readonly saveManager: SaveManager;
  public readonly qualityProfile: AdaptiveQualityProfile;
  public readonly onnxRegistry: ONNXModelRegistry;
  public readonly questManager: IQuestService;
  public readonly equipmentSystem: IEquipmentService;
  public renderer: Renderer | null = null;
  /** GearCatalog-based loadout driving derived ship stats (speed, shields, etc.). */
  public playerLoadout: ShipLoadout | null = null;
  /** Runtime engine for the active text quest (one at a time). */
  public readonly textQuestRuntime = new TextQuestRuntime();
  /** Narrator for text quest node descriptions (ONNX with template fallback). */
  public readonly questNarrator: QuestNarrator;

  private exceptionHandler: IExceptionHandler;
  private animationFrameId = 0;
  private lastTime = 0;
  private modalObjects: (Graphics | Text)[] = [];
  private readonly galaxyService: IGalaxyService;
  private readonly playerService: IPlayerService;
  private readonly sceneFactory: SceneFactory;
  private readonly npcSimulator = new NpcSimulator();

  constructor(diDependencies?: GameEngineDIDependencies) {
    if (diDependencies) {
      // DI mode: use injected services
      this.exceptionHandler = diDependencies.exceptionHandler;
      this.qualityProfile = diDependencies.qualityProfile;
      this.onnxRegistry =
        diDependencies.onnxService as unknown as ONNXModelRegistry;
      this.saveManager = diDependencies.saveService as SaveManager;
      this.galaxyService = diDependencies.galaxyService;
      this.playerService = diDependencies.playerService;
      this.questManager = diDependencies.questService;
      this.equipmentSystem = diDependencies.equipmentService;
    } else {
      // Legacy mode: direct instantiation (backward compatibility)
      this.qualityProfile = new AdaptiveQualityProfile();
      this.onnxRegistry = new ONNXModelRegistry(this.qualityProfile);
      this.saveManager = new SaveManager();
      this.galaxyService = new GalaxyService();
      this.playerService = new PlayerService();
      this.exceptionHandler = GlobalExceptionHandler.getInstance();
      this.questManager = new QuestManagerAdapter();
      this.equipmentSystem = new EquipmentSystemAdapter();
    }

    this.sceneFactory = new SceneFactory();
    this.questNarrator = new OnnxQuestNarrator(this.onnxRegistry);

    this.exceptionHandler.onCriticalError = (response) => {
      this.handleCriticalError(response);
    };
  }

  async initialize(config: GameConfig): Promise<void> {
    try {
      // Load settings from localStorage and validate
      const storedSettings = localStorage.getItem("sr_settings");
      if (storedSettings) {
        try {
          validatePlayerSettings(JSON.parse(storedSettings));
          logger.info("Loaded and validated settings from localStorage");
        } catch (error) {
          logger.warn("Invalid settings, using defaults:", error);
        }
      }

      // Initialize Renderer
      const container = document.getElementById("game-container");
      if (!container) {
        throw new GameSystemException(
          "NO_CONTAINER",
          "Game container not found in DOM.",
        );
      }
      this.renderer = new Renderer(container);
      await this.renderer.initialize();

      // Load generated art into the texture cache before any scene builds, so
      // sprites resolve immediately (missing art simply falls back to Graphics).
      await preloadTextures();

      // Check for Canvas2D fallback after renderer init
      const rendererType = (
        this.renderer.app.renderer as unknown as { type?: string }
      ).type;
      if (rendererType === "canvas") {
        logger.warn("Canvas2D fallback active — WebGL unavailable");
      }

      // Benchmark device
      this.qualityProfile.benchmark();
      logger.info(`Quality profile: ${this.qualityProfile.level}`);

      // Initialize SaveManager and auto-load if valid save exists
      const hasSave = await this.saveManager.hasSave();
      if (hasSave) {
        logger.info("Existing save detected, attempting auto-load");
        try {
          const loaded = await this.loadGame("auto");
          if (loaded) {
            // Start game loop after successful load
            this.lastTime = performance.now();
            this.gameLoop(this.lastTime);
            return;
          }
        } catch (error) {
          logger.error("Auto-load failed, falling back to main menu:", error);
        }
      }

      // Generate or load Galaxy
      const seed = config.seed ?? `SR_${Date.now()}`;
      this.galaxy = await this.galaxyService.generate(
        seed,
        config.systemCount ?? 10,
      );
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
      throw new GameSystemException(
        "RENDERER_NOT_READY",
        "Renderer not initialized.",
      );
    }

    // Persist current scene type for recovery across reloads
    this.currentSceneType = sceneType;
    localStorage.setItem("sr_currentScene", sceneType);

    // Tear down current scene
    if (this.currentScene) {
      this.currentScene.destroy();
      this.currentScene = null;
    }

    // Handle new game creation when transitioning to STAR_MAP or SPACE_FLIGHT and no player exists
    const isGameStartScene =
      sceneType === SceneType.STAR_MAP || sceneType === SceneType.SPACE_FLIGHT;
    if (isGameStartScene && !this.player) {
      // Get selected faction from context or default to OUTLANDERS
      const selectedFaction =
        (context as { selectedFaction?: FactionType })?.selectedFaction ??
        FactionType.OUTLANDERS;

      this.player = this.playerService.createPlayer({
        factionType: selectedFaction,
        captainName: "Captain",
        startingMoney: 1000,
      });

      // Add starter modules to inventory for testing
      this.player.inventory.addItem(
        new WeaponModule(
          "weapon_laser_1",
          "Лазер МК-1",
          { type: "damage", value: 10 },
          1,
          15,
          3,
          10,
        ),
      );
      this.player.inventory.addItem(
        new ShieldModule(
          "shield_basic_1",
          "Базовый щит",
          { type: "shield", value: 20 },
          1,
          25,
          5,
        ),
      );
      this.player.inventory.addItem(
        new EngineModule(
          "engine_fast_1",
          "Быстрый двигатель",
          { type: "speed", value: 0.2 },
          1,
          0.3,
          0.1,
        ),
      );

      logger.info(`Created new player with faction: ${this.player.faction}`);

      // Initialize GearCatalog loadout: starter corvette with engine + fuel tank
      if (!this.playerLoadout) {
        const loadout = new ShipLoadout("hull_corvette");
        loadout.install("eq_engine_i");
        loadout.install("eq_tank");
        this.playerLoadout = loadout;
      }
    }

    // Resolve starting system for new game
    if (isGameStartScene && this.player && this.galaxy) {
      if (!this.player.currentSystemId) {
        this.player.currentSystemId = this.galaxy.systems[0].id;
        this.galaxy.systems[0].explored = true;
        this.galaxy.systems[0].fogOfWar = false;
        logger.info(
          `New game: starting system set to ${this.player.currentSystemId}`,
        );
      }
    }

    // Instantiate new scene with renderer via factory (OCP: new scenes added in factory)
    const newScene = this.sceneFactory.createScene(sceneType, this.renderer);
    if (!newScene) {
      throw new GameSystemException(
        "INVALID_SCENE",
        `Unknown scene type: ${sceneType}`,
      );
    }
    this.currentScene = newScene;

    // Prepare context with galaxy and gameEngine for gameplay scenes
    const finalContext: Record<string, unknown> = { ...(context ?? {}) };
    if (sceneType === SceneType.STAR_MAP) {
      if (this.galaxy) {
        finalContext.galaxy = this.galaxy;
      }
    }
    if (
      sceneType === SceneType.STAR_MAP ||
      sceneType === SceneType.SPACE_FLIGHT ||
      sceneType === SceneType.PLANET ||
      sceneType === SceneType.DIALOGUE ||
      sceneType === SceneType.INVENTORY ||
      sceneType === SceneType.COMBAT ||
      sceneType === SceneType.TRADE ||
      sceneType === SceneType.EQUIPMENT_SHOP ||
      sceneType === SceneType.INFO_CENTER ||
      sceneType === SceneType.STATION ||
      sceneType === SceneType.GOVERNMENT ||
      sceneType === SceneType.TEXT_QUEST
    ) {
      finalContext.gameEngine = this;
    }

    this.currentScene.initialize(finalContext);
    logger.info(`Transitioned to scene: ${sceneType}`);

    // Auto-save on scene transition (only for gameplay scenes with valid state)
    if (
      this.galaxy &&
      this.player &&
      sceneType !== SceneType.MAIN_MENU &&
      sceneType !== SceneType.RACE_SELECTION
    ) {
      this.saveGame("auto").catch((e) => {
        logger.error("Auto-save failed:", e);
      });
    }
  }

  /**
   * Advance the galaxy by one game day: increment the day counter and tick the
   * living-galaxy NPC simulation. The per-day RNG is derived from the galaxy id
   * and day so simulation stays deterministic and survives save/load (no RNG
   * state to persist). Call this instead of `galaxy.simulateDay()` directly.
   */
  advanceGalaxyDay(): void {
    if (!this.galaxy) return;
    this.galaxy.simulateDay();
    const rng = new SeededRNG(`${this.galaxy.id}_day_${this.galaxy.gameDays}`);
    const npcEvents = this.npcSimulator.tick(
      this.galaxy,
      rng,
      this.player?.currentSystemId,
    );
    for (const event of npcEvents) {
      this.galaxy.addNewsEvent(event);
    }

    // Advance market drift on every planet (Task 1: daily supply/demand drift).
    for (const system of this.galaxy.systems) {
      for (const planet of system.planets) {
        if (typeof planet.market.advanceMarketDay === "function") {
          planet.market.advanceMarketDay(() => rng.next());
        }
      }
    }

    // Droid repair: if player has a droid installed, heal hull by repairRate HP/day
    if (this.player && this.playerLoadout) {
      const stats = this.playerLoadout.derivedStats();
      if (stats.repairRate > 0) {
        const ship = this.player.ship;
        if (ship.hullHP < ship.maxHull) {
          ship.hullHP = Math.min(ship.maxHull, ship.hullHP + stats.repairRate);
        }
      }
    }

    this.infoRegistryCache = null; // world advanced → registry is stale

    // Check for expired quests and apply failure penalties.
    this.checkExpiredQuests();
  }

  /**
   * Check all active quests against the current game day. Expired quests are
   * failed and their penalty (credits fine + reputation loss) applied to the
   * player. Delegates to QuestManager which owns the failure logic.
   */
  checkExpiredQuests(): void {
    if (!this.player || !this.galaxy) return;
    this.questManager.checkExpiredQuests(this.galaxy.gameDays, this.player);
  }

  // Lazily-built galactic info registry, cached per game day (EPIC-009).
  private infoRegistryCache: { day: number; reg: GalacticRegistry } | null =
    null;

  /**
   * The galactic information registry for the current day (EPIC-009): ship
   * locations, market goods and per-planet gear shops, queryable by parameter
   * and jump distance. Rebuilt when the day changes. Null until a galaxy exists.
   */
  getInfoRegistry(): GalacticRegistry | null {
    if (!this.galaxy) return null;
    const day = this.galaxy.gameDays;
    if (this.infoRegistryCache?.day === day) return this.infoRegistryCache.reg;
    const reg = buildRegistry(this.galaxy, this.galaxy.id, day);
    this.infoRegistryCache = { day, reg };
    return reg;
  }

  /**
   * The quest board a planet currently offers (EPIC-008): deterministic from the
   * galaxy seed + planet + day-bucket, with quests the player has already taken
   * or completed filtered out.
   */
  getQuestBoard(planetId: string): GeneratedQuest[] {
    if (!this.galaxy || !this.player) return [];
    const originSystem = this.galaxy.systems.find(
      (s) => s.id === this.player!.currentSystemId,
    );
    const faction: string =
      (originSystem as { ownerFaction?: string })?.ownerFaction ??
      "INDEPENDENT";
    const board = generateQuestBoard({
      systems: this.galaxy.systems,
      originSystemId: this.player.currentSystemId,
      planetId,
      day: this.galaxy.gameDays,
      seed: this.galaxy.id,
      completedQuestChains: this.player.completedQuestChains,
    });
    // Record when this board was last fetched for persistence tracking.
    this.galaxy.questBoards[planetId] = this.galaxy.gameDays;
    const taken = new Set<string>([
      ...this.questManager.getActiveQuests().map((q) => q.id),
      ...this.questManager.getCompletedQuestIds(),
    ]);
    return board.filter((q) => {
      if (taken.has(q.template.id)) return false;
      // Filter elite quests the player doesn't have enough reputation for.
      const minRep = q.template.minReputation ?? 0;
      if (minRep > 0 && this.player!.getReputation(faction) < minRep)
        return false;
      return true;
    });
  }

  /**
   * Accept a generated board quest (EPIC-008): registers and activates it via the
   * quest service, tagged with the issuing planet and current day for deadlines.
   */
  acceptBoardQuest(quest: GeneratedQuest, planetId: string): Quest | null {
    return this.questManager.acceptQuestFromTemplate(
      quest.template,
      planetId,
      this.galaxy?.gameDays ?? 0,
    );
  }

  async saveGame(slotId = "auto"): Promise<void> {
    if (!this.galaxy || !this.player) {
      throw new GameSystemException(
        "SAVE_NO_STATE",
        "Cannot save: no active game state.",
      );
    }

    // Mirror live quest state into the player's questLog so quests (and their
    // progress/deadlines) survive save/load. QuestManager owns the source of
    // truth at runtime; player.questLog is only the serialized snapshot.
    const questLog = this.player.questLog as {
      activeQuests: unknown[];
      completedQuests: unknown[];
    };
    questLog.activeQuests.length = 0;
    questLog.activeQuests.push(...this.questManager.getActiveQuests());
    questLog.completedQuests.length = 0;
    questLog.completedQuests.push(...this.questManager.getCompletedQuestIds());

    const { SaveState } = await import("@/domain/SaveState");
    const state = new SaveState(
      this.saveManager.currentVersion,
      this.galaxy,
      this.player,
      [], // persistentDialogs would come from DialogueSystem
      Date.now(),
      this.currentSceneType,
    );

    await this.saveManager.write(slotId, state);
  }

  async loadGame(slotId = "auto"): Promise<boolean> {
    const save = await this.saveManager.read(slotId);
    if (!save) {
      return false;
    }

    // Validate save data integrity
    if (!save.player || !save.player.id || !save.galaxy) {
      throw new GameValidationException(
        "SAVE_VALIDATION_FAILED",
        "Corrupted save data - missing required fields",
      );
    }

    this.galaxy = save.galaxy;
    this.player = save.player;

    // Saved state is plain JSON: restore class prototypes so domain methods
    // (galaxy.simulateDay, ship.repair, inventory.addItem) and `instanceof`
    // module checks work after "Continue". Field data is already correct.
    this.rehydrateLoadedState();

    // Restore quest state into the live QuestManager (it owns quests at
    // runtime; the save only carries the serialized questLog).
    const loadedQuestLog = this.player.questLog as {
      activeQuests?: Quest[];
      completedQuests?: string[];
    };
    this.questManager.restoreState(
      loadedQuestLog.activeQuests ?? [],
      (loadedQuestLog.completedQuests ?? []) as string[],
    );

    // Ensure player has a valid current system
    if (!this.player.currentSystemId && this.galaxy.systems[0]) {
      this.player.currentSystemId = this.galaxy.systems[0].id;
      logger.info("Set default currentSystemId to first system");
    }

    // Validate current system exists
    const currentSystem = this.galaxy.systems.find(
      (s) => s.id === this.player!.currentSystemId,
    );
    if (!currentSystem) {
      logger.warn("Current system not found, resetting to first system");
      this.player.currentSystemId = this.galaxy.systems[0].id;
    }

    // Restore scene type (default to SPACE_FLIGHT for better UX).
    // Scenes that require transient context (a specific planet, NPC or
    // encounter) or are overlays cannot be safely re-entered from a save with
    // only { gameEngine }, so fall back to SPACE_FLIGHT to avoid a blank,
    // soft-locked screen on "Continue".
    const contextDependentScenes: SceneType[] = [
      SceneType.PLANET,
      SceneType.TRADE,
      SceneType.DIALOGUE,
      SceneType.COMBAT,
      SceneType.INVENTORY,
    ];
    const savedScene = save.currentSceneType ?? SceneType.SPACE_FLIGHT;
    const sceneType = contextDependentScenes.includes(savedScene)
      ? SceneType.SPACE_FLIGHT
      : savedScene;
    await this.transitionTo(sceneType, { gameEngine: this });
    return true;
  }

  /**
   * Restore class prototypes on the just-loaded plain save objects.
   *
   * SaveManager persists/returns plain JSON, so loaded entities have the right
   * field data but none of their domain methods (and modules fail `instanceof`
   * checks). Re-attaching the prototypes is sufficient because all instance
   * data is already present; we never reconstruct via constructors, avoiding
   * positional-argument drift.
   */
  private rehydrateLoadedState(): void {
    if (this.galaxy) {
      Object.setPrototypeOf(this.galaxy, Galaxy.prototype);
    }

    if (this.player) {
      if (this.player.ship) {
        Object.setPrototypeOf(this.player.ship, PlayerShip.prototype);
        for (const mod of this.player.ship.modules) {
          this.rehydrateModule(mod);
        }
      }
      if (this.player.inventory) {
        Object.setPrototypeOf(this.player.inventory, Inventory.prototype);
        for (const mod of this.player.inventory.modules) {
          this.rehydrateModule(mod);
        }
      }
    }
  }

  /** Re-attach the correct ShipModule subclass prototype based on category. */
  private rehydrateModule(mod: ShipModule | null): void {
    if (!mod) return;
    switch (mod.category) {
      case "WEAPON":
        Object.setPrototypeOf(mod, WeaponModule.prototype);
        break;
      case "SHIELD":
        Object.setPrototypeOf(mod, ShieldModule.prototype);
        break;
      case "ENGINE":
        Object.setPrototypeOf(mod, EngineModule.prototype);
        break;
      default:
        Object.setPrototypeOf(mod, ShipModule.prototype);
    }
  }

  handleError(error: Error): void {
    const response = this.exceptionHandler.handle(error);
    logger.error(
      `GameEngine handled error: ${response.code} - ${response.message}`,
    );

    // Handle validation errors from save loading
    if (
      error instanceof GameValidationException &&
      error.errorCode === "SAVE_VALIDATION_FAILED"
    ) {
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
      this.saveGame("_emergency").catch((e) => {
        logger.error("Emergency auto-save failed:", e);
      });
    }
    this.showErrorModal(response.message, true);
  }

  private showErrorModal(
    message: string,
    _isFatal: boolean,
    isNewGameButton = false,
  ): void {
    if (!this.renderer) return;

    // Clear any existing modal
    this.clearModal();

    const width = this.renderer.app.screen.width;
    const height = this.renderer.app.screen.height;

    // Semi-transparent overlay
    const overlay = new Graphics();
    overlay.fill({ color: 0x000000, alpha: 0.85 });
    overlay.rect(0, 0, width, height);
    overlay.eventMode = "static";
    this.renderer.uiLayer.addChild(overlay);
    this.modalObjects.push(overlay);

    // Error message text
    const msgText = new Text({
      text: message,
      style: {
        fontFamily: "Courier New",
        fontSize: 16,
        fill: 0xff4444,
        align: "center",
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
        text: "Новая игра",
        style: {
          fontFamily: "Courier New",
          fontSize: 20,
          fill: 0x00ff00,
          fontWeight: "bold",
        },
      });
      btnText.anchor.set(0.5);
      btnText.x = width / 2;
      btnText.y = height / 2 + 40;
      btnText.eventMode = "static";
      btnText.cursor = "pointer";

      btnText.on("pointerdown", async () => {
        this.clearModal();
        await this.generateDefaultGameState();
        await this.transitionTo(SceneType.STAR_MAP).catch((e) => {
          logger.error("Transition after modal failed:", e);
        });
      });

      btnText.on("pointerover", () => {
        btnText.alpha = 0.7;
      });
      btnText.on("pointerout", () => {
        btnText.alpha = 1;
      });

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

  private async generateDefaultGameState(): Promise<void> {
    this.player = null;
    this.playerService.deletePlayer();
    const seed = `SR_${Date.now()}`;
    this.galaxy = await this.galaxyService.generate(seed, 30);
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
