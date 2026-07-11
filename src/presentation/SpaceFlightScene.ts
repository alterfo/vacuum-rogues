import { GameScene } from "./GameScene";
import { Container, FederatedPointerEvent } from "pixi.js";
import type { GameEngine } from "@/systems/GameEngine";
import { SceneType } from "@/types";
import { installGameCursors, setCanvasCursor } from "./cursor";
import type { Planet } from "@/domain/Planet";
import type { Station } from "@/domain/Station";
import { logger } from "@/utils/logger";
import {
  clampOutsideRadius,
  computeFlightPath,
  planWarpEdgeRoute,
  pointAlongPath,
  takeoffArcPath,
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
import { CombatModule } from "./flight/CombatModule";
import { createCombatPauseUi } from "./flight/combatPauseUi";
import { orbitBump } from "./flight/combatOrbitClock";
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
  recordAndMaybeAutosaveFlight,
  type FlightAutosaveState,
} from "./flight/flightTurnEnd";
import { E2ETestHooks } from "./flight/e2eTestHooks";

/** Planet spiral-in hint: where to curve the approach when landing. */
type LandingHint = { planetX: number; planetY: number; planetRadius: number };

export class SpaceFlightScene extends GameScene {
  private gameEngine: GameEngine | null = null;
  private playerShip!: PlayerShipRenderer;
  // Screen-fixed, behind the world on renderer.stage; SpaceBackgroundLayer populates it.
  private skyContainer: Container | null = null;
  private asteroidBelt!: AsteroidBelt;
  private background: SpaceBackgroundLayer | null = null;
  private warpFx!: WarpEffectRenderer;
  private questCompletion!: QuestCompletion;
  private bgElapsed = 0; // Animation clock for background (ms)
  private shipPhysics: ShipPhysics | null = null;
  // In-flight HUD (buttons, day counter, mini-map, toasts); presses fan back via initialize() callbacks.
  private hud!: FlightHud;

  // Owns planet sprites/markers + info panel and route-target state; scene reads it for route/landing/re-entry.
  private planetManager!: PlanetManager;
  // Owns the central sun + star geometry (centre/radius/avoidRadius) the scene reads for collision/orbit/route math.
  private starRenderer!: StarRenderer;
  // Draws the static orbit circles and the system-boundary ring (a FlightModule).
  private orbitRenderer!: OrbitRenderer;

  private npcManager!: NpcShipManager;
  private combatModule!: CombatModule;
  private combatPause = createCombatPauseUi(); // active-pause; rewired in initialize()
  // Latches the low-hull auto-stop so the warning fires once per descent.
  private lowHullStopped = false;
  private destroyed = false;

  private flightHelp: FlightSceneHelp | null = null; // see flight/flightSceneHelp.ts

  // Turn control: the turn "runs" (ship flies, NPCs/planets move, combat) while true.
  private isTurnRunning = false;
  // F1 (playtest3): Pause lets the ship finish its current day, then halts — a latch defers
  // stop+endTurn to the next whole-day boundary (cleared by endTurn()/turn start; low-HP + combat abort halt now).
  private pauseAtDayBoundary = false;
  // Latch: show "pause first" hint only once per turn to avoid message spam.
  private turnHintShown = false;
  // True only while the combat pursuit re-plots its own course (Task 3 break-off).
  private pursuitReplot = false;
  private readonly SYSTEM_INNER_RADIUS = SYSTEM_GEOMETRY.innerRadius;
  private readonly SYSTEM_BOUNDARY_RADIUS = SYSTEM_GEOMETRY.boundaryRadius;
  private readonly SCANNER_RANGE = GAME_BALANCE.scannerRange;

  // Clicks within this window of scene init are residual events from the prior scene's button — ignored.
  private sceneReadyAt = 0;
  private readonly INPUT_GRACE_MS = 350;

  private distanceTraveled: number = 0;
  // Throttle state for the per-frame live capture + periodic in-flight autosave
  // (recordAndMaybeAutosaveFlight); the headline reload-resume persistence.
  private flightAutosave: FlightAutosaveState = { accumMs: 0, lastPos: null };
  private readonly DISTANCE_PER_DAY: number = GAME_BALANCE.pixelsPerDay;
  // Fractional day accrued while holding position — a wait turn (US-070 #5) OR a
  // stationary real-time fight (combat advances orbits but not the calendar; see updateShip).
  private waitDayAccum: number = 0;
  private readonly MS_PER_WAIT_DAY: number = 1000; // день = секунда (US-070); must equal MS_PER_ORBITAL_DAY
  private visualOrbitBoost: number = 0; // orbit-visual day top-up while moving (additive, NOT a floor) — flight/CLAUDE.md
  private orbitTopUp = (dt: number): number =>
    orbitBump(this.combatPause.paused, dt, this.shipPhysics?.timeScale ?? 1);
  // The day the planets render from: currentDay plus the presentation-only
  // moving top-up. The single production source behind getOrbitalDay —
  // orbitVisualFloorDuringFlight.test.ts asserts against THIS getter.
  private get orbitalVisualDay(): number {
    return this.currentDay + this.visualOrbitBoost;
  }
  // Fractional "day of turn" (gameDays + sub-day move/wait/combat); feeds orbits + the HUD date read-out.
  private get currentDay(): number {
    const days = this.gameEngine?.galaxy?.gameDays ?? 0;
    const frac = this.distanceTraveled / this.DISTANCE_PER_DAY;
    return days + frac + this.waitDayAccum;
  }
  // Two-step movement: plan route, then execute. plannedRoute carries the spiral hint behind it so a
  // re-execute that drops it (Ход / onPlayPause) re-derives from the ship's CURRENT position, not a stale path (US-070).
  private plannedRoute: { x: number; y: number; landing?: LandingHint } | null =
    null;
  // Full curved path (around the star) for drawing the route line; ship flows through it via ShipPhysics.setPath.
  private routePath: { x: number; y: number }[] = [];
  // Draws the planned-course overlay (dashed line + end marker); route planning stays here, renderer owns the Graphics.
  private routeRenderer!: RouteRenderer;

  // Pending hyperjump (US-023): set when the player chose a warp target on the
  // star map. The ship auto-routes to the system edge in `exitVector` direction
  // and the jump fires only on reaching the boundary (see performWarp).
  private pendingWarp: {
    targetSystemId: string;
    fuelCost: number;
    exitVector: { x: number; y: number };
  } | null = null;
  // The real boundary point the ship was routed to for the pending warp —
  // may diverge from `exitVector` on a genuine flee (near-edge escape).
  private pendingWarpExitPoint: { x: number; y: number } | null = null;
  // Guards against firing the jump more than once mid-transition.
  private warpInProgress = false;

  // Continuous input tracking
  private boundPointerDown: ((event: FederatedPointerEvent) => void) | null =
    null;
  private boundPointerMove: ((event: FederatedPointerEvent) => void) | null =
    null;
  private boundPointerUp: (() => void) | null = null;
  private boundPointerLeave: (() => void) | null = null;
  private boundKeyDown: ((event: KeyboardEvent) => void) | null = null;

  // World camera: zoom, pan, smoothed follow/look-ahead, edge clamp and
  // screen↔world conversion (its own controller). Pan/zoom *gestures* are still
  // recognised here via PanZoomController and forwarded as deltas / wheel events.
  private camera!: CameraController;
  private readonly panZoom = new PanZoomController();
  private touchControls!: FlightTouchController; // touch pinch-zoom seam (mobile Task 3)
  private boundWheel: ((event: WheelEvent) => void) | null = null;
  // Suppresses Chrome's middle-button "auto-scroll" (which otherwise fires
  // wheel/scroll events and zooms the camera while the player pans).
  private boundCanvasMouseDown: ((event: MouseEvent) => void) | null = null;
  // Reposition the screen-edge-anchored HUD when the window/canvas resizes,
  // otherwise the minimap and star-map button drift off-screen (bug: canvas
  // exceeded the window, right/bottom UI hidden).
  private boundResize: (() => void) | null = null;
  private boundContextMenu: ((e: Event) => void) | null = null;

  // Playwright/e2e driver methods live in e2eTestHooks.ts (dev-only, __DEBUG__-gated);
  // this scene keeps 1-line forwarders so the public e2e* surface is unchanged.
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
          // Set when arriving from a planet take-off: the ship spawns next to
          // that planet instead of at the system edge (see below).
          fromPlanetId?: string;
          // Set when undocking from a space station: the ship spawns next to
          // that station instead of being flung to the system edge (Task 9).
          fromStationId?: string;
          // Pure HUD re-init (font-scale change): keep the ship where it was
          // instead of edge-spawning (playtest4 A). See applyEntrySpawn().
          preserveShipPos?: { x: number; y: number };
        }
      | undefined;
    this.gameEngine = ctx?.gameEngine ?? null;
    this.pendingWarp = ctx?.pendingWarp ?? null;
    // Quest auto-completion driven by flight events (system entry / NPC kill).
    this.questCompletion = new QuestCompletion(this.gameEngine);
    // HUD module: buttons, day counter, mini-map, mini-log, toasts, tooltips. Built first so the NPC/planet deps (toast + tooltip) reach it; buttons fan back via the callbacks below.
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

    this.combatModule = new CombatModule({
      getShipPhysics: () => this.shipPhysics,
      isPaused: () => this.combatPause.paused || !this.isTurnRunning,
      getPlayerLoadout: () => this.gameEngine?.playerLoadout ?? null,
      getUiLayer: () => this.renderer.uiLayer,
      getGameLayer: () => this.renderer.gameLayer,
      getScreenSize: () => this.renderer.app.screen,
      getPlayerShip: () => this.gameEngine?.player?.ship ?? null,
      getGameMode: () => this.gameEngine?.player?.gameMode ?? "NORMAL",
      // Adaptive garrison scaling (Task 4): fights in a hostile-held system
      // scale with the run's ratcheted peak power.
      isHostileSystem: () => {
        const sysId = this.gameEngine?.player?.currentSystemId;
        return !!(sysId && this.gameEngine?.galaxy?.isHostileSystem(sysId));
      },
      getCampaignPeakPower: () => this.gameEngine?.campaignPeakPower ?? 0,
      onNpcDestroyed: (s) => {
        const npcId = s.npc.id; // capture before the death path deletes the NPC, then complete its BOUNTY
        this.npcManager.handleInFlightDeath(s);
        this.questCompletion.bountyByNpcKill(npcId);
      },
      onPlayerDestroyed: () => this.npcManager.handlePlayerDeath(),
      onPlayerUnderAttack: () =>
        this.combatPause.requestPause("incoming-attack"),
      onCombatEnded: () => {
        // Resume if a fight ended while paused (a phantom stance cleaned up while
        // frozen — Task 9 (vi)); reset() alone leaves `paused` set → still frozen.
        if (this.combatPause.paused) this.combatPause.resume();
        this.combatPause.reset(); // re-arm pause debounce
        if (!this.destroyed) this.endTurn(); // combat over → end the turn (skip teardown)
      },
      onTargetLost: (npc) => this.combatPause.loseTarget(npc), // re-pause on lost target
      onRoundComplete: () => this.combatPause.repause(), // Task 9 (v): between-rounds reaction window
      showMessage: (t, c) => this.hud.showMessage(t, c),
    });
    this.combatPause = createCombatPauseUi(
      this.renderer,
      this.combatModule,
      () => this.shipPhysics?.stop(),
    );
    this.gameEngine?.setCombatStateProvider(() => this.combatModule.isActive); // adaptive combat music signal
    // NPC module: living-galaxy ships, contact panel, auto-follow combat, OVERMIND prompt.
    this.npcManager = new NpcShipManager(
      this.renderer,
      this.gameEngine,
      this.renderer.gameLayer,
      this.renderer.uiLayer,
      {
        getShipPhysics: () => this.shipPhysics,
        getPlanetSprites: () => this.planetManager.planetSprites,
        getStarCenter: () => ({
          x: this.starRenderer.centerX,
          y: this.starRenderer.centerY,
        }),
        isTurnRunning: () => this.isTurnRunning && !this.combatPause.paused,
        showMessage: (text, color) => this.hud.showMessage(text, color),
        showTooltip: (text, sx, sy) => this.hud.showTooltip(text, sx, sy),
        hideTooltip: () => this.hud.hideTooltip(),
        executeRouteTo: (x, y) => {
          this.pursuitReplot = true;
          this.executeRouteTo(x, y);
          this.pursuitReplot = false;
        },
        clearRouteTarget: () => {
          this.planetManager.routeTargetPlanetId = null;
        },
        endTurn: () => this.endTurn(),
        startInFlightCombat: (sprite) => this.combatModule.addCombatant(sprite),
        onPlayerEngagesCombat: () => {
          // Route is preserved through combat.
          // If the ship is flying, defer the stop to the current day boundary
          // so the route isn't aborted mid-day; if stationary, the first hit
          // via onPlayerUnderAttack will open the active-pause overlay anyway.
          if (!this.isTurnRunning) {
            this.isTurnRunning = true;
            this.updateInteractiveCursors(true);
          }
          if (!this.shipPhysics?.isMoving) {
            this.combatPause.requestPause("incoming-attack");
          } else {
            this.pauseAtDayBoundary = true;
          }
        },
        isInCombat: () => this.combatModule.isActive,
        selectCombatTarget: (s) => this.combatModule.selectTarget(s),
        getCombatTargetId: () =>
          this.combatModule.selectedTarget?.npc.id ?? null,
        isCombatant: (sprite) => this.combatModule.combatants.has(sprite),
        isPaused: () => this.combatPause.paused,
        getStarAvoidRadius: () => this.starRenderer.avoidRadius,
        sessionState: this.gameEngine?.sessionState,
      },
    );
    // Auto-complete system-entry quests: EXPLORATION, DEFENSE (OVERMIND liberation), ESCORT.
    this.questCompletion.explorationBySystemEntry();
    this.questCompletion.defenseBySystemEntry();
    this.questCompletion.escortBySystemEntry();

    // Update lastVisitedDay for data-fog tracking (Task 21) and mark system visited (Task 29).
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

    // OVERMIND core system: show the final encounter prompt on system entry.
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

    // Normal entry is the boundary edge; a pending hyperjump starts at lastFlightShipPos.
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
    // Cruise speed (px/ms): derivedStats().speed already folds in the best
    // engine; the ship.speed branch only covers the transient pre-loadout window.
    const loadoutStats = this.gameEngine?.playerLoadout?.derivedStats();
    const ship = this.gameEngine?.player?.ship;
    const cruise = loadoutStats
      ? loadoutStats.speed
      : (this.DISTANCE_PER_DAY / 1000) *
        Math.min(1.4, Math.max(0.8, ship?.speed ?? 1));
    this.shipPhysics = new ShipPhysics(entryX, entryY, cruise || 0.1, ctx?.arrivalHeading ?? 0); // prettier-ignore

    this.renderer.clearGameLayer();
    this.renderer.clearUILayer();

    // Explicit z-ordering so interactive ships hit-test above the big planet discs
    // (US-070 #6). Tiers: bg 0, star/planets default, NPCs Z_NPC, ship Z_SHIP.
    this.renderer.gameLayer.sortableChildren = true;

    // Star module: owns the sun and the star geometry (centre/radius/avoid-radius)
    // the rest of the scene reads. Constructed here so createPlanets can read centre.
    this.starRenderer = new StarRenderer(
      this.renderer,
      this.gameEngine,
      this.renderer.gameLayer,
    );

    // Asteroid module: foreground asteroid/comet field (US-070 #1); owns its objects.
    this.asteroidBelt = new AsteroidBelt(
      this.renderer,
      this.renderer.gameLayer,
    );

    // Orbit module: static orbit circles + system-boundary ring. Owns its display
    // objects on the game layer; nothing animates per frame.
    this.orbitRenderer = new OrbitRenderer(
      this.renderer,
      this.renderer.gameLayer,
      this.gameEngine?.galaxy ?? null,
      this.gameEngine?.player?.currentSystemId ?? "default",
    );

    // Route module: draws the planned-course overlay (dashed line + landing/
    // navigation marker) on the game layer. Stateless — fed the finished polyline.
    this.routeRenderer = new RouteRenderer(this.renderer.gameLayer);

    // Planet module: owns planet sprites, station markers, the info panel and the
    // route-target state. Clicking a body delegates route/landing/docking back via
    // callbacks (route data stays here — Information Expert). Built via initialize().
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

    // Player-ship module: owns the ship hull/sprite, glow, heading crosshair and
    // take-off arc. Reads position from ShipPhysics; flight/turn logic stays here.
    this.playerShip = new PlayerShipRenderer(
      this.renderer,
      this.renderer.gameLayer,
      this.shipPhysics,
      this.gameEngine?.player?.ship.hullClass ?? "",
    );

    // World camera: owns zoom/pan/follow/clamp. Reads ship physics + star centre;
    // fans each transform out to the NPC hit-area rescale.
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
      // Keep NPC hit areas a fixed screen size regardless of zoom level.
      this.npcManager?.updateHitAreas(zoom);
    };

    this.touchControls = new FlightTouchController(
      this.camera,
      isTouchLayoutActive, // touch pinch → camera zoom (mobile Task 3); inert off-touch
    );

    // Warp-exit flourish (flash/rings) shown when dropping out of hyperspace.
    this.warpFx = new WarpEffectRenderer(this.renderer.gameLayer);

    // Screen-fixed deep-space backdrop behind the world so panning never reveals an edge.
    this.skyContainer = new Container();
    this.skyContainer.eventMode = "none";
    this.renderer.stage.addChildAt(this.skyContainer, 0);

    // Background module: nebulae + star fields + twinkle (skyContainer), mid-ground
    // parallax above the sky, foreground dust + edge vignette on the UI layer.
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

    // Position the ship for this entry — resolved after createPlanets() because
    // take-off/re-entry read the freshly-placed planet sprites.
    this.applyEntrySpawn(ctx);

    // Center the camera on the ship at spawn (the camera follows the ship).
    this.camera.centerOnShip();

    // Pending hyperjump: auto-route to the system edge — the near-edge escape
    // on a genuine flee (Task 9 iv), else the exit-direction edge. Pre-planned
    // but not started — press "Ход" to fly it (US-070 #11); the jump fires on
    // reaching the boundary (updateShip → performWarp).
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

    // Just dropped out of hyperspace → play the warp-exit flourish at the ship.
    if (ctx?.warpArrival && !this.pendingWarp) {
      this.warpFx.play(this.shipPhysics.shipX, this.shipPhysics.shipY);
    }

    this.hud.miniMap?.updateSystemName(
      this.gameEngine?.galaxy?.systems.find(
        (s) => s.id === this.gameEngine?.player?.currentSystemId,
      )?.name,
    );
    // Enable interactivity on stage for continuous pointer tracking.
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

    // Keyboard (Quest Journal) + wheel (zoom, on window to capture all events).
    this.boundKeyDown = this.onKeyDown.bind(this);
    window.addEventListener("keydown", this.boundKeyDown);
    this.boundWheel = this.onWheel.bind(this); // capture: true — see onWheel()'s comment
    window.addEventListener("wheel", this.boundWheel, {
      passive: false,
      capture: true,
    });

    // Reposition edge-anchored HUD on window resize (PixiJS resizes the canvas
    // via resizeTo, but UI placed at screen.width/height does not move).
    this.boundResize = this.handleResize.bind(this);
    window.addEventListener("resize", this.boundResize);

    // Prevent context menu on right click (used for panning).
    this.boundContextMenu = (e: Event) => e.preventDefault();
    this.renderer.app.canvas.addEventListener(
      "contextmenu",
      this.boundContextMenu,
    );

    // Suppress middle-button auto-scroll so panning with the wheel button does
    // not also zoom the camera.
    this.boundCanvasMouseDown = (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault();
    };
    this.renderer.app.canvas.addEventListener(
      "mousedown",
      this.boundCanvasMouseDown,
    );

    // Context-sensitive game cursors (US-070 #5): default in space, reticle over
    // hostiles, landing marker over planets.
    installGameCursors(this.renderer.app);

    this.sceneReadyAt = performance.now();

    // E2E fixtures set `window.__hideFlightBackground` (see applyMockHeavySystems)
    // so every test gets a clean black background for lightweight, diff-friendly
    // screenshots. Re-read on every entry so re-entry honours it too.
    if (
      __DEBUG__ &&
      typeof window !== "undefined" &&
      (window as unknown as Record<string, unknown>).__hideFlightBackground
    ) {
      this.e2eSetBackgroundVisible(false);
    }
    this.flightHelp = mountFlightSceneHelp(this.renderer);

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
    const frozen = this.combatPause.paused; // freeze ship-sync + camera too (2026-06-27 #1)
    if (!frozen) this.playerShip.update(deltaTime, this.bgElapsed);
    if (!frozen) this.npcManager.updateCombat(deltaTime);
    this.combatModule.update(deltaTime, this.bgElapsed);
    // A lethal hit here fires GAME_OVER synchronously, destroying this scene
    // mid-frame; bail before driving the now-destroyed modules below.
    if (this.destroyed) return;
    this.flightHelp?.maybeShowCombatHint(this.combatModule.isActive); // 1st-fight hint
    // Skip the live capture mid-hyperjump: performWarp already cleared the capture
    // + set the new systemId, but the ship still sits at the old edge coords until
    // the transition completes — re-capturing here would persist a stale position.
    if (this.gameEngine && this.shipPhysics && !this.warpInProgress)
      recordAndMaybeAutosaveFlight(
        this.gameEngine,
        this.shipPhysics,
        this.flightAutosave,
        deltaTime,
      );
    if (!frozen) this.camera.update();
    this.npcManager.update(deltaTime, this.bgElapsed);
    this.planetManager.update(deltaTime, this.bgElapsed);
    this.updateSystemMiniMap();
    // *Effective* turn state: gate the raw flag on the combat-pause freeze.
    this.hud.setTurnRunning(this.isTurnRunning && !this.combatPause.paused);
    this.hud.update(deltaTime, this.bgElapsed);
  }

  persistLiveState(): void {
    this.npcManager?.persistLivePositions();
  }
  destroy(): void {
    this.destroyed = true;
    this.flightHelp?.destroy(); // contextual help (first-time hint + «?» + combat hint)
    this.flightHelp = null;
    // Remove all pointer event listeners
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

    // Remove keyboard listener
    if (this.boundKeyDown) {
      window.removeEventListener("keydown", this.boundKeyDown);
      this.boundKeyDown = null;
    }

    // Remove wheel listener
    if (this.boundWheel) {
      window.removeEventListener("wheel", this.boundWheel, { capture: true });
      this.boundWheel = null;
    }

    // Remove the contextmenu suppressor.
    if (this.boundContextMenu) {
      this.renderer.app.canvas.removeEventListener(
        "contextmenu",
        this.boundContextMenu,
      );
      this.boundContextMenu = null;
    }

    // Remove the middle-button auto-scroll suppressor.
    if (this.boundCanvasMouseDown) {
      this.renderer.app.canvas.removeEventListener(
        "mousedown",
        this.boundCanvasMouseDown,
      );
      this.boundCanvasMouseDown = null;
    }

    // Remove the resize listener.
    if (this.boundResize) {
      window.removeEventListener("resize", this.boundResize);
      this.boundResize = null;
    }
    this.isTurnRunning = false;
    this.turnHintShown = false;
    this.lowHullStopped = false;
    this.warpInProgress = false;
    this.waitDayAccum = 0;

    // Tear down the warp-exit flourish if one is mid-animation.
    this.warpFx?.destroy();

    // Tear down the HUD (buttons, mini-map, mini-log, toast/tooltip + their
    // timers) before clearUILayer destroys the UI layer underneath it.
    this.hud?.destroy();

    // Tear down planet sprites, station markers and the planet info panel.
    this.planetManager?.destroy();

    // Tear down NPC ship sprites, contact panel and the OVERMIND-core overlay.
    this.npcManager?.destroy();
    this.combatModule?.destroy(); // Clear in-flight combat target + active flag.

    // Tear down the star module (disposes its halo/sun filters and removes its
    // display objects from the game layer) before the layer-wide cleanup below.
    this.starRenderer?.destroy();
    // Tear down the asteroid field (removes + destroys its container).
    this.asteroidBelt?.destroy();
    // Tear down the orbit circles + boundary ring (removes + destroys them).
    this.orbitRenderer?.destroy();
    // Tear down the ship renderer (disposes its glow filter, removes the ship
    // container + heading crosshair from the game layer).
    this.playerShip?.destroy();
    // The planned-course overlay is torn down by clearPlannedRoute() below.

    // Release GPU filter textures before the layer is cleared — clearGameLayer
    // destroys the display objects but not their BlurFilters (ship glow, etc.),
    // which would otherwise leak each teardown.
    if (this.renderer.gameLayer) disposeFiltersDeep(this.renderer.gameLayer);
    this.renderer.clearGameLayer();
    this.renderer.clearUILayer();

    // Reset the camera transform on gameLayer: clearGameLayer removes children,
    // not the scale/offset, so the next scene would inherit this zoom/pan.
    if (this.renderer.gameLayer) {
      this.renderer.gameLayer.scale.set(1);
      this.renderer.gameLayer.x = 0;
      this.renderer.gameLayer.y = 0;
    }

    // The screen-fixed sky lives on renderer.stage, which clearGameLayer/
    // clearUILayer do NOT touch — remove and destroy it explicitly.
    if (this.skyContainer) {
      this.renderer.stage.removeChild(this.skyContainer);
      // Dispose the nebula-cloud, pillar and swarm-mote BlurFilters before the
      // subtree is destroyed — destroy({children}) leaves their GPU textures.
      disposeFiltersDeep(this.skyContainer);
      this.skyContainer.destroy({ children: true });
      this.skyContainer = null;
    }

    if (this.background) {
      this.background.destroy();
      this.background = null;
    }

    // Layers are torn down by clearGameLayer/clearUILayer on the next scene
    // init; just drop our references (the HUD dropped its own above).
    this.bgElapsed = 0;
    this.shipPhysics = null;
    this.distanceTraveled = 0;
    this.visualOrbitBoost = 0;
    this.clearPlannedRoute(); // Clean up route line
    logger.info("SpaceFlightScene destroyed");
  }

  private readonly DOCKING_RANGE = 55;

  private async onDockAtStation(station: Station): Promise<void> {
    if (!this.gameEngine) return;
    logger.info(`Docking at station: ${station.name}`);
    this.clearPlannedRoute();
    this.planetManager.routeTargetStationId = null;
    // Mirrors onLandOnPlanet's free refuel-to-max — docking and landing are
    // both "arrive and park" actions, so both refuel (Task 7 game oddity fix).
    if (this.gameEngine.player?.ship) {
      this.gameEngine.player.ship.energy =
        this.gameEngine.player.ship.maxEnergy;
    }
    await this.gameEngine.transitionTo(SceneType.STATION, {
      gameEngine: this.gameEngine,
      station,
    });
  }

  /**
   * Plan or execute a route to a clicked planet (delegated by PlanetManager).
   * Two-step movement: first click plans the preview, a second click on the same
   * planet executes it. Route planning + targets are the scene's concern
   * (Information Expert); the manager owns the body sprites + info panel.
   */
  private handlePlanetRouteRequested(
    planetId: string,
    x: number,
    y: number,
  ): void {
    const sprite = this.planetManager.planetSprites.find(
      (s) => s.planet.id === planetId,
    );
    if (!sprite) return;

    // Curve the approach into a spiral-in around the planet's orbit edge (Task 5).
    const landing = {
      planetX: sprite.screenX,
      planetY: sprite.screenY,
      planetRadius: sprite.displayRadius,
    };

    // Detect second click via planet ID (stable even as the planet orbits),
    // not position proximity (which broke when the planet moved between clicks).
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

  /** Land on a planet (delegated by PlanetManager's info-panel land button). */
  private handlePlanetLanding(planetId: string): void {
    const sprite = this.planetManager.planetSprites.find(
      (s) => s.planet.id === planetId,
    );
    if (sprite) void this.onLandOnPlanet(sprite.planet);
  }

  /**
   * Plan or execute a route to a clicked station (delegated by PlanetManager).
   * The actual docking is proactive — see updateShip when within DOCKING_RANGE.
   */
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
    // Captured-system gate (single choke point, no bypass). Blocked → message +
    // clear route + endTurn() (else the arrival-land path leaves the ship in a wait-turn burn).
    const denial = this.planetManager.landingDenial(planet);
    if (denial) {
      this.hud.showMessage(landingDenialMessage(denial), 0xff4444);
      this.clearPlannedRoute();
      this.endTurn();
      return;
    }
    // Only land once the ship has actually reached the planet (days accrue in
    // updateShip; simulating flightDays here would teleport the player for free).
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

    // Right button (2) or Shift+Left for panning. The wheel (middle) button no
    // longer pans (auto-scroll/zoom conflict; the right button suffices).
    const isPanButton =
      event.button === 2 || (event.button === 0 && event.shiftKey);

    // Swallow the residual click carried over from the previous scene's button
    // (US-070 #1: confirming race selection also built a route here).
    if (
      !isPanButton &&
      performance.now() - this.sceneReadyAt < this.INPUT_GRACE_MS
    ) {
      logger.info(
        "Ignoring carried-over click during scene-entry grace window",
      );
      return;
    }

    // Modal panels dismiss on an outside click (their children stopPropagation()).
    if (!isPanButton && this.isBlockingModalOpen()) {
      this.closeBlockingModals();
      return;
    }

    // While a turn is running, block route building (panning stays allowed).
    if (this.isTurnRunning && !isPanButton) {
      if (!this.turnHintShown) {
        this.turnHintShown = true;
        this.hud.showMessage(
          "⏸ Поставь на паузу чтобы выбрать маршрут",
          0xffcc00,
        );
      }
      return;
    }

    // In-flight combat no longer freezes navigation (Task 3): a route committed
    // mid-fight breaks off the auto-pursuit (executeRouteTo) so the ship can flee;
    // combat keeps resolving. Enemy retargeting is via the enemy sprite click.

    // Lock navigation while en route to the warp edge (replanning OK when stopped).
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

    // Left button (0) for ship navigation (only if not holding Shift)
    // Two-step movement: first click plans route, second click executes
    if (event.button === 0 && !event.shiftKey) {
      // Begin tracking drag distance so a drag gesture won't be mistaken for a
      // navigation click (cleared in onPointerUp via panZoom.reset).
      this.panZoom.startDragTracking(event.global.x, event.global.y);

      // Convert the click to world coords, clamped outside the sun's exclusion
      // ring: a click on/behind the sun can't be a destination, and clamping
      // keeps route, marker and second-click-execute consistent (playtest 2 ③).
      const pt = this.camera.screenToWorld(event.global.x, event.global.y);
      const { centerX: sx, centerY: sy, avoidRadius } = this.starRenderer;
      const world = clampOutsideRadius(pt.x, pt.y, sx, sy, avoidRadius);

      // Check if we already have a planned route
      if (this.plannedRoute) {
        // Check if clicking near the same point (within 50px) - execute the route
        const dx = world.x - this.plannedRoute.x;
        const dy = world.y - this.plannedRoute.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < 50) {
          // Execute planned route (curving around the star if needed)
          this.executeRouteTo(this.plannedRoute.x, this.plannedRoute.y);
          logger.info(
            `▶️ Executing planned route to (${this.plannedRoute.x.toFixed(0)}, ${this.plannedRoute.y.toFixed(0)})`,
          );
          // Keep the route line visible during movement
        } else {
          // Clicked on different location - update planned route (empty space)
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
        // First click - plan the route (don't start moving yet)
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
    // If the LMB was dragged further than the threshold, cancel any route that
    // was planned in onPointerDown — the gesture was a drag, not a click.
    if (this.panZoom.shouldSwallowClick()) {
      this.clearPlannedRoute();
      logger.info("🖱️ LMB drag exceeded threshold — route planning swallowed");
    }
    this.panZoom.reset();
  }

  /**
   * Handle mouse wheel for zoom (toward the cursor). The anchor math lives in
   * {@link CameraController.zoomAtClient}; the scene only guards against zooming
   * mid-pan and forwards the event.
   */
  private onWheel(event: WheelEvent): void {
    event.preventDefault();

    // Do not zoom while a blocking modal is open: the journal's scrollable list
    // owns the wheel, else a wheel notch both scrolls it AND zooms underneath.
    if (this.isBlockingModalOpen() && !this.planetManager.hasInfoPanel) return;

    // Do not zoom during a pan drag: middle-button auto-scroll / trackpad momentum
    // emit wheel events mid-pan, which would also zoom (bug: pan + unwanted zoom).
    if (this.panZoom.isPanning) return;

    event.stopImmediatePropagation(); // keeps a handled zoom off the autopilot's same-node reclaim listener
    this.camera.zoomAtClient(event.deltaY, event.clientX, event.clientY);
  }

  /**
   * Re-anchor the screen-edge HUD after the window/canvas resizes. PixiJS keeps
   * the canvas sized to the container (resizeTo), but elements positioned at
   * screen.width/height were placed once at init and otherwise drift off-screen.
   */
  private handleResize(): void {
    // Force the renderer to match the container *now* so app.screen is current.
    // PixiJS's own resizeTo listener may run after ours; without this, growing
    // the window back left the HUD anchored to the old (smaller) size.
    this.renderer.resize();
    const w = this.renderer.app.screen.width;
    const h = this.renderer.app.screen.height;

    // Re-anchor all screen-edge HUD elements (buttons, mini-map, mini-log, …).
    this.hud.reposition(w, h);

    // Keep the ship framed after the viewport changed.
    if (this.shipPhysics) this.camera.centerOnShip();
  }

  /**
   * Decide where the ship sits on this SPACE_FLIGHT entry. Precedence:
   * `preserveShipPos` (pure HUD re-init, e.g. font-scale change — keep the ship
   * put, playtest4 A) → `fromPlanetId` take-off arc (Task 5) → station/landed-
   * planet spawn (Task 9).
   */
  private applyEntrySpawn(ctx?: {
    preserveShipPos?: { x: number; y: number };
    fromPlanetId?: string;
    fromStationId?: string;
  }): void {
    if (!this.shipPhysics) return;

    if (ctx?.preserveShipPos) {
      this.shipPhysics.teleport(ctx.preserveShipPos.x, ctx.preserveShipPos.y);
      return;
    }

    // Took off from a planet → spawn right next to it, not at the system edge.
    if (ctx?.fromPlanetId) {
      const sprite = this.planetManager.planetSprites.find(
        (s) => s.planet.id === ctx.fromPlanetId,
      );
      if (sprite) {
        const dx = sprite.screenX - this.starRenderer.centerX;
        const dy = sprite.screenY - this.starRenderer.centerY;
        const len = Math.hypot(dx, dy) || 1;
        // Take-off flourish: fly a short outward arc, then hand off to autopilot.
        // teleport() parks physics at the arc END so it's cosmetic (no days burned).
        const arc = takeoffArcPath(
          sprite.screenX,
          sprite.screenY,
          dx / len,
          dy / len,
          sprite.displayRadius,
          90,
        );
        const end = arc[arc.length - 1];
        this.shipPhysics.teleport(end.x, end.y);
        this.playerShip.startTakeoffArc(arc);
      }
      // Took off → no longer parked at the planet, so a later context-less
      // re-entry keeps its own spawn instead of snapping back here.
      if (this.gameEngine?.player) this.gameEngine.player.landedPlanetId = null;
      return;
    }

    this.applyReentrySpawn(ctx?.fromStationId);
  }

  /**
   * Font size changed in ⚙: restyle the text-bearing flight modules in place
   * rather than re-initialising the whole scene (the old path rebuilt planets/
   * ships/asteroids/NPCs + the nebula backdrop just to resize text). Each module
   * reads `scaledFont` at text-creation time, so refreshing only their labels
   * picks up the new size — world geometry and the ship position stay as-is. (T1)
   */
  private onFontScaleChanged(): void {
    this.hud?.refreshFontScale();
    this.planetManager?.refreshFontScale();
    this.npcManager?.refreshFontScale();
  }

  /**
   * Position the ship after a non-take-off entry to SPACE_FLIGHT (Task 9).
   * Priority: the station we just undocked from (`fromStationId`), else the last
   * planet we landed on (`player.landedPlanetId`, consumed once). If neither is
   * known the ship keeps its default edge spawn.
   */
  private applyReentrySpawn(fromStationId?: string): void {
    if (!this.shipPhysics) return;

    if (fromStationId) {
      const marker = this.planetManager.stationMarkers.find(
        (m) => m.station.id === fromStationId,
      );
      if (marker) {
        this.spawnShipBeside(marker.x, marker.y, 20);
        // Consume any pending landing too, so a later free-flight re-entry isn't
        // snapped back to a stale planet (docstring: landedPlanetId is one-shot).
        if (this.gameEngine?.player)
          this.gameEngine.player.landedPlanetId = null;
        return;
      }
    }

    const player = this.gameEngine?.player;
    const landedId = player?.landedPlanetId;
    if (landedId) {
      const sprite = this.planetManager.planetSprites.find(
        (s) => s.planet.id === landedId,
      );
      if (sprite) {
        this.spawnShipBeside(
          sprite.screenX,
          sprite.screenY,
          sprite.displayRadius,
        );
      }
      // Consume so a later free-flight entry doesn't keep snapping the ship back.
      if (player) player.landedPlanetId = null;
    }
  }

  /**
   * Park the ship just outside a body (planet/station) instead of at the system
   * edge — used when re-entering SPACE_FLIGHT after docking/landing (Task 9).
   * Places it `bodyRadius + margin` px out along the radial from the star, so it
   * sits clear of the body's disc and never on top of the star.
   */
  private spawnShipBeside(
    bodyX: number,
    bodyY: number,
    bodyRadius: number,
    margin = 40,
  ): void {
    if (!this.shipPhysics) return;
    const dx = bodyX - this.starRenderer.centerX;
    const dy = bodyY - this.starRenderer.centerY;
    const len = Math.hypot(dx, dy) || 1;
    const spawnX = bodyX + (dx / len) * (bodyRadius + margin);
    const spawnY = bodyY + (dy / len) * (bodyRadius + margin);
    this.shipPhysics.teleport(spawnX, spawnY);
    const shipC = this.playerShip?.container;
    if (shipC) {
      shipC.x = spawnX;
      shipC.y = spawnY;
    }
  }

  private updateShip(deltaTime: number): void {
    if (!this.shipPhysics) return;
    if (this.combatPause.paused) return; // active-pause: freeze movement + calendar

    // Take-off arc in progress (Task 5): the ship renderer walks the cosmetic
    // outward curve (see PlayerShipRenderer.update) — skip the day-counting
    // flight physics until it finishes.
    if (this.playerShip.isArcActive()) {
      return;
    }

    // Track position before update (for distance calculation)
    const prevX = this.shipPhysics.shipX;
    const prevY = this.shipPhysics.shipY;
    const wasMoving = this.shipPhysics.isMoving;

    // Update physics
    this.shipPhysics.update(deltaTime);

    // Proactive docking: station is a small marker, dock when within DOCKING_RANGE.
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

    // Proactive landing + mid-flight re-aim toward the (orbiting) planet target;
    // PlanetManager owns the landing-range/lead/threshold math (Information Expert).
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

    // Check if ship just arrived (was moving, now stopped). Physics flows through
    // the curved path itself, so reaching a stop here means the final waypoint.
    if (wasMoving && !this.shipPhysics.isMoving) {
      logger.info("🎯 Ship arrived at destination.");

      // Reached the system edge with a pending hyperjump → execute the warp.
      if (this.pendingWarp && !this.warpInProgress) {
        this.clearPlannedRoute();
        void this.performWarp();
        return;
      }

      // Pre-combat chase is owned by updateCombat: on arrival let it re-route/engage.
      if (this.npcManager.followNpcId) return;

      // If the route targeted a planet, land on arrival (the expected outcome).
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
          // Not in range on a hard stop (rare): just end the turn below.
        }
      }

      // Arrived at open space → endTurn() resets ALL turn state (incl. the F1 latch).
      this.clearPlannedRoute();
      this.endTurn();
    }

    // Star-touch damage: StarRenderer burns the hull in rate-limited chunks; true on fresh contact.
    const startedBurning = this.starRenderer.updateSunContactDamage(
      deltaTime,
      this.shipPhysics.shipX,
      this.shipPhysics.shipY,
      this.isTurnRunning,
      this.shipPhysics?.timeScale ?? 1,
    );
    if (startedBurning) this.hud.showMessage("☀ Корпус горит!", 0xff8800);

    // Safety auto-stop: halt engines below 30% hull (latched) — EXCEPT a
    // committed hyperjump escape (`pendingWarp`) or a route to a planet
    // (`routeTargetPlanetId`, per the warning below).
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

    // Turn-based time: only advance days when ship is moving (every DISTANCE_PER_DAY px = 1 day).
    if (this.shipPhysics.isMoving && this.shipPhysics.currentSpeed > 0.01) {
      const dx = this.shipPhysics.shipX - prevX;
      const dy = this.shipPhysics.shipY - prevY;
      const stepPx = Math.sqrt(dx * dx + dy * dy);
      // ADDITIVE top-up (deliberately NOT a floor): a shortfall-only top-up
      // reroutes the letsplay campaign gate (longGameCompetence (c)) via the
      // planets' live geometry — see flight/CLAUDE.md before changing this.
      this.visualOrbitBoost += this.orbitTopUp(deltaTime);
      this.distanceTraveled += stepPx;
      while (this.distanceTraveled >= this.DISTANCE_PER_DAY) {
        this.distanceTraveled -= this.DISTANCE_PER_DAY;
        // Combat freezes the REAL calendar (NPC sim/markets) — see orbitsDuringCombat.
        // The orbit moves the ship continuously, so route the moving fight's day into
        // the orbital sub-day, not advanceGalaxyDay (which refresh()'s the sim and can
        // despawn the live target — cf. the OVERMIND-core push-into-galaxy workaround).
        if (this.combatModule?.isActive) {
          this.waitDayAccum += 1;
          // Deferred-pause requested while flying during combat: stop at this
          // day boundary (same mechanic as normal Space pause, but combat-safe —
          // endTurn sets isTurnRunning=false which also freezes the combat module).
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
        // F1 (playtest3): a deferred Pause ends the turn at the day boundary.
        if (this.pauseAtDayBoundary) {
          this.endTurn();
          break;
        }
      }
    }

    // Stationary turn (US-070 #5): a wait turn advances the calendar; a fight only the orbital day.
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

  /** Advance the calendar while the ship waits in place (a course-less turn). */
  private advanceWaitTime(deltaTime: number): void {
    // Clamp dt to one wait-day so a backgrounded tab's huge resume-frame can't
    // flush hundreds of days at once and outrun the deferred Pause (cf. ShipPhysics).
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

  /**
   * Execute the committed hyperjump on reaching the system edge (US-023):
   * deducts fuel, reveals the target system + neighbours, auto-saves, then
   * transitions in with entry mirroring the REAL departure point (Task 2).
   */
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
    // Deliberately NO isDowned() cancel here — a jump COMMITTED while healthy
    // must complete even if a GOD-floor volley downs the ship mid-transit
    // (else GOD-mode soft-locks at a garrison every repair→jump escape can't
    // outrun; NORMAL/HARD never derive `downed` so are unaffected).
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
    // ESCORT (the only VISIT_SYSTEM-objective quest) completes via
    // QuestCompletion.escortBySystemEntry() through the return-to-issuer gate; a
    // VISIT_SYSTEM progress event here would pre-complete and strand it.
    logger.info(
      `Hyperjump to ${target.name} complete. Fuel left: ${this.gameEngine.player.ship.energy}`,
    );

    this.gameEngine.saveGame("auto").catch((e) => {
      logger.error("Auto-save after hyperjump failed:", e);
    });

    // Mirror the REAL departure angle (Task 2), not the straight-line exitVector.
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

  /**
   * Plot the planned-course overlay and hand it to {@link RouteRenderer} to draw.
   * Route planning (the ship→waypoints→destination polyline + landing-vs-nav
   * decision) is the scene's job; the renderer just draws what it's told.
   */
  private plotRoute(): void {
    if (!this.shipPhysics || !this.plannedRoute) return;

    if (this.isTurnRunning) {
      this.routeRenderer.clearRoute();
      return;
    }
    // Polyline ship → (curved waypoints) → destination (bare destination on a clear shot).
    const path =
      this.routePath.length > 0 ? this.routePath : [this.plannedRoute];
    const points = [
      { x: this.shipPhysics.shipX, y: this.shipPhysics.shipY },
      ...path,
    ];
    const { x: toX, y: toY } = this.plannedRoute;

    this.routeRenderer.drawRoute(points);

    // Landing marker when the target sits on a planet, else a navigation marker.
    if (this.planetManager.getPlanetAt(toX, toY) !== null) {
      this.routeRenderer.drawLandingMarker(toX, toY);
    } else {
      this.routeRenderer.drawNavigationMarker(toX, toY);
    }

    // One-day-travel marker: only when the route is longer than one day's
    // travel — a route shorter than that has no meaningful midpoint (it would
    // coincide with the end marker).
    const dayPoint = pointAlongPath(points, this.DISTANCE_PER_DAY);
    if (!dayPoint.done) {
      this.routeRenderer.drawDayMarker(dayPoint.x, dayPoint.y);
    }
  }

  /**
   * Set the planned-route point and draw its preview, bowing the preview around
   * the star so the dashed line never appears to cut through the sun before the
   * player commits (US-070 #6: the route was drawn straight through the star on
   * the first click, only curving once executed). A planet destination previews
   * the curved spiral-in approach (Task 5).
   */
  private planRouteTo(x: number, y: number, landing?: LandingHint): void {
    if (!this.shipPhysics) return;
    this.plannedRoute = { x, y, landing };
    this.routePath = this.flightPathTo(x, y, landing);
    this.plotRoute();
  }

  /** Star-avoiding (planet target: spiral-in) path from the ship's CURRENT position —
   * the single marshalling point behind BOTH planning and executing (drawn == flown). */
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

  /**
   * Start flying to (x,y) along a star-avoiding (and, for planets, spiral) path.
   * A player course committed mid-fight breaks off the combat auto-pursuit (Task
   * 3) so the ship flies there; the pursuit's own re-plots (`pursuitReplot`) opt out.
   */
  private executeRouteTo(x: number, y: number, landing?: LandingHint): void {
    if (!this.shipPhysics) return;
    if (!this.pursuitReplot && this.combatModule?.isActive)
      this.npcManager.breakOffCombatPursuit();
    this.playerShip.finishTakeoff(); // a fresh course cancels any in-progress take-off arc
    // Single source: re-derive from the ship's CURRENT position (drawn == flown),
    // recovering the spiral hint callers (Ход) drop (recompute, don't replay).
    const same = this.plannedRoute?.x === x && this.plannedRoute?.y === y;
    const hint = landing ?? (same ? this.plannedRoute?.landing : undefined);
    this.routePath = this.flightPathTo(x, y, hint);
    // Physics flows through the waypoints without stopping (US-070 #5).
    this.shipPhysics.setPath(this.routePath);
    this.plannedRoute = { x, y, landing: hint };
    this.isTurnRunning = true; // executing a route runs the turn (Play)
    this.updateInteractiveCursors(true);
    this.plotRoute();
  }

  private clearPlannedRoute(): void {
    this.plannedRoute = null;
    // Guard: clearPlannedRoute runs from destroy(), which may fire before the
    // scene finished initializing (and constructing the planet/NPC modules).
    if (this.planetManager) {
      this.planetManager.routeTargetPlanetId = null;
      this.planetManager.routeTargetStationId = null;
    }
    if (this.npcManager) this.npcManager.followNpcId = null;
    this.routePath = [];
    this.routeRenderer?.clearRoute();
  }

  /** Refresh mini-map each frame; PlanetManager.update() owns the orbital motion. */
  private updateSystemMiniMap(): void {
    // Always update even when paused — gives visual feedback during the pause overlay.
    const miniMap = this.hud.miniMap;
    if (miniMap && this.shipPhysics) {
      const npcDots = this.npcManager.getNpcDots();
      // Show the route on the radar: the planned destination (set on planning
      // or while travelling), else the live target while the ship is moving.
      const route =
        this.plannedRoute ??
        (this.shipPhysics.isMoving
          ? {
              x: this.shipPhysics.getTargetX(),
              y: this.shipPhysics.getTargetY(),
            }
          : null);
      // Current camera view in world coords → radar viewport rectangle.
      const viewport = this.camera.worldViewport();
      miniMap.updateWithSprites(
        this.planetManager.planetSprites,
        this.shipPhysics.shipX,
        this.shipPhysics.shipY,
        this.starRenderer.centerX,
        this.starRenderer.centerY,
        npcDots,
        route,
        this.SYSTEM_BOUNDARY_RADIUS,
        viewport,
        this.SCANNER_RANGE,
      );
      miniMap.updateCenterButton(
        this.camera.panX,
        this.camera.panY,
        this.shipPhysics.shipX,
        this.shipPhysics.shipY,
        this.camera.zoom,
      );
    }
  }

  /**
   * Play/Pause turn control. Paused: Play executes the planned route. Running:
   * Pause defers the stop to the next whole-day boundary (F1, playtest3) — except
   * a combat auto-follow, which aborts immediately. Suppressed while the active-
   * pause overlay is open — else a stray click desyncs `isTurnRunning` below.
   */
  private onPlayPause(): void {
    if (this.combatPause.paused) return;
    if (this.isTurnRunning) {
      // A combat auto-follow / active fight has no advancing day to defer the
      // pause to (combat freezes the calendar), so the day-boundary latch would
      // never fire — halt the turn immediately instead.
      if (this.npcManager.followNpcId || this.combatModule?.isActive) {
        this.endTurn(); // combat abort halts now (endTurn stops the ship)
      } else if (!this.pauseAtDayBoundary) {
        this.pauseAtDayBoundary = true;
        this.hud.showMessage("⏸ Завершаю день…", 0x88ccff);
      }
      return;
    }
    // Play: run the planned route (or close on an attack target). With no course
    // at all, run a "wait" turn — time passes, the ship holds position (US-070 #5).
    this.pauseAtDayBoundary = false; // fresh turn — clear any stale latch
    if (this.plannedRoute) {
      this.executeRouteTo(this.plannedRoute.x, this.plannedRoute.y);
    } else if (this.npcManager.followNpcId) {
      const target = this.npcManager.getFollowTarget();
      if (target) this.executeRouteTo(target.x, target.y);
    } else {
      this.waitDayAccum = 0;
      this.isTurnRunning = true; // course-less wait: time passes, ship stays put
      this.updateInteractiveCursors(true);
      this.hud.showMessage("⏳ Ожидание… (мир движется)", 0x88ccff);
    }
  }

  /** End the running turn: stop the ship and freeze the world (pause). */
  private endTurn(): void {
    this.isTurnRunning = false;
    this.pauseAtDayBoundary = false; // deferred pause consumed (or turn ended)
    this.waitDayAccum = 0; // also drops any combat-orbit offset: orbits settle to gameDays
    this.distanceTraveled = 0;
    this.visualOrbitBoost = 0;
    this.turnHintShown = false;
    this.updateInteractiveCursors(false);
    // Settle the ship in place and persist where it stopped (reload-resume).
    if (this.shipPhysics) endFlightTurn(this.shipPhysics, this.gameEngine);
  }

  /** Switch planet and NPC cursors so hovering shows intent only when not mid-turn. */
  private updateInteractiveCursors(turnRunning: boolean): void {
    // Cursor management is owned by the modules that own the sprites (Information
    // Expert) — the scene only routes the turn state, never touches Graphics.
    this.planetManager?.setCursors(turnRunning);
    this.npcManager?.setCursors(turnRunning);
  }

  /** True while a panel that should swallow outside-clicks is open. */
  private isBlockingModalOpen(): boolean {
    return (
      this.npcManager.hasOpenModal() ||
      this.hud.isQuestJournalOpen() ||
      this.planetManager.hasInfoPanel ||
      this.hud.isSettingsPanelOpen() ||
      this.hud.isSystemModalOpen()
    );
  }

  /** Close any open blocking modal (NPC contact / quest journal / planet panel). */
  private closeBlockingModals(): void {
    this.npcManager.closeModals();
    this.hud.closeModals(); // quest journal + ♿ accessibility panel (deferred destroy)
    this.planetManager.closeInfoPanel();
  }

  // Remember the ship's position so a later return starts here, not the edge.
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

  /** Handle keyboard input via the pure `handleFlightKey` helper. */
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

  /**
   * Navigate ship to quest objective location (planet)
   */
  private navigateToQuestObjective(locationId: string): void {
    // Target in the CURRENT system → plot a normal route to the planet.
    const here = this.planetManager.planetSprites.find(
      (s) => s.planet.id === locationId,
    );
    if (here && this.shipPhysics) {
      this.planRouteTo(here.screenX, here.screenY);
      this.planetManager.handlePlanetClick(here.planet);
      return;
    }
    // Target in ANOTHER (possibly not-yet-reachable) system → open the star map
    // pre-selected on that system so the player can plot the warp route there.
    const target = this.gameEngine?.galaxy?.systemForLocation(locationId);
    if (target && this.gameEngine) {
      this.saveShipPosition();
      void this.gameEngine.transitionTo(SceneType.STAR_MAP, {
        gameEngine: this.gameEngine,
        pendingSelectedSystemId: target.id,
      });
    }
  }

  /** E2E helper: click back to star map */
  async e2eClickBackToMap(): Promise<void> {
    return this.e2eHooks.clickBackToMap();
  }

  /** E2E helper: set ship target position */
  e2eSetTarget(x: number, y: number): void {
    this.e2eHooks.setTarget(x, y);
  }

  /** E2E helper: get camera state */
  e2eGetCameraState(): { zoom: number; panX: number; panY: number } {
    return this.e2eHooks.getCameraState();
  }

  /** E2E helper: set camera zoom */
  e2eSetCameraZoom(zoom: number): void {
    this.e2eHooks.setCameraZoom(zoom);
  }

  /** E2E helper: set camera pan */
  e2eSetCameraPan(x: number, y: number): void {
    this.e2eHooks.setCameraPan(x, y);
  }

  /** E2E helper: check if minimap exists */
  e2eHasMinimap(): boolean {
    return this.e2eHooks.hasMinimap();
  }

  /** E2E helper: get ship position */
  e2eGetShipPosition(): { x: number; y: number } {
    return this.e2eHooks.getShipPosition();
  }

  /** E2E helper: check if quest journal is open */
  e2eIsQuestJournalOpen(): boolean {
    return this.e2eHooks.isQuestJournalOpen();
  }

  /** E2E helper: return current system planets for test assertions */
  e2eGetPlanets(): { id: string; name: string }[] {
    return this.e2eHooks.getPlanets();
  }

  /** E2E helper: transition directly to PLANET scene bypassing distance check */
  async e2eLandOnPlanet(): Promise<void> {
    return this.e2eHooks.landOnPlanet();
  }

  /** E2E helper: count of NPC ship sprites currently in the scene */
  e2eGetNpcCount(): number {
    return this.e2eHooks.getNpcCount();
  }

  /** E2E helper: true once a planet renders via the GLSL rotation filter (F1). */
  e2eHasFilterPlanet(): boolean {
    return this.e2eHooks.hasFilterPlanet();
  }

  /**
   * E2E helper (F1 pixel assertion): hide everything on the game layer except
   * one GLSL-filtered planet body and return its on-screen geometry.
   */
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

  /**
   * E2E helper: hide/show the heavy nebula background (sky + mid-ground parallax
   * + dust + vignette) so screenshots are lightweight and diff-friendly. The
   * applyMockHeavySystems fixture flips this off for every E2E test.
   */
  e2eSetBackgroundVisible(visible: boolean): void {
    this.e2eHooks.setBackgroundVisible(visible);
  }

  /** E2E helper: snapshot of the scene's high-level state for assertions. */
  e2eGetSceneState(): {
    planetsCount: number;
    npcsCount: number;
    isFlying: boolean;
    turnNumber: number;
  } {
    return this.e2eHooks.getSceneState();
  }

  /** E2E helper: trigger the planet-click handler for the planet at `index`. */
  e2eClickPlanet(index: number): void {
    this.e2eHooks.clickPlanet(index);
  }

  /** E2E helper: trigger the NPC-contact click for the ship at `index`. */
  e2eClickNpc(index: number): void {
    this.e2eHooks.clickNpc(index);
  }

  /** E2E helper: press Pause — defers the stop to the day boundary (F1). */
  e2ePressPause(): void {
    this.e2eHooks.pressPause();
  }

  /** E2E helper: start a turn (Ход) — runs the planned route or a wait turn. */
  e2eStartTurn(): void {
    this.e2eHooks.startTurn();
  }
}
