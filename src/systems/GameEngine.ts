import type { GameConfig, GameMode } from "@/types";
import { SceneType, FactionType, QuestType, NpcRole, NpcState } from "@/types";
import { Galaxy } from "@/domain/Galaxy";
import type { FlightShipPos } from "@/domain/SaveState";
import type { GameScene } from "@/presentation/GameScene";
import { Renderer } from "@/presentation/Renderer";
import { preloadTextures } from "@/presentation/textures";
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
import { QuestManagerAdapter, NoOpOverlayPresenter } from "@/core/adapters";
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

/**
 * Optional DI dependencies for GameEngine.
 * When provided, GameEngine uses DI for better testability.
 * When not provided, GameEngine uses legacy direct instantiation for backward compatibility.
 */
export interface GameEngineDIDependencies {
  saveService: ISaveService;
  galaxyService: IGalaxyService;
  playerService: IPlayerService;
  exceptionHandler: IExceptionHandler;
  qualityProfile: AdaptiveQualityProfile;
  questService: IQuestService;
  /** Optional — falls back to a headless no-op so existing DI sites keep compiling. */
  overlayPresenter?: IOverlayPresenter;
}

/**
 * The faction whose standing a loan default damages. The Galactic Bank (АБС) is a
 * galaxy-wide institution with no faction of its own, so its reputation sanction
 * lands on the order-and-establishment faction that underwrites it. Centralized so
 * the mapping is changed in one place.
 */
const BANK_FACTION_ID: FactionType = FactionType.BASTIONS;
/** One-off reputation hit applied the moment a player loan crosses into default. */
const BANK_DEFAULT_REPUTATION_PENALTY = 15;

/** Hull fraction below which the adaptive music plays the low-hull tension cue. */
const MUSIC_TENSION_HULL_FRACTION = 0.3;

export class GameEngine {
  public currentScene: GameScene | null = null;
  public currentSceneType: SceneType = SceneType.MAIN_MENU;
  public galaxy: Galaxy | null = null;
  public player: Player | null = null;
  /**
   * Flight-position persistence cluster — {@link FlightPositionTracker}. Owns
   * `lastFlightShipPos`/`liveFlightShipPos`/the persisted `flightShipPos` +
   * the page-hide autosave plumbing (see that class for the full rationale).
   */
  private readonly flightPositions: FlightPositionTracker =
    new FlightPositionTracker({
      isSpaceFlightActive: () =>
        this.currentSceneType === SceneType.SPACE_FLIGHT,
      hasActiveGame: () => !!this.galaxy && !!this.player,
      saveGame: (slotId) => this.saveGame(slotId),
      persistLiveSceneState: () => this.currentScene?.persistLiveState?.(),
    });
  /**
   * Transient: the ship's world position in the system when the player last left
   * flight for the star map, so a hyperjump can start from where the ship was
   * (not teleport it next to the sun). Cleared once consumed.
   * @deprecated thin compat accessor — read/write {@link flightPositions} directly.
   */
  public get lastFlightShipPos(): { x: number; y: number } | null {
    return this.flightPositions.lastFlightShipPos;
  }
  public set lastFlightShipPos(pos: { x: number; y: number } | null) {
    this.flightPositions.lastFlightShipPos = pos;
  }
  /**
   * True only when `lastFlightShipPos` was captured while fleeing an active
   * fight (`SpaceFlightScene.saveShipPosition`, gated on `combatModule.isActive`)
   * — the sole signal `warpEdgePoint`'s near-edge escape (Task 9 iv) may use.
   * `lastFlightShipPos` alone is NOT that signal: it's set on every routine
   * inventory/star-map/quest-nav trip too, so gating on it alone fired the
   * near-edge exit on every hyperjump, not just a genuine flee. Transient
   * cross-scene state, like `lastFlightShipPos` — not part of `SaveState`.
   */
  public lastFlightWasFleeing = false;
  /**
   * Live in-flight ship position captured on each turn-end during FREE flight (no
   * scene exit), so the headline reload case — warp/take-off in, fly around, reload
   * — resumes where the ship stopped instead of edge-spawning. Distinct from
   * lastFlightShipPos: it is NOT read by the entry-spawn path (so it can never leak
   * into a warp/take-off spawn) and is cleared when the ship leaves the system
   * (performWarp). saveGame folds it into flightShipPos only while SPACE_FLIGHT is
   * the active scene; the systemId tag still guards the restore on load.
   * @deprecated thin compat accessor — read/write {@link flightPositions} directly.
   */
  public get liveFlightShipPos(): { x: number; y: number } | null {
    return this.flightPositions.liveFlightShipPos;
  }
  public set liveFlightShipPos(pos: { x: number; y: number } | null) {
    this.flightPositions.liveFlightShipPos = pos;
  }
  /**
   * Sticky, system-tagged copy of the last in-flight ship position, persisted
   * in the save. Non-private (unlike `pendingNewGamePlus`) — this accessor has
   * no in-class caller (every internal read/write now goes through
   * `flightPositions` directly), and a private accessor with no in-class
   * caller trips `noUnusedLocals`.
   * @deprecated thin compat accessor — an existing test pokes this field via
   * cast; read/write {@link flightPositions} directly in new code.
   */
  get flightShipPos(): FlightShipPos | null {
    return this.flightPositions.persistedFlightShipPos;
  }
  set flightShipPos(pos: FlightShipPos | null) {
    this.flightPositions.persistedFlightShipPos = pos;
  }
  // Player's chosen in-flight game-speed multiplier (1×/2×/4×). Held here — not on
  // the per-scene FlightHud/ShipPhysics, both rebuilt on every SPACE_FLIGHT
  // re-init — so the speed survives a land/take-off or star-map round-trip
  // instead of resetting to 1× (playtest3 F3). Re-applied by
  // FlightHud.restoreGameSpeed() on every HUD (re)build. Deliberately NOT in
  // SaveState/schemas.ts (transient cross-scene state, like lastFlightShipPos).
  public gameSpeedMultiplier = 1;
  // Transient anti-farm bookkeeping shared with NpcShipManager — see
  // {@link FlightSessionState}. Held HERE (not the per-scene NpcShipManager,
  // rebuilt on every SPACE_FLIGHT re-init) so the exploration-encounter
  // once-per-session offer and the per-galaxy-day salvage cap survive a scene
  // rebuild (warp / land→take-off / star-map round-trip) instead of
  // re-arming on every system entry. Deliberately NOT in SaveState/schemas.ts
  // (ephemeral cross-scene state, like liveFlightShipPos); reset on «Новая
  // игра» via {@link FlightSessionState.resetForNewSession}.
  public readonly sessionState = new FlightSessionState();

  /** @deprecated thin compat accessor — read/write {@link sessionState} directly. */
  public get offeredEncounterIds(): Set<string> {
    return this.sessionState.offeredEncounterIds;
  }
  /** @deprecated thin compat accessor — read/write {@link sessionState} directly. */
  public get salvageDay(): number {
    return this.sessionState.salvageDay;
  }
  public set salvageDay(day: number) {
    this.sessionState.salvageDay = day;
  }
  /** @deprecated thin compat accessor — read/write {@link sessionState} directly. */
  public get salvagedToday(): number {
    return this.sessionState.salvagedToday;
  }
  public set salvagedToday(amount: number) {
    this.sessionState.salvagedToday = amount;
  }
  /** Called when a quest expires mid-session so the HUD can show a toast. */
  public questExpiryCallback?: (message: string) => void;
  /** Called when a quest moves to pending-return state so the HUD can show a toast. */
  public questPendingReturnCallback?: (message: string) => void;
  /**
   * Fired by {@link GameEngine.triggerPlayerDeath} when the player ship is
   * destroyed in flight combat. The game-over presentation (GAME_OVER scene
   * transition, Task 4) hooks in here; kept as a seam so the death detection +
   * idempotent guard can be tested without a renderer.
   */
  public playerDeathCallback?: () => void;
  public readonly saveManager: SaveManager;
  public readonly qualityProfile: AdaptiveQualityProfile;
  public readonly questManager: IQuestService;
  public renderer: Renderer | null = null;
  /** GearCatalog-based loadout driving derived ship stats (speed, shields, etc.). */
  public playerLoadout: ShipLoadout | null = null;
  /** Runtime engine for the active text quest (one at a time). */
  public readonly textQuestRuntime = new TextQuestRuntime();
  /** Narrator for text quest node descriptions (pure template substitution). */
  public readonly questNarrator: QuestNarrator;
  /** Audio subsystem: background music + SFX. */
  public readonly audio = new AudioManager();
  /** Adaptive-music driver: maps scene + flight/combat state → background track. */
  private readonly music = new MusicDriver();
  /** Edge-triggered low-hull warning cue (fires once per critical-hull episode). */
  private readonly hullAlarm = new HullAlarm();
  /**
   * Live "is the player in a fight?" signal the active scene plugs in (the flight
   * scene registers `() => combatModule.isActive`). Polled each frame by the
   * game loop to drive adaptive combat music; cleared on every scene transition
   * so a non-flight scene reverts to ambient. See {@link setCombatStateProvider}.
   */
  private combatStateProvider: (() => boolean) | null = null;
  /** The АБС "универсальная шина": consumers dispatch banking commands here. */
  public readonly bankBus = new BankBus();
  /** The authoritative core-banking ledger + command handler on {@link bankBus}. */
  public readonly bankingService = new BankingService(this.bankBus);

  /**
   * The bus + service bundle consumer sites thread into the credit helpers
   * (`adjustPlayerCredits` / `creditNpc`) so every money move books a balanced
   * ledger entry instead of poking `player.credits` directly.
   */
  public get bank(): BankAccess {
    return { bus: this.bankBus, service: this.bankingService };
  }

  /**
   * Read-only access to the live NPC simulation. Scenes use this to project
   * transient population state (e.g. the star map's half-red/half-green battle
   * marker via {@link NpcSimulator.battleSystemIds}). Not for mutation — the
   * engine drives the simulator's `tick`.
   */
  public get npc(): NpcSimulator {
    return this.npcSimulator;
  }

  /**
   * The ratcheted peak `playerPowerIndex` of this run (null before the first
   * ratchet/restore). The adaptive-difficulty consumers (spread pacing,
   * garrison scaling — Tasks 3–4) read the peak through this seam.
   */
  public get campaignPeakPower(): number | null {
    return this.campaignPeakPowerValue;
  }

  /**
   * Ratchet the campaign peak power from the live loadout and return the new
   * peak (0 while no run is active). Called on every EOD tick (the adaptive
   * spread pacing input) and before every save — the stored value never
   * decreases within a run, so selling gear cannot soften the front.
   */
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
  /** Renderer-backed in production; a headless no-op when not injected (tests, legacy DI sites). */
  private readonly overlay: IOverlayPresenter;
  /**
   * Carry-over staged by {@link startNewGamePlus} for the next fresh game: the
   * new-game creation path in {@link transitionTo} consumes it (once) to seed the
   * fresh player's credits/rank/faction/difficulty. Null for a plain new game.
   * @deprecated thin compat accessor — the guard lives on {@link EndgameController}.
   */
  private get pendingNewGamePlus(): NewGamePlusCarry | null {
    return this.endgame.pendingNewGamePlus;
  }
  private set pendingNewGamePlus(carry: NewGamePlusCarry | null) {
    this.endgame.pendingNewGamePlus = carry;
  }
  /** Drops the active `credits` projection binding before re-binding a new player. */
  private bankProjectionUnsub: Unsubscribe | null = null;
  /**
   * Highest `playerPowerIndex` reached this run — the adaptive-difficulty
   * ratchet (three-year-campaign Task 2). Null until first ratcheted (fresh
   * runtime); persisted as the optional additive `campaignPeakPower` save
   * field; restored (or derived from the loadout for pre-campaign saves) in
   * {@link loadGame}. Only ever rises within a run — see `ratchetPeakPower`.
   */
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
      // DI mode: use injected services
      this.exceptionHandler = diDependencies.exceptionHandler;
      this.qualityProfile = diDependencies.qualityProfile;
      this.saveManager = diDependencies.saveService as SaveManager;
      this.galaxyService = diDependencies.galaxyService;
      this.playerService = diDependencies.playerService;
      this.questManager = diDependencies.questService;
    } else {
      // Legacy mode: direct instantiation (backward compatibility)
      this.qualityProfile = new AdaptiveQualityProfile();
      this.saveManager = new SaveManager();
      this.galaxyService = new GalaxyService();
      this.playerService = new PlayerService();
      this.exceptionHandler = GlobalExceptionHandler.getInstance();
      this.questManager = new QuestManagerAdapter();
    }
    this.overlay =
      diDependencies?.overlayPresenter ?? new NoOpOverlayPresenter();

    // Adaptive campaign pressure (Task 4): the per-tick Overmind garrison
    // sizing reads the run's ratcheted peak power live through this provider
    // (new game resets the value to null ⇒ 0, so no cross-run leak).
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
      checkWinCondition: () => this.checkWinCondition(),
      checkExpiredQuests: () => this.checkExpiredQuests(),
      isOutcomeShown: () => this.endgame.isOutcomeShown(),
      showGameOutcomeScreen: (win) => this.showGameOutcomeScreen(win),
      isWinScreenShown: () => this.endgame.isWinScreenShown(),
      markWinScreenShown: () => this.endgame.markWinScreenShown(),
      transitionToWinScreen: () => {
        this.transitionTo(SceneType.WIN_SCREEN, { gameEngine: this }).catch(
          (e) => logger.error("Win screen transition failed:", e),
        );
      },
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

    // АБС: when the EOD batch defaults the player's loan, apply the one-off
    // bank-faction reputation sanction. The event fires once per default crossing
    // (see BankingService.processLoanDefaults), so the hit is not re-applied on
    // each subsequent overdue day. NPC loans (if any) carry no reputation.
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

  /**
   * Wire the current player into the АБС: open their current account, seed it
   * from `player.credits`, and bind `credits` as a projection of that account's
   * GL balance. Idempotent — drops any prior binding first and only seeds the
   * gap, so it is safe to call again after a load. No-op without a player.
   */
  private setupPlayerBanking(): void {
    if (!this.player) return;
    this.bankProjectionUnsub?.();
    this.bankProjectionUnsub = setupPlayerBanking(
      this.bankBus,
      this.bankingService,
      this.player,
    );
    // Hand the bank to the systems that move money outside a scene (quest rewards
    // / fines, NPC pirate plunder) so they book ledger entries via the bus too.
    this.questManager.attachBank?.(this.bank);
    this.npcSimulator.attachBank(this.bank);
  }

  async initialize(config: GameConfig): Promise<void> {
    try {
      // Persist the live in-flight position when the tab is hidden/closed so a
      // reload mid-flight resumes where the ship was (registered once, before the
      // auto-load early-return below).
      this.flightPositions.registerFlightHideAutosave();

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

    // Drop the previous scene's adaptive-music combat signal; the next flight
    // scene re-registers it in initialize(), other scenes leave it null (ambient).
    this.combatStateProvider = null;

    // Tear down current scene
    if (this.currentScene) {
      this.currentScene.destroy();
      this.currentScene = null;
    }

    // Tear down any open modal/loading overlay's OWN bookkeeping BEFORE the
    // blanket clearUILayer() below destroys every UI-layer child out from
    // under it — else the presenter's tracking arrays keep stale destroyed-
    // object references across scenes (F4, three-year-campaign Task 16b).
    this.overlay.dismissAll();

    // Safety net: guarantee no orphaned interactive objects survive a scene's incomplete destroy() (prevents click-swallowing across scenes).
    this.renderer.clearGameLayer();
    this.renderer.clearUILayer();

    // Handle new game creation when transitioning to STAR_MAP or SPACE_FLIGHT and no player exists
    const isGameStartScene =
      sceneType === SceneType.STAR_MAP || sceneType === SceneType.SPACE_FLIGHT;
    if (isGameStartScene && !this.player) {
      // New Game+ carry-over staged by startNewGamePlus (consumed once here): a
      // capped credit slice + the won captain's rank/faction + a tougher mode.
      // A plain new game leaves it null and every default below applies as before.
      const ngPlus = this.pendingNewGamePlus;
      this.pendingNewGamePlus = null;

      // Get selected faction from context, the NG+ carry, or default to OUTLANDERS
      const selectedFaction =
        (context as { selectedFaction?: FactionType })?.selectedFaction ??
        ngPlus?.factionType ??
        FactionType.OUTLANDERS;

      this.player = this.playerService.createPlayer({
        factionType: selectedFaction,
        captainName: "Captain",
        startingMoney: ngPlus?.credits ?? 1000,
      });

      // A fresh run starts with no peak-power ratchet — a previous session's
      // value must not leak into the new campaign. Re-seeded on first save.
      this.campaignPeakPowerValue = null;

      // NG+ carries the won captain's rank forward (veteran status persists).
      if (ngPlus) this.player.rank = ngPlus.rank;

      // Per-run difficulty mode chosen on the new-game screen (default NORMAL),
      // or the one-notch-tougher mode the NG+ cycle escalates to.
      // Read here (not in createPlayer) so the field is set on the canonical
      // Player the engine owns; "downed" is derived from mode + hull, not stored.
      const selectedGameMode =
        (context as { selectedGameMode?: GameMode })?.selectedGameMode ??
        ngPlus?.gameMode ??
        "NORMAL";
      this.player.setGameMode(selectedGameMode);

      // HARD seeds modestly more hostiles (overmind/pirate systems + larger
      // garrisons). The galaxy was generated at boot before the mode was known,
      // so augment its initial hostile seeding now; NORMAL/GOD are no-ops →
      // exactly today's counts. The extra systems persist in the save.
      this.applyDifficultyHostileScaling();

      // A fresh game ships fully fitted (engine + tank + weapon + grapple) with
      // nothing install-required left loose in the hold — see starterLoadout().
      // No starter spares are seeded into inventory.modules / ownedGearIds.

      logger.info(`Created new player with faction: ${this.player.faction}`);

      // Initialize GearCatalog loadout: starter corvette with engine + fuel tank
      if (!this.playerLoadout) {
        this.playerLoadout = this.starterLoadout();
      }

      // Open the player's current account in the АБС and project credits onto it.
      this.setupPlayerBanking();
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
      // Reveal the home system's immediate neighbours up-front (same call the
      // star map makes on open). Without a known cluster the InfoCenter's
      // both-endpoints-known margin rule hid EVERY cross-system rumor («~?%»)
      // until the player happened to open the star map — a single known system
      // can never anchor a route. Revealing neighbours now gives the trade-margin
      // column real numbers for the local cluster from turn 1.
      this.galaxy.revealSystemAndNeighbors(this.player.currentSystemId);
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
      // Landing parks the ship on the planet: its last free-flight position is no
      // longer where the ship is. Drop the captured position now so a later
      // take-off autosave (which runs after landedPlanetId is cleared and the
      // scene is back to SPACE_FLIGHT) cannot re-persist the stale pre-landing
      // position and teleport the ship there on the next reload.
      this.forgetFlightPosition();
    }

    this.currentScene.initialize(finalContext);
    logger.info(`Transitioned to scene: ${sceneType}`);

    // Play background music track matching the new scene. No flight state is
    // passed here, so the director picks the scene's ambient track; the live
    // flight loop drives combat/tension swaps from SpaceFlightScene.update.
    this.updateMusic();

    // Auto-save on scene transition (only for gameplay scenes with valid state).
    // GAME_OVER is excluded: it is the terminal death screen, and the `"auto"`
    // slot is the takeoff checkpoint the death rolls back to — autosaving the
    // GAME_OVER state here would clobber that checkpoint (and, since GAME_OVER is
    // not a contextDependentScene, a later load would re-enter the death screen
    // and bounce straight back). Death must be non-destructive to the autosave.
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

  /**
   * Invalidate the ship's captured free-flight position. Called when the ship
   * lands (it is parked on a planet, not at a free-flight position).
   * @deprecated thin compat forwarder — call {@link flightPositions} directly.
   */
  forgetFlightPosition(): void {
    this.flightPositions.forgetFlightPosition();
  }

  /**
   * Continuously capture the live in-flight ship position. Called every frame
   * from the flight scene so a later autosave (turn-end, periodic, or the
   * page-hide flush) persists where the ship actually IS — not the stale
   * system-entry edge.
   * @deprecated thin compat forwarder — call {@link flightPositions} directly.
   */
  recordLiveFlightPos(x: number, y: number): void {
    this.flightPositions.recordLiveFlightPos(x, y);
  }

  /**
   * Persist the live in-flight position on page-hide
   * (`visibilitychange`→hidden / `beforeunload`) so a reload mid-flight resumes
   * the live position instead of edge-spawning.
   * @deprecated thin compat forwarder — call {@link flightPositions} directly.
   */
  async flushFlightAutosave(): Promise<void> {
    await this.flightPositions.flushFlightAutosave();
  }

  /**
   * Advance the galaxy by one game day: increment the day counter and tick the
   * living-galaxy NPC simulation. The per-day RNG is derived from the galaxy id
   * and day so simulation stays deterministic and survives save/load (no RNG
   * state to persist). Call this instead of `galaxy.simulateDay()` directly.
   */
  advanceGalaxyDay(): void {
    if (!this.galaxy) return;
    this.dayTick.run();
  }

  /**
   * Returns true when the player meets the win condition:
   * rank >= 2 ("Ветеран") AND reputation > 50 with at least 3 factions.
   */
  checkWinCondition(): boolean {
    return this.endgame.checkWinCondition();
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
   * Whether the player can liberate their current system right now — it is a
   * captured (Overmind/pirate) system whose hostile garrison has been cleared
   * ({@link canPlayerLiberate}). The public predicate behind
   * {@link liberateCurrentSystem} (which re-checks it before acting); also
   * exercised directly by the player-liberation playtests.
   */
  canLiberateCurrentSystem(): boolean {
    if (!this.galaxy || !this.player?.currentSystemId) return false;
    return canPlayerLiberate(this.galaxy, this.player.currentSystemId);
  }

  /**
   * Liberate the player's current system from OVERMIND or pirate control — the
   * player-driven counter-play that makes the captured front reversible mid-game
   * (works for **both** pirate- and Overmind-captured systems via
   * {@link Galaxy.tryLiberate}). Gated on {@link canLiberateCurrentSystem}: only
   * fires once the local hostile garrison is cleared (a real combat victory), so
   * it can never auto-clear the map — each call frees at most the one system the
   * player is in. Returns true when a system was actually freed.
   */
  liberateCurrentSystem(): boolean {
    if (!this.canLiberateCurrentSystem()) return false;
    const systemId = this.player!.currentSystemId;
    const liberated = this.galaxy!.tryLiberate(systemId, "player");
    if (liberated) {
      logger.info(`Player liberated system ${systemId}`);
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

    // Content keys of quests the player already engaged, so the generator never
    // re-offers them ("задания не должны повторяться"). Active + pending-return
    // quests carry full templates, so their content key is computable; completed
    // quests are ids-only (no retained template) and stay deduped by id below.
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
      // Routine contracts must never TARGET an occupied system — its standing
      // garrison annihilates the courier (see BoardOptions.hostileSystems).
      hostileSystems: [
        ...this.galaxy.overmindSystems,
        ...this.galaxy.pirateSystems,
      ],
      overmindSystems: this.galaxy.overmindSystems,
      overmindAdjacentSystems: overmindAdjacent,
    });
    // Inject the Overmind campaign chain step this board should offer (Task 12).
    // The step is gated on player milestones + prior-step completion (pure
    // predicate over the already-persisted completed-quest list), so it appears
    // only in order and only once its milestone band is crossed. Pushed onto the
    // board so the shared `taken` filter below drops it while it is active or
    // once completed. No board slot is consumed and no save shape changes.
    const campaignQuest = this.buildCampaignBoardQuest(planetId);
    if (campaignQuest) board.push(campaignQuest);
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
   * The Overmind campaign chain quest a board should currently offer, or null
   * (chain complete / next milestone not reached / run decided / no reachable
   * target yet). The step selection is a pure predicate over the persisted
   * completed-quest list + Overmind state + ratcheted power (Task 12); the
   * target system is resolved from the live galaxy here.
   */
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

  /**
   * Resolve a concrete destination system for a campaign step from the live
   * galaxy: a `frontier` step points at an explored, non-hostile system on the
   * Overmind border (falling back to any safe rear system when the front is not
   * yet charted); a `safe` step points at an explored, non-hostile rear system.
   * Returns null when no valid (explored, non-hostile) system is reachable.
   */
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

    // frontier steps prefer the front, fall back to the rear; safe steps prefer
    // the rear, fall back to the front — so the chain always resolves a target
    // as long as any explored, non-hostile system is reachable.
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

  /**
   * Accept a generated board quest (EPIC-008): registers and activates it via the
   * quest service, tagged with the issuing planet and current day for deadlines.
   */
  acceptBoardQuest(quest: GeneratedQuest, planetId: string): Quest | null {
    const factionId =
      this.galaxy?.systems.find((s) => s.planets.some((p) => p.id === planetId))
        ?.ownerFaction ?? "";

    // For BOUNTY quests, bind the narrative ship name (e.g. «Стальной ворон») to
    // a real pirate living in the target system: rename it and link it via
    // targetObjectId. The GalacticRegistry — rebuilt each game day from each
    // npcShip.currentSystemId — then surfaces the ship by name in the Info
    // Center, with its system and jump distance. When no pirate is present we
    // pass the original template unchanged (targetObjectId null), preserving the
    // matchesSystem fallback in QuestCompletion.bountyByNpcKill().
    let template = quest.template;
    const targetSystemId = quest.template.targetSystemId;
    if (
      quest.template.type === QuestType.BOUNTY &&
      quest.targetNpcName &&
      targetSystemId
    ) {
      // Pirates already bound to another active or pending bounty are off-limits:
      // reusing one would let a single kill complete both quests, and the second
      // rename would clobber the first quest's named target.
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
        // The Info Center registry is cached per game-day and only rebuilt on
        // world advance. Renaming a ship mid-day mutates galaxy state the cached
        // snapshot won't reflect, so the player couldn't find the freshly-named
        // target until the next day-tick. Drop the cache so it rebuilds on the
        // next lookup — the whole point of binding a real NPC is findability.
        this.infoRegistryCache = null;
      }
    }

    // Carry the generated quest's concrete target planet (e.g. the «Местный
    // подряд» neighbour the cargo is couriered to) onto the template so the
    // accepted Quest knows which in-system planet completes it. Null for quests
    // with no specific planet — those stay system-level.
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

    // Refresh the persisted flight position from the live one whenever the flight
    // scene has set it (see FlightPositionTracker.captureForSave). The systemId
    // guards the restore on load. See loadGame.
    const flightShipPos = this.flightPositions.captureForSave(
      this.player.currentSystemId,
    );

    // Ratchet the campaign peak power before persisting: the stored value
    // never decreases within a run (selling gear must not soften the adaptive
    // difficulty). A fresh runtime (null) seeds from the current loadout.
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
      // Persist the АБС book of record (accounts + journal + EOD cursors) so the
      // ledger reloads verbatim instead of being re-seeded from `player.credits`.
      this.bankingService.toSnapshot(),
      flightShipPos,
      this.campaignPeakPowerValue ?? undefined,
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

    // Loading a checkpoint (e.g. the takeoff autosave after a death) re-arms the
    // one-shot death guard, so the restored player can die again — otherwise the
    // game-over flow would never re-fire after the first death.
    this.endgame.resetPlayerDeathGuard();

    // Clear adaptive-audio state so a loaded save never inherits a stale combat
    // hold or a still-armed low-hull alarm from the prior in-session game (Continue
    // after death, or loading a slot from the in-flight menu). Symmetric with the
    // new-game reset in generateDefaultGameState: without re-arming the alarm, a
    // load into a critical-hull save while the previous game also ended low-hull
    // would swallow the first warning edge (`low && !wasLow` stays false).
    // `transitionTo` below also nulls combatStateProvider; clearing it here keeps
    // the block self-documenting and matches the new-game path.
    this.combatStateProvider = null;
    this.music.reset();
    this.hullAlarm.reset();

    // Saved state is plain JSON: restore class prototypes so domain methods
    // (galaxy.simulateDay, ship.repair, inventory.addItem) and `instanceof`
    // module checks work after "Continue". Field data is already correct.
    this.rehydrateLoadedState();

    // Re-apply the saved run's difficulty to the NPC garrison sizing (HARD only;
    // NORMAL/GOD are no-ops). The galaxy's extra HARD hostile systems are already
    // persisted, so only the per-day garrison range needs re-arming on load.
    this.npcSimulator.setGameMode(this.player.gameMode);

    // Restore the persisted АБС book of record (accounts + journal + EOD cursors)
    // verbatim, so balances, statements and open savings/loan accounts survive the
    // reload. Old saves lack the snapshot — there `setupPlayerBanking` below
    // re-seeds the player current account from the loaded `credits` (the migration
    // path: credits → opening balance).
    if (save.banking) {
      this.bankingService.restore(save.banking);
    } else {
      // Pre-banking save: no book of record. Clear any ledger left over from an
      // earlier game in this session so the re-seed below starts from clean books
      // (otherwise the Bank UI would show the previous game's statement).
      this.bankingService.resetLedger();
    }

    // Re-wire the loaded player into the АБС: bind the `credits` projection and
    // open their current account. With a restored ledger this is a no-op seed
    // (the account already balances to `credits`); on an old save it opens +
    // seeds the account from `credits`.
    this.setupPlayerBanking();

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

    // Load-time loadout revalidation (save-compat safety net): a catalog
    // rebalance may have shrunk this hull's slot/mass capacity *after* the save
    // was written, leaving the restored loadout over-capacity. Drop the excess
    // to the inventory bag — the same drop semantics a hull swap uses — so a
    // catalog shrink can't brick an old save; it loads in a valid, playable
    // state instead. A loadout that still fits drops nothing (normal saves are
    // untouched). `fromJSON` already caps hull micromodules to the hull's slots.
    if (this.player) {
      for (const slot of this.playerLoadout.revalidateToCurrentHull()) {
        const g = gearById(slot.gearId);
        if (g) this.player.inventory.addItem(slotToBagModule(g, slot));
      }
    }

    // Restore the adaptive-difficulty ratchet. Pre-campaign saves carry no
    // `campaignPeakPower` — derive it from the just-restored (and revalidated)
    // loadout so the run resumes with a faithful peak instead of null.
    this.campaignPeakPowerValue = this.player
      ? restoredPeakPower(
          save.campaignPeakPower,
          this.playerLoadout,
          this.player.credits,
          this.player.rank,
        )
      : null;

    // Project the canonical loadout's hull onto the live ship at load time, just
    // as both hull shops do at hull-change time. The save's `ship.maxHull`/
    // `hullClass` are restored verbatim from JSON and would otherwise drift from
    // the loadout (a migrated/rebalanced hull, or a hull micromodule) — combat
    // and the daily droid repair read `ship.maxHull`, so without this the two
    // models could disagree, the exact landmine the dual-hull unification removes.
    if (this.player?.ship) {
      applyLoadoutHullToShip(this.player.ship, this.playerLoadout);
    }

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
      SceneType.INVENTORY,
      SceneType.STATION,
      SceneType.EQUIPMENT_SHOP,
      SceneType.GOVERNMENT,
      SceneType.TEXT_QUEST,
      SceneType.WIN_SCREEN,
      SceneType.INFO_CENTER,
      SceneType.BANK,
      // The save/load screen is a menu overlay with no resumable game context;
      // a save taken there (in-game pause autosave to "auto") must bounce to
      // SPACE_FLIGHT on load, not re-open a blank slot list.
      SceneType.SAVE_LOAD,
    ];
    const savedScene = save.currentSceneType ?? SceneType.SPACE_FLIGHT;
    // A save may name a scene that no longer exists — notably the removed hex
    // SceneType.COMBAT (combat is now real-time in-flight only). An old autosave
    // taken inside the hex CombatScene persisted currentSceneType: "COMBAT"
    // (transitionTo autosaves every gameplay scene), and that string still
    // validates (schema is z.string()). Without this guard it would reach
    // transitionTo("COMBAT") → SceneFactory returns null → INVALID_SCENE crash on
    // "Continue". Treat any unknown/removed scene like a context-dependent one and
    // fall back to SPACE_FLIGHT.
    const isKnownScene = (Object.values(SceneType) as string[]).includes(
      savedScene,
    );
    const sceneType =
      !isKnownScene || contextDependentScenes.includes(savedScene)
        ? SceneType.SPACE_FLIGHT
        : savedScene;

    // Carry the persisted flight position forward so a subsequent autosave keeps
    // it, and resume the ship where it was on reload: pass it as
    // `preserveShipPos` only when we land in SPACE_FLIGHT and the saved position
    // belongs to the loaded system (else applyEntrySpawn edge-spawns as before).
    // A save made while the ship was *landed* (`landedPlanetId` set — e.g. a
    // PLANET/TRADE/BANK save that falls back to SPACE_FLIGHT) must spawn beside
    // that planet via applyReentrySpawn, NOT teleport to a possibly-stale flight
    // position (landing does not refresh `flightShipPos`), so suppress the resume
    // in that case and let the landed-planet spawn win.
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
    return true;
  }

  /**
   * Resume the most recent *meaningful* save — the "Continue" entry point. It
   * resolves the latest non-terminal save across **all** slots (auto + the
   * manual grid) via {@link latestMeaningfulSlot} and loads it, so a player who
   * took a manual save more recently than the autosave (or whose autosave landed
   * on a win/lose screen) resumes the right one. Returns `false` when nothing
   * meaningful exists to load. The autosave path is untouched — it still always
   * writes to the `"auto"` slot; this only changes which slot Continue *reads*.
   */
  async continueGame(): Promise<boolean> {
    const slotId = await latestMeaningfulSlot(this.saveManager);
    if (!slotId) return false;
    return this.loadGame(slotId);
  }

  /**
   * The player's faction as the ShipLoadout `Faction` type, so loadouts can
   * enforce micromodule faction-incompatibility (canon §11.3). `FactionType`
   * and `Faction` share their string values for all playable factions.
   */
  private playerLoadoutFaction(): Faction | undefined {
    return this.player?.faction as unknown as Faction | undefined;
  }

  /**
   * Default starter loadout: a fully fitted corvette — engine + fuel tank +
   * weapon + grapple (gravity tractor). Everything essential is installed so a
   * fresh game has nothing install-required loose in the hold.
   */
  private starterLoadout(): ShipLoadout {
    const loadout = new ShipLoadout(
      "hull_corvette",
      this.playerLoadoutFaction(),
    );
    loadout.install("eq_engine_i");
    loadout.install("eq_tank");
    // A fresh game must be able to fight: fit a starter weapon (Импульсный
    // лазер). The corvette has 2 weapon slots and a 40-mass budget.
    loadout.install("wpn_pulse");
    // The grapple/захват — a gravity tractor (Гравитяга Тип-I) — lets the ship
    // tow loot in from a distance. EQUIPMENT bank, mass 3. Total fitted mass:
    // engine (6) + tank (3) + weapon (4) + grav-tractor (3) = 16 ≤ 40, and the
    // equipment bank (3 slots) holds tank + grav-tractor with room to spare.
    loadout.install("grav_tractor_1");
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
      // Class field initializers (`activeRumors = []`) do NOT run when a loaded
      // plain object is reparented via setPrototypeOf, and SaveManager returns the
      // raw parsed object (Zod `.default([])` applies only to the discarded
      // validated copy). Saves created before the trade-rumor feature therefore
      // arrive with `activeRumors === undefined`, which throws in
      // getActiveRumors()/updateRumors() on the first daily tick. Restore it here,
      // mirroring the visitedSystems / stations guards below.
      if (!Array.isArray(this.galaxy.activeRumors)) {
        this.galaxy.activeRumors = [];
      }
      // Overmind endgame-arc state: the v27→28 migration backfills it, but a save
      // already at the current version that somehow lacks it (e.g. a synthetic
      // object whose Zod `.default` was discarded) must not leave the EOD spread
      // tick reading `undefined`. Default it dormant here, mirroring the guards
      // above. See initialOvermindSpreadState / MigrationPipeline 27→28.
      if (!this.galaxy.overmindArc) {
        this.galaxy.overmindArc = initialOvermindSpreadState();
      }
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
      }
      if (this.player.inventory) {
        Object.setPrototypeOf(this.player.inventory, Inventory.prototype);
      }
    }

    // Restore prototypes down the galaxy → system → planet → market chain.
    // Without this, loaded markets are method-less plain objects: the daily
    // drift guard (`typeof advanceMarketDay === "function"`) fails so prices
    // freeze on loaded saves, and any Market method call throws.
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

  /**
   * Show a full-screen win or loss overlay with a "Начать заново" button (and,
   * on a win, a "Новая игра+" button). Delegates to {@link EndgameController} —
   * see there for the idempotent-guard and arc-persistence rationale.
   */
  showGameOutcomeScreen(win: boolean): void {
    this.endgame.showGameOutcomeScreen(win);
  }

  /**
   * Start a New Game+ from the victory screen. Delegates to
   * {@link EndgameController} — see there for the carry-over rationale.
   */
  async startNewGamePlus(): Promise<void> {
    await this.endgame.startNewGamePlus();
  }

  /**
   * Player ship destroyed in flight combat → game over. Delegates to
   * {@link EndgameController} — see there for the idempotent-guard and
   * autosave-non-destructiveness rationale.
   */
  triggerPlayerDeath(): void {
    this.endgame.triggerPlayerDeath();
  }

  /**
   * «Начать заново» from the GAME_OVER screen: start a completely fresh game.
   * Delegates to {@link EndgameController} — see there for why the full reset
   * must happen before race selection.
   */
  async restartNewGame(): Promise<void> {
    await this.endgame.restartNewGame();
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
      this.overlay.showError(
        `Ошибка сохранения: ${error.errorMessage}. Нажмите "Новая игра" для начала новой игры.`,
        () => this.newGameFromErrorModal(),
      );
      return;
    }

    // Fatal vs. recoverable both render the same modal (no "Новая игра" button);
    // only the log line above distinguishes them.
    this.overlay.showError(response.message);
  }

  private handleCriticalError(response: { message: string }): void {
    // Emergency auto-save to the hidden recovery slot.
    if (this.galaxy && this.player) {
      this.saveGame(EMERGENCY_SLOT_ID).catch((e) => {
        logger.error("Emergency auto-save failed:", e);
      });
    }
    this.overlay.showError(response.message);
  }

  /** "Новая игра" click on the save-validation error modal. */
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

  /**
   * Apply the chosen difficulty mode's hostile scaling to the freshly-generated
   * galaxy. HARD seeds modestly more overmind/pirate systems (picking the
   * next-most-isolated neutral systems, mirroring the generator's own ordering)
   * and arms the NPC simulator to grow standing garrisons. NORMAL/GOD leave both
   * untouched, so their hostile counts stay exactly today's. Called from the
   * new-game path once the player's `gameMode` is set and the galaxy exists.
   */
  private applyDifficultyHostileScaling(): void {
    if (!this.player || !this.galaxy) return;
    const mode = this.player.gameMode;

    // Arm the daily garrison sizing (HARD grows the [min,max] range).
    this.npcSimulator.setGameMode(mode);

    // Order every system most-isolated-first (q²+r² magnitude descending) — the
    // same criterion the generator uses to pick the starting hostiles — so the
    // extra HARD hostiles sit on the next-most-isolated frontier systems.
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

  /** Delegates to {@link EndgameController} — see there for the full reset list. */
  private async generateDefaultGameState(): Promise<void> {
    await this.endgame.generateDefaultGameState();
  }

  private gameLoop = (time: number): void => {
    const deltaTime = time - this.lastTime;
    this.lastTime = time;

    try {
      this.currentScene?.update(deltaTime);
      // PixiJS renders automatically via app.ticker / RAF
      // Adaptive music: poll the scene's live combat signal every frame so the
      // director's combat hysteresis can revert to ambient once a fight ends.
      this.updateMusic(this.combatStateProvider?.() ?? false);
    } catch (error) {
      this.handleError(error as Error);
    }

    this.animationFrameId = requestAnimationFrame(this.gameLoop);
  };

  /**
   * Register (or clear with `null`) the active scene's live "in combat?" signal.
   * The flight scene plugs in `() => combatModule.isActive`; {@link transitionTo}
   * clears it so a non-flight scene can't keep combat music playing.
   */
  setCombatStateProvider(provider: (() => boolean) | null): void {
    this.combatStateProvider = provider;
  }

  /**
   * Recompute and apply the background music track for the current scene + live
   * combat state through the {@link MusicDriver} (the pure {@link MusicDirector}
   * is the single source of truth for "which track fits now"). Called once on a
   * scene transition (no `inCombat` ⇒ the scene's ambient track) and every frame
   * from {@link GameEngine.gameLoop} with the registered combat-state signal — so
   * a fight swaps to the combat / boss track and the director's combat hysteresis
   * reverts to ambient once the window elapses. `lowHull` (the tension cue) is
   * derived from the player ship; `boss` from fighting inside the OVERMIND-core
   * system. `AudioManager.playTrack` is a no-op when the track is unchanged, so
   * the per-frame calls are cheap.
   */
  updateMusic(inCombat = false): void {
    const ship = this.player?.ship;
    const lowHull = ship
      ? ship.hullHP < ship.maxHull * MUSIC_TENSION_HULL_FRACTION
      : false;
    const coreId = this.galaxy?.overmindCoreSystemId;
    // Boss is keyed off *location* (fighting inside the OVERMIND core), not the
    // transient `inCombat` flag: during the director's post-disengage hold window
    // `inCombat` is false, so gating on it would flicker the held track from
    // `combat_boss` back to plain `combat` mid-boss-fight. `boss` is only read by
    // the director while combat is active/held, so it is inert otherwise.
    const boss = !!coreId && this.player?.currentSystemId === coreId;
    this.music.apply(this.audio, {
      scene: this.currentSceneType,
      inCombat,
      lowHull,
      boss,
      now: typeof performance !== "undefined" ? performance.now() : Date.now(),
    });
    // One-shot low-hull warning: the alarm folds the per-frame `lowHull` level
    // into a single firing edge so it sounds once per critical-hull episode
    // rather than every tick the hull stays low.
    this.hullAlarm.update(this.audio, lowHull);
  }

  stop(): void {
    cancelAnimationFrame(this.animationFrameId);
    this.flightPositions.unregisterFlightHideAutosave();
    this.currentScene?.destroy();
    this.renderer?.destroy();
    this.combatStateProvider = null;
    this.music.reset();
    this.hullAlarm.reset();
    this.audio.destroy();
  }
}
