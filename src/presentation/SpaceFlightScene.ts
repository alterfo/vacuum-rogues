import { GameScene } from "./GameScene";
import { Container, FederatedPointerEvent } from "pixi.js";
import type { GameEngine } from "@/systems/GameEngine";
import { SceneType } from "@/types";
import { installGameCursors, setCanvasCursor } from "./cursor";
import type { Planet } from "@/domain/Planet";
import type { Station } from "@/domain/Station";
import { logger } from "@/utils/logger";
import { t } from "@/i18n/i18n";
import {
  clampOutsideRadius,
  computeFlightPath,
  planWarpEdgeRoute,
  type Point,
} from "@/utils/flightGeometry";
import { ShipPhysics } from "@/systems/ShipPhysics";
import { PanZoomController } from "@/systems/PanZoomController";
import { SYSTEM_GEOMETRY, GAME_BALANCE } from "@/config/balance";
import { landingDenialMessage } from "@/systems/galaxy/landingAccess";
import { SpaceBackgroundLayer } from "./SpaceBackgroundLayer";
import { StarRenderer } from "./flight/StarRenderer";
import { AsteroidBelt } from "./flight/AsteroidBelt";
import { OrbitRenderer } from "./flight/OrbitRenderer";
import { RouteRenderer } from "./flight/RouteRenderer";
import { PlayerShipRenderer } from "./flight/PlayerShipRenderer";
import { NpcShipManager } from "./flight/NpcShipManager";
import { buildNpcManagerDeps } from "./flight/npcManagerDeps";
import { CombatModule } from "./flight/CombatModule";
import { buildCombatModuleDeps } from "./flight/combatModuleDeps";
import { createCombatPauseUi } from "./flight/combatPauseUi";
import { CombatPlanningUi, createCombatPlanningController } from "./flight/combatPlanningUi"; // prettier-ignore
import { routePlanningClick } from "./flight/combatCoursePreview";
import { createCombatExecution, type CombatExecutionController } from "./flight/combatExecution"; // prettier-ignore
import { buildCombatExecutionDeps } from "./flight/combatExecutionDeps";
import { plotPlannedRoute, navigateToQuestTarget } from "./flight/routePlot";
import { updateFlightMiniMap } from "./flight/miniMapUpdate";
import { orbitBump } from "./flight/combatOrbitClock";
import {
  autoConfirmCombatTurn,
  combatRouteClickAllowed,
} from "./flight/combatAutoPlan";
import { CombatAutoToggle } from "./flight/combatAutoToggle";
import { isAutoCombatEnabled } from "@/systems/settings/gameSettings";
import { PlanetManager } from "./flight/PlanetManager";
import { FlightHud } from "./flight/FlightHud";
import { CameraController } from "./flight/CameraController";
import { FlightTouchController } from "./flight/flightTouchControls";
import { isTouchLayoutActive } from "./ui/responsiveLayout";
import { WarpEffectRenderer } from "./flight/WarpEffectRenderer";
import { QuestCompletion } from "./flight/QuestCompletion";
import { arrivalHeadingFromExitVector, departureVectorFromExitPoint } from "./flight/warpHeading"; // prettier-ignore
import { handleFlightKey } from "./flight/flightKeyHandler";
import { wireFlightSystemMenu } from "./flight/flightSystemMenu";
import { mountFlightSceneHelp, type FlightSceneHelp } from "./flight/flightSceneHelp"; // prettier-ignore
import { disposeFiltersDeep } from "./flight/disposeFilters";
import {
  endFlightTurn,
  handleFlightPlayPause,
  recordAndMaybeAutosaveFlight,
  type FlightAutosaveState,
} from "./flight/flightTurnEnd";
import { E2ETestHooks } from "./flight/e2eTestHooks";
import {
  applyEntrySpawn as computeEntrySpawn,
  applyReentrySpawn as computeReentrySpawn,
  spawnShipBeside as computeSpawnShipBeside,
  type EntrySpawnDeps,
} from "./flight/flightEntrySpawn";
import { hashToAngle, planetOrbitPosition } from "@/utils/flightGeometry";

const DOMAIN_FALLBACK_PLANET_RADIUS = 90;

type LandingHint = { planetX: number; planetY: number; planetRadius: number };

export class SpaceFlightScene extends GameScene {
  private gameEngine: GameEngine | null = null;
  private playerShip!: PlayerShipRenderer;
  private skyContainer: Container | null = null;
  private asteroidBelt!: AsteroidBelt;
  private background: SpaceBackgroundLayer | null = null;
  private warpFx!: WarpEffectRenderer;
  private questCompletion!: QuestCompletion;
  private bgElapsed = 0; // Animation clock for background (ms)
  private shipPhysics: ShipPhysics | null = null;
  private hud!: FlightHud;

  private planetManager!: PlanetManager;
  private starRenderer!: StarRenderer;
  private orbitRenderer!: OrbitRenderer;

  private npcManager!: NpcShipManager;
  private combatModule!: CombatModule;
  private combatPause = createCombatPauseUi(); // active-pause; rewired in initialize()
  private combatPlanningUi: CombatPlanningUi | null = null;
  private combatExecution: CombatExecutionController | null = null;
  private combatPlanning = createCombatPlanningController({
    getShipPhysics: () => this.shipPhysics,
    getUi: () => this.combatPlanningUi,
    showMessage: (text, color) => this.hud.showMessage(text, color),
    onConfirmPlan: (plan) => this.combatExecution?.beginWindow(plan),
    breakOffPursuit: () => this.npcManager?.breakOffCombatPursuit(),
    isAutoCombat: () => isAutoCombatEnabled(),
    onFightEnd: () => {
      this.combatExecution?.endFight(); // wrecks/flashes keep drifting past the end
      if (this.destroyed) return; // mid-teardown — clearPlannedRoute() handles it
      if (this.plannedRoute) this.plotRoute();
      else this.routeRenderer.clearRoute(); // restored the pre-combat course line above, else drop the last combat course preview
    },
  });
  private autoCombatToggle = new CombatAutoToggle({
    getUiLayer: () => this.renderer.uiLayer,
    getScreenSize: () => ({
      width: this.renderer.app.screen.width,
      height: this.renderer.app.screen.height,
    }),
  });
  private lowHullStopped = false;
  private destroyed = false;

  private flightHelp: FlightSceneHelp | null = null; // see flight/flightSceneHelp.ts

  private isTurnRunning = false;
  private pauseAtDayBoundary = false;
  private turnHintShown = false;
  private pursuitReplot = false;
  private readonly SYSTEM_INNER_RADIUS = SYSTEM_GEOMETRY.innerRadius;
  private readonly SYSTEM_BOUNDARY_RADIUS = SYSTEM_GEOMETRY.boundaryRadius;
  private readonly SCANNER_RANGE = GAME_BALANCE.scannerRange;

  private sceneReadyAt = 0;
  private readonly INPUT_GRACE_MS = 350;

  private distanceTraveled: number = 0;
  private flightAutosave: FlightAutosaveState = { accumMs: 0, lastPos: null };
  private readonly DISTANCE_PER_DAY: number = GAME_BALANCE.pixelsPerDay;
  private waitDayAccum: number = 0;
  private readonly MS_PER_WAIT_DAY: number = 1000; // день = секунда (US-070); must equal MS_PER_ORBITAL_DAY
  private visualOrbitBoost: number = 0; // orbit-visual day top-up while moving (additive, NOT a floor) — flight/CLAUDE.md
  private orbitDayCarry: number = 0;
  private orbitTopUp = (dt: number): number =>
    orbitBump(this.combatPause.paused, dt, this.shipPhysics?.timeScale ?? 1);
  private get orbitalVisualDay(): number {
    return this.currentDay + this.orbitDayCarry + this.visualOrbitBoost;
  }
  private get currentDay(): number {
    const days = this.gameEngine?.galaxy?.gameDays ?? 0;
    const frac = this.distanceTraveled / this.DISTANCE_PER_DAY;
    return days + frac + this.waitDayAccum;
  }
  private plannedRoute: { x: number; y: number; landing?: LandingHint } | null =
    null;
  private routePath: { x: number; y: number }[] = [];
  private routeRenderer!: RouteRenderer;

  private pendingWarp: {
    targetSystemId: string;
    fuelCost: number;
    exitVector: { x: number; y: number };
  } | null = null;
  private pendingWarpExitPoint: { x: number; y: number } | null = null;
  private warpInProgress = false;

  private boundPointerDown: ((event: FederatedPointerEvent) => void) | null =
    null;
  private boundPointerMove: ((event: FederatedPointerEvent) => void) | null =
    null;
  private boundPointerUp: (() => void) | null = null;
  private boundPointerLeave: (() => void) | null = null;
  private boundKeyDown: ((event: KeyboardEvent) => void) | null = null;

  private camera!: CameraController;
  private readonly panZoom = new PanZoomController();
  private touchControls!: FlightTouchController; // touch pinch-zoom seam (mobile Task 3)
  private boundWheel: ((event: WheelEvent) => void) | null = null;
  private boundCanvasMouseDown: ((event: MouseEvent) => void) | null = null;
  private boundResize: (() => void) | null = null;
  private boundContextMenu: ((e: Event) => void) | null = null;

  private readonly e2eHooks = new E2ETestHooks({
    returnToStarMap: () => this.returnToStarMap(),
    onPlayPause: () => this.onPlayPause(),
    getIsTurnRunning: () => this.isTurnRunning,
    getShipPhysics: () => this.shipPhysics,
    getCamera: () => this.camera,
    getHud: () => this.hud,
    getPlanetManager: () => this.planetManager,
    getNpcManager: () => this.npcManager,
    getGameEngine: () => this.gameEngine,
    getGameLayer: () => this.renderer.gameLayer,
    getSkyContainer: () => this.skyContainer,
    getBackground: () => this.background,
  });

  initialize(context?: object): void {
    const ctx = context as
      | {
          gameEngine?: GameEngine;
          entryVector?: { x: number; y: number };
          arrivalHeading?: number; // radians — continues the departure heading
          pendingWarp?: {
            targetSystemId: string;
            fuelCost: number;
            exitVector: { x: number; y: number };
          };
          warpArrival?: boolean;
          fromPlanetId?: string;
          fromStationId?: string;
          preserveShipPos?: { x: number; y: number };
          pendingNavigateLocationId?: string;
        }
      | undefined;
    this.gameEngine = ctx?.gameEngine ?? null;
    this.pendingWarp = ctx?.pendingWarp ?? null;
    this.questCompletion = new QuestCompletion(this.gameEngine);
    this.hud = new FlightHud(
      this.renderer,
      this.gameEngine,
      this.renderer.uiLayer,
    );
    this.hud.setDayProvider(() => this.currentDay); // date read-out shows sub-day turn progress
    this.hud.onPlayPause = () => this.onPlayPause();
    this.hud.onSpeedCycle = (scale) => this.shipPhysics?.setTimeScale(scale);
    this.hud.onStarMap = () => void this.returnToStarMap();
    this.hud.onQuestNavigate = (id) => this.navigateToQuestObjective(id);
    this.hud.onMiniMapPan = (x, y) => this.camera.focusOnWorld(x, y);
    this.hud.onMiniMapReturn = () => this.camera.startReturn();
    this.hud.onFontScaleChange = () => this.onFontScaleChanged();
    this.hud.onPaletteChange = () => this.npcManager?.refreshFactionColors();
    this.hud.onInventory = () => void this.openInventory();
    this.hud.onCancel = () =>
      this.onKeyDown({ key: "Escape" } as KeyboardEvent);
    wireFlightSystemMenu(this.hud, this.gameEngine); // in-flight load/main-menu escape hatch (Task 2)

    this.combatModule = new CombatModule(
      buildCombatModuleDeps({
        getShipPhysics: () => this.shipPhysics,
        isPlanning: () => this.combatPlanning.isPlanning,
        isExecutingPlan: () => this.combatPlanning.isExecuting,
        getPlannedTarget: (w) =>
          this.combatPlanning.plan.weaponTargets.get(w) ?? null,
        getExecution: () => this.combatExecution,
        endCombatPlanning: () => this.combatPlanning.endCombat(),
        isCombatPauseActive: () => this.combatPause.paused,
        isTurnRunning: () => this.isTurnRunning,
        isDestroyed: () => this.destroyed,
        renderer: this.renderer,
        gameEngine: this.gameEngine,
        getNpcManager: () => this.npcManager,
        questCompletion: this.questCompletion,
        hud: this.hud,
        endTurn: () => this.endTurn(),
      }),
    );
    this.combatPause = createCombatPauseUi(
      this.renderer,
      this.combatModule,
      () => this.shipPhysics?.stop(),
    );
    this.gameEngine?.setCombatStateProvider(() => this.combatModule.isActive); // adaptive combat music signal
    this.combatPlanningUi = new CombatPlanningUi({
      getUiLayer: () => this.renderer.uiLayer,
      getGameLayer: () => this.renderer.gameLayer,
      getScreenSize: () => this.renderer.app.screen,
      getShipPos: () =>
        this.shipPhysics
          ? { x: this.shipPhysics.shipX, y: this.shipPhysics.shipY }
          : null,
      getFittedWeapons: () => this.combatModule.fittedWeapons(),
      isCombatant: (s) => this.combatModule.combatants.has(s),
      planning: this.combatPlanning,
      showMessage: (text, color) => this.hud.showMessage(text, color),
      actions: {
        getOwnedConsumableIds: () =>
          this.gameEngine?.player?.inventory.ownedConsumableIds ?? [],
        canAfterburn: () => this.combatExecution?.canAfterburn() ?? true,
      },
    });
    this.npcManager = new NpcShipManager(
      this.renderer,
      this.gameEngine,
      this.renderer.gameLayer,
      this.renderer.uiLayer,
      buildNpcManagerDeps({
        getShipPhysics: () => this.shipPhysics,
        getPlanetSprites: () => this.planetManager.planetSprites,
        getStarCenter: () => ({
          x: this.starRenderer.centerX,
          y: this.starRenderer.centerY,
        }),
        getStarAvoidRadius: () => this.starRenderer.avoidRadius,
        isTurnRunning: () => this.isTurnRunning,
        setTurnRunning: (v) => {
          this.isTurnRunning = v;
        },
        isCombatPauseActive: () => this.combatPause.paused,
        isPlanning: () => this.combatPlanning.isPlanning,
        updateInteractiveCursors: (v) => this.updateInteractiveCursors(v),
        showMessage: (text, color) => this.hud.showMessage(text, color),
        showTooltip: (text, sx, sy) => this.hud.showTooltip(text, sx, sy),
        hideTooltip: () => this.hud.hideTooltip(),
        executeRouteTo: (x, y) => this.executeRouteTo(x, y),
        setPursuitReplot: (v) => {
          this.pursuitReplot = v;
        },
        clearRouteTargetPlanet: () => {
          this.planetManager.routeTargetPlanetId = null;
        },
        endTurn: () => this.endTurn(),
        addCombatant: (s) => this.combatModule.addCombatant(s),
        beginCombatPlanning: () => void this.combatPlanning.beginCombat(),
        isCombatActive: () => this.combatModule.isActive,
        selectCombatTarget: (s) => this.combatModule.selectTarget(s),
        handlePlanningTargetClick: (s) =>
          this.combatPlanningUi?.handleTargetClick(s) ?? false,
        deferDeathLoot: (npc) =>
          this.combatExecution?.consumeLootDeferral(npc) ?? false,
        getSelectedCombatTargetId: () =>
          this.combatModule.selectedTarget?.npc.id ?? null,
        isCombatant: (sprite) => this.combatModule.combatants.has(sprite),
        sessionState: this.gameEngine?.sessionState,
      }),
    );
    this.combatExecution = createCombatExecution(
      buildCombatExecutionDeps({
        getShipPhysics: () => this.shipPhysics,
        getGameLayer: () => this.renderer.gameLayer,
        getPlanetSprites: () => this.planetManager.planetSprites,
        getPlayerVisual: () => this.playerShip.container,
        getEngine: () => this.gameEngine,
        getCombatModule: () => this.combatModule,
        getNpcManager: () => this.npcManager,
        isExecutingPlan: () => this.combatPlanning.isExecuting,
        showMessage: (text, color) => this.hud.showMessage(text, color),
      }),
    );
    this.questCompletion.explorationBySystemEntry();
    this.questCompletion.defenseBySystemEntry();
    this.questCompletion.escortBySystemEntry();

    if (this.gameEngine?.galaxy && this.gameEngine.player) {
      const _galaxy = this.gameEngine.galaxy;
      const _sys = _galaxy.systems.find(
        (s) => s.id === this.gameEngine!.player!.currentSystemId,
      );
      if (_sys) _sys.lastVisitedDay = _galaxy.gameDays;
      this.gameEngine.player.markVisited(
        this.gameEngine.player.currentSystemId,
      );
    }

    if (this.gameEngine?.galaxy && this.gameEngine.player) {
      const coreId = this.gameEngine.galaxy.overmindCoreSystemId;
      if (
        coreId &&
        this.gameEngine.player.currentSystemId === coreId &&
        this.gameEngine.galaxy.isOvermindSystem(coreId)
      ) {
        this.npcManager.showOvermindCorePrompt();
      }
    }

    const centerX = this.renderer.app.screen.width / 2;
    const centerY = this.renderer.app.screen.height / 2;

    const lastPos = this.gameEngine?.lastFlightShipPos ?? null;
    const wasFleeing = this.gameEngine?.lastFlightWasFleeing ?? false;
    if (this.gameEngine) this.gameEngine.lastFlightShipPos = null; // consume
    if (this.gameEngine) this.gameEngine.lastFlightWasFleeing = false; // consume
    const entryVector = ctx?.entryVector ?? { x: 0, y: 1 };
    const entryX = this.pendingWarp
      ? (lastPos?.x ??
        centerX - this.pendingWarp.exitVector.x * this.SYSTEM_INNER_RADIUS)
      : (lastPos?.x ?? centerX + entryVector.x * this.SYSTEM_BOUNDARY_RADIUS);
    const entryY = this.pendingWarp
      ? (lastPos?.y ??
        centerY - this.pendingWarp.exitVector.y * this.SYSTEM_INNER_RADIUS)
      : (lastPos?.y ?? centerY + entryVector.y * this.SYSTEM_BOUNDARY_RADIUS);
    const loadoutStats = this.gameEngine?.playerLoadout?.derivedStats();
    const ship = this.gameEngine?.player?.ship;
    const cruise = loadoutStats
      ? loadoutStats.speed
      : (this.DISTANCE_PER_DAY / 1000) *
        Math.min(1.4, Math.max(0.8, ship?.speed ?? 1));
    this.shipPhysics = new ShipPhysics(entryX, entryY, cruise || 0.1, ctx?.arrivalHeading ?? 0); // prettier-ignore

    this.renderer.clearGameLayer();
    this.renderer.clearUILayer();

    this.renderer.gameLayer.sortableChildren = true;

    this.starRenderer = new StarRenderer(
      this.renderer,
      this.gameEngine,
      this.renderer.gameLayer,
    );

    this.asteroidBelt = new AsteroidBelt(
      this.renderer,
      this.renderer.gameLayer,
    );

    this.orbitRenderer = new OrbitRenderer(
      this.renderer,
      this.renderer.gameLayer,
      this.gameEngine?.galaxy ?? null,
      this.gameEngine?.player?.currentSystemId ?? "default",
    );

    this.routeRenderer = new RouteRenderer(this.renderer.gameLayer);

    this.planetManager = new PlanetManager(
      this.renderer,
      this.gameEngine,
      this.renderer.gameLayer,
      this.renderer.uiLayer,
      {
        getShipPhysics: () => this.shipPhysics,
        getStarCenter: () => ({
          x: this.starRenderer.centerX,
          y: this.starRenderer.centerY,
        }),
        isTurnRunning: () => this.isTurnRunning,
        getOrbitalDay: () => this.orbitalVisualDay,
        showPlanetTooltip: (planet, faction, sx, sy, landingDenial) =>
          this.hud.showPlanetTooltip(planet, faction, sx, sy, landingDenial),
        hideTooltip: () => this.hud.hideTooltip(),
        clearFollow: () => {
          if (this.npcManager) this.npcManager.followNpcId = null;
        },
      },
    );
    this.planetManager.onPlanetRouteRequested = (planetId, x, y) =>
      this.handlePlanetRouteRequested(planetId, x, y);
    this.planetManager.onPlanetLanding = (planetId) =>
      this.handlePlanetLanding(planetId);
    this.planetManager.onStationDock = (stationId) =>
      this.handleStationDock(stationId);

    this.playerShip = new PlayerShipRenderer(
      this.renderer,
      this.renderer.gameLayer,
      this.shipPhysics,
      this.gameEngine?.player?.ship.hullClass ?? "",
    );

    this.camera = new CameraController(this.renderer, {
      getShipPhysics: () => this.shipPhysics,
      getStarCenter: () => ({
        x: this.starRenderer.centerX,
        y: this.starRenderer.centerY,
      }),
      boundaryRadius: this.SYSTEM_BOUNDARY_RADIUS,
      isInCombat: () => this.combatModule?.isActive ?? false,
    });
    this.camera.onTransform = (zoom) => {
      this.npcManager?.updateHitAreas(zoom);
    };

    this.touchControls = new FlightTouchController(
      this.camera,
      isTouchLayoutActive, // touch pinch → camera zoom (mobile Task 3); inert off-touch
    );

    this.warpFx = new WarpEffectRenderer(this.renderer.gameLayer);

    this.skyContainer = new Container();
    this.skyContainer.eventMode = "none";
    this.renderer.stage.addChildAt(this.skyContainer, 0);

    this.background = new SpaceBackgroundLayer(
      this.renderer,
      this.skyContainer,
      this.gameEngine?.player?.currentSystemId ?? "default",
      () => ({
        panX: this.camera.panX,
        panY: this.camera.panY,
        zoom: this.camera.zoom,
      }),
      () =>
        this.shipPhysics
          ? {
              angle: this.shipPhysics.shipAngle,
              speed: this.shipPhysics.currentSpeed,
            }
          : null,
    );
    this.background.initialize();

    this.starRenderer.initialize();
    this.orbitRenderer.initialize(); // Orbit circles + boundary (hyperjump edge)
    this.planetManager.initialize(); // Planets + station markers (US-066)
    this.npcManager.initialize(!!ctx?.preserveShipPos); // NPC ships present in this system (Feature 8)
    this.combatModule.initialize(); // In-flight combat lifecycle (Tasks 11–14)
    this.playerShip.initialize(); // Ship hull/sprite, glow, heading crosshair
    this.asteroidBelt.initialize(); // Foreground asteroids/comets (US-070 #1)
    this.hud.initialize(); // Turn/speed buttons, day counter, mini-map, mini-log

    this.applyEntrySpawn(ctx);

    this.camera.centerOnShip();

    if (this.pendingWarp) {
      const { edge, routePath } = planWarpEdgeRoute(
        { x: this.shipPhysics.shipX, y: this.shipPhysics.shipY },
        { x: centerX, y: centerY },
        this.pendingWarp.exitVector,
        this.SYSTEM_BOUNDARY_RADIUS,
        wasFleeing,
        { x: this.starRenderer.centerX, y: this.starRenderer.centerY },
        this.starRenderer.avoidRadius,
      );
      this.routePath = routePath;
      this.plannedRoute = { x: edge.x, y: edge.y };
      this.pendingWarpExitPoint = { x: edge.x, y: edge.y };
      this.plotRoute();
    }

    if (ctx?.warpArrival && !this.pendingWarp) {
      this.warpFx.play(this.shipPhysics.shipX, this.shipPhysics.shipY);
    }

    this.hud.miniMap?.updateSystemName(
      this.gameEngine?.galaxy?.systems.find(
        (s) => s.id === this.gameEngine?.player?.currentSystemId,
      )?.name,
    );
    this.boundPointerDown = this.onPointerDown.bind(this);
    this.boundPointerMove = this.onPointerMove.bind(this);
    this.boundPointerUp = this.onPointerUp.bind(this);
    this.boundPointerLeave = () => this.panZoom.reset();

    this.renderer.app.stage.eventMode = "static";
    this.renderer.app.stage.hitArea = this.renderer.app.screen;
    this.renderer.app.stage.on("pointerdown", this.boundPointerDown);
    this.renderer.app.stage.on("pointermove", this.boundPointerMove);
    this.renderer.app.stage.on("pointerup", this.boundPointerUp);
    this.renderer.app.stage.on("pointerupoutside", this.boundPointerUp);
    this.renderer.app.canvas.addEventListener(
      "pointerleave",
      this.boundPointerLeave,
    );

    this.boundKeyDown = this.onKeyDown.bind(this);
    window.addEventListener("keydown", this.boundKeyDown);
    this.boundWheel = this.onWheel.bind(this); // capture: true — see onWheel()'s comment
    window.addEventListener("wheel", this.boundWheel, {
      passive: false,
      capture: true,
    });

    this.boundResize = this.handleResize.bind(this);
    window.addEventListener("resize", this.boundResize);

    this.boundContextMenu = (e: Event) => e.preventDefault();
    this.renderer.app.canvas.addEventListener(
      "contextmenu",
      this.boundContextMenu,
    );

    this.boundCanvasMouseDown = (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault();
    };
    this.renderer.app.canvas.addEventListener(
      "mousedown",
      this.boundCanvasMouseDown,
    );

    installGameCursors(this.renderer.app);

    this.sceneReadyAt = performance.now();

    if (
      __DEBUG__ &&
      typeof window !== "undefined" &&
      (window as unknown as Record<string, unknown>).__hideFlightBackground
    ) {
      this.e2eSetBackgroundVisible(false);
    }
    this.flightHelp = mountFlightSceneHelp(this.renderer);

    if (ctx?.pendingNavigateLocationId) {
      this.navigateToQuestObjective(ctx.pendingNavigateLocationId);
    }

    logger.info(
      "SpaceFlightScene initialized with camera controls: pan (Shift+click), zoom (wheel)",
    );
  }

  update(deltaTime: number): void {
    this.bgElapsed += deltaTime;
    this.background?.update(deltaTime, this.bgElapsed);
    this.asteroidBelt.update(deltaTime, this.bgElapsed);
    this.starRenderer.update(deltaTime, this.bgElapsed);
    this.warpFx.update(deltaTime);
    this.updateShip(deltaTime);
    this.combatPlanning.tickExecute(deltaTime); // no-op outside EXECUTING (14.5a)
    this.maybeAutoConfirmCombat();
    const frozen = this.combatPause.paused || this.combatPlanning.isPlanning;
    if (!frozen) this.playerShip.update(deltaTime, this.bgElapsed);
    if (!frozen) this.npcManager.updateCombat(deltaTime);
    this.combatModule.update(deltaTime, this.bgElapsed);
    if (!frozen && !this.destroyed) this.combatExecution?.update(deltaTime);
    else if (this.combatPlanning.isPlanning && !this.destroyed)
      this.combatExecution?.drawPlanningStatusBars();
    if (this.destroyed) return;
    this.flightHelp?.maybeShowCombatHint(this.combatModule.isActive); // 1st-fight hint
    if (this.gameEngine && this.shipPhysics && !this.warpInProgress)
      recordAndMaybeAutosaveFlight(
        this.gameEngine,
        this.shipPhysics,
        this.flightAutosave,
        deltaTime,
      );
    if (!frozen) this.camera.update(deltaTime);
    this.npcManager.update(deltaTime, this.bgElapsed);
    this.planetManager.update(deltaTime, this.bgElapsed);
    this.updateSystemMiniMap();
    const paused = this.combatPause.paused || this.combatPlanning.isPlanning; // 2026-07-18
    this.hud.setTurnRunning(this.isTurnRunning && !paused);
    this.hud.update(deltaTime, this.bgElapsed);
  }

  persistLiveState(): void {
    this.npcManager?.persistLivePositions();
  }
  destroy(): void {
    this.destroyed = true;
    this.flightHelp?.destroy(); // contextual help (first-time hint + «?» + combat hint)
    this.flightHelp = null;
    if (this.boundPointerDown) {
      this.renderer.app.stage.off("pointerdown", this.boundPointerDown);
      this.boundPointerDown = null;
    }
    if (this.boundPointerMove) {
      this.renderer.app.stage.off("pointermove", this.boundPointerMove);
      this.boundPointerMove = null;
    }
    if (this.boundPointerUp) {
      this.renderer.app.stage.off("pointerup", this.boundPointerUp);
      this.renderer.app.stage.off("pointerupoutside", this.boundPointerUp);
      this.boundPointerUp = null;
    }
    if (this.boundPointerLeave) {
      this.renderer.app.canvas.removeEventListener(
        "pointerleave",
        this.boundPointerLeave,
      );
      this.boundPointerLeave = null;
    }

    if (this.boundKeyDown) {
      window.removeEventListener("keydown", this.boundKeyDown);
      this.boundKeyDown = null;
    }

    if (this.boundWheel) {
      window.removeEventListener("wheel", this.boundWheel, { capture: true });
      this.boundWheel = null;
    }

    if (this.boundContextMenu) {
      this.renderer.app.canvas.removeEventListener(
        "contextmenu",
        this.boundContextMenu,
      );
      this.boundContextMenu = null;
    }

    if (this.boundCanvasMouseDown) {
      this.renderer.app.canvas.removeEventListener(
        "mousedown",
        this.boundCanvasMouseDown,
      );
      this.boundCanvasMouseDown = null;
    }

    if (this.boundResize) {
      window.removeEventListener("resize", this.boundResize);
      this.boundResize = null;
    }
    this.isTurnRunning = false;
    this.turnHintShown = false;
    this.lowHullStopped = false;
    this.warpInProgress = false;
    this.waitDayAccum = 0;

    this.warpFx?.destroy();

    this.hud?.destroy();

    this.planetManager?.destroy();

    this.npcManager?.destroy();
    this.combatModule?.destroy(); // Clear in-flight combat target + active flag.
    this.combatExecution?.destroy(); // Execute-window entities + overlays (14.5c).
    this.combatPlanningUi?.destroy(); // Planning bar + range rings (14.5b).
    this.autoCombatToggle.destroy();
    this.combatPlanning.endCombat(); // Reset the pause-and-plan loop too (Task 14.5a).

    this.starRenderer?.destroy();
    this.asteroidBelt?.destroy();
    this.orbitRenderer?.destroy();
    this.playerShip?.destroy();

    if (this.renderer.gameLayer) disposeFiltersDeep(this.renderer.gameLayer);
    this.renderer.clearGameLayer();
    this.renderer.clearUILayer();

    if (this.renderer.gameLayer) {
      this.renderer.gameLayer.scale.set(1);
      this.renderer.gameLayer.x = 0;
      this.renderer.gameLayer.y = 0;
    }

    if (this.skyContainer) {
      this.renderer.stage.removeChild(this.skyContainer);
      disposeFiltersDeep(this.skyContainer);
      this.skyContainer.destroy({ children: true });
      this.skyContainer = null;
    }

    if (this.background) {
      this.background.destroy();
      this.background = null;
    }

    this.bgElapsed = 0;
    this.shipPhysics = null;
    this.distanceTraveled = 0;
    this.visualOrbitBoost = 0;
    this.orbitDayCarry = 0;
    this.clearPlannedRoute(); // Clean up route line
    logger.info("SpaceFlightScene destroyed");
  }

  private readonly DOCKING_RANGE = 55;

  private readonly WARP_EDGE_ARRIVAL_RANGE = 60;

  private async onDockAtStation(station: Station): Promise<void> {
    if (!this.gameEngine) return;
    logger.info(`Docking at station: ${station.name}`);
    this.clearPlannedRoute();
    this.planetManager.routeTargetStationId = null;
    if (this.gameEngine.player?.ship) {
      this.gameEngine.player.ship.energy =
        this.gameEngine.player.ship.maxEnergy;
    }
    await this.gameEngine.transitionTo(SceneType.STATION, {
      gameEngine: this.gameEngine,
      station,
    });
  }

  private handlePlanetRouteRequested(
    planetId: string,
    x: number,
    y: number,
  ): void {
    const sprite = this.planetManager.planetSprites.find(
      (s) => s.planet.id === planetId,
    );
    if (!sprite) return;

    const landing = {
      planetX: sprite.screenX,
      planetY: sprite.screenY,
      planetRadius: sprite.displayRadius,
    };

    const isSamePlanet = this.planetManager.routeTargetPlanetId === planetId;
    this.planetManager.routeTargetPlanetId = planetId;

    if (this.plannedRoute && isSamePlanet) {
      this.executeRouteTo(x, y, landing);
      logger.info(`▶️ Executing route to planet ${sprite.planet.name}`);
    } else {
      this.planRouteTo(x, y, landing);
      logger.info(
        `🗺️ Route planned to planet ${sprite.planet.name}. Click again to execute.`,
      );
    }
  }

  private handlePlanetLanding(planetId: string): void {
    const sprite = this.planetManager.planetSprites.find(
      (s) => s.planet.id === planetId,
    );
    if (sprite) void this.onLandOnPlanet(sprite.planet);
  }

  private handleStationDock(stationId: string): void {
    const marker = this.planetManager.stationMarkers.find(
      (m) => m.station.id === stationId,
    );
    if (!marker || !this.shipPhysics) return;

    if (this.plannedRoute) {
      const dx = marker.x - this.plannedRoute.x;
      const dy = marker.y - this.plannedRoute.y;
      if (Math.sqrt(dx * dx + dy * dy) < 50) {
        this.executeRouteTo(marker.x, marker.y);
        return;
      }
    }
    this.planRouteTo(marker.x, marker.y);
  }

  private async onLandOnPlanet(planet: Planet): Promise<void> {
    const denial = this.planetManager.landingDenial(planet);
    if (denial) {
      this.hud.showMessage(landingDenialMessage(denial), 0xff4444);
      this.clearPlannedRoute();
      this.endTurn();
      return;
    }
    if (
      this.shipPhysics &&
      !this.planetManager.shipReachedPlanet(planet, this.shipPhysics)
    ) {
      logger.warn("Cannot land: ship has not reached the planet yet");
      return;
    }
    if (this.gameEngine?.player?.ship) {
      this.gameEngine.player.ship.energy =
        this.gameEngine.player.ship.maxEnergy;
    }
    await this.gameEngine?.transitionTo(SceneType.PLANET, {
      gameEngine: this.gameEngine,
      planet,
    });
  }

  private onPointerDown(event: FederatedPointerEvent): void {
    if (!this.shipPhysics) return;

    if (this.touchControls.onDown(event)) {
      this.clearPlannedRoute(); // touch pinch (2nd finger) voids the route + owns the gesture (mobile Task 3)
      return;
    }

    logger.debug(
      `🖱️ POINTER DOWN: button=${event.button}, shift=${event.shiftKey}, global=(${event.global.x.toFixed(0)}, ${event.global.y.toFixed(0)})`,
    );

    const isPanButton =
      event.button === 2 || (event.button === 0 && event.shiftKey);

    if (
      !isPanButton &&
      performance.now() - this.sceneReadyAt < this.INPUT_GRACE_MS
    ) {
      logger.info(
        "Ignoring carried-over click during scene-entry grace window",
      );
      return;
    }

    if (!isPanButton && this.isBlockingModalOpen()) {
      this.closeBlockingModals();
      return;
    }

    const planningCtx = {
      planning: this.combatPlanning,
      ship: this.shipPhysics,
      camera: this.camera,
      star: this.starRenderer,
      routeRenderer: this.routeRenderer,
    };
    if (routePlanningClick(event, planningCtx)) return;

    if (
      this.isTurnRunning &&
      !isPanButton &&
      !combatRouteClickAllowed({
        combatActive: this.combatModule?.isActive === true,
        autoCombat: isAutoCombatEnabled(),
      })
    ) {
      if (!this.turnHintShown) {
        this.turnHintShown = true;
        this.hud.showMessage(
          "⏸ Поставь на паузу чтобы выбрать маршрут",
          0xffcc00,
        );
      }
      return;
    }

    if (this.pendingWarp && !isPanButton && this.shipPhysics?.isMoving) {
      logger.info("Navigation locked: en route to warp edge");
      return;
    }

    if (isPanButton) {
      event.preventDefault(); // Prevent default behavior for pan buttons
      this.panZoom.startPan(event.global.x, event.global.y);
      setCanvasCursor(this.renderer.app, "grab"); // pan cursor (US-070 #5)
      logger.info(`✅ Pan mode activated with button ${event.button}`);
      return;
    }

    if (event.button === 0 && !event.shiftKey) {
      this.panZoom.startDragTracking(event.global.x, event.global.y);

      const pt = this.camera.screenToWorld(event.global.x, event.global.y);
      const { centerX: sx, centerY: sy, avoidRadius } = this.starRenderer;
      const world = clampOutsideRadius(pt.x, pt.y, sx, sy, avoidRadius);
      if (this.plannedRoute) {
        const dx = world.x - this.plannedRoute.x;
        const dy = world.y - this.plannedRoute.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < 50) {
          this.executeRouteTo(this.plannedRoute.x, this.plannedRoute.y);
          logger.info(
            `▶️ Executing planned route to (${this.plannedRoute.x.toFixed(0)}, ${this.plannedRoute.y.toFixed(0)})`,
          );
        } else {
          this.planetManager.routeTargetPlanetId = null;
          this.planetManager.routeTargetStationId = null;
          this.npcManager.followNpcId = null;
          this.pendingWarp = null; // cancel warp if user picks a different destination
          this.planRouteTo(world.x, world.y);
          logger.info(
            `🗺️ Route updated to (${world.x.toFixed(0)}, ${world.y.toFixed(0)})`,
          );
        }
      } else {
        this.planetManager.routeTargetPlanetId = null;
        this.planetManager.routeTargetStationId = null;
        this.npcManager.followNpcId = null;
        this.pendingWarp = null; // cancel warp if user picks a new destination
        this.planRouteTo(world.x, world.y);
        logger.info(
          `🗺️ Route planned to (${world.x.toFixed(0)}, ${world.y.toFixed(0)}). Click again to execute.`,
        );
      }
    }
  }

  private onPointerMove(event: FederatedPointerEvent): void {
    if (this.touchControls.onMove(event)) return; // touch pinch consumes 2-finger moves
    const panDelta = this.panZoom.onMove(event.global.x, event.global.y);
    if (panDelta) this.camera.pan(panDelta.dx, panDelta.dy);
  }

  private onPointerUp(event?: FederatedPointerEvent): void {
    if (event) this.touchControls.onUp(event); // clear touch finger bookkeeping
    if (this.panZoom.isPanning) {
      logger.info("❌ Pan mode deactivated");
      setCanvasCursor(this.renderer.app, "default"); // release pan cursor
    }
    if (this.panZoom.shouldSwallowClick()) {
      this.clearPlannedRoute();
      logger.info("🖱️ LMB drag exceeded threshold — route planning swallowed");
    }
    this.panZoom.reset();
  }

  private onWheel(event: WheelEvent): void {
    event.preventDefault();

    if (this.isBlockingModalOpen() && !this.planetManager.hasInfoPanel) return;

    if (this.panZoom.isPanning) return;

    event.stopImmediatePropagation(); // keeps a handled zoom off the autopilot's same-node reclaim listener
    this.camera.zoomAtClient(event.deltaY, event.clientX, event.clientY);
  }

  private handleResize(): void {
    this.renderer.resize();
    const w = this.renderer.app.screen.width;
    const h = this.renderer.app.screen.height;

    this.hud.reposition(w, h);
    this.combatPlanningUi?.reposition(w, h); // else drifts onto «Ход» — prettier-ignore

    if (this.shipPhysics) this.camera.centerOnShip();
  }

  private currentSystemStations(): Station[] {
    const systemId = this.gameEngine?.player?.currentSystemId;
    return (
      this.gameEngine?.galaxy?.systems.find((s) => s.id === systemId)
        ?.stations ?? []
    );
  }

  private currentSystemPlanets(): Planet[] {
    const systemId = this.gameEngine?.player?.currentSystemId;
    return (
      this.gameEngine?.galaxy?.systems.find((s) => s.id === systemId)
        ?.planets ?? []
    );
  }

  private entrySpawnDeps(): EntrySpawnDeps {
    return {
      shipPhysics: this.shipPhysics,
      starCenter: {
        x: this.starRenderer.centerX,
        y: this.starRenderer.centerY,
      },
      findPlanetSprite: (id) =>
        this.planetManager.planetSprites.find((s) => s.planet.id === id),
      findStationMarker: (id) =>
        this.planetManager.stationMarkers.find((m) => m.station.id === id),
      findStationDomainPos: (id) => {
        const station = this.currentSystemStations().find((s) => s.id === id);
        if (!station) return undefined;
        return {
          x:
            this.starRenderer.centerX +
            Math.cos(station.orbitAngle) * station.orbitRadius,
          y:
            this.starRenderer.centerY +
            Math.sin(station.orbitAngle) * station.orbitRadius,
        };
      },
      findPlanetDomainPos: (id) => {
        const planet = this.currentSystemPlanets().find((p) => p.id === id);
        if (!planet) return undefined;
        const pos = planetOrbitPosition(
          planet.orbitalRadius,
          hashToAngle(planet.id),
          this.gameEngine?.galaxy?.gameDays ?? 0,
          { x: this.starRenderer.centerX, y: this.starRenderer.centerY },
        );
        return { ...pos, radius: DOMAIN_FALLBACK_PLANET_RADIUS };
      },
      startTakeoffArc: (arc) => this.playerShip.startTakeoffArc(arc),
      setShipContainerPos: (x, y) => {
        const shipC = this.playerShip?.container;
        if (shipC) {
          shipC.x = x;
          shipC.y = y;
        }
      },
      landedPlanetId: this.gameEngine?.player?.landedPlanetId,
      clearLandedPlanetId: () => {
        if (this.gameEngine?.player)
          this.gameEngine.player.landedPlanetId = null;
      },
    };
  }

  private applyEntrySpawn(ctx?: {
    preserveShipPos?: { x: number; y: number };
    fromPlanetId?: string;
    fromStationId?: string;
  }): void {
    computeEntrySpawn(this.entrySpawnDeps(), ctx);
  }

  private onFontScaleChanged(): void {
    this.hud?.refreshFontScale();
    this.planetManager?.refreshFontScale();
    this.npcManager?.refreshFontScale();
  }

  applyReentrySpawn(fromStationId?: string): void {
    computeReentrySpawn(this.entrySpawnDeps(), fromStationId);
  }

  spawnShipBeside(
    bodyX: number,
    bodyY: number,
    bodyRadius: number,
    margin = 40,
  ): void {
    computeSpawnShipBeside(
      this.entrySpawnDeps(),
      bodyX,
      bodyY,
      bodyRadius,
      margin,
    );
  }

  private updateShip(deltaTime: number): void {
    if (!this.shipPhysics) return;
    if (this.combatPause.paused) return; // active-pause: freeze movement + calendar
    if (this.combatPlanning.isPlanning) return; // tactical planning: freeze movement + calendar (Task 14.5a)

    if (this.playerShip.isArcActive()) {
      return;
    }

    const prevX = this.shipPhysics.shipX;
    const prevY = this.shipPhysics.shipY;
    const wasMoving = this.shipPhysics.isMoving;

    this.shipPhysics.update(deltaTime);

    if (this.planetManager.routeTargetStationId && this.shipPhysics.isMoving) {
      const marker = this.planetManager.stationMarkers.find(
        (m) => m.station.id === this.planetManager.routeTargetStationId,
      );
      if (marker) {
        const d = Math.hypot(
          marker.x - this.shipPhysics.shipX,
          marker.y - this.shipPhysics.shipY,
        );
        if (d <= this.DOCKING_RANGE) {
          void this.onDockAtStation(marker.station);
          return;
        }
      }
    }

    if (this.planetManager.routeTargetPlanetId && this.shipPhysics.isMoving) {
      const act = this.planetManager.updateRouteToTarget(
        this.shipPhysics.shipX,
        this.shipPhysics.shipY,
        this.plannedRoute,
      );
      if (act?.kind === "land") {
        this.clearPlannedRoute();
        void this.onLandOnPlanet(act.planet);
        return;
      }
      if (act?.kind === "reaim") this.executeRouteTo(act.x, act.y);
    }

    if (wasMoving && !this.shipPhysics.isMoving) {
      logger.info("🎯 Ship arrived at destination.");

      if (this.pendingWarp && !this.warpInProgress) {
        const exit = this.pendingWarpExitPoint;
        const atExit =
          !exit ||
          Math.hypot(
            exit.x - this.shipPhysics.shipX,
            exit.y - this.shipPhysics.shipY,
          ) <= this.WARP_EDGE_ARRIVAL_RANGE;
        if (atExit) {
          this.clearPlannedRoute();
          void this.performWarp();
          return;
        }
        this.plannedRoute = { x: exit.x, y: exit.y };
        this.routePath = this.flightPathTo(exit.x, exit.y);
        this.plotRoute();
        return;
      }

      if (this.npcManager.followNpcId) return;

      if (this.planetManager.routeTargetPlanetId) {
        const sprite = this.planetManager.planetSprites.find(
          (s) => s.planet.id === this.planetManager.routeTargetPlanetId,
        );
        if (sprite) {
          const dist = Math.hypot(
            sprite.screenX - this.shipPhysics.shipX,
            sprite.screenY - this.shipPhysics.shipY,
          );
          if (dist <= this.planetManager.landingThreshold(sprite)) {
            const planet = sprite.planet;
            this.clearPlannedRoute();
            void this.onLandOnPlanet(planet);
            return;
          }
        }
      }

      this.clearPlannedRoute();
      this.endTurn();
    }

    const startedBurning = this.starRenderer.updateSunContactDamage(
      deltaTime,
      this.shipPhysics.shipX,
      this.shipPhysics.shipY,
      this.isTurnRunning,
      this.shipPhysics?.timeScale ?? 1,
    );
    if (startedBurning) this.hud.showMessage("☀ Корпус горит!", 0xff8800);

    const ship = this.gameEngine?.player?.ship;
    if (ship && ship.maxHull > 0) {
      const hullFraction = ship.hullHP / ship.maxHull;
      if (hullFraction < 0.3) {
        if (
          this.shipPhysics.isMoving &&
          !this.lowHullStopped &&
          !this.pendingWarp &&
          !this.planetManager.routeTargetPlanetId
        ) {
          this.lowHullStopped = true;
          this.npcManager.followNpcId = null;
          this.clearPlannedRoute();
          this.endTurn(); // stop the ship and end the turn
          this.hud.showMessage(
            "⚠ Корпус < 30% — двигатели остановлены. Найдите планету для ремонта.",
            0xff5555,
          );
        }
      } else {
        this.lowHullStopped = false;
      }
    }

    if (this.shipPhysics.isMoving && this.shipPhysics.currentSpeed > 0.01) {
      const dx = this.shipPhysics.shipX - prevX;
      const dy = this.shipPhysics.shipY - prevY;
      const stepPx = Math.sqrt(dx * dx + dy * dy);
      this.visualOrbitBoost += this.orbitTopUp(deltaTime);
      this.distanceTraveled += stepPx;
      while (this.distanceTraveled >= this.DISTANCE_PER_DAY) {
        this.distanceTraveled -= this.DISTANCE_PER_DAY;
        if (this.combatModule?.isActive) {
          this.waitDayAccum += 1;
          if (this.pauseAtDayBoundary) {
            this.endTurn();
            break;
          }
          continue;
        }
        if (this.gameEngine?.galaxy) {
          this.gameEngine.advanceGalaxyDay();
          this.npcManager.refresh(); // NPCs may have arrived/departed this day
        }
        if (this.pauseAtDayBoundary) {
          this.endTurn();
          break;
        }
      }
    }

    if (
      this.isTurnRunning &&
      !this.shipPhysics.isMoving &&
      !this.npcManager.followNpcId &&
      !this.pendingWarp
    ) {
      if (this.combatModule?.isActive)
        this.waitDayAccum += this.orbitTopUp(deltaTime);
      else this.advanceWaitTime(deltaTime);
    }
  }

  private advanceWaitTime(deltaTime: number): void {
    const clampedDt = Math.min(deltaTime, this.MS_PER_WAIT_DAY);
    const scaledDt = clampedDt * (this.shipPhysics?.timeScale ?? 1);
    this.waitDayAccum += scaledDt / this.MS_PER_WAIT_DAY;
    while (this.waitDayAccum >= 1) {
      this.waitDayAccum -= 1;
      if (this.gameEngine?.galaxy) {
        this.gameEngine.advanceGalaxyDay();
        this.npcManager.refresh();
      }
      if (this.pauseAtDayBoundary) {
        this.endTurn(); // F1: deferred Pause ends the wait turn at the boundary
        break;
      }
    }
  }

  private async performWarp(): Promise<void> {
    if (
      !this.pendingWarp ||
      this.warpInProgress ||
      !this.gameEngine?.player ||
      !this.gameEngine.galaxy
    ) {
      return;
    }
    const exitPoint = this.pendingWarpExitPoint;
    this.pendingWarpExitPoint = null;
    this.warpInProgress = true;
    this.gameEngine.audio.playSfx("warp").catch(() => {});

    const { targetSystemId, fuelCost, exitVector } = this.pendingWarp;
    this.pendingWarp = null; // consume so the jump can't re-fire
    this.gameEngine.liveFlightShipPos = null; // ship left system: drop the capture

    const target = this.gameEngine.galaxy.systems.find(
      (s) => s.id === targetSystemId,
    );
    if (!target) {
      logger.error(`Warp target system not found: ${targetSystemId}`);
      this.warpInProgress = false;
      return;
    }

    this.gameEngine.player.ship.energy = Math.max(
      0,
      this.gameEngine.player.ship.energy - fuelCost,
    );
    this.gameEngine.player.currentSystemId = targetSystemId;
    this.gameEngine.galaxy.revealSystemAndNeighbors(targetSystemId);
    logger.info(
      `Hyperjump to ${target.name} complete. Fuel left: ${this.gameEngine.player.ship.energy}`,
    );

    this.gameEngine.saveGame("auto").catch((e) => {
      logger.error("Auto-save after hyperjump failed:", e);
    });

    const departureVector = departureVectorFromExitPoint(
      exitPoint,
      { x: this.starRenderer.centerX, y: this.starRenderer.centerY },
      exitVector,
    );
    const entryVector = { x: -departureVector.x, y: -departureVector.y };
    await this.gameEngine.transitionTo(SceneType.SPACE_FLIGHT, {
      gameEngine: this.gameEngine,
      entryVector,
      arrivalHeading: arrivalHeadingFromExitVector(departureVector),
      warpArrival: true,
    });
  }

  private plotRoute(): void {
    plotPlannedRoute(this.routeRenderer, {
      shipPos: this.shipPhysics
        ? { x: this.shipPhysics.shipX, y: this.shipPhysics.shipY }
        : null,
      plannedRoute: this.plannedRoute,
      isTurnRunning: this.isTurnRunning,
      routePath: this.routePath,
      isPlanetAt: (x, y) => this.planetManager.getPlanetAt(x, y) !== null,
      distancePerDay: this.DISTANCE_PER_DAY,
    });
  }

  private planRouteTo(x: number, y: number, landing?: LandingHint): void {
    if (!this.shipPhysics) return;
    this.plannedRoute = { x, y, landing };
    this.routePath = this.flightPathTo(x, y, landing);
    this.plotRoute();
  }

  private flightPathTo(x: number, y: number, landing?: LandingHint): Point[] {
    if (!this.shipPhysics) return [];
    return computeFlightPath(
      this.shipPhysics.shipX,
      this.shipPhysics.shipY,
      x,
      y,
      this.starRenderer,
      GAME_BALANCE.landingApproachOffset,
      landing,
    );
  }

  private executeRouteTo(x: number, y: number, landing?: LandingHint): void {
    if (!this.shipPhysics) return;
    if (!this.pursuitReplot && this.combatModule?.isActive)
      this.npcManager.breakOffCombatPursuit();
    this.playerShip.finishTakeoff(); // a fresh course cancels any in-progress take-off arc
    const same = this.plannedRoute?.x === x && this.plannedRoute?.y === y;
    const hint = landing ?? (same ? this.plannedRoute?.landing : undefined);
    this.routePath = this.flightPathTo(x, y, hint);
    this.shipPhysics.setPath(this.routePath);
    this.plannedRoute = { x, y, landing: hint };
    this.isTurnRunning = true; // executing a route runs the turn (Play)
    this.updateInteractiveCursors(true);
    this.plotRoute();
  }

  private clearPlannedRoute(): void {
    this.plannedRoute = null;
    if (this.planetManager) {
      this.planetManager.routeTargetPlanetId = null;
      this.planetManager.routeTargetStationId = null;
    }
    if (this.npcManager) this.npcManager.followNpcId = null;
    this.routePath = [];
    this.routeRenderer?.clearRoute();
  }

  private updateSystemMiniMap(): void {
    updateFlightMiniMap({
      miniMap: this.hud.miniMap,
      ship: this.shipPhysics,
      npcDots: this.npcManager.getNpcDots(),
      planetSprites: this.planetManager.planetSprites,
      plannedRoute: this.plannedRoute,
      starCenter: {
        x: this.starRenderer.centerX,
        y: this.starRenderer.centerY,
      },
      camera: this.camera,
      boundaryRadius: this.SYSTEM_BOUNDARY_RADIUS,
      scannerRange: this.SCANNER_RANGE,
    });
  }

  private onPlayPause(): void {
    handleFlightPlayPause({
      isCombatPaused: () => this.combatPause.paused,
      isPlanning: () => this.combatPlanning.isPlanning,
      isExecutingPlan: () => this.combatPlanning.isExecuting,
      hasOpenModal: () => this.isBlockingModalOpen(),
      confirmPlan: () => void this.combatPlanning.confirm(),
      isTurnRunning: () => this.isTurnRunning,
      combatAbortActive: () =>
        !!this.npcManager.followNpcId || !!this.combatModule?.isActive,
      endTurn: () => this.endTurn(),
      pauseLatched: () => this.pauseAtDayBoundary,
      setPauseLatch: (v) => void (this.pauseAtDayBoundary = v),
      plannedRoute: () => this.plannedRoute,
      followActive: () => !!this.npcManager.followNpcId,
      followTarget: () => this.npcManager.getFollowTarget(),
      executeRouteTo: (x, y) => this.executeRouteTo(x, y),
      beginWaitTurn: () => {
        this.waitDayAccum = 0;
        this.isTurnRunning = true; // course-less wait: time passes, ship stays put
        this.updateInteractiveCursors(true);
        this.hud.showMessage(t("flight.turn.waiting"), 0x88ccff);
      },
      showMessage: (text, color) => this.hud.showMessage(text, color),
    });
  }

  private maybeAutoConfirmCombat(): void {
    this.autoCombatToggle.sync(this.combatModule?.isActive === true);
    if (this.destroyed || !this.combatPlanning.isPlanning) return;
    if (!isAutoCombatEnabled()) return;
    const physics = this.shipPhysics;
    autoConfirmCombatTurn(
      this.combatPlanning,
      this.combatModule.fittedWeapons(),
      [...this.combatModule.combatants],
      physics ? { x: physics.shipX, y: physics.shipY } : null,
      this.combatModule.selectedTarget,
    );
  }

  private endTurn(): void {
    this.isTurnRunning = false;
    this.pauseAtDayBoundary = false; // deferred pause consumed (or turn ended)
    this.orbitDayCarry +=
      this.waitDayAccum +
      this.distanceTraveled / this.DISTANCE_PER_DAY +
      this.visualOrbitBoost;
    this.waitDayAccum = 0;
    this.distanceTraveled = 0;
    this.visualOrbitBoost = 0;
    this.turnHintShown = false;
    this.updateInteractiveCursors(false);
    if (this.shipPhysics) endFlightTurn(this.shipPhysics, this.gameEngine);
  }

  private updateInteractiveCursors(turnRunning: boolean): void {
    this.planetManager?.setCursors(turnRunning);
    this.npcManager?.setCursors(turnRunning);
  }

  private isBlockingModalOpen(): boolean {
    return (
      this.npcManager.hasOpenModal() ||
      this.hud.isQuestJournalOpen() ||
      this.planetManager.hasInfoPanel ||
      this.hud.isSettingsPanelOpen() ||
      this.hud.isSystemModalOpen()
    );
  }

  private closeBlockingModals(): void {
    this.npcManager.closeModals();
    this.hud.closeModals(); // quest journal + ♿ accessibility panel (deferred destroy)
    this.planetManager.closeInfoPanel();
  }

  private saveShipPosition(): void {
    if (this.gameEngine && this.shipPhysics) {
      this.gameEngine.lastFlightShipPos = {
        x: this.shipPhysics.shipX,
        y: this.shipPhysics.shipY,
      };
      this.gameEngine.lastFlightWasFleeing = !!this.combatModule?.isActive;
    }
  }

  private async returnToStarMap(): Promise<void> {
    logger.info("Returning to star map");
    if (this.gameEngine) {
      this.saveShipPosition();
      await this.gameEngine.transitionTo(SceneType.STAR_MAP);
    }
  }

  private onKeyDown(event: KeyboardEvent): void {
    handleFlightKey(event, {
      combatPause: {
        paused: this.combatPause.paused,
        resume: () => this.combatPause.resume(),
        beginCombatRound: () => this.combatModule.beginCombatRound(),
      },
      npcManager: this.npcManager,
      hud: this.hud,
      planetManager: this.planetManager,
      plannedRoute: this.plannedRoute,
      isTurnRunning: this.isTurnRunning,
      clearPlannedRoute: () => this.clearPlannedRoute(),
      executeRouteTo: (x, y) => this.executeRouteTo(x, y),
      openInventory: () => void this.openInventory(),
      combatPlanning: {
        isPlanning: this.combatPlanning.isPlanning,
        confirm: () => this.combatPlanning.confirm(),
      },
    });
  }

  private async openInventory(): Promise<void> {
    if (!this.gameEngine) return;
    logger.info("Opening inventory");
    this.saveShipPosition();
    await this.gameEngine.transitionTo(SceneType.INVENTORY, {
      gameEngine: this.gameEngine,
    });
  }

  private navigateToQuestObjective(locationId: string): void {
    navigateToQuestTarget(
      {
        planets: () => this.planetManager.planetSprites,
        hasShip: () => this.shipPhysics !== null,
        planRouteTo: (x, y) => this.planRouteTo(x, y),
        openPlanetPanel: (p) => this.planetManager.handlePlanetClick(p),
        openStarMapOn: (systemId) => {
          if (!this.gameEngine) return;
          this.saveShipPosition();
          void this.gameEngine.transitionTo(SceneType.STAR_MAP, {
            gameEngine: this.gameEngine,
            pendingSelectedSystemId: systemId,
          });
        },
        systemForLocation: (id) =>
          this.gameEngine?.galaxy?.systemForLocation(id) ?? null,
      },
      locationId,
    );
  }

  async e2eClickBackToMap(): Promise<void> {
    return this.e2eHooks.clickBackToMap();
  }

  e2eSetTarget(x: number, y: number): void {
    this.e2eHooks.setTarget(x, y);
  }

  e2eGetCameraState(): { zoom: number; panX: number; panY: number } {
    return this.e2eHooks.getCameraState();
  }

  e2eSetCameraZoom(zoom: number): void {
    this.e2eHooks.setCameraZoom(zoom);
  }

  e2eSetCameraPan(x: number, y: number): void {
    this.e2eHooks.setCameraPan(x, y);
  }

  e2eHasMinimap(): boolean {
    return this.e2eHooks.hasMinimap();
  }

  e2eGetShipPosition(): { x: number; y: number } {
    return this.e2eHooks.getShipPosition();
  }

  e2eIsQuestJournalOpen(): boolean {
    return this.e2eHooks.isQuestJournalOpen();
  }

  e2eGetPlanets(): { id: string; name: string }[] {
    return this.e2eHooks.getPlanets();
  }

  async e2eLandOnPlanet(): Promise<void> {
    return this.e2eHooks.landOnPlanet();
  }

  e2eGetNpcCount(): number {
    return this.e2eHooks.getNpcCount();
  }

  e2eHasFilterPlanet(): boolean {
    return this.e2eHooks.hasFilterPlanet();
  }

  e2eIsolateFilterPlanet(): {
    screenX: number;
    screenY: number;
    displayRadius: number;
  } | null {
    return this.e2eHooks.isolateFilterPlanet();
  }

  e2ePlayPause(): void {
    this.e2eHooks.playPause();
  }

  e2eSetBackgroundVisible(visible: boolean): void {
    this.e2eHooks.setBackgroundVisible(visible);
  }

  e2eGetSceneState(): {
    planetsCount: number;
    npcsCount: number;
    isFlying: boolean;
    turnNumber: number;
  } {
    return this.e2eHooks.getSceneState();
  }

  e2eClickPlanet(index: number): void {
    this.e2eHooks.clickPlanet(index);
  }

  e2eClickNpc(index: number): void {
    this.e2eHooks.clickNpc(index);
  }

  e2ePressPause(): void {
    this.e2eHooks.pressPause();
  }

  e2eStartTurn(): void {
    this.e2eHooks.startTurn();
  }
}
