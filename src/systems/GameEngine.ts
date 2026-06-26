import type { GameConfig, GameMode } from "@/types";
import {
  SceneType,
  FactionType,
  QuestType,
  NpcRole,
  NpcState,
  ResourceType,
} from "@/types";
import { Galaxy } from "@/domain/Galaxy";
import type { FlightShipPos } from "@/domain/SaveState";
import type { GameScene } from "@/presentation/GameScene";
import { Renderer } from "@/presentation/Renderer";
import { preloadTextures } from "@/presentation/textures";
import { SaveManager } from "@/data/SaveManager";
import { AdaptiveQualityProfile } from "@/ai/AdaptiveQualityProfile";
import { GlobalExceptionHandler } from "@/exceptions/GlobalExceptionHandler";
import { GameSystemException } from "@/exceptions/GameSystemException";
import { GameValidationException } from "@/exceptions/GameValidationException";
import { logger } from "@/utils/logger";
import { GAME_BALANCE, additionalHostileSeeds } from "@/config/balance";
import { Graphics, Text } from "pixi.js";
import { validatePlayerSettings } from "@/validation/schemas";
import { Player } from "@/domain/Player";
import { NpcSimulator } from "@/systems/npc/NpcSimulator";
import { GalaxySimulator } from "@/systems/GalaxySimulator";
import { TradeSystem } from "@/systems/TradeSystem";
import { scanTradeRoutes } from "@/systems/trade/RouteScanner";
import { updateRumors } from "@/systems/trade/RumorDirector";
import { stepOwnershipTick } from "@/systems/galaxy/OvermindBalance";
import {
  initialOvermindSpreadState,
  advanceOvermind,
  type OvermindSpreadConfig,
} from "@/systems/overmind/overmindSpread";
import {
  newGamePlusCarry,
  type NewGamePlusCarry,
} from "@/systems/overmind/newGamePlus";
import { SeededRNG } from "@/utils/seededRNG";
import type { Quest } from "@/domain/Quest";
import {
  generateQuestBoard,
  questKeyForQuest,
  type GeneratedQuest,
} from "@/systems/quests/QuestGenerator";
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
} from "@/core/ports";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import {
  applyLoadoutHullToShip,
  slotToBagModule,
} from "@/systems/equipment/GearBridge";
import { gearById } from "@/systems/equipment/GearCatalog";
import type { Faction } from "@/types/faction";
import { NpcShip } from "@/domain/NpcShip";
import { GalaxyService, PlayerService, SceneFactory } from "@/core/services";
import { QuestManagerAdapter } from "@/core/adapters";
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

export class GameEngine {
  public currentScene: GameScene | null = null;
  public currentSceneType: SceneType = SceneType.MAIN_MENU;
  public galaxy: Galaxy | null = null;
  public player: Player | null = null;
  // Transient: the ship's world position in the system when the player last left
  // flight for the star map, so a hyperjump can start from where the ship was
  // (not teleport it next to the sun). Cleared once consumed.
  public lastFlightShipPos: { x: number; y: number } | null = null;
  // Live in-flight ship position captured on each turn-end during FREE flight (no
  // scene exit), so the headline reload case — warp/take-off in, fly around, reload
  // — resumes where the ship stopped instead of edge-spawning. Distinct from
  // lastFlightShipPos: it is NOT read by the entry-spawn path (so it can never leak
  // into a warp/take-off spawn) and is cleared when the ship leaves the system
  // (performWarp). saveGame folds it into flightShipPos only while SPACE_FLIGHT is
  // the active scene; the systemId tag still guards the restore on load.
  public liveFlightShipPos: { x: number; y: number } | null = null;
  // Sticky, system-tagged copy of the last in-flight ship position, PERSISTED in
  // the save (unlike lastFlightShipPos) so a browser reload resumes the ship
  // where it was instead of edge-spawning. Refreshed from lastFlightShipPos
  // whenever that is set (always a live flight position written by the flight
  // scene); kept across a later non-flight autosave so the last good position is
  // not lost. The systemId guards the restore — applied only when the loaded
  // system matches (else the ship falls back to the default edge spawn).
  private flightShipPos: FlightShipPos | null = null;
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

  private exceptionHandler: IExceptionHandler;
  /** Retained page-hide autosave handlers so {@link stop} can detach them. */
  private flightHideHandler: (() => void) | null = null;
  private flightVisibilityHandler: (() => void) | null = null;
  private animationFrameId = 0;
  private lastTime = 0;
  private modalObjects: (Graphics | Text)[] = [];
  private loadingOverlayObjects: (Graphics | Text)[] = [];
  /**
   * One-shot guard for the Overmind endgame outcome overlay
   * ({@link showGameOutcomeScreen}, win OR loss). Set by the overlay itself so
   * the sticky `won`/`lost` arc status re-running each EOD — and the in-flight
   * core-kill win path — only ever shows the outcome once.
   */
  private _outcomeShown = false;
  private _winScreenShown = false;
  /** One-shot guard so player death fires the game-over flow exactly once. */
  private _playerDeathShown = false;
  /**
   * Carry-over staged by {@link startNewGamePlus} for the next fresh game: the
   * new-game creation path in {@link transitionTo} consumes it (once) to seed the
   * fresh player's credits/rank/faction/difficulty. Null for a plain new game.
   */
  private pendingNewGamePlus: NewGamePlusCarry | null = null;
  /** Drops the active `credits` projection binding before re-binding a new player. */
  private bankProjectionUnsub: Unsubscribe | null = null;
  private readonly galaxyService: IGalaxyService;
  private readonly playerService: IPlayerService;
  private readonly sceneFactory: SceneFactory;
  private readonly npcSimulator = new NpcSimulator();
  private readonly galaxySimulator = new GalaxySimulator();
  private readonly tradeSystem = new TradeSystem();

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
      this.registerFlightHideAutosave();

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

    // Play background music track matching the new scene.
    this.playSceneTrack(sceneType);

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
   * lands (it is parked on a planet, not at a free-flight position). Drops BOTH
   * the live turn-end capture (`liveFlightShipPos`) AND the sticky persisted
   * position (`flightShipPos`): the latter is otherwise only ever overwritten
   * (never cleared) by `saveGame`, so without this a take-off autosave would
   * re-persist the stale pre-landing position and the next reload would teleport
   * the ship there. The ship re-establishes `flightShipPos` on its first
   * post-takeoff turn-end. (System exit clears `liveFlightShipPos` in
   * `performWarp`; the load-time systemId guard covers the cross-system case —
   * landing is the same-system case that guard cannot catch.)
   */
  forgetFlightPosition(): void {
    this.liveFlightShipPos = null;
    this.flightShipPos = null;
  }

  /**
   * Continuously capture the live in-flight ship position. Called every frame
   * from the flight scene so a later autosave (turn-end, periodic, or the
   * page-hide flush below) persists where the ship actually IS — not the stale
   * system-entry edge. Free flight is otherwise only persisted at discrete
   * turn-ends; between them (and during a combat orbit, which moves the ship with
   * no turn-end) nothing tracked the live position. `saveGame` folds
   * `liveFlightShipPos` into the system-tagged `flightShipPos` solely while
   * SPACE_FLIGHT is active, and the systemId tag guards the restore on load — so
   * a capture here can never leak into a non-flight or cross-system spawn.
   */
  recordLiveFlightPos(x: number, y: number): void {
    this.liveFlightShipPos = { x, y };
  }

  /**
   * Persist the live in-flight position on page-hide
   * (`visibilitychange`→hidden / `beforeunload`) so a reload mid-flight resumes
   * the live position instead of edge-spawning. No-op outside flight: a
   * landed/menu save must not be clobbered with a stale flight capture, and the
   * field is only valid while SPACE_FLIGHT is the active scene (saveGame's own
   * gate). Best-effort under `beforeunload` (the async write may not finish
   * before unload), but `visibilitychange`→hidden fires reliably on mobile/tab
   * backgrounding where the write does complete.
   */
  async flushFlightAutosave(): Promise<void> {
    if (this.currentSceneType !== SceneType.SPACE_FLIGHT) return;
    if (!this.galaxy || !this.player) return;
    await this.saveGame("auto");
  }

  /**
   * Register the one-time page-hide autosave listeners. Survives scene
   * transitions (registered once at engine init), guarded for non-browser
   * runtimes (bare Vitest constructs the engine without calling `initialize`).
   * Handlers are retained so {@link stop} can detach them.
   */
  private registerFlightHideAutosave(): void {
    if (typeof window === "undefined" || this.flightHideHandler) return;
    const flush = (): void => {
      void this.flushFlightAutosave().catch((e) =>
        logger.error("Flight hide autosave failed:", e),
      );
    };
    this.flightHideHandler = flush;
    window.addEventListener("beforeunload", this.flightHideHandler);
    if (typeof document !== "undefined") {
      this.flightVisibilityHandler = (): void => {
        if (document.visibilityState === "hidden") flush();
      };
      document.addEventListener(
        "visibilitychange",
        this.flightVisibilityHandler,
      );
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

    // Trade-route rumors (living-trade-economy): after today's drift settles,
    // re-scan the galaxy's neutral spreads and advance the rumor lifecycle so
    // TRADE_OPPORTUNITY rumors open/refresh/expire against current prices.
    // Ordering matters — drift → scan → rumor update — so rumors reflect the
    // prices that were just rolled. Skip galaxies with fewer than two
    // market-bearing systems: no cross-system route can exist there, so there is
    // nothing to scan (and the guard keeps degenerate maps from crashing).
    const marketSystemCount = this.galaxy.systems.filter((s) =>
      s.planets.some((p) => !!p.market),
    ).length;
    if (marketSystemCount >= 2) {
      updateRumors(
        this.galaxy,
        () =>
          scanTradeRoutes(
            this.galaxy!,
            (planet, resource) =>
              this.tradeSystem.referenceMarketPrice(planet, resource),
            // One route per ResourceType at most — keep them all visible so a
            // closing rumor stays in the re-score set until it truly expires.
            { maxRoutes: Object.values(ResourceType).length, minMarginPct: 0 },
          ),
        this.galaxy.gameDays,
        {
          marginOpen: GAME_BALANCE.rumorMarginOpen,
          marginExpire: GAME_BALANCE.rumorMarginExpire,
          maxActive: GAME_BALANCE.rumorMaxActive,
        },
      );
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
        // The endgame-arc spread (`advanceOvermindArc`, run every EOD) is the sole
        // authority on the Overmind front whenever the Overmind holds territory:
        // the equilibrium then only churns PIRATES. This stops the equilibrium's
        // ~25% feedback ceiling from (a) capping the arc below its loss line —
        // making the "galaxy consumed" defeat unreachable — and (b) liberating the
        // Overmind core, which would fire a spurious "core broken" victory.
        freezeOvermind: this.galaxy.overmindSystems.length > 0,
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

    // Overmind endgame-arc spread: the escalating front. Runs every EOD (the
    // equilibrium tick above is a 5-day churn floor; this is the deliberate,
    // monotone advance that grows unless the player pushes it back). Captures
    // feed `overmindSystems`, which the landing gate, NpcSimulator garrisons and
    // the star-map threat indicator all key off automatically. Idempotent per
    // business date via the machine's `lastSpreadDay` cadence.
    this.advanceOvermindArc();

    // Endgame outcome (Task 4): the arc status machine is the single source of
    // truth. `won` (core broken / Overmind eradicated) shows the victory screen;
    // `lost` (front past the loss line, past grace, full-size galaxy) shows the
    // defeat screen. The overlay is drawn over the current scene — NOT a terminal
    // scene transition — so it never clobbers the autosave checkpoint the way an
    // autosaving GAME_OVER scene would. Gated on `_outcomeShown` (and the overlay
    // is itself idempotent) so the sticky won/lost status re-running each EOD —
    // and the in-flight core-kill win path — only shows the screen once.
    if (!this._outcomeShown) {
      if (this.galaxy.overmindArc.status === "won") {
        logger.info("OVERMIND arc won — showing victory screen");
        this.showGameOutcomeScreen(true);
      } else if (this.galaxy.overmindArc.status === "lost") {
        logger.warn(
          "OVERMIND arc lost — galaxy consumed, showing defeat screen",
        );
        this.showGameOutcomeScreen(false);
      }
    }

    this.infoRegistryCache = null; // world advanced → registry is stale

    // Check for expired quests and apply failure penalties.
    this.checkExpiredQuests();

    // End-of-day banking batch (АБС): accrue interest on savings/loan accounts,
    // cut statements, and roll the bank's business date. Dispatched on the
    // universal bus so the core books balanced accrual entries and consumers
    // (the HUD, the Bank UI) react via events. Runs after today's fines so they
    // land on the day's statement; idempotent per business date.
    this.bankBus.dispatch({ kind: "RunEndOfDay" });

    // Win condition: rank >= VETERAN (2) + 3+ factions with rep > 50.
    if (this.checkWinCondition() && !this._winScreenShown) {
      this._winScreenShown = true;
      this.transitionTo(SceneType.WIN_SCREEN, { gameEngine: this }).catch((e) =>
        logger.error("Win screen transition failed:", e),
      );
    }
  }

  /**
   * Drive the Overmind endgame-arc spread machine one EOD tick.
   *
   * Pure decision (`advanceOvermind`) over a read-only galaxy view → newly
   * captured frontier ids + the next arc state. The captures are applied to the
   * live galaxy (`addOvermindSystem`, which the landing gate / garrisons / threat
   * indicator all derive from) and announced as OVERMIND_EXPANSION news; the arc
   * clock/threat/status snapshot is persisted on `galaxy.overmindArc`.
   *
   * Idempotent per business date: the machine's `lastSpreadDay` cadence blocks a
   * second capture on the same day, status re-derivation is a pure read, and
   * `peakThreat`/`dayZero` are monotone — so a re-run for the same day is a no-op.
   */
  private advanceOvermindArc(): void {
    if (!this.galaxy) return;
    const galaxy = this.galaxy;
    const day = galaxy.gameDays;

    const config: OvermindSpreadConfig = {
      graceDays: GAME_BALANCE.OVERMIND_SPREAD_GRACE_DAYS,
      spreadIntervalDays: GAME_BALANCE.OVERMIND_SPREAD_INTERVAL_DAYS,
      capturesPerTick: GAME_BALANCE.OVERMIND_SPREAD_CAPTURES_PER_TICK,
      lossShare: GAME_BALANCE.OVERMIND_SPREAD_LOSS_SHARE,
      containedShare: GAME_BALANCE.OVERMIND_SPREAD_CONTAINED_SHARE,
      minSystemsForLoss: GAME_BALANCE.OVERMIND_SPREAD_MIN_SYSTEMS,
    };

    const prevStatus = galaxy.overmindArc.status;
    // The real Galaxy/StarSystem structurally satisfy the spread machine's
    // minimal read-only view (id + connections + the overmind sets).
    const { state, captured } = advanceOvermind(
      galaxy.overmindArc,
      {
        id: galaxy.id,
        systems: galaxy.systems,
        overmindSystems: galaxy.overmindSystems,
        overmindCoreSystemId: galaxy.overmindCoreSystemId,
      },
      day,
      config,
    );

    for (const id of captured) {
      galaxy.addOvermindSystem(id);
      const sys = galaxy.systems.find((s) => s.id === id);
      galaxy.addNewsEvent({
        type: "OVERMIND_EXPANSION",
        systemId: id,
        day,
        description: `OVERMIND поглотил систему ${sys?.name ?? id}`,
      });
      logger.info(`OVERMIND arc captured: ${sys?.name ?? id} (${id})`);
    }

    galaxy.overmindArc = state;
    if (state.status !== prevStatus) {
      logger.info(`OVERMIND arc status: ${prevStatus} → ${state.status}`);
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
    // scene has set it. lastFlightShipPos is written right before a scene exit
    // (star map / inventory / combat) and consumed to null on the next flight
    // entry; liveFlightShipPos is the free-flight turn-end capture (only valid
    // while SPACE_FLIGHT is the active scene). Kept sticky — a later non-flight
    // autosave must not clear the last good position. The systemId guards the
    // restore on load. See loadGame.
    const livePos =
      this.lastFlightShipPos ??
      (this.currentSceneType === SceneType.SPACE_FLIGHT
        ? this.liveFlightShipPos
        : null);
    if (livePos && this.player.currentSystemId) {
      this.flightShipPos = {
        x: livePos.x,
        y: livePos.y,
        systemId: this.player.currentSystemId,
      };
    }

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
      this.flightShipPos ?? undefined,
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
    this._playerDeathShown = false;

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
    this.flightShipPos = save.flightShipPos ?? null;
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
   * on a win, a "Новая игра+" button that carries a subset of progress into a
   * tougher cycle). Called when the player destroys the OVERMIND core / the arc
   * status reaches `won` (win) or the arc reaches `lost` (OVERMIND consumes the
   * galaxy).
   *
   * Idempotent: the first call sets {@link _outcomeShown} and subsequent calls
   * no-op, so the sticky `won`/`lost` arc status re-running each EOD — and the
   * in-flight core-kill win path firing alongside the next EOD — only ever shows
   * the screen once. The overlay is drawn over the current scene (no terminal
   * scene transition), so it never triggers the autosave-clobber an autosaving
   * GAME_OVER scene would.
   */
  showGameOutcomeScreen(win: boolean): void {
    if (this._outcomeShown) return;
    this._outcomeShown = true;
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

    // A small helper to build a clickable text button (the outcome overlay's
    // only interactive elements).
    const makeButton = (
      label: string,
      y: number,
      color: number,
      onClick: () => void,
    ): void => {
      const btn = new Text({
        text: label,
        style: {
          fontFamily: "Courier New",
          fontSize: 22,
          fill: color,
          fontWeight: "bold",
        },
      });
      btn.anchor.set(0.5);
      btn.x = width / 2;
      btn.y = y;
      btn.eventMode = "static";
      btn.cursor = "pointer";
      btn.on("pointerdown", onClick);
      btn.on("pointerover", () => {
        btn.alpha = 0.7;
      });
      btn.on("pointerout", () => {
        btn.alpha = 1;
      });
      this.renderer!.uiLayer.addChild(btn);
      this.modalObjects.push(btn);
    };

    // «Начать заново» — a full reset (new galaxy, fresh captain) back to the menu.
    const restart = (): void => {
      this.clearModal();
      this.generateDefaultGameState()
        .then(() =>
          this.transitionTo(SceneType.MAIN_MENU, { gameEngine: this }),
        )
        .catch((e) => logger.error("Transition after game outcome failed:", e));
    };

    if (win) {
      // On a victory, offer New Game+ (carry a subset of progress into a tougher
      // cycle) above the plain restart.
      makeButton("Новая игра+", height / 2 + 70, 0x66ddff, () => {
        this.clearModal();
        this.startNewGamePlus().catch((e) =>
          logger.error("New Game+ start failed:", e),
        );
      });
      makeButton("Начать заново", height / 2 + 120, 0x00ff88, restart);
    } else {
      makeButton("Начать заново", height / 2 + 90, 0x00ff88, restart);
    }
  }

  /**
   * Start a New Game+ from the victory screen: a fresh galaxy on a tougher cycle
   * that carries a *chosen subset* of the won captain's progress (a capped slice
   * of credits, their rank + faction, and a one-notch-harder difficulty —
   * {@link newGamePlusCarry}). The carry is captured BEFORE the reset and staged
   * on {@link pendingNewGamePlus}; the new-game creation path in
   * {@link transitionTo} consumes it once when the fresh player is built.
   *
   * No new persisted field: the carry maps onto values the new-game path already
   * seeds (startingMoney/rank/faction/gameMode), so NG+ needs no schema/migration.
   */
  async startNewGamePlus(): Promise<void> {
    const carry = this.player
      ? newGamePlusCarry(
          {
            credits: this.player.credits,
            rank: this.player.rank,
            faction: this.player.faction,
            gameMode: this.player.gameMode,
          },
          {
            creditCarryFraction:
              GAME_BALANCE.NEW_GAME_PLUS_CREDIT_CARRY_FRACTION,
            creditCarryCap: GAME_BALANCE.NEW_GAME_PLUS_CREDIT_CARRY_CAP,
          },
        )
      : null;
    await this.generateDefaultGameState();
    // Stage AFTER the reset (generateDefaultGameState nulls the player) so the
    // fresh new-game build picks it up.
    this.pendingNewGamePlus = carry;
    await this.transitionTo(SceneType.SPACE_FLIGHT, { gameEngine: this });
  }

  /**
   * Player ship destroyed in flight combat → game over. Fires the death flow
   * exactly once (one-shot `_playerDeathShown` guard): a stray later
   * shot the same frame is a no-op. Crucially this does NOT touch the `"auto"`
   * takeoff autosave — that save is the checkpoint the GAME_OVER screen rolls
   * back to, so death must be non-destructive to it.
   *
   * Production drives the terminal {@link SceneType.GAME_OVER} transition here.
   * The transition is renderer-guarded so the headless death-detection tests
   * (no renderer) still exercise the idempotent guard + {@link playerDeathCallback}
   * seam without `transitionTo` throwing.
   */
  triggerPlayerDeath(): void {
    if (this._playerDeathShown) return;
    this._playerDeathShown = true;
    logger.warn("Player ship destroyed — triggering game over");
    this.playerDeathCallback?.();
    if (this.renderer) {
      this.transitionTo(SceneType.GAME_OVER, { gameEngine: this }).catch((e) =>
        logger.error("Game-over transition failed:", e),
      );
    }
  }

  /**
   * «Начать заново» from the GAME_OVER screen: start a completely fresh game.
   * Mirrors the new-game modal path — it MUST reset game state
   * (`generateDefaultGameState`: null the player, regenerate the galaxy, clear the
   * win/death guards) BEFORE entering race selection. Without the reset the dead
   * player survives, so the SPACE_FLIGHT new-game guard (`!this.player`, see
   * {@link transitionTo}) never fires and race-selection would drop the player back
   * into the old galaxy with the destroyed ship instead of a fresh start.
   */
  async restartNewGame(): Promise<void> {
    await this.generateDefaultGameState();
    await this.transitionTo(SceneType.RACE_SELECTION, { gameEngine: this });
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

  private async generateDefaultGameState(): Promise<void> {
    this.player = null;
    this.playerLoadout = null;
    this._outcomeShown = false;
    this._winScreenShown = false;
    this._playerDeathShown = false;
    this.playerService.deletePlayer();
    // Full reset for a fresh game: clear quests, the banking ledger and the
    // persisted/transient flight position so «Новая игра» never inherits the
    // prior in-session game's quests, credits or ship location (playtest
    // 2026-06-23). The new player's account is re-seeded when it's created.
    this.questManager.restoreState([], []);
    this.bankingService.resetLedger();
    this.flightShipPos = null;
    this.lastFlightShipPos = null;
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
    if (this.flightHideHandler && typeof window !== "undefined") {
      window.removeEventListener("beforeunload", this.flightHideHandler);
    }
    if (this.flightVisibilityHandler && typeof document !== "undefined") {
      document.removeEventListener(
        "visibilitychange",
        this.flightVisibilityHandler,
      );
    }
    this.flightHideHandler = null;
    this.flightVisibilityHandler = null;
    this.currentScene?.destroy();
    this.renderer?.destroy();
    this.audio.destroy();
  }
}
