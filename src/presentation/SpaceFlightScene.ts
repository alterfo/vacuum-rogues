import { GameScene } from "./GameScene";
import { Container, FederatedPointerEvent } from "pixi.js";
import type { GameEngine } from "@/systems/GameEngine";
import { SceneType } from "@/types";
import { installGameCursors, setCanvasCursor } from "./cursor";
import type { Planet } from "@/domain/Planet";
import type { Station } from "@/domain/Station";
import { logger } from "@/utils/logger";
import {
  avoidStarPath,
  spiralApproachPath,
  takeoffArcPath,
} from "@/utils/flightGeometry";
import { ShipPhysics } from "@/systems/ShipPhysics";
import { engineSpeedBonus } from "@/systems/EquipmentSystem";
import { PanZoomController } from "@/systems/PanZoomController";
import { SYSTEM_GEOMETRY, GAME_BALANCE } from "@/config/balance";
import { SpaceBackgroundLayer } from "./SpaceBackgroundLayer";
import { StarRenderer } from "./flight/StarRenderer";
import { AsteroidBelt } from "./flight/AsteroidBelt";
import { OrbitRenderer } from "./flight/OrbitRenderer";
import { RouteRenderer } from "./flight/RouteRenderer";
import { PlayerShipRenderer } from "./flight/PlayerShipRenderer";
import { NpcShipManager } from "./flight/NpcShipManager";
import { PlanetManager } from "./flight/PlanetManager";
import { FlightHud } from "./flight/FlightHud";
import { CameraController } from "./flight/CameraController";
import { WarpEffectRenderer } from "./flight/WarpEffectRenderer";
import { QuestCompletion } from "./flight/QuestCompletion";

/** Minimal structural view of a display object for recursive filter disposal. */
interface FilterableNode {
  filters?:
    | ReadonlyArray<{ destroy?: () => void }>
    | { destroy?: () => void }
    | null;
  children?: ReadonlyArray<unknown>;
}

export class SpaceFlightScene extends GameScene {
  private gameEngine: GameEngine | null = null;
  // Renders the player ship (hull/sprite, glow, heading crosshair, take-off arc)
  // and owns its display objects — extracted from this scene as a FlightModule.
  private playerShip!: PlayerShipRenderer;
  // Screen-fixed deep-space backdrop (crisp far stars + twinkle), sits behind
  // the world so panning never reveals an edge. Added to renderer.stage. The
  // scene owns this container's lifecycle; SpaceBackgroundLayer populates it
  // (nebulae, star fields, twinkle stars) but does not create/destroy it.
  private skyContainer: Container | null = null;
  // Occasional foreground asteroids/comets drifting across the view (US-070 #1).
  // Extracted to a FlightModule that owns the field's display objects + state.
  private asteroidBelt!: AsteroidBelt;
  // Owns the deep-space backdrop, mid-ground parallax, foreground dust streaks
  // and edge vignette (extracted from this scene — FlightModule).
  private background: SpaceBackgroundLayer | null = null;
  // Warp-exit flourish (flash/rings/glow) — owns its transient effect container.
  private warpFx!: WarpEffectRenderer;
  // Auto-completes exploration/defense/bounty quests triggered by flight events.
  private questCompletion!: QuestCompletion;
  private bgElapsed = 0; // Animation clock for background (ms)
  private shipPhysics: ShipPhysics | null = null;
  // In-flight HUD: turn/speed/settings buttons, day counter, mini-map, mini-log,
  // toasts and tooltips. Extracted from this scene as a FlightModule; button
  // presses fan back through callbacks wired in initialize(). The scene drives
  // the mini-map refresh via `hud.miniMap` (it reads route + camera state).
  private hud!: FlightHud;

  // Owns all planet sprites, station markers, the planet info panel and the
  // route-target state — extracted from this scene as a FlightModule. The scene
  // reads its planetSprites/stationMarkers/routeTarget* fields for route
  // planning, landing/docking and re-entry spawn; route logic stays here.
  private planetManager!: PlanetManager;
  // Renders the central sun (glow halo, rotating surface, limb fade) and owns the
  // star geometry the scene reads for collision/orbit/route math — extracted from
  // this scene as a FlightModule. Exposes centerX/centerY/radius/avoidRadius.
  private starRenderer!: StarRenderer;
  // Draws the static orbit circles and the system-boundary ring — extracted from
  // this scene as a FlightModule. Owns its own display objects on the game layer.
  private orbitRenderer!: OrbitRenderer;

  // Living-galaxy NPC ships present in the player's system (Feature 8) — sprite
  // lifecycle, contact panel, auto-follow combat loop and the OVERMIND-core
  // prompt are owned by this module. The scene reads/clears its `followNpcId`
  // during the flight/turn loop and drives its combat tick + refresh.
  private npcManager!: NpcShipManager;
  // Latches the low-hull auto-stop so the warning fires once per descent below
  // the threshold, not every frame.
  private lowHullStopped = false;

  // Turn control (Play/Pause). The turn "runs" (ship flies, NPCs/planets move,
  // combat resolves) while isTurnRunning; Pause stops the ship and ends it now.
  private isTurnRunning = false;
  // Latch: show "pause first" hint only once per turn to avoid message spam.
  private turnHintShown = false;
  private readonly SYSTEM_INNER_RADIUS = SYSTEM_GEOMETRY.innerRadius;
  private readonly SYSTEM_BOUNDARY_RADIUS = SYSTEM_GEOMETRY.boundaryRadius;
  private readonly SCANNER_RANGE = GAME_BALANCE.scannerRange;

  // Time tracking for day counter
  // Timestamp (performance.now) when the scene finished initializing. A click
  // that lands within a short window of entering the scene is the residual
  // pointer event from the previous scene's button (e.g. the race-selection
  // confirm), not a deliberate navigation click — it is ignored (US-070 #1).
  private sceneReadyAt = 0;
  private readonly INPUT_GRACE_MS = 350;

  private distanceTraveled: number = 0;
  private readonly DISTANCE_PER_DAY: number = GAME_BALANCE.pixelsPerDay;
  // Course-less "wait" turn (US-070 #5): fractional day accrued while the ship
  // holds position, and how long one waited day takes in real time.
  private waitDayAccum: number = 0;
  private readonly MS_PER_WAIT_DAY: number = 1000; // день = секунда (US-070)

  // Two-step movement: plan route, then execute
  private plannedRoute: { x: number; y: number } | null = null;
  // Full curved path (around the star) kept for drawing the route line; the
  // ship flows through it via ShipPhysics.setPath (no scene-side waypoint queue).
  private routePath: { x: number; y: number }[] = [];
  // Draws the planned-course overlay (dashed line, day ticks, end marker) —
  // extracted to a renderer that owns the Graphics; route planning stays here.
  private routeRenderer!: RouteRenderer;

  // Pending hyperjump (US-023): set when the player chose a warp target on the
  // star map. The ship auto-routes to the system edge in `exitVector` direction
  // and the jump fires only on reaching the boundary (see performWarp).
  private pendingWarp: {
    targetSystemId: string;
    fuelCost: number;
    exitVector: { x: number; y: number };
  } | null = null;
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
  // screen↔world conversion — extracted from this scene as its own controller.
  // Pan/zoom *gestures* are still recognised here (input) via PanZoomController
  // and forwarded to the camera as deltas / wheel events.
  private camera!: CameraController;
  private readonly panZoom = new PanZoomController();
  private boundWheel: ((event: WheelEvent) => void) | null = null;
  // Suppresses Chrome's middle-button "auto-scroll" (which otherwise fires
  // wheel/scroll events and zooms the camera while the player pans). See bug:
  // panning with the wheel button also zoomed the view.
  private boundCanvasMouseDown: ((event: MouseEvent) => void) | null = null;
  // Reposition the screen-edge-anchored HUD when the window/canvas resizes,
  // otherwise the minimap and star-map button drift off-screen (bug: canvas
  // exceeded the window, right/bottom UI hidden).
  private boundResize: (() => void) | null = null;
  private boundContextMenu: ((e: Event) => void) | null = null;

  initialize(context?: object): void {
    const ctx = context as
      | {
          gameEngine?: GameEngine;
          entryVector?: { x: number; y: number };
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
          // Set when returning from CombatScene (Task 11).
          combatResult?: "victory" | "retreat";
          npcId?: string;
        }
      | undefined;
    this.gameEngine = ctx?.gameEngine ?? null;
    this.pendingWarp = ctx?.pendingWarp ?? null;
    // Quest auto-completion driven by flight events (system entry / NPC kill).
    this.questCompletion = new QuestCompletion(this.gameEngine);

    // HUD module: turn/speed/settings buttons, day counter, mini-map, mini-log,
    // toasts and tooltips. Constructed first so the NPC/planet modules' deps
    // (toast + tooltip) and the overmind branch can reach it; its display objects
    // are built later via initialize() (after the UI layer is cleared). Button
    // presses fan back through the callbacks wired just below.
    this.hud = new FlightHud(
      this.renderer,
      this.gameEngine,
      this.renderer.uiLayer,
    );
    this.hud.onPlayPause = () => this.onPlayPause();
    this.hud.onSpeedCycle = (scale) => this.shipPhysics?.setTimeScale(scale);
    this.hud.onStarMap = () => void this.returnToStarMap();
    this.hud.onQuestNavigate = (id) => this.navigateToQuestObjective(id);
    this.hud.onMiniMapPan = (x, y) => this.camera.focusOnWorld(x, y);
    this.hud.onMiniMapReturn = () => this.camera.startReturn();

    // NPC module: owns the living-galaxy ships, their contact panel, the
    // auto-follow combat loop and the OVERMIND-core prompt. Constructed first so
    // the victory-removeNpc and overmind-prompt branches below can use it; its
    // sprites are built later via initialize() (after the layers are cleared).
    // Its accessors read live scene state (ship physics, planet sprites, star
    // centre, turn state) and the HUD (toast/tooltip), so it never couples to
    // this scene class directly.
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
        isTurnRunning: () => this.isTurnRunning,
        showMessage: (text, color) => this.hud.showMessage(text, color),
        showTooltip: (text, sx, sy) => this.hud.showTooltip(text, sx, sy),
        hideTooltip: () => this.hud.hideTooltip(),
        executeRouteTo: (x, y) => this.executeRouteTo(x, y),
        clearRouteTarget: () => {
          this.planetManager.routeTargetPlanetId = null;
        },
        endTurn: () => this.endTurn(),
      },
    );

    // If returning victorious from CombatScene, remove the defeated NPC from
    // the galaxy domain before the NPC module builds the sprite list.
    if (
      ctx?.combatResult === "victory" &&
      ctx.npcId &&
      this.gameEngine?.galaxy
    ) {
      this.npcManager.removeDefeatedNpc(this.gameEngine.galaxy, ctx.npcId);
      this.questCompletion.bountyByNpcKill(ctx.npcId);
    }

    // Auto-complete EXPLORATION quests whose target is the current system.
    this.questCompletion.explorationBySystemEntry();

    // Auto-complete DEFENSE quests targeting this system (OVERMIND liberations).
    this.questCompletion.defenseBySystemEntry();

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

    // OVERMIND core system: show the final encounter prompt (only on fresh entry,
    // not when returning from an already-completed combat).
    if (
      this.gameEngine?.galaxy &&
      this.gameEngine.player &&
      !ctx?.combatResult
    ) {
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

    // Ship enters at the system boundary (рубеж гиперпрыжка) from the warp
    // direction. No viewport clamp: the camera follows the ship (centerCamera-
    // OnShip), so it is always on-screen even though the system is larger than
    // the viewport.
    // For a pending hyperjump (US-023) the ship instead spawns near the system
    // centre so the player sees it traverse out to the edge before jumping.
    // For a pending hyperjump the ship starts from where it actually was in the
    // system when the player opened the star map (US-070 #1). If that position
    // isn't known (e.g. jumped straight from a fresh load), fall back to the
    // inner side opposite the exit direction — still clear of the star, never on
    // top of the sun. A normal (non-warp) entry comes in from the system edge.
    const lastPos = this.gameEngine?.lastFlightShipPos ?? null;
    if (this.gameEngine) this.gameEngine.lastFlightShipPos = null; // consume
    const entryVector = ctx?.entryVector ?? { x: 0, y: 1 };
    const entryX = this.pendingWarp
      ? (lastPos?.x ??
        centerX - this.pendingWarp.exitVector.x * this.SYSTEM_INNER_RADIUS)
      : centerX + entryVector.x * this.SYSTEM_BOUNDARY_RADIUS;
    const entryY = this.pendingWarp
      ? (lastPos?.y ??
        centerY - this.pendingWarp.exitVector.y * this.SYSTEM_INNER_RADIUS)
      : centerY + entryVector.y * this.SYSTEM_BOUNDARY_RADIUS;
    // Cruise speed: derived from installed engine module (px/ms).
    // Loadout speed is already in px/ms from ShipLoadout.derivedStats().
    // Fall back to DISTANCE_PER_DAY / 1000 (legacy ship.speed multiplier) when
    // no GearCatalog loadout is set, so old saves/tests keep working.
    // An equipped EngineModule's "speed" stat (e.g. the fast engine's value:0.2)
    // scales the GearCatalog base so a faster engine is actually faster (Task 10).
    // The fallback path already folds the engine into ship.speed via
    // EquipmentSystem.applyModuleBonuses, so the bonus is only re-applied to the
    // loadout-derived base — never double-counted.
    const loadoutStats = this.gameEngine?.playerLoadout?.derivedStats();
    const ship = this.gameEngine?.player?.ship;
    const engineBonus = ship ? engineSpeedBonus(ship) : 0;
    const cruise = loadoutStats
      ? loadoutStats.speed * (1 + engineBonus)
      : (this.DISTANCE_PER_DAY / 1000) *
        Math.min(1.4, Math.max(0.8, ship?.speed ?? 1));
    this.shipPhysics = new ShipPhysics(entryX, entryY, cruise || 0.1);

    this.renderer.clearGameLayer();
    this.renderer.clearUILayer();

    // Explicit z-ordering so interactive ships always sit (and hit-test) above
    // the large planet discs and the star — planets render big, and without this
    // a planet's interactive disc could swallow clicks meant for an NPC drifting
    // over it (US-070 #6). zIndex tiers: background 0, star/planets default,
    // NPCs Z_NPC, player ship Z_SHIP, decorative FX in between.
    this.renderer.gameLayer.sortableChildren = true;

    // Star module: owns the sun (glow, rotating surface) and the star geometry
    // (centre/radius/avoid-radius) the rest of the scene reads. Constructed here
    // so createPlanets/route planning can read its centre below; its display
    // objects are built when initialize() runs (just after the bg layer).
    this.starRenderer = new StarRenderer(
      this.renderer,
      this.gameEngine,
      this.renderer.gameLayer,
    );

    // Asteroid module: foreground asteroid/comet field drifting through the
    // system (US-070 #1). Owns its own display objects on the game layer.
    this.asteroidBelt = new AsteroidBelt(
      this.renderer,
      this.renderer.gameLayer,
    );

    // Orbit module: static orbit circles + system-boundary ring. Owns its own
    // display objects on the game layer; nothing animates per frame.
    this.orbitRenderer = new OrbitRenderer(
      this.renderer,
      this.renderer.gameLayer,
      this.gameEngine?.galaxy ?? null,
      this.gameEngine?.player?.currentSystemId ?? "default",
    );

    // Route module: draws the planned-course overlay (dashed line, day ticks,
    // landing/navigation marker) onto the game layer. Stateless wrt game logic —
    // the scene hands it the finished polyline + marker decision.
    this.routeRenderer = new RouteRenderer(this.renderer.gameLayer);

    // Planet module: owns planet sprites, station markers, the info panel and the
    // route-target state. Its accessors read live scene state (ship physics, star
    // centre, the orbital-day clock, turn state) and the HUD (tooltip); clicking a
    // body delegates the route/landing/docking back to the scene via callbacks, so
    // route data stays here (Information Expert). Built later via initialize().
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
        getOrbitalDay: () => {
          const gameDays = this.gameEngine?.galaxy?.gameDays ?? 0;
          const fractionalDay = this.distanceTraveled / this.DISTANCE_PER_DAY;
          return gameDays + fractionalDay + this.waitDayAccum;
        },
        showPlanetTooltip: (planet, faction, sx, sy) =>
          this.hud.showPlanetTooltip(planet, faction, sx, sy),
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
    // the cosmetic take-off arc. Reads the authoritative position from the
    // ShipPhysics created above; the scene keeps the flight/turn logic.
    this.playerShip = new PlayerShipRenderer(
      this.renderer,
      this.renderer.gameLayer,
      this.shipPhysics,
    );

    // World camera: owns zoom/pan/follow/clamp. Reads live ship physics + star
    // centre via accessors; fans each new transform out to the NPC hit-area
    // rescale and the HUD debug read-out (the camera stays unaware of both).
    this.camera = new CameraController(this.renderer, {
      getShipPhysics: () => this.shipPhysics,
      getStarCenter: () => ({
        x: this.starRenderer.centerX,
        y: this.starRenderer.centerY,
      }),
      boundaryRadius: this.SYSTEM_BOUNDARY_RADIUS,
    });
    this.camera.onTransform = (zoom) => {
      // Keep NPC hit areas a fixed screen size regardless of zoom level.
      this.npcManager?.updateHitAreas(zoom);
      this.hud?.setCameraDebug(
        this.camera.zoom,
        this.camera.panX,
        this.camera.panY,
      );
    };

    // Warp-exit flourish (flash/rings) shown when dropping out of hyperspace.
    this.warpFx = new WarpEffectRenderer(this.renderer.gameLayer);

    // Screen-fixed deep-space backdrop (crisp far stars + twinkle), behind the
    // whole world so panning/zooming never exposes a hard background edge.
    this.skyContainer = new Container();
    this.skyContainer.eventMode = "none";
    this.renderer.stage.addChildAt(this.skyContainer, 0);

    // Background module: nebulae + star fields + twinkle stars (in skyContainer),
    // mid-ground parallax (drift asteroids, comets, silhouette ships) just above
    // the sky, foreground dust streaks + edge vignette on the UI layer. Parallax
    // reads live camera state and ship velocity via the injected accessors.
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
    this.npcManager.initialize(); // NPC ships present in this system (Feature 8)
    this.playerShip.initialize(); // Ship hull/sprite, glow, heading crosshair
    this.asteroidBelt.initialize(); // Foreground asteroids/comets (US-070 #1)
    this.hud.initialize(); // Turn/speed buttons, day counter, mini-map, mini-log

    // Took off from a planet → spawn right next to it (just outside its orbit),
    // not at the system edge. Planets are placed at a random orbital angle each
    // time the scene loads, so we resolve the position after createPlanets().
    if (ctx?.fromPlanetId && this.shipPhysics) {
      const sprite = this.planetManager.planetSprites.find(
        (s) => s.planet.id === ctx.fromPlanetId,
      );
      if (sprite) {
        const dx = sprite.screenX - this.starRenderer.centerX;
        const dy = sprite.screenY - this.starRenderer.centerY;
        const len = Math.hypot(dx, dy) || 1;
        const outX = dx / len;
        const outY = dy / len;
        // Take-off flourish (Task 5): fly a short outward arc from the planet
        // edge to a point ~90px beyond it, then hand off to autopilot. Physics
        // is parked at the arc's END so the manoeuvre is purely cosmetic (no
        // game-days burned) — updateShip defers to updateTakeoff while it plays.
        const arc = takeoffArcPath(
          sprite.screenX,
          sprite.screenY,
          outX,
          outY,
          sprite.displayRadius,
          90,
        );
        const end = arc[arc.length - 1];
        // teleport() also resets the physics target, so the ship parks at the
        // arc's end instead of flying back toward its initial (edge) spawn.
        this.shipPhysics.teleport(end.x, end.y);
        // Hand the cosmetic arc to the ship renderer; it walks the container
        // along it each frame (updateShip defers while the arc is active).
        this.playerShip.startTakeoffArc(arc);
      }
      // Took off → no longer parked at the planet, so a later combat-return or
      // context-less re-entry keeps its own spawn instead of snapping back here.
      if (this.gameEngine?.player) this.gameEngine.player.landedPlanetId = null;
    } else {
      // Not a planet take-off: spawn beside the station we undocked from, or
      // (failing that) beside the last planet we landed on (Task 9).
      this.applyReentrySpawn(ctx?.fromStationId);
    }

    // Center the camera on the ship at spawn (system is larger than the
    // viewport; the camera follows the ship — see CameraController.update).
    this.camera.centerOnShip();

    // Pending hyperjump: auto-route the ship to the system edge in the warp
    // direction. The jump fires when it reaches the boundary (see updateShip →
    // performWarp). Days advance during this flight like any other movement.
    if (this.pendingWarp) {
      const { exitVector } = this.pendingWarp;
      const edgeX = centerX + exitVector.x * this.SYSTEM_BOUNDARY_RADIUS;
      const edgeY = centerY + exitVector.y * this.SYSTEM_BOUNDARY_RADIUS;
      // Pre-plan the route to the jump point, but DO NOT start moving — the
      // player must press "Ход" (Play) to begin the flight to the edge
      // (US-070 #11). The route preview (bowing around the star) is drawn so the
      // course is visible immediately.
      this.routePath = this.computeAvoidancePath(
        this.shipPhysics.shipX,
        this.shipPhysics.shipY,
        edgeX,
        edgeY,
      );
      this.plannedRoute = { x: edgeX, y: edgeY };
      this.plotRoute();
      logger.info(
        `Pending warp: course to system edge plotted (${edgeX.toFixed(0)}, ${edgeY.toFixed(0)}) — press Ход to depart`,
      );
    }

    // Just dropped out of hyperspace → play the warp-exit flourish at the ship.
    if (ctx?.warpArrival && !this.pendingWarp) {
      this.warpFx.play(this.shipPhysics.shipX, this.shipPhysics.shipY);
    }

    // Enable interactivity on stage for continuous pointer tracking
    this.boundPointerDown = this.onPointerDown.bind(this);
    this.boundPointerMove = this.onPointerMove.bind(this);
    this.boundPointerUp = this.onPointerUp.bind(this);
    this.boundPointerLeave = () => this.panZoom.reset();

    this.renderer.app.stage.eventMode = "static";
    this.renderer.app.stage.hitArea = this.renderer.app.screen; // Ensure stage receives all events
    this.renderer.app.stage.on("pointerdown", this.boundPointerDown);
    this.renderer.app.stage.on("pointermove", this.boundPointerMove);
    this.renderer.app.stage.on("pointerup", this.boundPointerUp);
    this.renderer.app.stage.on("pointerupoutside", this.boundPointerUp);
    this.renderer.app.canvas.addEventListener(
      "pointerleave",
      this.boundPointerLeave,
    );

    logger.info(
      `Stage hitArea set to: ${this.renderer.app.screen.width}x${this.renderer.app.screen.height}`,
    );

    // Add keyboard listener for Quest Journal
    this.boundKeyDown = this.onKeyDown.bind(this);
    window.addEventListener("keydown", this.boundKeyDown);

    // Add wheel listener for zoom (on window to ensure it captures events)
    this.boundWheel = this.onWheel.bind(this);
    window.addEventListener("wheel", this.boundWheel, { passive: false });

    // Reposition edge-anchored HUD on window resize (PixiJS auto-resizes the
    // canvas via resizeTo, but UI placed at screen.width/height does not move).
    this.boundResize = this.handleResize.bind(this);
    window.addEventListener("resize", this.boundResize);

    // Prevent context menu on right click (used for panning)
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
    // Sync the ship sprite to the post-physics position (or walk the take-off
    // arc), redraw engine effects, and refresh the heading crosshair.
    this.playerShip.update(deltaTime, this.bgElapsed);
    this.npcManager.updateCombat(deltaTime);
    this.camera.update();
    this.npcManager.update(deltaTime, this.bgElapsed);
    this.planetManager.update(deltaTime, this.bgElapsed);
    this.updateSystemMiniMap();
    // Push the turn state so the HUD shows the right Play/Pause label, then let
    // it refresh its per-frame read-outs (button, day counter, mini-log fade).
    this.hud.setTurnRunning(this.isTurnRunning);
    this.hud.update(deltaTime, this.bgElapsed);
  }

  destroy(): void {
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
      window.removeEventListener("wheel", this.boundWheel);
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
    if (this.renderer.gameLayer)
      this.disposeFiltersDeep(this.renderer.gameLayer);
    this.renderer.clearGameLayer();
    this.renderer.clearUILayer();

    // Reset the camera transform we applied to gameLayer. clearGameLayer only
    // removes children, not the scale/offset, so the next scene (PlanetScene,
    // StarMapScene) would otherwise inherit this scene's zoom/pan and render
    // scaled and shifted.
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
      this.disposeFiltersDeep(this.skyContainer);
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
    this.clearPlannedRoute(); // Clean up route line
    logger.info("SpaceFlightScene destroyed");
  }

  /**
   * Recursively destroy every filter attached to a display-object subtree.
   * PixiJS v8 `Container.destroy({children})` / `clearGameLayer()` removes the
   * display objects but does NOT dispose their `filters` — each BlurFilter holds
   * a GPU render texture that leaks on every scene teardown otherwise (the swarm
   * motes, ship glow, star halo, nebula clouds and pillars all carry one). Call
   * this before tearing a layer down so the textures are released.
   */
  private disposeFiltersDeep(obj: FilterableNode): void {
    const fs = obj.filters;
    const arr = Array.isArray(fs) ? fs : fs ? [fs] : [];
    for (const f of arr) f.destroy?.();
    for (const child of obj.children ?? []) {
      this.disposeFiltersDeep(child as FilterableNode);
    }
  }

  private readonly DOCKING_RANGE = 55;

  private async onDockAtStation(station: Station): Promise<void> {
    if (!this.gameEngine) return;
    logger.info(`Docking at station: ${station.name}`);
    this.clearPlannedRoute();
    this.planetManager.routeTargetStationId = null;
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
    // Guard: only allow landing when the ship has actually reached the planet.
    // Game-days already accrue during the flight (see updateShip), so we do NOT
    // simulate flightDays here — doing so previously let a single click both
    // teleport the player and skip days for free.
    const sprite = this.planetManager.planetSprites.find(
      (s) => s.planet.id === planet.id,
    );
    if (sprite && this.shipPhysics) {
      const dx = sprite.screenX - this.shipPhysics.shipX;
      const dy = sprite.screenY - this.shipPhysics.shipY;
      if (
        Math.sqrt(dx * dx + dy * dy) >
        this.planetManager.landingThreshold(sprite)
      ) {
        logger.warn("Cannot land: ship has not reached the planet yet");
        return;
      }
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

    logger.debug(
      `🖱️ POINTER DOWN: button=${event.button}, shift=${event.shiftKey}, global=(${event.global.x.toFixed(0)}, ${event.global.y.toFixed(0)})`,
    );

    // Right button (2) or Shift+Left for panning. The wheel (middle) button no
    // longer pans — it caused the auto-scroll/zoom conflict and the right button
    // is enough (per request).
    const isPanButton =
      event.button === 2 || (event.button === 0 && event.shiftKey);

    // Swallow the residual click carried over from the previous scene's button
    // (US-070 #1: after confirming race selection, the same click was building a
    // route here). Panning is unaffected so the player can still look around.
    if (
      !isPanButton &&
      performance.now() - this.sceneReadyAt < this.INPUT_GRACE_MS
    ) {
      logger.info(
        "Ignoring carried-over click during scene-entry grace window",
      );
      return;
    }

    // Modal panels (NPC contact, quest journal) are dismissed by clicking
    // outside them. Their own children call stopPropagation(), so any click that
    // reaches the stage while one is open is necessarily *outside* it — swallow
    // it (close the panel, do NOT plan a route behind the modal). See bug: route
    // was being built to the point hidden behind the dialog.
    if (!isPanButton && this.isBlockingModalOpen()) {
      this.closeBlockingModals();
      return;
    }

    // While a turn is running, block route building and panel interactions.
    // Panning is always allowed so the player can still survey the map.
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

    // While the ship is already en route to the warp edge, lock navigation.
    // If the ship is still stopped (route shown but Play not pressed), allow replanning.
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

      // Convert screen coordinates to world coordinates
      const world = this.camera.screenToWorld(event.global.x, event.global.y);

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
    const panDelta = this.panZoom.onMove(event.global.x, event.global.y);
    if (panDelta) this.camera.pan(panDelta.dx, panDelta.dy);
  }

  private onPointerUp(): void {
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

    // Do not zoom while a pan drag is in progress. Middle-button "auto-scroll"
    // (and trackpad momentum) can emit wheel events during a pan; suppressing
    // them here keeps panning from also zooming (bug: pan + unwanted zoom).
    if (this.panZoom.isPanning) return;

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

    // Proactive landing: planets render large (US-070 #3), so land as soon as
    // the ship touches the planet's surface margin instead of flying all the way
    // to its centre (which sits deep inside the disc).
    if (this.planetManager.routeTargetPlanetId && this.shipPhysics.isMoving) {
      const sprite = this.planetManager.planetSprites.find(
        (s) => s.planet.id === this.planetManager.routeTargetPlanetId,
      );
      if (sprite) {
        const d = Math.hypot(
          sprite.screenX - this.shipPhysics.shipX,
          sprite.screenY - this.shipPhysics.shipY,
        );
        if (d <= this.planetManager.landingThreshold(sprite)) {
          const planet = sprite.planet;
          this.clearPlannedRoute();
          void this.onLandOnPlanet(planet);
          return;
        }
      }
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

      // Auto-follow an attacked NPC is owned by updateCombat (chase → hold →
      // fire). On arrival here we simply keep the turn running and let combat
      // decide whether to re-route or open fire.
      if (this.npcManager.followNpcId) return;

      // If the route targeted a planet, land on arrival (the player set the
      // planet as the destination, so landing is the expected outcome).
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
          // The planet drifted along its orbit while we flew — keep chasing its
          // current position (still avoiding the star) so we arrive and land.
          this.executeRouteTo(sprite.screenX, sprite.screenY);
          return;
        }
      }

      // Arrived at an open-space destination with nothing else to do → the turn
      // ends (Play/Pause model).
      this.clearPlannedRoute();
      this.isTurnRunning = false;
    }

    // Star-touch damage: while the ship is inside the star visual radius the
    // StarRenderer burns the hull in discrete chunks (rate-limited so a graze
    // does not drain it frame-by-frame). It returns true on the frame a fresh
    // contact episode begins, so the toast fires once per episode.
    const startedBurning = this.starRenderer.updateSunContactDamage(
      deltaTime,
      this.shipPhysics.shipX,
      this.shipPhysics.shipY,
      this.isTurnRunning,
      this.shipPhysics?.timeScale ?? 1,
    );
    if (startedBurning) {
      this.hud.showMessage("☀ Корпус горит!", 0xff8800);
    }

    // Safety auto-stop: if the hull drops below 30% mid-flight, halt the engines
    // so the player can divert to the nearest planet and repair before pressing
    // on. Latched so the warning fires once per descent below the threshold.
    const ship = this.gameEngine?.player?.ship;
    if (ship && ship.maxHull > 0) {
      const hullFraction = ship.hullHP / ship.maxHull;
      if (hullFraction < 0.3) {
        if (this.shipPhysics.isMoving && !this.lowHullStopped) {
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

    // Turn-based time: only advance days when ship is moving
    if (this.shipPhysics.isMoving && this.shipPhysics.currentSpeed > 0.01) {
      const dx = this.shipPhysics.shipX - prevX;
      const dy = this.shipPhysics.shipY - prevY;
      const distanceMoved = Math.sqrt(dx * dx + dy * dy);

      this.distanceTraveled += distanceMoved;

      // Every DISTANCE_PER_DAY pixels = 1 game day
      while (this.distanceTraveled >= this.DISTANCE_PER_DAY) {
        this.distanceTraveled -= this.DISTANCE_PER_DAY;
        if (this.gameEngine?.galaxy) {
          this.gameEngine.advanceGalaxyDay();
          // The HUD day counter refreshes from gameEngine each frame (hud.update).
          this.npcManager.refresh(); // NPCs may have arrived/departed this day

          logger.debug(
            `Day passed during flight. Current day: ${this.gameEngine.galaxy.gameDays}`,
          );
        }
      }
    }

    // The ship container is synced to the physics position and redrawn for
    // engine effects by PlayerShipRenderer.update(), called right after this in
    // the scene's update loop.

    // "Wait" turn (US-070 #5): the player may run a turn with no course — the
    // ship holds position while the living galaxy (NPCs) and the calendar keep
    // advancing, until Pause. Advance game days on a timer while idle so time
    // genuinely passes; combat hold-station and pending warps are handled
    // elsewhere and excluded here.
    if (
      this.isTurnRunning &&
      !this.shipPhysics.isMoving &&
      !this.npcManager.followNpcId &&
      !this.pendingWarp
    ) {
      this.advanceWaitTime(deltaTime);
    }
  }

  /**
   * Advance the calendar while the ship waits in place (a course-less turn). A
   * fractional day accumulates smoothly (so planets keep drifting); whole days
   * are committed to the galaxy as they tick over. Pause stops the wait turn
   * immediately via onPlayPause(), so there is no day-boundary deferral here.
   */
  private advanceWaitTime(deltaTime: number): void {
    const scaledDt = deltaTime * (this.shipPhysics?.timeScale ?? 1);
    this.waitDayAccum += scaledDt / this.MS_PER_WAIT_DAY;
    while (this.waitDayAccum >= 1) {
      this.waitDayAccum -= 1;
      if (this.gameEngine?.galaxy) {
        this.gameEngine.advanceGalaxyDay();
        this.npcManager.refresh();
      }
    }
  }

  /**
   * Execute the committed hyperjump once the ship has reached the system edge
   * (US-023). Deducts fuel, moves the player to the target system, reveals it
   * and its neighbours, auto-saves, then transitions to the new system with the
   * ship entering from the origin side (entry = -exit).
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
    this.warpInProgress = true;
    this.gameEngine.audio.playSfx("warp").catch(() => {});

    const { targetSystemId, fuelCost, exitVector } = this.pendingWarp;
    this.pendingWarp = null; // consume so the jump can't re-fire

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

    // Appear on the side of the new system that faces the origin.
    const entryVector = { x: -exitVector.x, y: -exitVector.y };
    await this.gameEngine.transitionTo(SceneType.SPACE_FLIGHT, {
      gameEngine: this.gameEngine,
      entryVector,
      warpArrival: true,
    });
  }

  /**
   * Plot the planned-course overlay and hand it to {@link RouteRenderer} to draw.
   * Route planning (the ship→waypoints→destination polyline and the
   * landing-vs-navigation decision) is the scene's job — it owns the route data
   * and the planet sprites; the renderer just draws what it's told. (Named
   * `plotRoute`, not `draw*`: the actual drawing is delegated to the renderer.)
   */
  private plotRoute(): void {
    if (!this.shipPhysics || !this.plannedRoute) return;

    // Polyline ship → (curved waypoints) → destination. When the path is a
    // straight clear shot, routePath is just the destination.
    const path =
      this.routePath.length > 0 ? this.routePath : [this.plannedRoute];
    const points = [
      { x: this.shipPhysics.shipX, y: this.shipPhysics.shipY },
      ...path,
    ];
    const toX = this.plannedRoute.x;
    const toY = this.plannedRoute.y;

    this.routeRenderer.drawRoute(points, this.DISTANCE_PER_DAY);

    // Check if route target is near a planet (within its interaction radius)
    const isLandingOnPlanet = this.planetManager.getPlanetAt(toX, toY) !== null;

    // Draw different marker based on whether this is a landing or empty space navigation
    if (isLandingOnPlanet) {
      this.routeRenderer.drawLandingMarker(toX, toY);
    } else {
      this.routeRenderer.drawNavigationMarker(toX, toY);
    }
  }

  /**
   * Clear planned route and route line
   */
  /**
   * Build a path from (fx,fy) to (tx,ty) that bows around the star instead of
   * flying through it. Returns just [{to}] when the straight segment is clear,
   * otherwise an arc of waypoints around the star plus the destination.
   */
  private computeAvoidancePath(
    fx: number,
    fy: number,
    tx: number,
    ty: number,
  ): { x: number; y: number }[] {
    return avoidStarPath(
      fx,
      fy,
      tx,
      ty,
      this.starRenderer.centerX,
      this.starRenderer.centerY,
      this.starRenderer.avoidRadius,
    );
  }

  /**
   * Build the flight path from the ship to (tx,ty): the star-avoidance arc, but
   * when the shot is otherwise straight and the destination is a planet, a
   * curved spiral-in approach so the ship sweeps into the orbit edge rather than
   * beelining at the disc (Task 5). When the path already bows around the star
   * it is curved enough and left as-is.
   */
  private computeFlightPath(
    tx: number,
    ty: number,
    landing?: { planetX: number; planetY: number; planetRadius: number },
  ): { x: number; y: number }[] {
    if (!this.shipPhysics) return [{ x: tx, y: ty }];
    const fx = this.shipPhysics.shipX;
    const fy = this.shipPhysics.shipY;
    const path = this.computeAvoidancePath(fx, fy, tx, ty);
    if (landing && path.length <= 1) {
      return spiralApproachPath(
        fx,
        fy,
        landing.planetX,
        landing.planetY,
        landing.planetRadius,
        GAME_BALANCE.landingApproachOffset,
      );
    }
    return path;
  }

  /**
   * Set the planned-route point and draw its preview, bowing the preview around
   * the star so the dashed line never appears to cut through the sun before the
   * player commits (US-070 #6: the route was drawn straight through the star on
   * the first click, only curving once executed). A planet destination previews
   * the curved spiral-in approach (Task 5).
   */
  private planRouteTo(
    x: number,
    y: number,
    landing?: { planetX: number; planetY: number; planetRadius: number },
  ): void {
    if (!this.shipPhysics) return;
    this.plannedRoute = { x, y };
    this.routePath = this.computeFlightPath(x, y, landing);
    this.plotRoute();
  }

  /** Start flying to (x,y) along a star-avoiding (and, for planets, spiral) path. */
  private executeRouteTo(
    x: number,
    y: number,
    landing?: { planetX: number; planetY: number; planetRadius: number },
  ): void {
    if (!this.shipPhysics) return;
    this.playerShip.finishTakeoff(); // a fresh course cancels any in-progress take-off arc
    this.routePath = this.computeFlightPath(x, y, landing);
    // Hand the whole curved path to physics; it flows through the waypoints
    // without stopping (smooth motion around the star — US-070 #5).
    this.shipPhysics.setPath(this.routePath);
    this.plannedRoute = { x, y };
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

    // ?.: clearPlannedRoute runs from destroy(), which may fire before the
    // scene finished initializing (and constructing the route renderer).
    this.routeRenderer?.clearRoute();
  }

  /**
   * Refresh the system mini-map each frame (planet positions, ship, NPC dots,
   * route + camera viewport). Planet orbital motion itself is owned by
   * PlanetManager.update(); this only reads its sprites for the radar.
   */
  private updateSystemMiniMap(): void {
    // Always update mini-map (even when paused, for visual feedback). The radar
    // object lives in the HUD; the per-frame refresh stays here (it reads route +
    // camera + world state owned by the scene).
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
   * Play/Pause turn control. When paused: Play executes the planned route (the
   * turn starts running). While running: Pause ends the turn at the next day
   * segment (or immediately if the ship is holding station in combat).
   */
  private onPlayPause(): void {
    if (this.isTurnRunning) {
      // Pause: stop the ship immediately and end the turn so the player can
      // abort an unwanted route mid-flight — no longer deferred to the next day
      // segment. Works the same whether flying, holding station, or waiting.
      this.shipPhysics?.stop();
      this.endTurn();
      return;
    }
    // Play: run the planned route (or close on an attack target). With no course
    // at all, run a "wait" turn — the ship holds position while the world keeps
    // moving and the calendar advances, until Pause (US-070 #5).
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
    this.waitDayAccum = 0;
    this.distanceTraveled = 0;
    this.turnHintShown = false;
    this.updateInteractiveCursors(false);
    if (this.shipPhysics) {
      this.shipPhysics.setTarget(
        this.shipPhysics.shipX,
        this.shipPhysics.shipY,
      );
      this.shipPhysics.isMoving = false;
      this.shipPhysics.currentSpeed = 0;
    }
  }

  /** Switch planet and NPC cursors so hovering shows intent only when not mid-turn. */
  private updateInteractiveCursors(turnRunning: boolean): void {
    const planetCursor = turnRunning ? "default" : "pointer";
    for (const sprite of this.planetManager.planetSprites) {
      sprite.graphics.cursor = planetCursor;
    }
    // NPC cursors + interactivity restore are owned by the NPC module.
    this.npcManager?.setCursors(turnRunning);
  }

  /** True while a panel that should swallow outside-clicks is open. */
  private isBlockingModalOpen(): boolean {
    return (
      this.npcManager.hasOpenModal() ||
      this.hud.isQuestJournalOpen() ||
      this.planetManager.hasInfoPanel ||
      this.hud.isSettingsPanelOpen()
    );
  }

  /** Close any open blocking modal (NPC contact / quest journal / planet panel). */
  private closeBlockingModals(): void {
    this.npcManager.closeModals();
    this.hud.closeModals(); // quest journal + settings panel (deferred destroy)
    this.planetManager.closeInfoPanel();
  }

  private async returnToStarMap(): Promise<void> {
    logger.info("Returning to star map");
    if (this.gameEngine) {
      // Remember where the ship is so a hyperjump can start from here rather
      // than teleporting the ship next to the sun (US-070 #1).
      if (this.shipPhysics) {
        this.gameEngine.lastFlightShipPos = {
          x: this.shipPhysics.shipX,
          y: this.shipPhysics.shipY,
        };
      }
      await this.gameEngine.transitionTo(SceneType.STAR_MAP);
    }
  }

  /**
   * Handle keyboard input (J key for quest journal)
   */
  private onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      // B4: first Escape closes the top-most panel, second cancels route.
      if (this.npcManager.isContactPanelOpen) {
        this.npcManager.closeContactPanel();
      } else if (this.hud.isQuestJournalOpen()) {
        this.hud.closeQuestJournal();
      } else if (this.planetManager.hasInfoPanel) {
        this.planetManager.closeInfoPanel();
      } else if (this.plannedRoute) {
        this.clearPlannedRoute();
        this.hud.showMessage("Маршрут отменён", 0xffaa00);
      }
      return;
    }
    if (event.key === "j" || event.key === "J") {
      this.hud.toggleQuestJournal();
    } else if (event.key === "i" || event.key === "I") {
      this.openInventory();
    }
  }

  /**
   * Open inventory scene
   */
  private async openInventory(): Promise<void> {
    if (!this.gameEngine) return;

    logger.info("Opening inventory");
    await this.gameEngine.transitionTo(SceneType.INVENTORY, {
      gameEngine: this.gameEngine,
    });
  }

  /**
   * Navigate ship to quest objective location (planet)
   */
  private navigateToQuestObjective(locationId: string): void {
    logger.info(`Navigating to quest objective: ${locationId}`);

    // Find planet sprite by locationId
    const planetSprite = this.planetManager.planetSprites.find(
      (s) => s.planet.id === locationId,
    );
    if (planetSprite && this.shipPhysics) {
      // Plan a star-avoiding route to the planet (same path as a manual click).
      this.planRouteTo(planetSprite.screenX, planetSprite.screenY);
      logger.info(
        `Planned navigation route to planet ${planetSprite.planet.name}`,
      );

      // Show planet info panel
      this.planetManager.handlePlanetClick(planetSprite.planet);
    } else {
      logger.warn(`Could not find planet with ID: ${locationId}`);
    }
  }

  /** E2E helper: click back to star map */
  async e2eClickBackToMap(): Promise<void> {
    if (!__DEBUG__) return;
    await this.returnToStarMap();
  }

  /** E2E helper: set ship target position */
  e2eSetTarget(x: number, y: number): void {
    if (!__DEBUG__) return;
    if (this.shipPhysics) {
      this.shipPhysics.setTarget(x, y);
    }
  }

  /** E2E helper: get camera state */
  e2eGetCameraState(): { zoom: number; panX: number; panY: number } {
    if (!__DEBUG__) return { zoom: 1, panX: 0, panY: 0 };
    return {
      zoom: this.camera.zoom,
      panX: this.camera.panX,
      panY: this.camera.panY,
    };
  }

  /** E2E helper: set camera zoom */
  e2eSetCameraZoom(zoom: number): void {
    if (!__DEBUG__) return;
    this.camera.setZoom(zoom);
  }

  /** E2E helper: set camera pan */
  e2eSetCameraPan(x: number, y: number): void {
    if (!__DEBUG__) return;
    this.camera.setPan(x, y);
  }

  /** E2E helper: check if minimap exists */
  e2eHasMinimap(): boolean {
    if (!__DEBUG__) return false;
    return this.hud.miniMap !== null;
  }

  /** E2E helper: get ship position */
  e2eGetShipPosition(): { x: number; y: number } {
    if (!__DEBUG__) return { x: 0, y: 0 };
    return {
      x: this.shipPhysics?.shipX ?? 0,
      y: this.shipPhysics?.shipY ?? 0,
    };
  }

  /** E2E helper: check if quest journal is open */
  e2eIsQuestJournalOpen(): boolean {
    if (!__DEBUG__) return false;
    return this.hud.isQuestJournalVisible();
  }

  /** E2E helper: return current system planets for test assertions */
  e2eGetPlanets(): { id: string; name: string }[] {
    if (!__DEBUG__) return [];
    return this.planetManager.planetSprites.map((ps) => ({
      id: ps.planet.id,
      name: ps.planet.name,
    }));
  }

  /** E2E helper: transition directly to PLANET scene bypassing distance check */
  async e2eLandOnPlanet(): Promise<void> {
    if (!__DEBUG__) return;
    const planet = this.planetManager.planetSprites[0]?.planet;
    if (!planet || !this.gameEngine) return;
    await this.gameEngine.transitionTo(SceneType.PLANET, {
      gameEngine: this.gameEngine,
      planet,
    });
  }

  /** E2E helper: count of NPC ship sprites currently in the scene */
  e2eGetNpcCount(): number {
    if (!__DEBUG__) return 0;
    return this.npcManager.npcCount;
  }

  e2ePlayPause(): void {
    if (!__DEBUG__) return;
    this.onPlayPause();
  }
}
