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
import { GAME_BALANCE } from "@/config/balance";
import { Graphics, Text } from "pixi.js";
import { validatePlayerSettings } from "@/validation/schemas";
import { Player } from "@/domain/Player";
import { NpcSimulator } from "@/systems/npc/NpcSimulator";
import { GalaxySimulator } from "@/systems/GalaxySimulator";
import { stepOwnershipTick } from "@/systems/galaxy/OvermindBalance";
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
import type { Faction } from "@/types/faction";
import { NpcShip } from "@/domain/NpcShip";
import { GalaxyService, PlayerService, SceneFactory } from "@/core/services";
import { QuestManagerAdapter, EquipmentSystemAdapter } from "@/core/adapters";
import { TextQuestRuntime } from "@/systems/quests/TextQuestRuntime";
import {
  OnnxQuestNarrator,
  type QuestNarrator,
} from "@/ai/adapters/QuestNarrator";
import { getQuestScript } from "@/systems/quests/TextQuestRegistry";
import type { QuestScript } from "@/systems/quests/QuestScript";
import { AudioManager } from "@/systems/AudioManager";

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
  // Player's chosen in-flight game-speed multiplier (1×/2×/4×). Held here — not on
  // the per-scene FlightHud/ShipPhysics, both rebuilt on every SPACE_FLIGHT
  // re-init — so the speed survives a land/take-off or star-map round-trip
  // instead of resetting to 1× (playtest3 F3). Re-applied by
  // FlightHud.restoreGameSpeed() on every HUD (re)build. Deliberately NOT in
  // SaveState/schemas.ts (transient cross-scene state, like lastFlightShipPos).
  public gameSpeedMultiplier = 1;
  /** Called when a quest expires mid-session so the HUD can show a toast. */
  public questExpiryCallback?: (message: string) => void;
  /** Called when a quest moves to pending-return state so the HUD can show a toast. */
  public questPendingReturnCallback?: (message: string) => void;
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
  /** Audio subsystem: background music + SFX. */
  public readonly audio = new AudioManager();

  private exceptionHandler: IExceptionHandler;
  private animationFrameId = 0;
  private lastTime = 0;
  private modalObjects: (Graphics | Text)[] = [];
  private loadingOverlayObjects: (Graphics | Text)[] = [];
  private _gameOverShown = false;
  private _winScreenShown = false;
  private readonly galaxyService: IGalaxyService;
  private readonly playerService: IPlayerService;
  private readonly sceneFactory: SceneFactory;
  private readonly npcSimulator = new NpcSimulator();
  private readonly galaxySimulator = new GalaxySimulator();

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

    // Safety net: guarantee no orphaned interactive objects survive a scene's incomplete destroy() (prevents click-swallowing across scenes).
    this.renderer.clearGameLayer();
    this.renderer.clearUILayer();

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
        this.playerLoadout = this.starterLoadout();
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
      // Mark the starting system visited before any scene (the star map
      // included) opens. Otherwise getSystemVisibility() treats every system —
      // including the one the player is sitting in — as "unknown" and the star
      // map renders "?" everywhere.
      this.player.markVisited(this.player.currentSystemId);
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

    // Track the planet the player is parked at so a later re-entry to
    // SPACE_FLIGHT spawns the ship next to it instead of at the system edge.
    // Set on landing (PLANET); SpaceFlightScene consumes & clears it on take-off.
    if (this.player && sceneType === SceneType.PLANET) {
      const landedPlanet = (context as { planet?: { id?: string } } | undefined)
        ?.planet;
      if (landedPlanet?.id) this.player.landedPlanetId = landedPlanet.id;
    }

    this.currentScene.initialize(finalContext);
    logger.info(`Transitioned to scene: ${sceneType}`);

    // Play background music track matching the new scene.
    this.playSceneTrack(sceneType);

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

    // Global galaxy events: PIRATE_SURGE, TRADE_BOOM, PLAGUE, DISCOVERY (Task 24).
    const globalEvents = this.galaxySimulator.tickGlobalEvents(
      this.galaxy,
      rng,
    );
    for (const event of globalEvents) {
      this.galaxy.addNewsEvent(event);
    }

    // Advance market drift on every planet (Task 1: daily supply/demand drift).
    // Emit a MARKET_SHIFT news event for notable price swings (~10% chance/day per system).
    for (const system of this.galaxy.systems) {
      for (const planet of system.planets) {
        if (typeof planet.market.advanceMarketDay === "function") {
          planet.market.advanceMarketDay(() => rng.next());
        }
      }
      if (rng.next() < 0.1 && system.planets.length > 0) {
        this.galaxy.addNewsEvent({
          type: "MARKET_SHIFT",
          systemId: system.id,
          day: this.galaxy.gameDays,
          description: `Рыночные цены изменились в системе ${system.name}`,
        });
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

    // Self-balancing ownership tick: replaces the old unidirectional expansion.
    // Runs every OVERMIND_BALANCE_INTERVAL days; pure function, no side effects
    // beyond the returned ownership sets.
    if (this.galaxy.gameDays % GAME_BALANCE.OVERMIND_BALANCE_INTERVAL === 0) {
      const balanceCfg = {
        pCapture: GAME_BALANCE.OVERMIND_CAPTURE_PROB,
        pRecaptureBase: GAME_BALANCE.OVERMIND_RECAPTURE_BASE_PROB,
        feedbackStrength: GAME_BALANCE.OVERMIND_FEEDBACK_STRENGTH,
      };
      const nodes = this.galaxy.systems.map((s) => ({
        id: s.id,
        connections: s.connections,
      }));
      const prevOvermind = new Set(this.galaxy.overmindSystems);
      const prevPirate = new Set(this.galaxy.pirateSystems);
      const result = stepOwnershipTick(
        nodes,
        this.galaxy.overmindSystems,
        this.galaxy.pirateSystems,
        rng,
        balanceCfg,
      );
      this.galaxy.overmindSystems = result.overmindSystems;
      this.galaxy.pirateSystems = result.pirateSystems;

      // Emit news for newly captured systems.
      for (const id of result.overmindSystems) {
        if (!prevOvermind.has(id)) {
          const sys = this.galaxy.systems.find((s) => s.id === id);
          if (sys) {
            this.galaxy.addNewsEvent({
              type: "OVERMIND_EXPANSION",
              systemId: id,
              day: this.galaxy.gameDays,
              description: `OVERMIND захватил систему ${sys.name}`,
            });
            logger.info(`OVERMIND captured: ${sys.name} (${id})`);
          }
        }
      }
      for (const id of result.pirateSystems) {
        if (!prevPirate.has(id)) {
          const sys = this.galaxy.systems.find((s) => s.id === id);
          if (sys) {
            this.galaxy.addNewsEvent({
              type: "PIRATE_SURGE",
              systemId: id,
              day: this.galaxy.gameDays,
              description: `Пираты захватили систему ${sys.name}`,
            });
            logger.info(`Pirates captured: ${sys.name} (${id})`);
          }
        }
      }

      // Floor: the balance tick always maintains a minimum cosmic overmind
      // presence (OVERMIND_FLOOR_MIN). Only direct player combat (Task 4) can
      // reduce below this; natural balance cannot wipe the overmind entirely.
      // Check overmindSystems only — pirates filling the hostile quota must not
      // mask an overmind wipe-out that bypasses the loss-condition tracker.
      if (
        this.galaxy.overmindSystems.length < GAME_BALANCE.OVERMIND_FLOOR_MIN
      ) {
        const hostile = new Set([
          ...this.galaxy.overmindSystems,
          ...this.galaxy.pirateSystems,
        ]);
        const playerSystemId = this.player?.currentSystemId ?? "";
        const available = this.galaxy.systems.filter(
          (s) => !hostile.has(s.id) && s.id !== playerSystemId,
        );
        const needed =
          GAME_BALANCE.OVERMIND_FLOOR_MIN - this.galaxy.overmindSystems.length;
        for (let i = 0; i < needed && available.length > 0; i++) {
          const idx = rng.nextInt(0, available.length - 1);
          const chosen = available.splice(idx, 1)[0];
          this.galaxy.addOvermindSystem(chosen.id);
          logger.info(
            `OVERMIND floor: reseeded at ${chosen.name} (${chosen.id})`,
          );
        }
      }
    }

    // Loss condition: OVERMIND majority + past grace period + full-size galaxy.
    if (
      this.galaxy.isOvermindVictory(
        GAME_BALANCE.OVERMIND_LOSS_GRACE_DAYS,
        GAME_BALANCE.OVERMIND_LOSS_MIN_SYSTEMS,
        this.galaxy.gameDays,
      ) &&
      !this._gameOverShown
    ) {
      logger.warn(
        "OVERMIND controls majority of galaxy — triggering game over",
      );
      this._gameOverShown = true;
      this.showGameOutcomeScreen(false);
    }

    this.infoRegistryCache = null; // world advanced → registry is stale

    // Check for expired quests and apply failure penalties.
    this.checkExpiredQuests();

    // Win condition: rank >= VETERAN (2) + 3+ factions with rep > 50.
    if (this.checkWinCondition() && !this._winScreenShown) {
      this._winScreenShown = true;
      this.transitionTo(SceneType.WIN_SCREEN, { gameEngine: this }).catch((e) =>
        logger.error("Win screen transition failed:", e),
      );
    }
  }

  /**
   * Returns true when the player meets the win condition:
   * rank >= 2 ("Ветеран") AND reputation > 50 with at least 3 factions.
   */
  checkWinCondition(): boolean {
    if (!this.player) return false;
    const VETERAN_RANK = 2;
    if ((this.player.rank ?? 0) < VETERAN_RANK) return false;
    const factions = Object.values(FactionType);
    const allied = factions.filter(
      (f) => (this.player!.reputation[f] ?? 0) > 50,
    );
    return allied.length >= 3;
  }

  /**
   * Check all active quests against the current game day. Expired quests are
   * failed and their penalty (credits fine + reputation loss) applied to the
   * player. Delegates to QuestManager which owns the failure logic.
   */
  checkExpiredQuests(): void {
    if (!this.player || !this.galaxy) return;
    const expired = this.questManager.checkExpiredQuests(
      this.galaxy.gameDays,
      this.player,
    );
    for (const quest of expired) {
      this.questExpiryCallback?.(`Квест просрочен: «${quest.title}»`);
    }
  }

  /**
   * Liberate the player's current system from OVERMIND or pirate control.
   * Called on a player combat victory. Returns true if the system was hostile
   * and has been freed; false when the current system is already faction-held.
   */
  liberateCurrentSystem(): boolean {
    if (!this.galaxy || !this.player?.currentSystemId) return false;
    const liberated = this.galaxy.tryLiberate(this.player.currentSystemId);
    if (liberated) {
      logger.info(`Player liberated system ${this.player.currentSystemId}`);
    }
    return liberated;
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
    // Determine OVERMIND-adjacent systems for injecting DEFENSE quests.
    const overmindAdjacent = this.galaxy
      .getOvermindAdjacentSystems(this.player.currentSystemId)
      .map((s) => s.id);

    const board = generateQuestBoard({
      systems: this.galaxy.systems,
      originSystemId: this.player.currentSystemId,
      planetId,
      day: this.galaxy.gameDays,
      seed: this.galaxy.id,
      completedQuestChains: this.player.completedQuestChains,
      overmindSystems: this.galaxy.overmindSystems,
      overmindAdjacentSystems: overmindAdjacent,
    });
    // Record when this board was last fetched for persistence tracking.
    this.galaxy.questBoards[planetId] = this.galaxy.gameDays;
    const taken = new Set<string>([
      ...this.questManager.getActiveQuests().map((q) => q.id),
      ...this.questManager.getCompletedQuestIds(),
      // Pending-return quests (objectives done, reward unclaimed) must not
      // reappear on the board — otherwise they can be re-accepted into a
      // duplicate active copy while the original awaits its reward.
      ...this.questManager.getPendingReturnQuests().map((q) => q.id),
    ]);
    return board.filter((q) => {
      if (taken.has(q.template.id)) return false;
      // Filter elite quests the player doesn't have enough reputation for.
      const minRep = q.template.minReputation ?? 0;
      if (minRep > 0 && this.player!.getReputation(faction) < minRep)
        return false;
      // Filter elite quests the player doesn't have sufficient rank for.
      const minRank = q.template.minRank ?? 0;
      if (minRank > 0 && (this.player!.rank ?? 0) < minRank) return false;
      return true;
    });
  }

  /**
   * Accept a generated board quest (EPIC-008): registers and activates it via the
   * quest service, tagged with the issuing planet and current day for deadlines.
   */
  acceptBoardQuest(quest: GeneratedQuest, planetId: string): Quest | null {
    const factionId =
      this.galaxy?.systems.find((s) => s.planets.some((p) => p.id === planetId))
        ?.ownerFaction ?? "";
    return this.questManager.acceptQuestFromTemplate(
      quest.template,
      planetId,
      this.galaxy?.gameDays ?? 0,
      String(factionId),
    );
  }

  /**
   * Start a scripted text quest (EPIC-005 / Task 9).
   * Looks up the QuestScript by ID, injects an ONNX narration intro into the
   * first location (template fallback when ONNX is unavailable), then transitions
   * to TextQuestScene with the prepared script in context.
   */
  async startTextQuest(
    scriptId: string,
    seed?: number,
    returnScene: SceneType = SceneType.PLANET,
    returnContext: object = {},
    questId?: string,
  ): Promise<void> {
    const script = getQuestScript(scriptId);
    if (!script) {
      logger.warn(`startTextQuest: unknown script id "${scriptId}"`);
      return;
    }
    const scriptWithIntro = await this.injectQuestNarration(script);
    await this.transitionTo(SceneType.TEXT_QUEST, {
      gameEngine: this,
      questScript: scriptWithIntro,
      seed: seed ?? Date.now(),
      returnScene,
      returnContext,
      questId,
    });
  }

  /** Prepend a narration sentence from questNarrator to the start location text. */
  private async injectQuestNarration(
    script: QuestScript,
  ): Promise<QuestScript> {
    try {
      const system = this.galaxy?.systems.find(
        (s) => s.id === this.player?.currentSystemId,
      );
      const planetName = system?.planets[0]?.name ?? system?.name ?? "станция";
      const intro = await this.questNarrator.narrateQuestIntro(
        script,
        planetName,
      );
      if (!intro) return script;
      const locations = script.locations.map((loc) =>
        loc.id === script.startLocation
          ? { ...loc, text: `${intro}\n\n${loc.text}` }
          : loc,
      );
      return { ...script, locations };
    } catch {
      return script;
    }
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
      activeQuests: Quest[];
      completedQuests: string[];
      completedChainParts: Record<string, number[]>;
      pendingReturnQuests: Quest[];
    };
    questLog.activeQuests.length = 0;
    questLog.activeQuests.push(...this.questManager.getActiveQuests());
    questLog.completedQuests.length = 0;
    questLog.completedQuests.push(...this.questManager.getCompletedQuestIds());
    questLog.completedChainParts = this.questManager.getCompletedChainParts();
    questLog.pendingReturnQuests = this.questManager.getPendingReturnQuests();

    const { SaveState } = await import("@/domain/SaveState");
    const state = new SaveState(
      this.saveManager.currentVersion,
      this.galaxy,
      this.player,
      [], // persistentDialogs would come from DialogueSystem
      Date.now(),
      this.currentSceneType,
      this.playerLoadout?.toJSON(),
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

    // Restore the canonical loadout from the save; saves from before loadout
    // persistence — or a snapshot whose hull no longer exists in the catalog —
    // fall back to the default starter loadout so gear-derived stats still
    // work. (No shop flow installs into the loadout yet — F6 known gap,
    // CLAUDE.md — so until shops are canonicalized this round-trips the
    // starter loadout.)
    const restoredLoadout = save.loadout
      ? ShipLoadout.fromJSON(save.loadout, this.playerLoadoutFaction())
      : null;
    this.playerLoadout = restoredLoadout ?? this.starterLoadout();

    // Restore quest state into the live QuestManager (it owns quests at
    // runtime; the save only carries the serialized questLog).
    const loadedQuestLog = this.player.questLog;
    this.questManager.restoreState(
      loadedQuestLog.activeQuests ?? [],
      loadedQuestLog.completedQuests ?? [],
      loadedQuestLog.completedChainParts ?? {},
      loadedQuestLog.pendingReturnQuests ?? [],
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

    // Migration guard: older saves predate visitedSystems tracking, leaving the
    // array empty. Seed it with every explored system so the star map shows
    // names for all previously-visited stars, not just the current one.
    if (this.player.visitedSystems.length === 0) {
      for (const sys of this.galaxy.systems) {
        if (sys.explored) this.player.markVisited(sys.id);
      }
      // Ensure current system is included even if somehow not yet explored.
      if (this.player.currentSystemId) {
        this.player.markVisited(this.player.currentSystemId);
      }
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
      SceneType.STATION,
      SceneType.EQUIPMENT_SHOP,
      SceneType.GOVERNMENT,
      SceneType.TEXT_QUEST,
      SceneType.WIN_SCREEN,
      SceneType.INFO_CENTER,
    ];
    const savedScene = save.currentSceneType ?? SceneType.SPACE_FLIGHT;
    const sceneType = contextDependentScenes.includes(savedScene)
      ? SceneType.SPACE_FLIGHT
      : savedScene;
    await this.transitionTo(sceneType, { gameEngine: this });
    return true;
  }

  /**
   * The player's faction as the ShipLoadout `Faction` type, so loadouts can
   * enforce micromodule faction-incompatibility (canon §11.3). `FactionType`
   * and `Faction` share their string values for all playable factions.
   */
  private playerLoadoutFaction(): Faction | undefined {
    return this.player?.faction as unknown as Faction | undefined;
  }

  /** Default starter loadout: corvette with engine + fuel tank. */
  private starterLoadout(): ShipLoadout {
    const loadout = new ShipLoadout(
      "hull_corvette",
      this.playerLoadoutFaction(),
    );
    loadout.install("eq_engine_i");
    loadout.install("eq_tank");
    return loadout;
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
      for (const npc of this.galaxy.npcShips ?? []) {
        Object.setPrototypeOf(npc, NpcShip.prototype);
      }
    }

    if (this.player) {
      Object.setPrototypeOf(this.player, Player.prototype);
      // Fields added after initial release may be absent in older saves.
      if (!Array.isArray(this.player.visitedSystems)) {
        this.player.visitedSystems = [];
      }
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

    // Ensure stations array exists on each StarSystem (added in Task 26).
    if (this.galaxy) {
      for (const system of this.galaxy.systems) {
        if (!Array.isArray((system as { stations?: unknown }).stations)) {
          (system as { stations: unknown[] }).stations = [];
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

  /**
   * Show a full-screen win or loss overlay with a "Начать заново" button.
   * Called when the player destroys the OVERMIND core (win) or OVERMIND
   * captures more than half the galaxy (loss).
   */
  showGameOutcomeScreen(win: boolean): void {
    if (!this.renderer) return;
    this.clearModal();

    const width = this.renderer.app.screen.width;
    const height = this.renderer.app.screen.height;

    const overlay = new Graphics();
    overlay.fill({ color: 0x000000, alpha: 0.9 });
    overlay.rect(0, 0, width, height);
    overlay.eventMode = "static";
    this.renderer.uiLayer.addChild(overlay);
    this.modalObjects.push(overlay);

    const titleColor = win ? 0xffdd44 : 0xff4444;
    const titleStr = win ? "ПОБЕДА!" : "КОНЕЦ ИГРЫ";

    const titleText = new Text({
      text: titleStr,
      style: {
        fontFamily: "Courier New",
        fontSize: 36,
        fill: titleColor,
        fontWeight: "bold",
      },
    });
    titleText.anchor.set(0.5);
    titleText.x = width / 2;
    titleText.y = height / 2 - 80;
    titleText.eventMode = "none";
    this.renderer.uiLayer.addChild(titleText);
    this.modalObjects.push(titleText);

    const msg = win
      ? "Ветеран-Дипломат.\nГалактика под вашей защитой!"
      : "Галактика пала.\nOVERMIND установил контроль над большинством систем.";

    const msgText = new Text({
      text: msg,
      style: {
        fontFamily: "Courier New",
        fontSize: 18,
        fill: 0xcccccc,
        align: "center",
        wordWrap: true,
        wordWrapWidth: width * 0.65,
      },
    });
    msgText.anchor.set(0.5);
    msgText.x = width / 2;
    msgText.y = height / 2;
    msgText.eventMode = "none";
    this.renderer.uiLayer.addChild(msgText);
    this.modalObjects.push(msgText);

    const btnText = new Text({
      text: "Начать заново",
      style: {
        fontFamily: "Courier New",
        fontSize: 22,
        fill: 0x00ff88,
        fontWeight: "bold",
      },
    });
    btnText.anchor.set(0.5);
    btnText.x = width / 2;
    btnText.y = height / 2 + 90;
    btnText.eventMode = "static";
    btnText.cursor = "pointer";
    btnText.on("pointerdown", () => {
      this.clearModal();
      this.generateDefaultGameState()
        .then(() =>
          this.transitionTo(SceneType.MAIN_MENU, { gameEngine: this }),
        )
        .catch((e) => logger.error("Transition after game outcome failed:", e));
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
        try {
          await this.generateDefaultGameState();
          await this.transitionTo(SceneType.STAR_MAP);
        } catch (e) {
          logger.error("New game from modal failed:", e);
          this.showErrorModal(
            "Не удалось начать новую игру. Обновите страницу.",
            false,
          );
        }
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

  showLoadingOverlay(label: string): void {
    if (!this.renderer) return;
    this.hideLoadingOverlay();

    const width = this.renderer.app.screen.width;
    const height = this.renderer.app.screen.height;

    const overlay = new Graphics();
    overlay.fill({ color: 0x000000, alpha: 0.75 });
    overlay.rect(0, 0, width, height);
    overlay.eventMode = "static";
    this.renderer.uiLayer.addChild(overlay);
    this.loadingOverlayObjects.push(overlay);

    const labelText = new Text({
      text: label,
      style: {
        fontFamily: "Courier New",
        fontSize: 18,
        fill: 0x00ffff,
      },
    });
    labelText.anchor.set(0.5);
    labelText.x = width / 2;
    labelText.y = height / 2;
    labelText.eventMode = "none";
    this.renderer.uiLayer.addChild(labelText);
    this.loadingOverlayObjects.push(labelText);
  }

  hideLoadingOverlay(): void {
    for (const obj of this.loadingOverlayObjects) {
      if (obj.parent) {
        obj.parent.removeChild(obj);
      }
      obj.destroy();
    }
    this.loadingOverlayObjects = [];
  }

  private async generateDefaultGameState(): Promise<void> {
    this.player = null;
    this.playerLoadout = null;
    this._gameOverShown = false;
    this._winScreenShown = false;
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

  /** Map a scene type to the appropriate background music track and start it. */
  private playSceneTrack(sceneType: SceneType): void {
    switch (sceneType) {
      case SceneType.MAIN_MENU:
      case SceneType.RACE_SELECTION:
        this.audio.playTrack("menu_main").catch(() => {});
        break;
      case SceneType.STAR_MAP:
        this.audio.playTrack("explore_calm").catch(() => {});
        break;
      case SceneType.SPACE_FLIGHT:
        this.audio.playTrack("explore_calm").catch(() => {});
        break;
      case SceneType.COMBAT:
        this.audio.playTrack("combat").catch(() => {});
        break;
      case SceneType.PLANET:
        this.audio.playTrack("planet_hub").catch(() => {});
        break;
      case SceneType.TRADE:
        this.audio.playTrack("market").catch(() => {});
        break;
      case SceneType.EQUIPMENT_SHOP:
      case SceneType.STATION:
        this.audio.playTrack("equipment_shop").catch(() => {});
        break;
      case SceneType.GOVERNMENT:
        this.audio.playTrack("governor_dialogue").catch(() => {});
        break;
      case SceneType.TEXT_QUEST:
        this.audio.playTrack("text_quest").catch(() => {});
        break;
      case SceneType.INFO_CENTER:
        this.audio.playTrack("explore_calm").catch(() => {});
        break;
      default:
        break;
    }
  }

  stop(): void {
    cancelAnimationFrame(this.animationFrameId);
    this.currentScene?.destroy();
    this.renderer?.destroy();
    this.audio.destroy();
    this.onnxRegistry.cleanup();
  }
}
