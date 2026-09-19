import type { GameConfig, GameMode, LoadoutPreset } from "@/types";
import { SceneType, FactionType, QuestType, NpcRole, NpcState } from "@/types";
import { Galaxy } from "@/domain/Galaxy";
import type { FlightShipPos } from "@/domain/SaveState";
import type { GameScene } from "@/presentation/GameScene";
import { Renderer } from "@/presentation/Renderer";
import {
  preloadTextures,
  preloadCategories,
  BACKGROUND_PRELOAD_PREFIXES,
} from "@/presentation/textures";
import { SaveManager, EMERGENCY_SLOT_ID } from "@/data/SaveManager";
import { latestMeaningfulSlot } from "@/systems/saves/saveSlots";
import { AdaptiveQualityProfile } from "@/ai/AdaptiveQualityProfile";
import { GlobalExceptionHandler } from "@/exceptions/GlobalExceptionHandler";
import { GameSystemException } from "@/exceptions/GameSystemException";
import { GameValidationException } from "@/exceptions/GameValidationException";
import { logger } from "@/utils/logger";
import { additionalHostileSeeds } from "@/config/balance";
import { FlightSessionState } from "@/systems/FlightSessionState";
import { FlightPositionTracker } from "@/systems/FlightPositionTracker";
import { DayTickController } from "@/systems/DayTickController";
import { EndgameController } from "@/systems/EndgameController";
import { validatePlayerSettings } from "@/validation/schemas";
import { Player } from "@/domain/Player";
import { NpcSimulator } from "@/systems/npc/NpcSimulator";
import { GalaxySimulator } from "@/systems/GalaxySimulator";
import { TradeSystem } from "@/systems/TradeSystem";
import { canPlayerLiberate } from "@/systems/galaxy/liberation";
import { initialOvermindSpreadState } from "@/systems/overmind/overmindSpread";
import type { NewGamePlusCarry } from "@/systems/overmind/newGamePlus";
import type { Quest } from "@/domain/Quest";
import {
  generateQuestBoard,
  questKeyForQuest,
  type GeneratedQuest,
} from "@/systems/quests/QuestGenerator";
import {
  nextCampaignChainStep,
  buildCampaignChainQuest,
  type CampaignChainStep,
  type CampaignChainTarget,
} from "@/systems/quests/campaignChain";
import { jumpDistances } from "@/systems/galaxy/jumpDistance";
import type { QuestTemplate } from "@/systems/QuestManager";
import { buildRegistry } from "@/systems/info/InfoService";
import type { GalacticRegistry } from "@/systems/info/GalacticRegistry";
import { PlayerShip } from "@/domain/PlayerShip";
import { Inventory } from "@/domain/Inventory";
import type {
  ISaveService,
  IGalaxyService,
  IPlayerService,
  IExceptionHandler,
  IQuestService,
  IOverlayPresenter,
  IAutopilotStateProvider,
} from "@/core/ports";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import {
  powerIndexFromLoadout,
  ratchetPeakPower,
  restoredPeakPower,
} from "@/systems/campaign/playerPower";
import {
  applyLoadoutHullToShip,
  slotToBagModule,
} from "@/systems/equipment/GearBridge";
import { gearById } from "@/systems/equipment/GearCatalog";
import type { Faction } from "@/types/faction";
import { NpcShip } from "@/domain/NpcShip";
import { GalaxyService, PlayerService, SceneFactory } from "@/core/services";
import {
  QuestManagerAdapter,
  NoOpOverlayPresenter,
  NoOpAutopilotStateProvider,
} from "@/core/adapters";
import { TextQuestRuntime } from "@/systems/quests/TextQuestRuntime";
import { StarSystem } from "@/domain/StarSystem";
import { Planet } from "@/domain/Planet";
import { Market } from "@/domain/Market";
import {
  TemplateQuestNarrator,
  type QuestNarrator,
} from "@/ai/adapters/QuestNarrator";
import { getQuestScript } from "@/systems/quests/TextQuestRegistry";
import type { QuestScript } from "@/systems/quests/QuestScript";
import { AudioManager } from "@/systems/AudioManager";
import { MusicDriver } from "@/systems/audio/musicDriver";
import { HullAlarm } from "@/systems/audio/sfxCues";
import { BankBus, type Unsubscribe } from "@/systems/banking/bus";
import { BankingService } from "@/systems/banking/BankingService";
import { setupPlayerBanking, type BankAccess } from "@/systems/banking/economy";

export interface GameEngineDIDependencies {
  saveService: ISaveService;
  galaxyService: IGalaxyService;
  playerService: IPlayerService;
  exceptionHandler: IExceptionHandler;
  qualityProfile: AdaptiveQualityProfile;
  questService: IQuestService;
  overlayPresenter?: IOverlayPresenter;
  autopilotStateProvider?: IAutopilotStateProvider;
}

const BANK_FACTION_ID: FactionType = FactionType.BASTIONS;
const BANK_DEFAULT_REPUTATION_PENALTY = 15;

const MUSIC_TENSION_HULL_FRACTION = 0.3;

export class GameEngine {
  public currentScene: GameScene | null = null;
  public currentSceneType: SceneType = SceneType.MAIN_MENU;
  public galaxy: Galaxy | null = null;
  public player: Player | null = null;
  private readonly flightPositions: FlightPositionTracker =
    new FlightPositionTracker({
      isSpaceFlightActive: () =>
        this.currentSceneType === SceneType.SPACE_FLIGHT,
      hasActiveGame: () => !!this.galaxy && !!this.player,
      saveGame: (slotId) => this.saveGame(slotId),
      persistLiveSceneState: () => this.currentScene?.persistLiveState?.(),
    });
  public get lastFlightShipPos(): { x: number; y: number } | null {
    return this.flightPositions.lastFlightShipPos;
  }
  public set lastFlightShipPos(pos: { x: number; y: number } | null) {
    this.flightPositions.lastFlightShipPos = pos;
  }
  public lastFlightWasFleeing = false;
  public get liveFlightShipPos(): { x: number; y: number } | null {
    return this.flightPositions.liveFlightShipPos;
  }
  public set liveFlightShipPos(pos: { x: number; y: number } | null) {
    this.flightPositions.liveFlightShipPos = pos;
  }
  get flightShipPos(): FlightShipPos | null {
    return this.flightPositions.persistedFlightShipPos;
  }
  set flightShipPos(pos: FlightShipPos | null) {
    this.flightPositions.persistedFlightShipPos = pos;
  }
  public gameSpeedMultiplier = 1;
  public readonly sessionState = new FlightSessionState();

  public get offeredEncounterIds(): Set<string> {
    return this.sessionState.offeredEncounterIds;
  }
  public get salvageDay(): number {
    return this.sessionState.salvageDay;
  }
  public set salvageDay(day: number) {
    this.sessionState.salvageDay = day;
  }
  public get salvagedToday(): number {
    return this.sessionState.salvagedToday;
  }
  public set salvagedToday(amount: number) {
    this.sessionState.salvagedToday = amount;
  }
  public questExpiryCallback?: (message: string) => void;
  public questPendingReturnCallback?: (message: string) => void;
  public playerDeathCallback?: () => void;
  public readonly saveManager: SaveManager;
  public readonly qualityProfile: AdaptiveQualityProfile;
  public readonly questManager: IQuestService;
  public renderer: Renderer | null = null;
  public playerLoadout: ShipLoadout | null = null;
  public playerLoadoutPresets: LoadoutPreset[] = [];
  public readonly textQuestRuntime = new TextQuestRuntime();
  public readonly questNarrator: QuestNarrator;
  public readonly audio = new AudioManager();
  private readonly music = new MusicDriver();
  private readonly hullAlarm = new HullAlarm();
  private combatStateProvider: (() => boolean) | null = null;
  public readonly bankBus = new BankBus();
  public readonly bankingService = new BankingService(this.bankBus);

  public get bank(): BankAccess {
    return { bus: this.bankBus, service: this.bankingService };
  }

  public get npc(): NpcSimulator {
    return this.npcSimulator;
  }

  public get campaignPeakPower(): number | null {
    return this.campaignPeakPowerValue;
  }

  private ratchetCampaignPeakPower(): number {
    if (this.player && this.playerLoadout) {
      this.campaignPeakPowerValue = ratchetPeakPower(
        this.campaignPeakPowerValue,
        powerIndexFromLoadout(
          this.playerLoadout,
          this.player.credits,
          this.player.rank,
        ),
      );
    }
    return this.campaignPeakPowerValue ?? 0;
  }

  private exceptionHandler: IExceptionHandler;
  private animationFrameId = 0;
  private lastTime = 0;
  private backgroundIntervalId: ReturnType<typeof setInterval> | null = null;
  private readonly BACKGROUND_TICK_MS = 500;
  private visibilityChangeHandler: (() => void) | null = null;
  private readonly overlay: IOverlayPresenter;
  private autopilotState: IAutopilotStateProvider;
  private loadedAutopilotEngaged: boolean | undefined = undefined;
  private get pendingNewGamePlus(): NewGamePlusCarry | null {
    return this.endgame.pendingNewGamePlus;
  }
  private set pendingNewGamePlus(carry: NewGamePlusCarry | null) {
    this.endgame.pendingNewGamePlus = carry;
  }
  private bankProjectionUnsub: Unsubscribe | null = null;
  private campaignPeakPowerValue: number | null = null;
  private readonly galaxyService: IGalaxyService;
  private readonly playerService: IPlayerService;
  private readonly sceneFactory: SceneFactory;
  private readonly npcSimulator = new NpcSimulator();
  private readonly galaxySimulator = new GalaxySimulator();
  private readonly tradeSystem = new TradeSystem();
  private readonly endgame: EndgameController;
  private readonly dayTick: DayTickController;

  constructor(diDependencies?: GameEngineDIDependencies) {
    if (diDependencies) {
      this.exceptionHandler = diDependencies.exceptionHandler;
      this.qualityProfile = diDependencies.qualityProfile;
      this.saveManager = diDependencies.saveService as SaveManager;
      this.galaxyService = diDependencies.galaxyService;
      this.playerService = diDependencies.playerService;
      this.questManager = diDependencies.questService;
    } else {
      this.qualityProfile = new AdaptiveQualityProfile();
      this.saveManager = new SaveManager();
      this.galaxyService = new GalaxyService();
      this.playerService = new PlayerService();
      this.exceptionHandler = GlobalExceptionHandler.getInstance();
      this.questManager = new QuestManagerAdapter();
    }
    this.overlay =
      diDependencies?.overlayPresenter ?? new NoOpOverlayPresenter();
    this.autopilotState =
      diDependencies?.autopilotStateProvider ??
      new NoOpAutopilotStateProvider();

    this.npcSimulator.attachCampaignPeakPower(
      () => this.campaignPeakPowerValue ?? 0,
    );

    this.endgame = new EndgameController({
      getPlayer: () => this.player,
      setPlayer: (player) => {
        this.player = player;
      },
      setPlayerLoadout: (loadout) => {
        this.playerLoadout = loadout;
      },
      getGalaxy: () => this.galaxy,
      setGalaxy: (galaxy) => {
        this.galaxy = galaxy;
      },
      galaxyService: this.galaxyService,
      playerService: this.playerService,
      questManager: this.questManager,
      bankingService: this.bankingService,
      sessionState: this.sessionState,
      music: this.music,
      hullAlarm: this.hullAlarm,
      clearFlightPositions: () => {
        this.flightPositions.persistedFlightShipPos = null;
        this.lastFlightShipPos = null;
      },
      clearCombatStateProvider: () => {
        this.combatStateProvider = null;
      },
      overlay: this.overlay,
      hasRenderer: () => !!this.renderer,
      getPlayerDeathCallback: () => this.playerDeathCallback,
      transitionToMainMenu: () =>
        this.transitionTo(SceneType.MAIN_MENU, { gameEngine: this }),
      transitionToSpaceFlight: () =>
        this.transitionTo(SceneType.SPACE_FLIGHT, { gameEngine: this }),
      transitionToGameOver: () =>
        this.transitionTo(SceneType.GAME_OVER, { gameEngine: this }),
      transitionToRaceSelection: () =>
        this.transitionTo(SceneType.RACE_SELECTION, { gameEngine: this }),
    });

    this.dayTick = new DayTickController({
      getGalaxy: () => this.galaxy,
      getPlayer: () => this.player,
      getPlayerLoadout: () => this.playerLoadout,
      npcSimulator: this.npcSimulator,
      galaxySimulator: this.galaxySimulator,
      tradeSystem: this.tradeSystem,
      bankBus: this.bankBus,
      checkExpiredQuests: () => this.checkExpiredQuests(),
      isOutcomeShown: () => this.endgame.isOutcomeShown(),
      showGameOutcomeScreen: (win) => this.showGameOutcomeScreen(win),
      invalidateInfoRegistryCache: () => {
        this.infoRegistryCache = null;
      },
      updateCampaignPeakPower: () => this.ratchetCampaignPeakPower(),
    });

    this.sceneFactory = new SceneFactory();
    this.questNarrator = new TemplateQuestNarrator();

    this.exceptionHandler.onCriticalError = (response) => {
      this.handleCriticalError(response);
    };

    this.bankBus.subscribe((event) => {
      if (
        event.kind === "LoanDefaulted" &&
        this.player &&
        event.ownerId === this.player.id
      ) {
        this.player.adjustReputation(
          BANK_FACTION_ID,
          -BANK_DEFAULT_REPUTATION_PENALTY,
        );
        logger.warn(
          `Loan ${event.loanAccountId} defaulted (${event.missedPayments} missed, ` +
            `${event.outstanding.toFixed(2)} owed) — ${BANK_FACTION_ID} reputation ` +
            `−${BANK_DEFAULT_REPUTATION_PENALTY}.`,
        );
      }
    });
  }

  private setupPlayerBanking(): void {
    if (!this.player) return;
    this.bankProjectionUnsub?.();
    this.bankProjectionUnsub = setupPlayerBanking(
      this.bankBus,
      this.bankingService,
      this.player,
    );
    this.questManager.attachBank?.(this.bank);
    this.npcSimulator.attachBank(this.bank);
  }

  async initialize(config: GameConfig): Promise<void> {
    try {
      this.flightPositions.registerFlightHideAutosave();

      const storedSettings = localStorage.getItem("sr_settings");
      if (storedSettings) {
        try {
          validatePlayerSettings(JSON.parse(storedSettings));
          logger.info("Loaded and validated settings from localStorage");
        } catch (error) {
          logger.warn("Invalid settings, using defaults:", error);
        }
      }

      const container = document.getElementById("game-container");
      if (!container) {
        throw new GameSystemException(
          "NO_CONTAINER",
          "Game container not found in DOM.",
        );
      }
      this.renderer = new Renderer(container);
      await this.renderer.initialize();

      await preloadTextures();
      void preloadCategories(BACKGROUND_PRELOAD_PREFIXES);

      const rendererType = (
        this.renderer.app.renderer as unknown as { type?: string }
      ).type;
      if (rendererType === "canvas") {
        logger.warn("Canvas2D fallback active — WebGL unavailable");
      }

      this.qualityProfile.benchmark();
      logger.info(`Quality profile: ${this.qualityProfile.level}`);

      const hasSave = await this.saveManager.hasSave();
      if (hasSave) {
        logger.info("Existing save detected, attempting auto-load");
        try {
          const loaded = await this.loadGame("auto");
          if (loaded) {
            this.startGameLoop();
            return;
          }
        } catch (error) {
          logger.error("Auto-load failed, falling back to main menu:", error);
        }
      }

      const seed = config.seed ?? `SR_${Date.now()}`;
      this.galaxy = await this.galaxyService.generate(
        seed,
        config.systemCount ?? 10,
      );
      logger.info(`Initializing with seed: ${seed}`);

      await this.transitionTo(SceneType.MAIN_MENU, { gameEngine: this });

      this.startGameLoop();
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

    this.currentSceneType = sceneType;
    localStorage.setItem("sr_currentScene", sceneType);

    this.combatStateProvider = null;

    if (this.currentScene) {
      this.currentScene.destroy();
      this.currentScene = null;
    }

    this.overlay.dismissAll();

    this.renderer.clearGameLayer();
    this.renderer.clearUILayer();

    const isGameStartScene =
      sceneType === SceneType.STAR_MAP || sceneType === SceneType.SPACE_FLIGHT;
    if (isGameStartScene && !this.player) {
      const ngPlus = this.pendingNewGamePlus;
      this.pendingNewGamePlus = null;

      const selectedFaction =
        (context as { selectedFaction?: FactionType })?.selectedFaction ??
        ngPlus?.factionType ??
        FactionType.OUTLANDERS;

      this.player = this.playerService.createPlayer({
        factionType: selectedFaction,
        captainName: "Captain",
        startingMoney: ngPlus?.credits ?? 1000,
      });

      this.campaignPeakPowerValue = null;

      if (ngPlus) this.player.rank = ngPlus.rank;

      const selectedGameMode =
        (context as { selectedGameMode?: GameMode })?.selectedGameMode ??
        ngPlus?.gameMode ??
        "NORMAL";
      this.player.setGameMode(selectedGameMode);

      this.applyDifficultyHostileScaling();

      logger.info(`Created new player with faction: ${this.player.faction}`);

      if (!this.playerLoadout) {
        this.playerLoadout = this.starterLoadout();
      }
      this.playerLoadoutPresets = [];

      this.setupPlayerBanking();
    }

    if (isGameStartScene && this.player && this.galaxy) {
      if (!this.player.currentSystemId) {
        this.player.currentSystemId = this.galaxy.systems[0].id;
        this.galaxy.systems[0].explored = true;
        this.galaxy.systems[0].fogOfWar = false;
        logger.info(
          `New game: starting system set to ${this.player.currentSystemId}`,
        );
      }
      this.player.markVisited(this.player.currentSystemId);
      this.galaxy.revealSystemAndNeighbors(this.player.currentSystemId);
    }

    const newScene = this.sceneFactory.createScene(sceneType, this.renderer);
    if (!newScene) {
      throw new GameSystemException(
        "INVALID_SCENE",
        `Unknown scene type: ${sceneType}`,
      );
    }
    this.currentScene = newScene;

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
      sceneType === SceneType.TRADE ||
      sceneType === SceneType.EQUIPMENT_SHOP ||
      sceneType === SceneType.INFO_CENTER ||
      sceneType === SceneType.STATION ||
      sceneType === SceneType.GOVERNMENT ||
      sceneType === SceneType.TEXT_QUEST ||
      sceneType === SceneType.BLACK_HOLE_ARCADE
    ) {
      finalContext.gameEngine = this;
    }

    if (this.player && sceneType === SceneType.PLANET) {
      const landedPlanet = (context as { planet?: { id?: string } } | undefined)
        ?.planet;
      if (landedPlanet?.id) this.player.landedPlanetId = landedPlanet.id;
      this.forgetFlightPosition();
    }

    this.currentScene.initialize(finalContext);
    logger.info(`Transitioned to scene: ${sceneType}`);

    this.updateMusic();

    if (
      this.galaxy &&
      this.player &&
      sceneType !== SceneType.MAIN_MENU &&
      sceneType !== SceneType.RACE_SELECTION &&
      sceneType !== SceneType.GAME_OVER
    ) {
      this.saveGame("auto").catch((e) => {
        logger.error("Auto-save failed:", e);
      });
    }
  }

  forgetFlightPosition(): void {
    this.flightPositions.forgetFlightPosition();
  }

  recordLiveFlightPos(x: number, y: number): void {
    this.flightPositions.recordLiveFlightPos(x, y);
  }

  async flushFlightAutosave(): Promise<void> {
    await this.flightPositions.flushFlightAutosave();
  }

  advanceGalaxyDay(): void {
    if (!this.galaxy) return;
    this.dayTick.run();
  }

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

  canLiberateCurrentSystem(): boolean {
    if (!this.galaxy || !this.player?.currentSystemId) return false;
    return canPlayerLiberate(this.galaxy, this.player.currentSystemId);
  }

  liberateCurrentSystem(): boolean {
    if (!this.canLiberateCurrentSystem()) return false;
    const systemId = this.player!.currentSystemId;
    const liberated = this.galaxy!.tryLiberate(systemId, "player");
    if (liberated) {
      logger.info(`Player liberated system ${systemId}`);
    }
    return liberated;
  }

  private infoRegistryCache: { day: number; reg: GalacticRegistry } | null =
    null;

  getInfoRegistry(): GalacticRegistry | null {
    if (!this.galaxy) return null;
    const day = this.galaxy.gameDays;
    if (this.infoRegistryCache?.day === day) return this.infoRegistryCache.reg;
    const reg = buildRegistry(this.galaxy, this.galaxy.id, day);
    this.infoRegistryCache = { day, reg };
    return reg;
  }

  getQuestBoard(planetId: string): GeneratedQuest[] {
    if (!this.galaxy || !this.player) return [];
    const originSystem = this.galaxy.systems.find(
      (s) => s.id === this.player!.currentSystemId,
    );
    const faction: string =
      (originSystem as { ownerFaction?: string })?.ownerFaction ??
      "INDEPENDENT";
    const overmindAdjacent = this.galaxy
      .getOvermindAdjacentSystems(this.player.currentSystemId)
      .map((s) => s.id);

    const excludeKeys = [
      ...this.questManager.getActiveQuests(),
      ...this.questManager.getPendingReturnQuests(),
    ].map(questKeyForQuest);

    const board = generateQuestBoard({
      systems: this.galaxy.systems,
      originSystemId: this.player.currentSystemId,
      planetId,
      day: this.galaxy.gameDays,
      seed: this.galaxy.id,
      completedQuestChains: this.player.completedQuestChains,
      excludeKeys,
      hostileSystems: [
        ...this.galaxy.overmindSystems,
        ...this.galaxy.pirateSystems,
      ],
      overmindSystems: this.galaxy.overmindSystems,
      overmindAdjacentSystems: overmindAdjacent,
    });
    const campaignQuest = this.buildCampaignBoardQuest(planetId);
    if (campaignQuest) board.push(campaignQuest);
    this.galaxy.questBoards[planetId] = this.galaxy.gameDays;
    const taken = new Set<string>([
      ...this.questManager.getActiveQuests().map((q) => q.id),
      ...this.questManager.getCompletedQuestIds(),
      ...this.questManager.getPendingReturnQuests().map((q) => q.id),
    ]);
    return board.filter((q) => {
      if (taken.has(q.template.id)) return false;
      const minRep = q.template.minReputation ?? 0;
      if (minRep > 0 && this.player!.getReputation(faction) < minRep)
        return false;
      const minRank = q.template.minRank ?? 0;
      if (minRank > 0 && (this.player!.rank ?? 0) < minRank) return false;
      return true;
    });
  }

  private buildCampaignBoardQuest(planetId: string): GeneratedQuest | null {
    if (!this.galaxy || !this.player) return null;
    const totalSystems = this.galaxy.systems.length;
    const overmindShare =
      totalSystems > 0 ? this.galaxy.overmindSystems.length / totalSystems : 0;
    const step = nextCampaignChainStep({
      completedStepIds: this.questManager.getCompletedQuestIds(),
      overmindShare,
      peakPower: this.campaignPeakPower ?? 0,
      arcStatus: this.galaxy.overmindArc.status,
    });
    if (!step) return null;
    const target = this.resolveCampaignChainTarget(step);
    if (!target) return null;
    return buildCampaignChainQuest(step, target, planetId);
  }

  private resolveCampaignChainTarget(
    step: CampaignChainStep,
  ): CampaignChainTarget | null {
    if (!this.galaxy || !this.player) return null;
    const galaxy = this.galaxy;
    const currentId = this.player.currentSystemId;
    const jumpDist = jumpDistances(galaxy.systems, currentId, {
      undirected: true,
    });
    const isSafe = (s: { id: string; explored?: boolean }): boolean =>
      s.id !== currentId &&
      s.explored !== false &&
      jumpDist.has(s.id) &&
      !galaxy.isHostileSystem(s.id);

    const frontierIds = new Set(
      galaxy
        .getOvermindAdjacentSystems(currentId)
        .filter((s) => isSafe(s))
        .map((s) => s.id),
    );
    const frontier = galaxy.systems
      .filter((s) => frontierIds.has(s.id))
      .sort((a, b) => a.id.localeCompare(b.id));
    const safeRear = galaxy.systems
      .filter((s) => isSafe(s) && !frontierIds.has(s.id))
      .sort((a, b) => a.id.localeCompare(b.id));

    const preferred =
      step.targetKind === "frontier"
        ? [...frontier, ...safeRear]
        : [...safeRear, ...frontier];
    const chosen = preferred[0];
    if (!chosen) return null;

    const planet =
      chosen.planets.find((p) => p.isHabitable) ?? chosen.planets[0] ?? null;
    return {
      systemId: chosen.id,
      systemName: chosen.name,
      planetId: planet?.id ?? null,
      jumps: jumpDist.get(chosen.id) ?? 1,
    };
  }

  acceptBoardQuest(quest: GeneratedQuest, planetId: string): Quest | null {
    const factionId =
      this.galaxy?.systems.find((s) => s.planets.some((p) => p.id === planetId))
        ?.ownerFaction ?? "";

    let template = quest.template;
    const targetSystemId = quest.template.targetSystemId;
    if (
      quest.template.type === QuestType.BOUNTY &&
      quest.targetNpcName &&
      targetSystemId
    ) {
      const boundIds = new Set<string>();
      for (const q of [
        ...this.questManager.getActiveQuests(),
        ...this.questManager.getPendingReturnQuests(),
      ]) {
        if (q.targetObjectId) boundIds.add(q.targetObjectId);
      }
      const pirate =
        this.galaxy?.npcShips.find(
          (n) =>
            n.currentSystemId === targetSystemId &&
            n.role === NpcRole.PIRATE &&
            n.state !== NpcState.DEAD &&
            !boundIds.has(n.id),
        ) ??
        this.galaxy?.npcShips.find(
          (n) =>
            n.role === NpcRole.PIRATE &&
            n.state !== NpcState.DEAD &&
            !boundIds.has(n.id),
        );
      if (pirate) {
        pirate.name = quest.targetNpcName;
        template = {
          ...quest.template,
          targetObjectId: pirate.id,
          targetSystemId: pirate.currentSystemId ?? targetSystemId,
        };
        this.infoRegistryCache = null;
      }
    }

    const templateWithPlanet: QuestTemplate = {
      ...template,
      targetPlanetId: quest.targetPlanetId,
    };

    return this.questManager.acceptQuestFromTemplate(
      templateWithPlanet,
      planetId,
      this.galaxy?.gameDays ?? 0,
      String(factionId),
    );
  }

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

  setAutopilotStateProvider(provider: IAutopilotStateProvider): void {
    this.autopilotState = provider;
  }

  getLoadedAutopilotEngaged(): boolean | undefined {
    return this.loadedAutopilotEngaged;
  }

  async saveGame(slotId = "auto"): Promise<void> {
    if (!this.galaxy || !this.player) {
      throw new GameSystemException(
        "SAVE_NO_STATE",
        "Cannot save: no active game state.",
      );
    }

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

    const flightShipPos = this.flightPositions.captureForSave(
      this.player.currentSystemId,
    );

    this.ratchetCampaignPeakPower();

    const { SaveState } = await import("@/domain/SaveState");
    const state = new SaveState(
      this.saveManager.currentVersion,
      this.galaxy,
      this.player,
      [], // persistentDialogs would come from DialogueSystem
      Date.now(),
      this.currentSceneType,
      this.playerLoadout?.toJSON(),
      this.bankingService.toSnapshot(),
      flightShipPos,
      this.campaignPeakPowerValue ?? undefined,
      this.playerLoadoutPresets.length > 0
        ? this.playerLoadoutPresets
        : undefined,
      this.autopilotState.isEngaged(),
    );

    await this.saveManager.write(slotId, state);
  }

  async loadGame(slotId = "auto"): Promise<boolean> {
    const save = await this.saveManager.read(slotId);
    if (!save) {
      return false;
    }

    if (!save.player || !save.player.id || !save.galaxy) {
      throw new GameValidationException(
        "SAVE_VALIDATION_FAILED",
        "Corrupted save data - missing required fields",
      );
    }

    this.galaxy = save.galaxy;
    this.player = save.player;

    this.loadedAutopilotEngaged = save.autopilotEngaged;

    this.endgame.resetPlayerDeathGuard();

    this.combatStateProvider = null;
    this.music.reset();
    this.hullAlarm.reset();

    this.rehydrateLoadedState();

    this.npcSimulator.setGameMode(this.player.gameMode);

    if (save.banking) {
      this.bankingService.restore(save.banking);
    } else {
      this.bankingService.resetLedger();
    }

    this.setupPlayerBanking();

    const restoredLoadout = save.loadout
      ? ShipLoadout.fromJSON(save.loadout, this.playerLoadoutFaction())
      : null;
    this.playerLoadout = restoredLoadout ?? this.starterLoadout();

    if (this.player) {
      for (const slot of this.playerLoadout.revalidateToCurrentHull()) {
        const g = gearById(slot.gearId);
        if (g) this.player.inventory.addItem(slotToBagModule(g, slot));
      }
    }

    this.playerLoadoutPresets = save.loadoutPresets ?? [];

    this.campaignPeakPowerValue = this.player
      ? restoredPeakPower(
          save.campaignPeakPower,
          this.playerLoadout,
          this.player.credits,
          this.player.rank,
        )
      : null;

    if (this.player?.ship) {
      applyLoadoutHullToShip(this.player.ship, this.playerLoadout);
    }

    const loadedQuestLog = this.player.questLog;
    this.questManager.restoreState(
      loadedQuestLog.activeQuests ?? [],
      loadedQuestLog.completedQuests ?? [],
      loadedQuestLog.completedChainParts ?? {},
      loadedQuestLog.pendingReturnQuests ?? [],
    );

    if (!this.player.currentSystemId && this.galaxy.systems[0]) {
      this.player.currentSystemId = this.galaxy.systems[0].id;
      logger.info("Set default currentSystemId to first system");
    }

    const currentSystem = this.galaxy.systems.find(
      (s) => s.id === this.player!.currentSystemId,
    );
    if (!currentSystem) {
      logger.warn("Current system not found, resetting to first system");
      this.player.currentSystemId = this.galaxy.systems[0].id;
    }

    if (this.player.visitedSystems.length === 0) {
      for (const sys of this.galaxy.systems) {
        if (sys.explored) this.player.markVisited(sys.id);
      }
      if (this.player.currentSystemId) {
        this.player.markVisited(this.player.currentSystemId);
      }
    }

    const contextDependentScenes: SceneType[] = [
      SceneType.PLANET,
      SceneType.TRADE,
      SceneType.DIALOGUE,
      SceneType.INVENTORY,
      SceneType.STATION,
      SceneType.EQUIPMENT_SHOP,
      SceneType.GOVERNMENT,
      SceneType.TEXT_QUEST,
      SceneType.WIN_SCREEN,
      SceneType.INFO_CENTER,
      SceneType.BANK,
      SceneType.SAVE_LOAD,
      SceneType.BLACK_HOLE_ARCADE,
    ];
    const savedScene = save.currentSceneType ?? SceneType.SPACE_FLIGHT;
    const isKnownScene = (Object.values(SceneType) as string[]).includes(
      savedScene,
    );
    const sceneType =
      !isKnownScene || contextDependentScenes.includes(savedScene)
        ? SceneType.SPACE_FLIGHT
        : savedScene;

    this.flightPositions.persistedFlightShipPos = save.flightShipPos ?? null;
    const resumePos =
      sceneType === SceneType.SPACE_FLIGHT &&
      !this.player.landedPlanetId &&
      save.flightShipPos &&
      save.flightShipPos.systemId === this.player.currentSystemId
        ? { x: save.flightShipPos.x, y: save.flightShipPos.y }
        : undefined;
    await this.transitionTo(
      sceneType,
      resumePos
        ? { gameEngine: this, preserveShipPos: resumePos }
        : { gameEngine: this },
    );
    this.autopilotState.resume(this.loadedAutopilotEngaged ?? false);
    return true;
  }

  async continueGame(): Promise<boolean> {
    const slotId = await latestMeaningfulSlot(this.saveManager);
    if (!slotId) return false;
    return this.loadGame(slotId);
  }

  private playerLoadoutFaction(): Faction | undefined {
    return this.player?.faction as unknown as Faction | undefined;
  }

  private starterLoadout(): ShipLoadout {
    const loadout = new ShipLoadout(
      "hull_corvette",
      this.playerLoadoutFaction(),
    );
    loadout.install("eq_engine_i");
    loadout.install("eq_tank");
    loadout.install("wpn_pulse");
    loadout.install("grav_tractor_1");
    return loadout;
  }

  private rehydrateLoadedState(): void {
    if (this.galaxy) {
      Object.setPrototypeOf(this.galaxy, Galaxy.prototype);
      if (!Array.isArray(this.galaxy.activeRumors)) {
        this.galaxy.activeRumors = [];
      }
      if (!this.galaxy.overmindArc) {
        this.galaxy.overmindArc = initialOvermindSpreadState();
      }
      for (const npc of this.galaxy.npcShips ?? []) {
        Object.setPrototypeOf(npc, NpcShip.prototype);
      }
    }

    if (this.player) {
      Object.setPrototypeOf(this.player, Player.prototype);
      if (!Array.isArray(this.player.visitedSystems)) {
        this.player.visitedSystems = [];
      }
      if (this.player.ship) {
        Object.setPrototypeOf(this.player.ship, PlayerShip.prototype);
      }
      if (this.player.inventory) {
        Object.setPrototypeOf(this.player.inventory, Inventory.prototype);
      }
    }

    if (this.galaxy) {
      for (const system of this.galaxy.systems) {
        Object.setPrototypeOf(system, StarSystem.prototype);
        if (!Array.isArray((system as { stations?: unknown }).stations)) {
          (system as { stations: unknown[] }).stations = [];
        }
        for (const planet of system.planets ?? []) {
          Object.setPrototypeOf(planet, Planet.prototype);
          if (planet.market) {
            Object.setPrototypeOf(planet.market, Market.prototype);
          }
        }
      }
    }
  }

  showGameOutcomeScreen(win: boolean): void {
    this.endgame.showGameOutcomeScreen(win);
  }

  async startNewGamePlus(): Promise<void> {
    await this.endgame.startNewGamePlus();
  }

  triggerPlayerDeath(): void {
    this.endgame.triggerPlayerDeath();
  }

  async restartNewGame(): Promise<void> {
    await this.endgame.restartNewGame();
  }

  handleError(error: Error): void {
    const response = this.exceptionHandler.handle(error);
    logger.error(
      `GameEngine handled error: ${response.code} - ${response.message}`,
    );

    if (
      error instanceof GameValidationException &&
      error.errorCode === "SAVE_VALIDATION_FAILED"
    ) {
      this.overlay.showError(
        `Ошибка сохранения: ${error.errorMessage}. Нажмите "Новая игра" для начала новой игры.`,
        () => this.newGameFromErrorModal(),
      );
      return;
    }

    this.overlay.showError(response.message);
  }

  private handleCriticalError(response: { message: string }): void {
    if (this.galaxy && this.player) {
      this.saveGame(EMERGENCY_SLOT_ID).catch((e) => {
        logger.error("Emergency auto-save failed:", e);
      });
    }
    this.overlay.showError(response.message);
  }

  private newGameFromErrorModal(): void {
    this.generateDefaultGameState()
      .then(() => this.transitionTo(SceneType.STAR_MAP))
      .catch((e) => {
        logger.error("New game from modal failed:", e);
        this.overlay.showError(
          "Не удалось начать новую игру. Обновите страницу.",
        );
      });
  }

  showLoadingOverlay(label: string): void {
    this.overlay.showLoading(label);
  }

  hideLoadingOverlay(): void {
    this.overlay.hideLoading();
  }

  private applyDifficultyHostileScaling(): void {
    if (!this.player || !this.galaxy) return;
    const mode = this.player.gameMode;

    this.npcSimulator.setGameMode(mode);

    const isolatedFirstIds = [...this.galaxy.systems]
      .sort(
        (a, b) =>
          b.coordinates.q ** 2 +
          b.coordinates.r ** 2 -
          (a.coordinates.q ** 2 + a.coordinates.r ** 2),
      )
      .map((s) => s.id);

    const extra = additionalHostileSeeds(
      mode,
      isolatedFirstIds,
      this.galaxy.overmindSystems,
      this.galaxy.pirateSystems,
    );
    for (const id of extra.overmind) this.galaxy.addOvermindSystem(id);
    for (const id of extra.pirate) this.galaxy.addPirateSystem(id);
  }

  private async generateDefaultGameState(): Promise<void> {
    await this.endgame.generateDefaultGameState();
  }

  private gameLoop = (time: number): void => {
    const deltaTime = time - this.lastTime;
    this.lastTime = time;

    try {
      this.currentScene?.update(deltaTime);
      this.updateMusic(this.combatStateProvider?.() ?? false);
    } catch (error) {
      this.handleError(error as Error);
    }

    this.animationFrameId = requestAnimationFrame(this.gameLoop);
  };

  private startGameLoop(): void {
    this.lastTime = performance.now();
    this.gameLoop(this.lastTime);
    this.registerBackgroundFallback();
  }

  private registerBackgroundFallback(): void {
    if (typeof document === "undefined" || this.visibilityChangeHandler) return;
    this.visibilityChangeHandler = () => {
      if (document.visibilityState === "hidden") this.startBackgroundTicker();
      else this.stopBackgroundTicker();
    };
    document.addEventListener("visibilitychange", this.visibilityChangeHandler);
    if (document.visibilityState === "hidden") this.startBackgroundTicker();
  }

  private startBackgroundTicker(): void {
    if (this.backgroundIntervalId != null) return;
    this.backgroundIntervalId = setInterval(() => {
      const time = performance.now();
      const deltaTime = time - this.lastTime;
      this.lastTime = time;
      try {
        this.currentScene?.update(deltaTime);
        this.updateMusic(this.combatStateProvider?.() ?? false);
      } catch (error) {
        this.handleError(error as Error);
      }
    }, this.BACKGROUND_TICK_MS);
  }

  private stopBackgroundTicker(): void {
    if (this.backgroundIntervalId != null) {
      clearInterval(this.backgroundIntervalId);
      this.backgroundIntervalId = null;
    }
  }

  setCombatStateProvider(provider: (() => boolean) | null): void {
    this.combatStateProvider = provider;
  }

  updateMusic(inCombat = false): void {
    const ship = this.player?.ship;
    const lowHull = ship
      ? ship.hullHP < ship.maxHull * MUSIC_TENSION_HULL_FRACTION
      : false;
    const coreId = this.galaxy?.overmindCoreSystemId;
    const boss = !!coreId && this.player?.currentSystemId === coreId;
    this.music.apply(this.audio, {
      scene: this.currentSceneType,
      inCombat,
      lowHull,
      boss,
      now: typeof performance !== "undefined" ? performance.now() : Date.now(),
    });
    this.hullAlarm.update(this.audio, lowHull);
  }

  stop(): void {
    cancelAnimationFrame(this.animationFrameId);
    this.stopBackgroundTicker();
    if (typeof document !== "undefined" && this.visibilityChangeHandler) {
      document.removeEventListener(
        "visibilitychange",
        this.visibilityChangeHandler,
      );
      this.visibilityChangeHandler = null;
    }
    this.flightPositions.unregisterFlightHideAutosave();
    this.currentScene?.destroy();
    this.renderer?.destroy();
    this.combatStateProvider = null;
    this.music.reset();
    this.hullAlarm.reset();
    this.audio.destroy();
  }
}
