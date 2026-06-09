import { GameScene } from "./GameScene";
import {
  Graphics,
  Text,
  Container,
  Sprite,
  FederatedPointerEvent,
  BlurFilter,
} from "pixi.js";
import { UiButton } from "./ui/UiButton";
import type { GameEngine } from "@/systems/GameEngine";
import { SceneType, NpcRole, QuestType } from "@/types";
import { Faction } from "@/types/faction";
import { buildPlanetTooltipLines } from "@/utils/planetTooltip";
import { pickVariant } from "./textures";
import { installGameCursors, setCanvasCursor } from "./cursor";
import { PlanetSprite } from "./PlanetSprite";
import { PlanetInfoPanel } from "./PlanetInfoPanel";
import { SystemMiniMap } from "./SystemMiniMap";
import { QuestJournalUI } from "./QuestJournalUI";
import { NpcShipSprite } from "./NpcShipSprite";
import type { SystemBounds } from "./NpcShipSprite";
import { NpcContactPanel } from "./NpcContactPanel";
import type { Planet } from "@/domain/Planet";
import type { Station } from "@/domain/Station";
import type { NpcShip } from "@/domain/NpcShip";
import {
  npcsPresentInSystem,
  NpcSimulator,
  npcRoleTechLevel,
} from "@/systems/npc/NpcSimulator";
import { logger } from "@/utils/logger";
import { formatGameDate } from "@/utils/gameCalendar";
import {
  avoidStarPath,
  hashToAngle,
  planetApproachPoint,
  spiralApproachPath,
  takeoffArcPath,
  pointAlongPath,
  leadInterceptPoint,
} from "@/utils/flightGeometry";
import { ShipPhysics } from "@/systems/ShipPhysics";
import { engineSpeedBonus } from "@/systems/EquipmentSystem";
import { FlightCombatResolver } from "@/systems/FlightCombatResolver";
import { PanZoomController } from "@/systems/PanZoomController";
import { SYSTEM_GEOMETRY, GAME_BALANCE } from "@/config/balance";
import {
  currentFontSizeKey,
  scaledFont,
  setFontScale,
  type FontSizeKey,
} from "@/utils/fontScale";
import { SpaceBackgroundLayer } from "./SpaceBackgroundLayer";
import { StarRenderer } from "./flight/StarRenderer";
import { AsteroidBelt } from "./flight/AsteroidBelt";
import { OrbitRenderer } from "./flight/OrbitRenderer";
import { RouteRenderer } from "./flight/RouteRenderer";

interface WarpArrivalEffect {
  container: Container;
  rings: Graphics[];
  flash: Graphics;
  glow: Graphics;
  elapsed: number;
  duration: number;
}

/** Minimal structural view of a display object for recursive filter disposal. */
interface FilterableNode {
  filters?:
    | ReadonlyArray<{ destroy?: () => void }>
    | { destroy?: () => void }
    | null;
  children?: ReadonlyArray<unknown>;
}

export class SpaceFlightScene extends GameScene {
  private readonly combatResolver = new FlightCombatResolver();
  private gameEngine: GameEngine | null = null;
  private shipContainer: Container | null = null;
  private shipGraphics: Graphics | null = null;
  // Soft volumetric glow blob behind the ship — gives 3D presence against the
  // dark backdrop. Created once and blurred; not redrawn per frame so the filter
  // texture stays stable.
  private shipGlow: Graphics | null = null;
  // Player-ship art (if available); falls back to the procedural triangle.
  private shipSprite: Sprite | null = null;
  // Heading 0 points +X (east); the ship art faces "down" (nose at the bottom of
  // the image), so the sprite is pre-rotated -90° (counter-clockwise) to align
  // art-forward with the heading. Verified live in US-070 Round 4.
  private readonly SHIP_SPRITE_ROTATION = -Math.PI / 2;
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
  private warpEffect: WarpArrivalEffect | null = null; // Warp-exit flash/rings
  private bgElapsed = 0; // Animation clock for background (ms)
  private shipPhysics: ShipPhysics | null = null;
  private readonly SHIP_SIZE = 20;
  private uiContainer: Container | null = null;

  // Planet rendering
  private planetSprites: PlanetSprite[] = [];
  private planetInfoPanel: PlanetInfoPanel | null = null;
  // Station rendering
  private stationMarkers: {
    station: Station;
    container: Container;
    x: number;
    y: number;
  }[] = [];
  private routeTargetStationId: string | null = null;
  // Renders the central sun (glow halo, rotating surface, limb fade) and owns the
  // star geometry the scene reads for collision/orbit/route math — extracted from
  // this scene as a FlightModule. Exposes centerX/centerY/radius/avoidRadius.
  private starRenderer!: StarRenderer;
  // Draws the static orbit circles and the system-boundary ring — extracted from
  // this scene as a FlightModule. Owns its own display objects on the game layer.
  private orbitRenderer!: OrbitRenderer;
  private systemMiniMap: SystemMiniMap | null = null;

  // NPC ships present in the player's system (Feature 8, slice 2)
  private npcSprites: NpcShipSprite[] = [];
  // Maps each non-pirate NPC sprite to the planet sprite it orbits so the
  // anchor can be refreshed each frame as planets drift along their orbits.
  private npcAnchorPlanet = new Map<NpcShipSprite, PlanetSprite>();
  private npcContactPanel: NpcContactPanel | null = null;
  private contactNpcId: string | null = null;
  // When set, the ship auto-follows this NPC (used by "Атаковать"): on each
  // arrival it re-routes to the target's current position (auto-follow).
  private followNpcId: string | null = null;
  private overmindOverlay: Container | null = null;
  // Guard: prevents multiple simultaneous CombatScene transition requests.
  private _combatTransitionPending = false;
  private readonly _npcSimulator = new NpcSimulator();
  // Transient on-screen feedback (toast), and its auto-clear timer.
  private toast: Text | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  // Latches the low-hull auto-stop so the warning fires once per descent below
  // the threshold, not every frame.
  private lowHullStopped = false;
  // Lerp-return animation: true while the camera is smoothly returning to ship.
  private cameraReturning = false;

  // Tooltip (B1): hover tooltip for planets (immediate) and NPC ships (300ms delay).
  private tooltipText: Text | null = null;
  private tooltipContainer: Container | null = null;
  private tooltipTimer: ReturnType<typeof setTimeout> | null = null;

  // Mini-log (B5): last 5 game events in the bottom-left corner.
  private miniLogContainer: Container | null = null;
  private miniLogEntries: Array<{ textObj: Text; elapsed: number }> = [];
  private readonly MINI_LOG_DURATION = 5000;
  private readonly MINI_LOG_FADE_MS = 1000;

  // Turn control (Play/Pause). The turn "runs" (ship flies, NPCs/planets move,
  // combat resolves) while isTurnRunning; Pause stops the ship and ends it now.
  private isTurnRunning = false;
  // Latch: show "pause first" hint only once per turn to avoid message spam.
  private turnHintShown = false;
  private playPauseButton: UiButton | null = null;
  private readonly WEAPON_RANGE = GAME_BALANCE.weaponRange;
  private readonly SYSTEM_INNER_RADIUS = SYSTEM_GEOMETRY.innerRadius;
  private readonly SYSTEM_OUTER_RADIUS = SYSTEM_GEOMETRY.outerRadius;
  private readonly SYSTEM_BOUNDARY_RADIUS = SYSTEM_GEOMETRY.boundaryRadius;
  private readonly SCANNER_RANGE = GAME_BALANCE.scannerRange;

  // Quest Journal UI
  private questJournalUI: QuestJournalUI | null = null;

  // Target indicator
  private targetIndicator: Graphics | null = null;

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
  private readonly LANDING_RANGE: number = 60; // px: how close the ship must be to a planet to land
  private dayCounterText: Text | null = null;

  // Speed control HUD button (cycles 1×/2×/4×)
  private speedButton: UiButton | null = null;
  private speedIndex: number = 0; // index into GAME_BALANCE.gameSpeedMultipliers

  // Font-size settings: gear button + toggled panel (bottom-left HUD)
  private gearButton: UiButton | null = null;
  private settingsPanel: Container | null = null;

  // Two-step movement: plan route, then execute
  private plannedRoute: { x: number; y: number } | null = null;
  // If the active route targets a planet, its id — the ship auto-lands on arrival.
  private routeTargetPlanetId: string | null = null;
  // Full curved path (around the star) kept for drawing the route line; the
  // ship flows through it via ShipPhysics.setPath (no scene-side waypoint queue).
  private routePath: { x: number; y: number }[] = [];
  // Draws the planned-course overlay (dashed line, day ticks, end marker) —
  // extracted to a renderer that owns the Graphics; route planning stays here.
  private routeRenderer!: RouteRenderer;

  // Cosmetic take-off arc (Task 5): when the ship lifts off a planet it flies a
  // short outward curve before autopilot engages. Driven by a fixed-speed walk
  // along this polyline; the flight physics stays parked at the end point so no
  // game-days are burned and the day/landing logic in updateShip is bypassed.
  private takeoffArc: { x: number; y: number }[] | null = null;
  private takeoffArcDist = 0;
  private static readonly TAKEOFF_ARC_SPEED = 0.5; // px/ms

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

  // Camera zoom and pan
  private cameraZoom: number = 1.0;
  private cameraPanX: number = 0;
  private cameraPanY: number = 0;
  // Camera "look-ahead": while moving, the focus point leads the ship along its
  // heading so the player sees what's coming. Smoothed for a calm feel.
  private camLeadX: number = 0;
  private camLeadY: number = 0;
  private readonly panZoom = new PanZoomController();
  // Lower min zoom so the player can pull back to survey the now much larger
  // system (grand scale, EPIC-004).
  private readonly MIN_ZOOM = 0.25;
  private readonly MAX_ZOOM = 2.0;
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
  private backButton: Text | null = null;

  // Debug display
  private cameraDebugText: Text | null = null;

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
    this._combatTransitionPending = false;

    // If returning victorious from CombatScene, remove the defeated NPC from
    // the galaxy domain before createNpcShips() builds the sprite list.
    if (
      ctx?.combatResult === "victory" &&
      ctx.npcId &&
      this.gameEngine?.galaxy
    ) {
      this._npcSimulator.removeNpc(this.gameEngine.galaxy, ctx.npcId);
      this.completeBountyQuestsByNpcKill(ctx.npcId);
    }

    // Auto-complete EXPLORATION quests whose target is the current system.
    this.completeExplorationQuestsBySystemEntry();

    // Auto-complete DEFENSE quests targeting this system (OVERMIND liberations).
    this.completeDefenseQuestsBySystemEntry();

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
        this.showOvermindCorePrompt();
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
        panX: this.cameraPanX,
        panY: this.cameraPanY,
        zoom: this.cameraZoom,
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
    this.createPlanets(); // Planets added to gameLayer directly (not blurred)
    this.createStations(); // Space stations in this system (US-066)
    this.createNpcShips(); // NPC ships present in this system (Feature 8)
    this.createShip();
    this.createTargetIndicator();
    this.asteroidBelt.initialize(); // Foreground asteroids/comets (US-070 #1)
    this.createUI();

    // Took off from a planet → spawn right next to it (just outside its orbit),
    // not at the system edge. Planets are placed at a random orbital angle each
    // time the scene loads, so we resolve the position after createPlanets().
    if (ctx?.fromPlanetId && this.shipPhysics) {
      const sprite = this.planetSprites.find(
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
        this.takeoffArc = arc;
        this.takeoffArcDist = 0;
        if (this.shipContainer) {
          this.shipContainer.x = arc[0].x;
          this.shipContainer.y = arc[0].y;
        }
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
    // viewport; the camera follows the ship — see updateCamera).
    this.centerCameraOnShip();

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
      this.drawRouteLine();
      logger.info(
        `Pending warp: course to system edge plotted (${edgeX.toFixed(0)}, ${edgeY.toFixed(0)}) — press Ход to depart`,
      );
    }

    // Just dropped out of hyperspace → play the warp-exit flourish at the ship.
    if (ctx?.warpArrival && !this.pendingWarp) {
      this.playWarpArrivalEffect(
        this.shipPhysics.shipX,
        this.shipPhysics.shipY,
      );
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
    this.updateWarpEffect(deltaTime);
    this.updateShip(deltaTime);
    this.updateCombat(deltaTime);
    this.updateCameraReturn();
    this.updateCamera();
    this.updateNpcShips(deltaTime);
    this.updatePlanets(deltaTime);
    this.updateTargetIndicator();
    this.updatePlayPauseButton();
    this.updateMiniLog(deltaTime);
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
    this.backButton = null;
    this.playPauseButton = null;
    this.speedButton = null;
    this.speedIndex = 0;
    this.gearButton = null;
    if (this.settingsPanel) {
      this.settingsPanel.destroy({ children: true });
      this.settingsPanel = null;
    }
    this.isTurnRunning = false;
    this.turnHintShown = false;
    this.lowHullStopped = false;
    this._combatTransitionPending = false;
    this.cameraReturning = false;
    this.warpInProgress = false;
    this.waitDayAccum = 0;
    this.takeoffArc = null;
    this.takeoffArcDist = 0;

    // Destroy planet sprites
    for (const sprite of this.planetSprites) {
      sprite.destroy();
    }
    this.planetSprites = [];

    // Destroy station markers
    for (const m of this.stationMarkers) {
      this.renderer.gameLayer.removeChild(m.container);
      m.container.destroy({ children: true });
    }
    this.stationMarkers = [];
    this.routeTargetStationId = null;

    // Destroy planet info panel
    if (this.planetInfoPanel) {
      this.planetInfoPanel.destroy();
      this.planetInfoPanel = null;
    }

    // Destroy NPC ship sprites and contact panel
    for (const sprite of this.npcSprites) {
      sprite.destroy();
    }
    this.npcSprites = [];
    this.npcAnchorPlanet.clear();
    this.closeNpcContactPanel();
    this.followNpcId = null;

    // Clear any transient toast + its timer.
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }
    if (this.toast) {
      this.toast.destroy();
      this.toast = null;
    }

    // Clear tooltip.
    this.hideTooltip();

    // Clear mini-log.
    for (const e of this.miniLogEntries) e.textObj.destroy();
    this.miniLogEntries = [];
    this.miniLogContainer = null;

    // Destroy quest journal
    if (this.questJournalUI) {
      this.questJournalUI.destroy();
      this.questJournalUI = null;
    }

    if (this.overmindOverlay) {
      this.overmindOverlay.destroy({ children: true });
      this.overmindOverlay = null;
    }

    // Destroy mini-map
    if (this.systemMiniMap) {
      this.systemMiniMap.destroy();
      this.systemMiniMap = null;
    }

    // Tear down the star module (disposes its halo/sun filters and removes its
    // display objects from the game layer) before the layer-wide cleanup below.
    this.starRenderer?.destroy();
    // Tear down the asteroid field (removes + destroys its container).
    this.asteroidBelt?.destroy();
    // Tear down the orbit circles + boundary ring (removes + destroys them).
    this.orbitRenderer?.destroy();
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
    // init; just drop our references (consistent with uiContainer handling).
    this.warpEffect = null;
    this.bgElapsed = 0;
    this.shipContainer = null;
    this.shipGraphics = null;
    this.shipGlow = null;
    this.shipSprite = null;
    this.uiContainer = null;
    this.cameraDebugText = null;
    this.dayCounterText = null;
    this.shipPhysics = null;
    this.targetIndicator = null;
    this.distanceTraveled = 0;
    this.clearPlannedRoute(); // Clean up route line
    logger.info("SpaceFlightScene destroyed");
  }

  /**
   * A BlurFilter with generous padding. PixiJS renders a filter into a texture
   * sized to the object's bounds + padding; if the padding is too small the
   * blur is clipped at the texture edge and shows as a hard rectangular band —
   * especially once the gameLayer is scaled by the camera zoom. Padding ~2×
   * the blur strength keeps the falloff inside the texture so no edge appears.
   */
  private paddedBlur(strength: number): BlurFilter {
    const f = new BlurFilter({ strength });
    // The Gaussian kernel reaches ~3σ; pad well beyond that (and beyond the
    // worst-case camera zoom) so the blur's falloff always stays inside the
    // filter texture. Too-tight padding shows as moving rectangular bands once
    // the gameLayer is scaled or the filtered object rotates (US-070 streaks).
    f.padding = Math.ceil(strength * 3 + 24);
    // Pin the filter resolution to 1 so the intermediate texture doesn't balloon
    // with camera zoom / device pixel ratio and get clamped to the max texture
    // size — that clamp is what produced the hard bands across the canvas.
    f.resolution = 1;
    return f;
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

  /**
   * Warp-exit flourish (US-043): a bright flash, expanding shock rings and a
   * lingering glow at the point where the ship drops out of hyperspace.
   */
  private playWarpArrivalEffect(x: number, y: number): void {
    const container = new Container();
    container.x = x;
    container.y = y;

    const color = 0x9fe8ff;

    const glow = new Graphics();
    glow.circle(0, 0, 90).fill({ color, alpha: 0.0 });
    glow.filters = [this.paddedBlur(24)];
    container.addChild(glow);

    const flash = new Graphics();
    flash.circle(0, 0, 60).fill({ color: 0xffffff, alpha: 1 });
    flash.filters = [this.paddedBlur(12)];
    container.addChild(flash);

    const rings: Graphics[] = [];
    for (let i = 0; i < 3; i++) {
      const ring = new Graphics();
      ring.circle(0, 0, 20).stroke({ width: 4, color, alpha: 0.9 });
      container.addChild(ring);
      rings.push(ring);
    }

    this.renderer.gameLayer.addChild(container);
    this.warpEffect = {
      container,
      rings,
      flash,
      glow,
      elapsed: 0,
      duration: 1100,
    };
  }

  private createShip(): void {
    if (!this.shipPhysics) return;

    this.shipContainer = new Container();

    // Volumetric glow blob drawn FIRST so it sits behind the hull/sprite. A soft
    // blue halo reads as depth and keeps the ship visible against dark space.
    // Whether the active hull is the sprite or the procedural triangle, this glow
    // is the "behind the ship" depth cue — for the sprite case it stands in for
    // an outline filter (no @pixi/filter-outline dependency in this project).
    this.shipGlow = new Graphics();
    this.shipGlow.eventMode = "none";
    this.shipContainer.addChild(this.shipGlow);

    this.shipGraphics = new Graphics();
    this.shipContainer.addChild(this.shipGraphics);

    // Prefer ship art (ranger hull) when available; the procedural triangle is
    // the fallback (drawShip skips the hull when a sprite is present).
    const shipTex = pickVariant("ships", "ranger", "player_ship");
    if (shipTex) {
      const sp = new Sprite(shipTex);
      sp.anchor.set(0.5);
      const size = this.SHIP_SIZE * 2.6;
      sp.width = size;
      sp.height = size;
      sp.rotation = this.SHIP_SPRITE_ROTATION;
      sp.eventMode = "none";
      this.shipSprite = sp;
      this.shipContainer.addChild(sp);
    }

    // Size the glow to the active hull representation, then blur it. The sprite
    // is ~2.6× larger than the procedural triangle, so its glow is wider to peek
    // out past the artwork edges.
    const glowRadius = this.shipSprite ? this.SHIP_SIZE * 1.6 : 18;
    this.shipGlow
      .circle(0, 0, glowRadius)
      .fill({ color: 0x2244aa, alpha: 0.35 });
    this.shipGlow.filters = [this.paddedBlur(8)];

    // Draw ship body (procedural triangle; no-op hull when a sprite is used)
    this.drawShip();

    this.shipContainer.zIndex = 110; // player ship above NPCs and planets
    this.shipContainer.x = this.shipPhysics.shipX;
    this.shipContainer.y = this.shipPhysics.shipY;
    this.shipContainer.pivot.set(0, 0);

    this.renderer.gameLayer.addChild(this.shipContainer);
  }

  /**
   * Create target indicator (crosshair showing where ship is heading)
   */
  private createTargetIndicator(): void {
    this.targetIndicator = new Graphics();
    this.targetIndicator.eventMode = "none"; // decorative — never intercept clicks
    this.targetIndicator.visible = false; // Hidden by default
    this.renderer.gameLayer.addChild(this.targetIndicator);
  }

  /**
   * Update target indicator position and visibility
   */
  private updateTargetIndicator(): void {
    if (!this.targetIndicator || !this.shipPhysics) return;

    const distance = this.shipPhysics.getDistanceToTarget();

    // Show indicator only if ship is moving and target is far enough
    if (this.shipPhysics.isMoving && distance > 20) {
      this.targetIndicator.visible = true;
      this.targetIndicator.clear();

      // Draw pulsing crosshair at target position
      const targetX = this.shipPhysics.getTargetX();
      const targetY = this.shipPhysics.getTargetY();

      const size = 15;
      const pulse = Math.sin(this.bgElapsed / 200) * 0.3 + 0.7; // Pulsing effect

      // Crosshair lines
      this.targetIndicator.moveTo(targetX - size, targetY);
      this.targetIndicator.lineTo(targetX + size, targetY);
      this.targetIndicator.moveTo(targetX, targetY - size);
      this.targetIndicator.lineTo(targetX, targetY + size);
      this.targetIndicator.stroke({ width: 2, color: 0x00ffff, alpha: pulse });

      // Center circle
      this.targetIndicator.circle(targetX, targetY, 4);
      this.targetIndicator.stroke({
        width: 1,
        color: 0x00ffff,
        alpha: pulse * 0.8,
      });
    } else {
      this.targetIndicator.visible = false;
    }
  }

  private drawShip(): void {
    if (!this.shipGraphics || !this.shipPhysics) return;
    this.shipGraphics.clear();

    // When ship art is present, the sprite is the hull — skip the procedural
    // triangle (it would draw on top of the sprite).
    if (this.shipSprite) return;

    const size = this.SHIP_SIZE;

    // Main hull — drawn as a fill, then re-stroked with a crisp cyan rim so the
    // silhouette reads clearly against dark space.
    const hull = [
      size,
      0,
      -size * 0.7,
      -size * 0.6,
      -size * 0.4,
      0,
      -size * 0.7,
      size * 0.6,
    ];
    this.shipGraphics.poly(hull).fill({ color: 0x4488cc });
    this.shipGraphics
      .poly(hull)
      .stroke({ color: 0x44ccff, alpha: 0.9, width: 1.5 });

    // Cockpit
    this.shipGraphics
      .poly([
        size * 0.3,
        0,
        -size * 0.2,
        -size * 0.25,
        -size * 0.2,
        size * 0.25,
      ])
      .fill({ color: 0x88ccff });

    // Engine glow (visible when ship is moving). bgElapsed is in ms, so /80 gives
    // a ~0.5 s pulse; the alpha now swings 0.10–1.0 (amplitude 0.45) for a strong
    // engine flicker, and the flame reaches further (0.7× vs 0.5×).
    if (this.shipPhysics.isMoving) {
      const enginePulse = 0.5 + 0.5 * Math.sin(this.bgElapsed / 80);
      this.shipGraphics
        .poly([
          -size * 0.5,
          -size * 0.4,
          -size * 0.5 - size * 0.7 * enginePulse,
          0,
          -size * 0.5,
          size * 0.4,
        ])
        .fill({
          color: 0x00ffff,
          alpha: 0.55 + 0.45 * Math.sin(this.bgElapsed / 80),
        });
    }

    // Engine lights
    this.shipGraphics.fill({ color: 0x00ffff, alpha: 0.8 });
    this.shipGraphics.circle(-size * 0.5, -size * 0.3, 2);
    this.shipGraphics.circle(-size * 0.5, size * 0.3, 2);
  }

  private createUI(): void {
    this.uiContainer = new Container();
    // Container uses default eventMode ('auto') - it won't block clicks since it has no handlers
    // Child elements with eventMode='static' will receive events

    // Instructions (non-interactive)
    const instructions = new Text({
      text: "ЛКМ - курс | Shift+ЛКМ/ПКМ - пан | Колесико - зум | [J] - Квесты | [I] - Инвентарь",
      style: {
        fontFamily: "Courier New",
        fontSize: scaledFont(13),
        fill: 0x88ccff,
      },
    });
    instructions.alpha = 0.8;
    instructions.x = 20;
    instructions.y = 20;
    instructions.eventMode = "none"; // Explicitly set to non-interactive
    this.uiContainer.addChild(instructions);

    // Camera debug display (development only)
    if (__DEBUG__) {
      this.cameraDebugText = new Text({
        text: "Камера: Zoom 1.00 | Pan (0, 0)",
        style: {
          fontFamily: "Courier New",
          fontSize: scaledFont(12),
          fill: 0xff00ff,
        },
      });
      this.cameraDebugText.x = this.renderer.app.screen.width - 300;
      this.cameraDebugText.y = this.renderer.app.screen.height - 30;
      this.cameraDebugText.eventMode = "none";
      this.uiContainer.addChild(this.cameraDebugText);
    }

    // Current date display
    this.dayCounterText = new Text({
      text: formatGameDate(this.gameEngine?.galaxy?.gameDays ?? 0),
      style: {
        fontFamily: "Courier New",
        fontSize: scaledFont(14),
        fill: 0x00ffff,
      },
    });
    this.dayCounterText.x = 20;
    this.dayCounterText.y = 50;
    this.uiContainer.addChild(this.dayCounterText);

    // Quest Journal button
    const questBtn = new Text({
      text: "[КВЕСТЫ]",
      style: {
        fontFamily: "Courier New",
        fontSize: scaledFont(14),
        fill: 0xffaa00,
        fontWeight: "bold" as const,
      },
    });
    questBtn.x = 20;
    questBtn.y = 80;
    questBtn.eventMode = "static";
    questBtn.cursor = "pointer";
    questBtn.on("pointerdown", (event) => {
      event.stopPropagation();
      this.gameEngine?.audio?.playUiClick();
      logger.info("Quest journal button clicked");
      this.toggleQuestJournal();
    });
    questBtn.on("pointerover", () => {
      this.gameEngine?.audio?.playUiHover();
      questBtn.alpha = 0.7;
    });
    questBtn.on("pointerout", () => {
      questBtn.alpha = 1;
    });
    this.uiContainer.addChild(questBtn);

    // Star map button
    const backBtn = new Text({
      text: "[МЕЖЗВЕЗДНАЯ КАРТА]",
      style: {
        fontFamily: "Courier New",
        fontSize: scaledFont(14),
        fill: 0xffaa00,
        fontWeight: "bold" as const,
      },
    });
    backBtn.x = this.renderer.app.screen.width - 220;
    backBtn.y = 20;
    backBtn.eventMode = "static";
    backBtn.cursor = "pointer";
    backBtn.on("pointerdown", async (event) => {
      event.stopPropagation();
      this.gameEngine?.audio?.playUiClick();
      logger.info("Star map button clicked");
      await this.returnToStarMap();
    });

    backBtn.on("pointerover", () => {
      this.gameEngine?.audio?.playUiHover();
      backBtn.alpha = 0.7;
    });
    backBtn.on("pointerout", () => {
      backBtn.alpha = 1;
    });

    this.uiContainer.addChild(backBtn);
    this.backButton = backBtn;

    // Play / Pause turn control (bottom-centre). Play runs the planned turn;
    // while moving it becomes Pause, which ends the turn at the next day segment.
    const PLAY_BTN_W = 140;
    const PLAY_BTN_H = 36;
    const playBtn = new UiButton(
      "",
      "▶ ХОД",
      "success",
      (event) => {
        event.stopPropagation();
        this.gameEngine?.audio?.playUiClick();
        this.onPlayPause();
      },
      PLAY_BTN_W,
      PLAY_BTN_H,
    );
    playBtn.x = this.renderer.app.screen.width / 2 - PLAY_BTN_W / 2;
    playBtn.y = this.renderer.app.screen.height - PLAY_BTN_H - 18;
    playBtn.on("pointerover", () => {
      this.gameEngine?.audio?.playUiHover();
    });
    // Pin the pointer cursor explicitly so scene-level cursor updates
    // (updateInteractiveCursors) can never reset the Ход button to "default"
    // — it only ever touches planet/NPC sprites, but this is belt-and-suspenders.
    playBtn.container.cursor = "pointer";
    this.uiContainer.addChild(playBtn.container);
    this.playPauseButton = playBtn;

    this.renderer.uiLayer.addChild(this.uiContainer);

    // Mini-log (B5): bottom-left panel showing the last 5 game events.
    this.miniLogContainer = new Container();
    this.miniLogContainer.eventMode = "none";
    this.miniLogContainer.x = 20;
    this.miniLogContainer.y = this.renderer.app.screen.height - 105;
    this.renderer.uiLayer.addChild(this.miniLogContainer);

    // Create mini-map. Dragging on it pans the main view (it no longer falls
    // through as a navigation click).
    this.systemMiniMap = new SystemMiniMap(
      this.renderer.app.screen.width,
      this.renderer.app.screen.height,
    );
    this.systemMiniMap.setPanHandler((worldX, worldY) =>
      this.focusCameraOnWorld(worldX, worldY),
    );
    this.systemMiniMap.setReturnCameraHandler(() => this.startCameraReturn());
    this.renderer.uiLayer.addChild(this.systemMiniMap.container);

    // Speed button: cycles 1×/2×/4× — placed above the minimap (bottom-right).
    const SPEED_BTN_W = 52;
    const SPEED_BTN_H = 28;
    const speedBtn = new UiButton(
      "",
      "1×",
      "neutral",
      (event) => {
        event.stopPropagation();
        this.cycleGameSpeed();
      },
      SPEED_BTN_W,
      SPEED_BTN_H,
    );
    speedBtn.x = this.renderer.app.screen.width - 20 - SPEED_BTN_W;
    speedBtn.y = this.renderer.app.screen.height - 220 - SPEED_BTN_H;
    this.renderer.uiLayer.addChild(speedBtn.container);
    this.speedButton = speedBtn;

    // Gear button (⚙) — bottom-left, above mini-log — opens font-size panel.
    const GEAR_BTN_W = 36;
    const GEAR_BTN_H = 32;
    const gearBtn = new UiButton(
      "⚙",
      "",
      "neutral",
      (event) => {
        event.stopPropagation();
        this.toggleSettingsPanel();
      },
      GEAR_BTN_W,
      GEAR_BTN_H,
    );
    gearBtn.x = 20;
    gearBtn.y = this.renderer.app.screen.height - 130 - GEAR_BTN_H;
    this.renderer.uiLayer.addChild(gearBtn.container);
    this.gearButton = gearBtn;
  }

  /** Toggle the font-size mini-panel (S / M / L). */
  private toggleSettingsPanel(): void {
    if (this.settingsPanel) {
      this.settingsPanel.destroy({ children: true });
      this.settingsPanel = null;
      return;
    }
    if (!this.gearButton) return;
    const panel = new Container();
    panel.eventMode = "static";
    panel.on("pointerdown", (e) => e.stopPropagation());
    const panelW = 120;
    const panelH = 44;
    const panelX = this.gearButton.x;
    const panelY = this.gearButton.y - panelH - 4;

    const bg = new Graphics();
    bg.roundRect(0, 0, panelW, panelH, 4).fill({
      color: 0x0a1520,
      alpha: 0.92,
    });
    bg.roundRect(0, 0, panelW, panelH, 4).stroke({ color: 0x334455, width: 1 });
    panel.addChild(bg);

    const active = currentFontSizeKey();
    const sizes: FontSizeKey[] = ["S", "M", "L"];
    const labels = ["A", "A", "A"];
    const btnFontSizes = [scaledFont(14), scaledFont(18), scaledFont(22)];

    sizes.forEach((key, i) => {
      const isActive = key === active;
      const btnX = 8 + i * 36;
      const btnY = 6;
      const btnW = 30;
      const btnH = 32;

      const btnBg = new Graphics();
      btnBg.roundRect(btnX, btnY, btnW, btnH, 3).fill({
        color: isActive ? 0x1a3048 : 0x0e1e2c,
        alpha: 1,
      });
      if (isActive) {
        btnBg.roundRect(btnX, btnY, btnW, btnH, 3).stroke({
          color: 0x00ccff,
          width: 1,
        });
      }
      btnBg.eventMode = "none";
      panel.addChild(btnBg);

      const lbl = new Text({
        text: labels[i],
        style: {
          fontFamily: "Courier New",
          fontSize: btnFontSizes[i],
          fill: isActive ? 0x00ccff : 0x88aacc,
        },
      });
      lbl.anchor.set(0.5);
      lbl.x = btnX + btnW / 2;
      lbl.y = btnY + btnH / 2;
      lbl.eventMode = "none";
      panel.addChild(lbl);

      const hit = new Graphics();
      hit
        .roundRect(btnX, btnY, btnW, btnH, 3)
        .fill({ color: 0xffffff, alpha: 0.001 });
      hit.eventMode = "static";
      hit.cursor = "pointer";
      hit.on("pointerdown", (event) => {
        event.stopPropagation();
        setFontScale(key);
        if (this.settingsPanel) {
          this.settingsPanel.destroy({ children: true });
          this.settingsPanel = null;
        }
        if (this.gameEngine) {
          void this.gameEngine.transitionTo(SceneType.SPACE_FLIGHT, {
            gameEngine: this.gameEngine,
          });
        }
      });
      panel.addChild(hit);
    });

    panel.x = panelX;
    panel.y = panelY;
    this.renderer.uiLayer.addChild(panel);
    this.settingsPanel = panel;
  }

  /**
   * Create planet sprites for the current star system
   */
  private createPlanets(): void {
    if (!this.gameEngine?.player) return;

    // Get current system
    const currentSystemId = this.gameEngine.player.currentSystemId;
    const galaxy = this.gameEngine.galaxy;
    if (!galaxy) return;

    const currentSystem = galaxy.systems.find((s) => s.id === currentSystemId);
    if (
      !currentSystem ||
      !currentSystem.planets ||
      currentSystem.planets.length === 0
    ) {
      logger.debug("No planets in current system");
      return;
    }

    // Get quest objective locations
    const questLocations =
      this.gameEngine.questManager.getActiveQuestLocations();

    // Orbital position is a deterministic function of the (persisted) game-day
    // count, so planets sit where they should every time the scene loads — no
    // more random teleport-around-the-sun after landing (US-070 #9). The base
    // angle is derived from the planet id so each planet starts at a stable,
    // distinct point on its orbit.
    const gameDays = this.gameEngine.galaxy?.gameDays ?? 0;
    for (const planet of currentSystem.planets) {
      const baseAngle = hashToAngle(planet.id);
      const sprite = new PlanetSprite(
        planet,
        this.starRenderer.centerX,
        this.starRenderer.centerY,
        baseAngle,
        gameDays,
      );

      // Set up click handler
      sprite.createHitArea(this.onPlanetClick.bind(this));

      // Tooltip on hover (B1) — immediate rich tooltip for planets.
      const systemFaction = currentSystem.ownerFaction;
      sprite.setTooltipHandlers(
        (p, sx, sy) => this.showPlanetTooltip(p, systemFaction, sx, sy),
        () => this.hideTooltip(),
      );

      // Add quest marker if this planet is a quest objective
      if (questLocations.includes(planet.id)) {
        this.addQuestMarker(sprite);
      }

      // zIndex 50 so ships behind the disc (zIndex 40) are occluded and ships
      // in front (zIndex 100) render on top — see updateNpcDepth().
      sprite.container.zIndex = 50;
      this.renderer.gameLayer.addChild(sprite.container);
      this.planetSprites.push(sprite);
    }

    logger.info(`Created ${this.planetSprites.length} planet sprites`);
  }

  /**
   * Add quest marker (pulsing ring) to a planet sprite
   */
  private addQuestMarker(sprite: PlanetSprite): void {
    const marker = new Graphics();

    // Draw pulsing ring around planet
    const radius = 25; // Slightly larger than planet
    marker.circle(0, 0, radius);
    marker.stroke({ width: 3, color: 0xffff00, alpha: 0.8 });

    // Add to planet container so it rotates with planet
    sprite.container.addChild(marker);

    logger.debug(`Added quest marker to planet ${sprite.planet.name}`);
  }

  // ── Station rendering (US-066) ──────────────────────────────────────────────

  private createStations(): void {
    const currentSystemId = this.gameEngine?.player?.currentSystemId;
    const galaxy = this.gameEngine?.galaxy;
    if (!currentSystemId || !galaxy) return;

    const currentSystem = galaxy.systems.find((s) => s.id === currentSystemId);
    if (!currentSystem || !currentSystem.stations.length) return;

    for (const station of currentSystem.stations) {
      const wx =
        this.starRenderer.centerX +
        Math.cos(station.orbitAngle) * station.orbitRadius;
      const wy =
        this.starRenderer.centerY +
        Math.sin(station.orbitAngle) * station.orbitRadius;

      const ctn = new Container();
      ctn.x = wx;
      ctn.y = wy;
      ctn.zIndex = 90;

      // Diamond shape coloured by station type
      const stationColor = this.stationColor(
        station.type as import("@/types").StationType,
      );
      const g = new Graphics();
      g.poly([0, -14, 10, 0, 0, 14, -10, 0]);
      g.fill({ color: stationColor, alpha: 0.85 });
      g.stroke({ color: 0xffffff, width: 1, alpha: 0.4 });
      g.eventMode = "none";
      ctn.addChild(g);

      // Small label
      const label = new Text({
        text: station.name.slice(0, 22),
        style: {
          fontSize: scaledFont(10),
          fill: stationColor,
          fontFamily: "monospace",
        },
      });
      label.anchor.set(0.5, 0);
      label.y = 18;
      label.eventMode = "none";
      ctn.addChild(label);

      // Hit area for clicking
      const hit = new Graphics();
      hit.circle(0, 0, 20);
      hit.fill({ color: 0xffffff, alpha: 0.001 });
      hit.eventMode = "static";
      hit.cursor = "pointer";
      hit.on("pointerdown", (e) => {
        e.stopPropagation();
        this.onStationClick(station);
      });
      ctn.addChild(hit);

      this.renderer.gameLayer.addChild(ctn);
      this.stationMarkers.push({ station, container: ctn, x: wx, y: wy });
    }

    logger.info(`Created ${this.stationMarkers.length} station markers`);
  }

  private stationColor(type: import("@/types").StationType): number {
    switch (type) {
      case "TRADE_POST":
        return 0xffcc44;
      case "REPAIR_DOCK":
        return 0x44aaff;
      case "MILITARY_BASE":
        return 0xff5544;
      case "RESEARCH_LAB":
        return 0xcc88ff;
      default:
        return 0xaaaaaa;
    }
  }

  private onStationClick(station: Station): void {
    logger.debug(`Station clicked: ${station.name}`);
    if (!this.shipPhysics) return;

    const marker = this.stationMarkers.find((m) => m.station.id === station.id);
    if (!marker) return;

    this.routeTargetStationId = station.id;
    this.routeTargetPlanetId = null;
    this.followNpcId = null;

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

  private readonly DOCKING_RANGE = 55;

  private async onDockAtStation(station: Station): Promise<void> {
    if (!this.gameEngine) return;
    logger.info(`Docking at station: ${station.name}`);
    this.clearPlannedRoute();
    this.routeTargetStationId = null;
    await this.gameEngine.transitionTo(SceneType.STATION, {
      gameEngine: this.gameEngine,
      station,
    });
  }

  /**
   * Handle planet click: two-step movement - plan route on first click, execute on second
   */
  private onPlanetClick(planet: Planet): void {
    if (this.isTurnRunning) return;

    logger.debug(
      `Planet clicked: ${planet.name}, plannedRoute=${JSON.stringify(this.plannedRoute)}, routeTargetPlanetId=${this.routeTargetPlanetId}`,
    );

    const planetSprite = this.planetSprites.find(
      (s) => s.planet.id === planet.id,
    );
    if (!planetSprite || !this.shipPhysics) return;

    this.followNpcId = null; // picking a planet cancels auto-follow

    // Compute approach point at planet edge (ship-facing side) so the route
    // preview stops at the disc surface rather than cutting through to the centre.
    const approachPt = planetApproachPoint(
      this.shipPhysics.shipX,
      this.shipPhysics.shipY,
      planetSprite.screenX,
      planetSprite.screenY,
      planetSprite.displayRadius,
      GAME_BALANCE.landingApproachOffset,
    );
    logger.debug(
      `Planet ${planet.name}: approach pt (${approachPt.x.toFixed(0)}, ${approachPt.y.toFixed(0)})`,
    );

    // Detect second click via planet ID (stable even as the planet orbits),
    // not position proximity (which broke when the planet moved between clicks).
    const isSamePlanet = this.routeTargetPlanetId === planet.id;
    this.routeTargetPlanetId = planet.id;

    // Curve the approach into a spiral-in around the planet's orbit edge (Task 5).
    const landing = {
      planetX: planetSprite.screenX,
      planetY: planetSprite.screenY,
      planetRadius: planetSprite.displayRadius,
    };

    if (this.plannedRoute && isSamePlanet) {
      // Second click on same planet - execute the route
      this.executeRouteTo(approachPt.x, approachPt.y, landing);
      logger.info(`▶️ Executing route to planet ${planet.name}`);
    } else {
      // First click or different planet - plan the route preview
      this.planRouteTo(approachPt.x, approachPt.y, landing);
      logger.info(
        `🗺️ Route planned to planet ${planet.name}. Click again to execute.`,
      );
    }

    // Show planet info panel. Landing is only offered once the ship has
    // actually flown to the planet; otherwise a single click would teleport the
    // player there (game-days only accrue while the ship is in motion).
    if (this.planetInfoPanel) {
      this.planetInfoPanel.destroy();
      this.planetInfoPanel = null;
    }

    const distanceX = planetSprite.screenX - this.shipPhysics.shipX;
    const distanceY = planetSprite.screenY - this.shipPhysics.shipY;
    const distanceToPlanet = Math.sqrt(
      distanceX * distanceX + distanceY * distanceY,
    );
    const flightDays = Math.max(
      1,
      Math.ceil(distanceToPlanet / this.DISTANCE_PER_DAY),
    );
    const shipAtPlanet =
      distanceToPlanet <= this.landingThreshold(planetSprite);

    const currentSystemId = this.gameEngine?.player?.currentSystemId;
    const currentSystem = this.gameEngine?.galaxy?.systems.find(
      (s) => s.id === currentSystemId,
    );
    this.planetInfoPanel = new PlanetInfoPanel(
      planet,
      this.renderer.app.screen.width,
      this.renderer.app.screen.height,
      flightDays,
      shipAtPlanet ? () => this.onLandOnPlanet(planet) : undefined,
      currentSystem?.ownerFaction,
    );
    this.renderer.uiLayer.addChild(this.planetInfoPanel.container);
  }

  /**
   * Distance (px) from the ship to a planet's centre at which landing is
   * allowed. Planets render large (US-070 #3), so this is the surface radius
   * plus a fixed approach margin — otherwise the ship would have to fly to the
   * planet's centre, deep inside the disc, before it could land.
   */
  private landingThreshold(sprite: PlanetSprite): number {
    return sprite.displayRadius + this.LANDING_RANGE;
  }

  private async onLandOnPlanet(planet: Planet): Promise<void> {
    // Guard: only allow landing when the ship has actually reached the planet.
    // Game-days already accrue during the flight (see updateShip), so we do NOT
    // simulate flightDays here — doing so previously let a single click both
    // teleport the player and skip days for free.
    const sprite = this.planetSprites.find((s) => s.planet.id === planet.id);
    if (sprite && this.shipPhysics) {
      const dx = sprite.screenX - this.shipPhysics.shipX;
      const dy = sprite.screenY - this.shipPhysics.shipY;
      if (Math.sqrt(dx * dx + dy * dy) > this.landingThreshold(sprite)) {
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
        this.showMessage("⏸ Поставь на паузу чтобы выбрать маршрут", 0xffcc00);
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
      const world = this.screenToWorld(event.global.x, event.global.y);

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
          this.routeTargetPlanetId = null;
          this.routeTargetStationId = null;
          this.followNpcId = null;
          this.pendingWarp = null; // cancel warp if user picks a different destination
          this.planRouteTo(world.x, world.y);
          logger.info(
            `🗺️ Route updated to (${world.x.toFixed(0)}, ${world.y.toFixed(0)})`,
          );
        }
      } else {
        // First click - plan the route (don't start moving yet)
        this.routeTargetPlanetId = null;
        this.routeTargetStationId = null;
        this.followNpcId = null;
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
    if (panDelta) {
      this.cameraPanX += panDelta.dx;
      this.cameraPanY += panDelta.dy;
      this.applyCameraTransform();
      if (Math.abs(panDelta.dx) > 1 || Math.abs(panDelta.dy) > 1) {
        logger.info(
          `📍 Camera pan: (${this.cameraPanX.toFixed(0)}, ${this.cameraPanY.toFixed(0)})`,
        );
      }
    }
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
   * Handle mouse wheel for zoom
   */
  private onWheel(event: WheelEvent): void {
    event.preventDefault();

    // Do not zoom while a pan drag is in progress. Middle-button "auto-scroll"
    // (and trackpad momentum) can emit wheel events during a pan; suppressing
    // them here keeps panning from also zooming (bug: pan + unwanted zoom).
    if (this.panZoom.isPanning) return;

    logger.debug(`🔍 WHEEL EVENT FIRED! deltaY: ${event.deltaY}`);

    const oldZoom = this.cameraZoom;

    // Calculate zoom delta (negative deltaY = zoom in, positive = zoom out)
    const zoomDelta = event.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = this.cameraZoom * zoomDelta;

    // Clamp zoom to min/max bounds
    const clampedZoom = Math.max(
      this.MIN_ZOOM,
      Math.min(this.MAX_ZOOM, newZoom),
    );

    // Zoom towards the mouse cursor so the world point under the pointer stays
    // fixed (US-070 #4). The wheel listener is on `window`, so the event carries
    // viewport coordinates — convert them to canvas-local screen coordinates.
    const rect = this.renderer.app.canvas.getBoundingClientRect();
    const anchorX = event.clientX - rect.left;
    const anchorY = event.clientY - rect.top;

    // World coordinates of the anchor point before zoom
    const worldAnchorX = (anchorX - this.cameraPanX) / this.cameraZoom;
    const worldAnchorY = (anchorY - this.cameraPanY) / this.cameraZoom;

    // Update zoom
    this.cameraZoom = clampedZoom;

    // Adjust pan to keep the anchor point under the cursor at the same position
    this.cameraPanX = anchorX - worldAnchorX * this.cameraZoom;
    this.cameraPanY = anchorY - worldAnchorY * this.cameraZoom;

    this.applyCameraTransform();
    logger.info(
      `Camera zoom: ${oldZoom.toFixed(2)} → ${this.cameraZoom.toFixed(2)} (deltaY: ${event.deltaY})`,
    );
  }

  /**
   * Apply camera zoom and pan to game layer
   */
  /**
   * Camera-follow: while the ship is flying, keep it centred (the system is
   * larger than the viewport). When the ship is stopped, the camera is left
   * alone so the player can freely pan/zoom to look around (consistent with the
   * turn-based pause, and preserves manual pan behaviour).
   */
  private updateCamera(): void {
    if (!this.shipPhysics) return;
    const moving =
      this.shipPhysics.isMoving && this.shipPhysics.currentSpeed > 0.01;
    const hasLead =
      Math.abs(this.camLeadX) > 0.5 || Math.abs(this.camLeadY) > 0.5;
    // Follow with smoothed look-ahead while moving; once stopped, let the
    // residual lead ease to zero and then STOP touching the camera — so the
    // player can freely pan to examine the map without it snapping back to the
    // ship (US-070: don't yank the view to the ship between turns).
    if (moving || hasLead) {
      this.cameraReturning = false; // ship motion follow takes over
      this.focusCameraWithLead();
    }
  }

  /**
   * Pan the camera so a point *ahead* of the ship (along its heading, scaled by
   * speed) sits at screen centre — the ship rides toward the back of the view
   * and the player can see what's coming. The lead is smoothed each frame.
   */
  private focusCameraWithLead(): void {
    if (!this.shipPhysics) return;
    const cx = this.renderer.app.screen.width / 2;
    const cy = this.renderer.app.screen.height / 2;

    // Desired lead (world units) in the heading direction, up to ~34% of a
    // half-screen ahead at full speed. Zero when stopped → ship recenters.
    const maxLeadWorld = (cx * 0.34) / this.cameraZoom;
    const f = Math.min(1, this.shipPhysics.getSpeedFraction() * 1.4);
    const desired = maxLeadWorld * f;
    const desiredX = Math.cos(this.shipPhysics.shipAngle) * desired;
    const desiredY = Math.sin(this.shipPhysics.shipAngle) * desired;

    // Smooth toward the desired lead (and toward 0 when slowing/stopped).
    this.camLeadX += (desiredX - this.camLeadX) * 0.06;
    this.camLeadY += (desiredY - this.camLeadY) * 0.06;

    const focusX = this.shipPhysics.shipX + this.camLeadX;
    const focusY = this.shipPhysics.shipY + this.camLeadY;
    // Ease the camera toward the target pan instead of snapping the ship to dead
    // centre every frame — a gentle follow so the view glides rather than jerks
    // when the ship turns or changes speed (US-070: camera not so abrupt).
    const targetPanX = cx - focusX * this.cameraZoom;
    const targetPanY = cy - focusY * this.cameraZoom;
    const FOLLOW = 0.08; // lower = smoother / more lag
    this.cameraPanX += (targetPanX - this.cameraPanX) * FOLLOW;
    this.cameraPanY += (targetPanY - this.cameraPanY) * FOLLOW;
    this.applyCameraTransform();
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

    if (this.backButton) {
      this.backButton.x = w - 220;
      this.backButton.y = 20;
    }
    if (this.cameraDebugText) {
      this.cameraDebugText.x = w - 300;
      this.cameraDebugText.y = h - 30;
    }
    if (this.toast) {
      this.toast.x = w / 2;
    }
    if (this.playPauseButton) {
      this.playPauseButton.x = w / 2 - 70;
      this.playPauseButton.y = h - 54;
    }
    this.systemMiniMap?.reposition(w, h);

    if (this.speedButton) {
      this.speedButton.x = w - 20 - 52;
      this.speedButton.y = h - 248;
    }

    if (this.gearButton) {
      this.gearButton.y = h - 162;
    }
    if (this.settingsPanel && this.gearButton) {
      this.settingsPanel.y = this.gearButton.y - 48;
    }

    if (this.miniLogContainer) {
      this.miniLogContainer.y = h - 105;
    }
    if (this.dayCounterText) {
      this.dayCounterText.y = 50;
    }

    // Keep the ship framed after the viewport changed.
    if (this.shipPhysics) this.centerCameraOnShip();
  }

  /**
   * Centre the main view on a world point — used by the radar drag-to-pan. The
   * residual camera lead is cleared so the view doesn't snap back while idle.
   */
  private focusCameraOnWorld(worldX: number, worldY: number): void {
    const cx = this.renderer.app.screen.width / 2;
    const cy = this.renderer.app.screen.height / 2;
    this.camLeadX = 0;
    this.camLeadY = 0;
    this.cameraPanX = cx - worldX * this.cameraZoom;
    this.cameraPanY = cy - worldY * this.cameraZoom;
    this.applyCameraTransform();
  }

  /** Snap the camera so the ship sits exactly at screen centre (spawn). */
  private centerCameraOnShip(): void {
    if (!this.shipPhysics) return;
    const cx = this.renderer.app.screen.width / 2;
    const cy = this.renderer.app.screen.height / 2;
    this.camLeadX = 0;
    this.camLeadY = 0;
    this.cameraReturning = false;
    this.cameraPanX = cx - this.shipPhysics.shipX * this.cameraZoom;
    this.cameraPanY = cy - this.shipPhysics.shipY * this.cameraZoom;
    this.applyCameraTransform();
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
      const marker = this.stationMarkers.find(
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
      const sprite = this.planetSprites.find((s) => s.planet.id === landedId);
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
    if (this.shipContainer) {
      this.shipContainer.x = spawnX;
      this.shipContainer.y = spawnY;
    }
  }

  /** Activate the lerp-return animation toward the ship (⊙ button handler). */
  private startCameraReturn(): void {
    this.camLeadX = 0;
    this.camLeadY = 0;
    this.cameraReturning = true;
  }

  /**
   * Each frame: lerp the camera toward the ship's centred position.
   * Clears `cameraReturning` once the ship is within 1 px of the target.
   */
  private updateCameraReturn(): void {
    if (!this.cameraReturning || !this.shipPhysics) return;
    const cx = this.renderer.app.screen.width / 2;
    const cy = this.renderer.app.screen.height / 2;
    const targetPanX = cx - this.shipPhysics.shipX * this.cameraZoom;
    const targetPanY = cy - this.shipPhysics.shipY * this.cameraZoom;
    const LERP = 0.12;
    this.cameraPanX += (targetPanX - this.cameraPanX) * LERP;
    this.cameraPanY += (targetPanY - this.cameraPanY) * LERP;
    this.applyCameraTransform();
    if (
      Math.abs(this.cameraPanX - targetPanX) < 1 &&
      Math.abs(this.cameraPanY - targetPanY) < 1
    ) {
      this.cameraPanX = targetPanX;
      this.cameraPanY = targetPanY;
      this.cameraReturning = false;
      this.applyCameraTransform();
    }
  }

  private applyCameraTransform(): void {
    if (!this.renderer.gameLayer) return;

    this.clampCameraPan();

    this.renderer.gameLayer.scale.set(this.cameraZoom);
    this.renderer.gameLayer.x = this.cameraPanX;
    this.renderer.gameLayer.y = this.cameraPanY;

    // Keep NPC hit areas a fixed screen size regardless of zoom level.
    for (const s of this.npcSprites) {
      s.updateHitArea(this.cameraZoom);
    }

    this.updateCameraDebugDisplay();
  }

  /**
   * Clamp the camera pan so the visible viewport never extends past the
   * background coverage (the nebula backdrop), i.e. the picture's edge can't be
   * panned into view. When the viewport is larger than the bound (fully zoomed
   * out) the system is simply centred on that axis.
   */
  private clampCameraPan(): void {
    const z = this.cameraZoom;
    // Slightly smaller than the backdrop half-size (BOUNDARY * 2.8 / 2 = 1.4)
    // so a margin of gas always remains beyond the edge of the screen.
    const half = this.SYSTEM_BOUNDARY_RADIUS * 1.25;
    const sw = this.renderer.app.screen.width;
    const sh = this.renderer.app.screen.height;

    // Viewport world edges: left = -panX/z, right = (sw - panX)/z. Require the
    // edges to stay within [center ± half].
    const minX = this.starRenderer.centerX - half;
    const maxX = this.starRenderer.centerX + half;
    const panXMax = -minX * z;
    const panXMin = sw - maxX * z;
    this.cameraPanX =
      panXMin > panXMax
        ? (panXMin + panXMax) / 2
        : Math.max(panXMin, Math.min(panXMax, this.cameraPanX));

    const minY = this.starRenderer.centerY - half;
    const maxY = this.starRenderer.centerY + half;
    const panYMax = -minY * z;
    const panYMin = sh - maxY * z;
    this.cameraPanY =
      panYMin > panYMax
        ? (panYMin + panYMax) / 2
        : Math.max(panYMin, Math.min(panYMax, this.cameraPanY));
  }

  /**
   * Update camera debug text display
   */
  private updateCameraDebugDisplay(): void {
    if (this.cameraDebugText) {
      this.cameraDebugText.text = `Камера: Zoom ${this.cameraZoom.toFixed(2)} | Pan (${this.cameraPanX.toFixed(0)}, ${this.cameraPanY.toFixed(0)})`;
    }
  }

  /**
   * Convert screen coordinates to world coordinates (accounting for camera transform)
   */
  private screenToWorld(
    screenX: number,
    screenY: number,
  ): { x: number; y: number } {
    const worldX = (screenX - this.cameraPanX) / this.cameraZoom;
    const worldY = (screenY - this.cameraPanY) / this.cameraZoom;
    return { x: worldX, y: worldY };
  }

  /**
   * Advance the cosmetic take-off arc (Task 5): walk the ship container along
   * the outward curve at a constant speed, facing the direction of travel. The
   * flight physics is already parked at the arc's end point, so when the walk
   * completes the ship simply stays there and normal autopilot resumes.
   */
  private updateTakeoff(deltaTime: number): void {
    if (!this.takeoffArc || !this.shipContainer || !this.shipPhysics) return;
    this.takeoffArcDist +=
      SpaceFlightScene.TAKEOFF_ARC_SPEED *
      Math.min(deltaTime, 100) *
      (this.shipPhysics?.timeScale ?? 1);
    const sample = pointAlongPath(this.takeoffArc, this.takeoffArcDist);
    this.shipContainer.x = sample.x;
    this.shipContainer.y = sample.y;
    this.shipContainer.rotation = sample.heading;
    this.shipPhysics.shipAngle = sample.heading; // keep physics heading in sync
    if (sample.done) {
      this.finishTakeoff();
    }
  }

  /** End the take-off arc: snap to the parked end point and clear the arc. */
  private finishTakeoff(): void {
    if (!this.takeoffArc) return;
    const end = this.takeoffArc[this.takeoffArc.length - 1];
    this.takeoffArc = null;
    this.takeoffArcDist = 0;
    if (this.shipPhysics) {
      this.shipPhysics.teleport(end.x, end.y);
      if (this.shipContainer) {
        this.shipContainer.x = end.x;
        this.shipContainer.y = end.y;
      }
    }
  }

  private updateShip(deltaTime: number): void {
    if (!this.shipContainer || !this.shipGraphics || !this.shipPhysics) return;

    // Take-off arc in progress (Task 5): drive the cosmetic outward curve and
    // skip the day-counting flight physics until it finishes.
    if (this.takeoffArc) {
      this.updateTakeoff(deltaTime);
      return;
    }

    // Track position before update (for distance calculation)
    const prevX = this.shipPhysics.shipX;
    const prevY = this.shipPhysics.shipY;
    const wasMoving = this.shipPhysics.isMoving;

    // Update physics
    this.shipPhysics.update(deltaTime);

    // Proactive docking: station is a small marker, dock when within DOCKING_RANGE.
    if (this.routeTargetStationId && this.shipPhysics.isMoving) {
      const marker = this.stationMarkers.find(
        (m) => m.station.id === this.routeTargetStationId,
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
    if (this.routeTargetPlanetId && this.shipPhysics.isMoving) {
      const sprite = this.planetSprites.find(
        (s) => s.planet.id === this.routeTargetPlanetId,
      );
      if (sprite) {
        const d = Math.hypot(
          sprite.screenX - this.shipPhysics.shipX,
          sprite.screenY - this.shipPhysics.shipY,
        );
        if (d <= this.landingThreshold(sprite)) {
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
      if (this.followNpcId) return;

      // If the route targeted a planet, land on arrival (the player set the
      // planet as the destination, so landing is the expected outcome).
      if (this.routeTargetPlanetId) {
        const sprite = this.planetSprites.find(
          (s) => s.planet.id === this.routeTargetPlanetId,
        );
        if (sprite) {
          const dist = Math.hypot(
            sprite.screenX - this.shipPhysics.shipX,
            sprite.screenY - this.shipPhysics.shipY,
          );
          if (dist <= this.landingThreshold(sprite)) {
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
      this.showMessage("☀ Корпус горит!", 0xff8800);
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
          this.followNpcId = null;
          this.clearPlannedRoute();
          this.endTurn(); // stop the ship and end the turn
          this.showMessage(
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
          this.updateDayCounter(); // Update UI
          this.refreshNpcShips(); // NPCs may have arrived/departed this day

          logger.debug(
            `Day passed during flight. Current day: ${this.gameEngine.galaxy.gameDays}`,
          );
        }
      }
    }

    // Read updated values from physics
    this.shipContainer.x = this.shipPhysics.shipX;
    this.shipContainer.y = this.shipPhysics.shipY;
    this.shipContainer.rotation = this.shipPhysics.shipAngle;

    // Redraw ship for engine effects (uses isMoving from physics)
    this.drawShip();

    // "Wait" turn (US-070 #5): the player may run a turn with no course — the
    // ship holds position while the living galaxy (NPCs) and the calendar keep
    // advancing, until Pause. Advance game days on a timer while idle so time
    // genuinely passes; combat hold-station and pending warps are handled
    // elsewhere and excluded here.
    if (
      this.isTurnRunning &&
      !this.shipPhysics.isMoving &&
      !this.followNpcId &&
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
        this.updateDayCounter();
        this.refreshNpcShips();
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
   * Update day counter UI text
   */
  private updateDayCounter(): void {
    if (this.dayCounterText && this.gameEngine?.galaxy) {
      this.dayCounterText.text = formatGameDate(
        this.gameEngine.galaxy.gameDays,
      );
    }
  }

  /**
   * Plan the planned-course overlay and hand it to {@link RouteRenderer} to draw.
   * Route planning (the ship→waypoints→destination polyline and the
   * landing-vs-navigation decision) is the scene's job — it owns the route data
   * and the planet sprites; the renderer just draws what it's told.
   */
  private drawRouteLine(): void {
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

    // Check if route target is near a planet (within 50px radius)
    const isLandingOnPlanet = this.planetSprites.some((sprite) => {
      const pdx = sprite.screenX - toX;
      const pdy = sprite.screenY - toY;
      const planetDistance = Math.sqrt(pdx * pdx + pdy * pdy);
      return planetDistance < 50; // Within planet interaction radius
    });

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
    this.drawRouteLine();
  }

  /** Start flying to (x,y) along a star-avoiding (and, for planets, spiral) path. */
  private executeRouteTo(
    x: number,
    y: number,
    landing?: { planetX: number; planetY: number; planetRadius: number },
  ): void {
    if (!this.shipPhysics) return;
    this.finishTakeoff(); // a fresh course cancels any in-progress take-off arc
    this.routePath = this.computeFlightPath(x, y, landing);
    // Hand the whole curved path to physics; it flows through the waypoints
    // without stopping (smooth motion around the star — US-070 #5).
    this.shipPhysics.setPath(this.routePath);
    this.plannedRoute = { x, y };
    this.isTurnRunning = true; // executing a route runs the turn (Play)
    this.updateInteractiveCursors(true);
    this.drawRouteLine();
  }

  private clearPlannedRoute(): void {
    this.plannedRoute = null;
    this.routeTargetPlanetId = null;
    this.routeTargetStationId = null;
    this.followNpcId = null;
    this.routePath = [];

    // ?.: clearPlannedRoute runs from destroy(), which may fire before the
    // scene finished initializing (and constructing the route renderer).
    this.routeRenderer?.clearRoute();
  }

  /**
   * Update planet positions for orbital rotation and mini-map
   * Turn-based: planets only rotate when ship is moving
   */
  private updatePlanets(deltaTime: number): void {
    // Orbital position tracks elapsed game days (whole days advance as the ship
    // flies; the in-flight fraction makes the motion smooth). Because position
    // is a pure function of game time, planets only advance by the days actually
    // spent away — no full orbit during a brief landing (US-070 #9).
    const gameDays = this.gameEngine?.galaxy?.gameDays ?? 0;
    const fractionalDay = this.distanceTraveled / this.DISTANCE_PER_DAY;
    // While waiting in place, waitDayAccum carries the smooth sub-day progress so
    // planets keep drifting (US-070 #5).
    const currentDays = gameDays + fractionalDay + this.waitDayAccum;
    for (const sprite of this.planetSprites) {
      sprite.setOrbitForDay(currentDays);
    }

    // Cosmetic axial spin / moons only advance while the turn is running.
    if (this.isTurnRunning) {
      const scaledDt = deltaTime * (this.shipPhysics?.timeScale ?? 1);
      for (const sprite of this.planetSprites) {
        sprite.update(scaledDt);
      }
    }

    // Always update mini-map (even when paused, for visual feedback)
    if (this.systemMiniMap && this.shipPhysics) {
      const npcDots = this.npcSprites.map((s) => ({
        x: s.x,
        y: s.y,
        color: s.mapColor,
      }));
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
      const z = this.cameraZoom;
      const viewport = {
        minX: (0 - this.cameraPanX) / z,
        minY: (0 - this.cameraPanY) / z,
        maxX: (this.renderer.app.screen.width - this.cameraPanX) / z,
        maxY: (this.renderer.app.screen.height - this.cameraPanY) / z,
      };
      this.systemMiniMap.updateWithSprites(
        this.planetSprites,
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
      this.systemMiniMap.updateCenterButton(
        this.cameraPanX,
        this.cameraPanY,
        this.shipPhysics.shipX,
        this.shipPhysics.shipY,
        this.cameraZoom,
      );
    }
  }

  /**
   * Create NPC ship sprites for every NPC currently present in this system.
   */
  private createNpcShips(): void {
    const galaxy = this.gameEngine?.galaxy;
    const systemId = this.gameEngine?.player?.currentSystemId;
    if (!galaxy || !systemId) return;

    // NPCs already in the system when we enter are distributed inside it (they
    // didn't just arrive), so they spawn at interior positions.
    for (const npc of npcsPresentInSystem(galaxy, systemId)) {
      this.addNpcSprite(npc, false);
    }
    logger.info(`Created ${this.npcSprites.length} NPC sprites`);
  }

  /** Geometry NPC ships move within (band + boundary edge). */
  private npcBounds(): SystemBounds {
    return {
      cx: this.starRenderer.centerX,
      cy: this.starRenderer.centerY,
      rInner: this.SYSTEM_INNER_RADIUS,
      rOuter: this.SYSTEM_OUTER_RADIUS,
      boundary: this.SYSTEM_BOUNDARY_RADIUS,
    };
  }

  /**
   * Spawn a single NPC sprite. When `entry` is true the ship just hyperjumped
   * in, so it appears on the system boundary and flies inward; otherwise it is
   * placed at a random interior position.
   */
  private addNpcSprite(npc: NpcShip, entry: boolean): void {
    const bounds = this.npcBounds();
    const angle = Math.random() * Math.PI * 2;
    const radius = entry
      ? bounds.boundary
      : bounds.rInner + Math.random() * (bounds.rOuter - bounds.rInner);
    const sprite = new NpcShipSprite(
      npc,
      bounds.cx + Math.cos(angle) * radius,
      bounds.cy + Math.sin(angle) * radius,
      bounds,
    );
    sprite.setClickHandler((n) => this.onNpcClick(n));
    sprite.setHoverHandler(
      (n, sx, sy) => this.showTooltip(`${n.name} [${n.role}]`, sx, sy),
      () => this.hideTooltip(),
    );
    sprite.container.zIndex = 100; // above planet discs so clicks reach the ship
    // Non-pirates "visit" a planet: anchor them to loiter near one (deterministic
    // by id) so traders/rangers/patrols cluster at planets instead of aimlessly
    // crossing the system. Pirates keep roaming the whole band.
    if (npc.role !== NpcRole.PIRATE && this.planetSprites.length > 0) {
      const idx = this.hashId(npc.id) % this.planetSprites.length;
      const p = this.planetSprites[idx];
      sprite.setAnchor(p.screenX, p.screenY);
      this.npcAnchorPlanet.set(sprite, p);
    }
    this.renderer.gameLayer.addChild(sprite.container);
    this.npcSprites.push(sprite);
  }

  /**
   * Sync NPC sprites with the simulation after a day passes (Scenario 8.5):
   * ships that left the system fly out to the boundary and hyperjump; newly
   * arrived ships appear on the boundary and fly in. No mid-system pop-in/out.
   */
  private refreshNpcShips(): void {
    const galaxy = this.gameEngine?.galaxy;
    const systemId = this.gameEngine?.player?.currentSystemId;
    if (!galaxy || !systemId) return;

    const present = npcsPresentInSystem(galaxy, systemId);
    const presentIds = new Set(present.map((n) => n.id));

    // NPCs no longer present begin flying out toward the boundary (removed once
    // they reach it, in updateNpcShips).
    for (const sprite of this.npcSprites) {
      if (!presentIds.has(sprite.npc.id)) sprite.beginDeparture();
    }

    // Newly arrived NPCs enter from the boundary.
    const existing = new Set(this.npcSprites.map((s) => s.npc.id));
    for (const npc of present) {
      if (!existing.has(npc.id)) this.addNpcSprite(npc, true);
    }

    // Close the contact panel if its NPC has left the system.
    if (this.contactNpcId && !presentIds.has(this.contactNpcId)) {
      this.closeNpcContactPanel();
    }
  }

  /** Advance NPC movement only while the world is running (turn-based). */
  private updateNpcShips(deltaTime: number): void {
    // The world runs while the turn is running (flying, or holding station in
    // combat) — not only while the ship is physically moving.
    if (!this.isTurnRunning) return;

    for (let i = this.npcSprites.length - 1; i >= 0; i--) {
      const sprite = this.npcSprites[i];
      // Keep the orbit center aligned with the planet's current orbital position.
      const anchorPlanet = this.npcAnchorPlanet.get(sprite);
      if (anchorPlanet) {
        sprite.updateAnchorPosition(anchorPlanet.screenX, anchorPlanet.screenY);
      }
      sprite.update(deltaTime * (this.shipPhysics?.timeScale ?? 1));
      if (sprite.isGone()) {
        this.npcAnchorPlanet.delete(sprite);
        sprite.destroy();
        this.npcSprites.splice(i, 1);
      } else {
        this.updateNpcDepth(sprite);
      }
    }
  }

  /**
   * Set NPC zIndex so the ship is occluded by planet discs it passes behind.
   * Planet discs sit at zIndex 50; ships at 40 render under them, ships at 100
   * render above. We switch to 40 whenever the ship's world position is within
   * the disc radius of any planet.
   */
  private updateNpcDepth(sprite: NpcShipSprite): void {
    for (const planet of this.planetSprites) {
      const dx = sprite.x - planet.screenX;
      const dy = sprite.y - planet.screenY;
      if (dx * dx + dy * dy < planet.displayRadius * planet.displayRadius) {
        sprite.container.zIndex = 40;
        return;
      }
    }
    sprite.container.zIndex = 100;
  }

  /** Small deterministic hash of a string id (FNV-1a) for stable assignment. */
  private hashId(s: string): number {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  /** Open the contact panel for a clicked NPC ship. */
  private onNpcClick(npc: NpcShip): void {
    if (this.isTurnRunning) return;

    this.closeNpcContactPanel();
    this.contactNpcId = npc.id;
    // Hailing/trading and the detailed readout are offered within radar/scanner
    // range; beyond it the panel only offers "Приблизиться" to close the gap
    // (US-070 #3). The gate is the scanner range, not the (much shorter) firing
    // range — you can talk and trade well before you are in weapons reach.
    const sprite = this.npcSprites.find((s) => s.npc.id === npc.id);
    const inRange =
      !!sprite &&
      !!this.shipPhysics &&
      Math.hypot(
        sprite.x - this.shipPhysics.shipX,
        sprite.y - this.shipPhysics.shipY,
      ) <= this.SCANNER_RANGE;
    const scanPower =
      this.gameEngine?.playerLoadout?.derivedStats().scanPower ?? 0;
    this.npcContactPanel = new NpcContactPanel(
      npc,
      this.renderer.app.screen.width,
      this.renderer.app.screen.height,
      {
        onHail: () => this.onHailNpc(npc),
        onTrade: () => this.onTradeNpc(npc),
        onAttack: () => this.onAttackNpc(npc),
        onApproach: () => this.onApproachNpc(npc),
        onClose: () => this.closeNpcContactPanel(),
      },
      inRange,
      scanPower,
    );
    this.renderer.uiLayer.addChild(this.npcContactPanel.container);
  }

  /**
   * "Приблизиться": plot a course to the target's current position and fly there
   * so the ship closes to firing range, without opening fire (US-070 #2). The
   * player can then re-open the panel to hail/trade or attack.
   */
  private onApproachNpc(npc: NpcShip): void {
    const sprite = this.npcSprites.find((s) => s.npc.id === npc.id);
    this.closeNpcContactPanel();
    if (!sprite || !this.shipPhysics) return;
    this.followNpcId = null; // approach only — not an attack
    this.routeTargetPlanetId = null;
    this.executeRouteTo(sprite.x, sprite.y);
    this.showMessage(`Сближение: ${npc.name}`, 0x88ccff);
  }

  /** "Связаться": if player has an active TEXT_ADVENTURE quest, launch it; otherwise show greeting. */
  private onHailNpc(npc: NpcShip): void {
    this.closeNpcContactPanel();

    const activeQuests = this.gameEngine?.questManager.getActiveQuests() ?? [];
    const textAdventureQuest = activeQuests.find(
      (q) => q.type === QuestType.TEXT_ADVENTURE,
    );

    if (textAdventureQuest && this.gameEngine) {
      const scriptId =
        textAdventureQuest.targetObjectId ?? textAdventureQuest.id;
      void this.gameEngine.startTextQuest(
        scriptId,
        undefined,
        SceneType.SPACE_FLIGHT,
        { gameEngine: this.gameEngine },
        textAdventureQuest.id,
      );
      return;
    }

    const lines = [
      "Приветствую, рейнджер. Чистого космоса.",
      "Не мешай — у меня груз по расписанию.",
      "Держись подальше, если не ищешь неприятностей.",
      "Слыхал о возмущениях у рубежа? Будь начеку.",
    ];
    const line = lines[Math.floor(Math.random() * lines.length)];
    this.showMessage(`${npc.name}: «${line}»`, 0x88ccff);
  }

  /** "Торговать": trade-with-ships is not implemented yet — be honest. */
  private onTradeNpc(npc: NpcShip): void {
    this.showMessage(
      `Торговля с ${npc.name} пока недоступна в полёте.`,
      0xffaa00,
    );
  }

  /**
   * "Атаковать": if already within weapon range, transition immediately to
   * turn-based CombatScene. Otherwise, close the panel and set the ship to
   * auto-follow (intercept) the target — updateCombat() will trigger the
   * CombatScene transition once in range.
   */
  private onAttackNpc(npc: NpcShip): void {
    const sprite = this.npcSprites.find((s) => s.npc.id === npc.id);
    this.closeNpcContactPanel();
    if (!sprite || !this.shipPhysics) return;

    const dist = Math.hypot(
      sprite.x - this.shipPhysics.shipX,
      sprite.y - this.shipPhysics.shipY,
    );

    if (dist <= this.WEAPON_RANGE) {
      this.launchCombatWithNpc(npc);
      return;
    }

    // Not yet in range — auto-follow to close the gap, aiming at a lead point
    // so the intercept curves to where the target is heading (Task 5).
    this.followNpcId = npc.id;
    this.routeTargetPlanetId = null;
    const lead = this.npcLeadPoint(sprite);
    this.executeRouteTo(lead.x, lead.y);
    this.showMessage(`Перехват: ${npc.name}`, 0xff5555);
  }

  /**
   * Predicted intercept point for chasing an NPC: leads the target along its
   * current heading so the pursuit curves toward where it will be rather than
   * pointing at its present position (Task 5). NPC velocity is derived from its
   * sprite heading (the hull faces its direction of travel) and the shared NPC
   * cruise speed. Falls back to the NPC's current position when no lead solves.
   */
  private npcLeadPoint(sprite: NpcShipSprite): { x: number; y: number } {
    if (!this.shipPhysics) return { x: sprite.x, y: sprite.y };
    const heading = sprite.container.rotation;
    const vx = Math.cos(heading) * GAME_BALANCE.npcSpeed;
    const vy = Math.sin(heading) * GAME_BALANCE.npcSpeed;
    return leadInterceptPoint(
      this.shipPhysics.shipX,
      this.shipPhysics.shipY,
      this.shipPhysics.getMaxSpeed(),
      sprite.x,
      sprite.y,
      vx,
      vy,
    );
  }

  /** Transition to the turn-based CombatScene for a specific NPC. */
  private launchCombatWithNpc(npc: NpcShip): void {
    if (!this.gameEngine || this._combatTransitionPending) return;
    this._combatTransitionPending = true;
    this.followNpcId = null;
    this.endTurn();
    void this.gameEngine.transitionTo(SceneType.COMBAT, {
      gameEngine: this.gameEngine,
      npcEnemy: {
        id: npc.id,
        hullHP: npc.hullHP,
        shields: npc.shields,
        damage: npc.damage,
        techLevel: npcRoleTechLevel(npc.role),
        factionId: npc.race,
      },
    });
  }

  /**
   * Play/Pause turn control. When paused: Play executes the planned route (the
   * turn starts running). While running: Pause ends the turn at the next day
   * segment (or immediately if the ship is holding station in combat).
   */
  /** Cycle game speed through 1×/2×/4× and update physics + button label. */
  private cycleGameSpeed(): void {
    const steps = GAME_BALANCE.gameSpeedMultipliers;
    this.speedIndex = (this.speedIndex + 1) % steps.length;
    const scale = steps[this.speedIndex];
    if (this.shipPhysics) this.shipPhysics.setTimeScale(scale);
    if (this.speedButton) this.speedButton.setLabel(`${scale}×`);
  }

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
    } else if (this.followNpcId) {
      const sprite = this.npcSprites.find((s) => s.npc.id === this.followNpcId);
      if (sprite) this.executeRouteTo(sprite.x, sprite.y);
    } else {
      this.waitDayAccum = 0;
      this.isTurnRunning = true; // course-less wait: time passes, ship stays put
      this.updateInteractiveCursors(true);
      this.showMessage("⏳ Ожидание… (мир движется)", 0x88ccff);
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
    for (const sprite of this.planetSprites) {
      sprite.graphics.cursor = planetCursor;
    }
    for (const sprite of this.npcSprites) {
      const npcCursor = turnRunning
        ? "default"
        : sprite.npc.role === NpcRole.PIRATE
          ? "target"
          : "pointer";
      sprite.container.cursor = npcCursor;
      // When the turn ends, restore click/hover interactivity on every ship that
      // isn't leaving the system — a ship that lost its hit-area mid-turn becomes
      // clickable again (Task 6).
      if (!turnRunning) sprite.restoreInteractivity();
    }
  }

  /** Refresh the Play/Pause button label/colour to match the turn state. */
  private updatePlayPauseButton(): void {
    if (!this.playPauseButton) return;
    if (this.isTurnRunning) {
      this.playPauseButton.setLabel("⏸ ПАУЗА");
      this.playPauseButton.setAccentColor(0xffcc00);
    } else {
      // ХОД is always available — with a course it flies it, without one it runs
      // a wait turn (US-070 #5), so the button is always shown active.
      this.playPauseButton.setLabel("▶ ХОД");
      this.playPauseButton.setAccentColor(0x00ff88);
    }
  }

  /**
   * Auto-attack: while a follow target is set and the turn is running, close to
   * weapon range, then hold station and exchange fire until the target is
   * destroyed, the player drops below 30% hull, or the target is lost.
   * Decision logic delegated to FlightCombatResolver for testability.
   */
  private updateCombat(_deltaTime: number): void {
    if (!this.shipPhysics) return;
    const ship = this.gameEngine?.player?.ship;
    if (!ship) return;

    const decision = this.combatResolver.decide({
      isTurnRunning: this.isTurnRunning,
      followNpcId: this.followNpcId,
      shipPhysics: this.shipPhysics,
      npcSprites: this.npcSprites,
      weaponRange: this.WEAPON_RANGE,
    });

    switch (decision.action) {
      case "idle":
        return;
      case "lost":
        this.showMessage("Цель потеряна", 0xffaa00);
        this.followNpcId = null;
        return;
      case "chase":
        if (!this.shipPhysics.isMoving) {
          // Re-aim at a fresh lead point each leg so the chase curves to lead a
          // crossing target rather than always heading at its old position.
          const chased = this.npcSprites.find(
            (s) => s.npc.id === this.followNpcId,
          );
          const lead = chased
            ? this.npcLeadPoint(chased)
            : { x: decision.targetX, y: decision.targetY };
          this.executeRouteTo(lead.x, lead.y);
        }
        return;
      case "launch":
        if (this.shipPhysics.isMoving) {
          this.shipPhysics.setTarget(
            this.shipPhysics.shipX,
            this.shipPhysics.shipY,
          );
          this.shipPhysics.isMoving = false;
          this.shipPhysics.currentSpeed = 0;
        }
        this.launchCombatWithNpc(decision.npc);
        return;
    }
  }

  /** True while a panel that should swallow outside-clicks is open. */
  private isBlockingModalOpen(): boolean {
    return (
      this.npcContactPanel !== null ||
      this.questJournalUI !== null ||
      this.planetInfoPanel !== null ||
      this.overmindOverlay !== null ||
      this.settingsPanel !== null
    );
  }

  /** Close any open blocking modal (NPC contact / quest journal / planet panel). */
  private closeBlockingModals(): void {
    this.closeNpcContactPanel();
    const journal = this.questJournalUI;
    this.questJournalUI = null;
    if (journal) queueMicrotask(() => journal.destroy());
    const info = this.planetInfoPanel;
    this.planetInfoPanel = null;
    if (info) queueMicrotask(() => info.destroy());
    if (this.overmindOverlay) {
      const ov = this.overmindOverlay;
      this.overmindOverlay = null;
      queueMicrotask(() => ov.destroy({ children: true }));
    }
    if (this.settingsPanel) {
      const sp = this.settingsPanel;
      this.settingsPanel = null;
      queueMicrotask(() => sp.destroy({ children: true }));
    }
  }

  private closeNpcContactPanel(): void {
    const panel = this.npcContactPanel;
    this.npcContactPanel = null;
    this.contactNpcId = null;
    // Defer the actual teardown out of the current pointer-event dispatch.
    // Destroying the display object that PixiJS's event boundary is mid-dispatch
    // on corrupts hit-testing and leaves other sprites unclickable (bug: after
    // contacting/attacking one NPC, other ships stopped responding to clicks).
    if (panel) queueMicrotask(() => panel.destroy());
  }

  /**
   * Transient on-screen feedback near the top-centre of the view (button
   * actions, warnings). Replaces any current toast.
   */
  private showMessage(text: string, color = 0x00ffff): void {
    this.addMiniLogEntry(text);
    this.gameEngine?.audio?.playToast();
    if (this.toast) {
      this.toast.destroy();
      this.toast = null;
    }
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }
    const t = new Text({
      text,
      style: {
        fontFamily: "Courier New",
        fontSize: scaledFont(15),
        fill: color,
        fontWeight: "bold",
        align: "center",
        stroke: { color: 0x000000, width: 4 },
      },
    });
    t.anchor.set(0.5, 0);
    t.x = this.renderer.app.screen.width / 2;
    t.y = 90;
    t.eventMode = "none";
    this.toast = t;
    this.renderer.uiLayer.addChild(t);
    this.toastTimer = setTimeout(() => {
      if (this.toast) {
        this.toast.destroy();
        this.toast = null;
      }
      this.toastTimer = null;
    }, 3200);
  }

  /** Show a delayed hover tooltip near the cursor (B1). 300 ms delay before it appears. */
  private showTooltip(text: string, screenX: number, screenY: number): void {
    this.hideTooltip();
    this.tooltipTimer = setTimeout(() => {
      this.tooltipTimer = null;
      const t = new Text({
        text,
        style: {
          fontFamily: "Courier New",
          fontSize: scaledFont(13),
          fill: 0xffffff,
          stroke: { color: 0x000000, width: 3 },
        },
      });
      t.eventMode = "none";
      t.x = Math.min(
        screenX + 16,
        this.renderer.app.screen.width - t.width - 8,
      );
      t.y = screenY - 24;
      this.tooltipText = t;
      this.renderer.uiLayer.addChild(t);
    }, 300);
  }

  /** Show an immediate rich planet tooltip (name, habitability, faction, capture). */
  private showPlanetTooltip(
    planet: Planet,
    systemFaction: Faction,
    screenX: number,
    screenY: number,
  ): void {
    this.hideTooltip();

    const lines = buildPlanetTooltipLines(
      planet,
      systemFaction,
      (faction) => this.gameEngine?.player?.getReputation(faction) ?? 0,
    );

    // Build container
    const padding = 8;
    const lineHeight = 18;
    const fontSize = 13;

    const container = new Container();
    container.eventMode = "none";

    const textNodes: Text[] = lines.map((line, i) => {
      const t = new Text({
        text: line.text,
        style: {
          fontFamily: "Courier New",
          fontSize,
          fill: line.color,
        },
      });
      t.eventMode = "none";
      t.x = padding;
      t.y = padding + i * lineHeight;
      return t;
    });

    // Measure content area after creating texts
    const maxWidth = Math.max(...textNodes.map((t) => t.width));
    const totalHeight = padding * 2 + lines.length * lineHeight;

    const bg = new Graphics();
    bg.roundRect(0, 0, maxWidth + padding * 2, totalHeight, 4);
    bg.fill({ color: 0x000000, alpha: 0.75 });
    bg.eventMode = "none";

    container.addChild(bg);
    for (const t of textNodes) container.addChild(t);

    const screenW = this.renderer.app.screen.width;
    const screenH = this.renderer.app.screen.height;
    container.x = Math.min(screenX + 16, screenW - maxWidth - padding * 2 - 8);
    container.y = Math.max(
      8,
      Math.min(screenY - totalHeight / 2, screenH - totalHeight - 8),
    );

    this.tooltipContainer = container;
    this.renderer.uiLayer.addChild(container);
  }

  /** Cancel any pending tooltip and destroy the visible one. */
  private hideTooltip(): void {
    if (this.tooltipTimer !== null) {
      clearTimeout(this.tooltipTimer);
      this.tooltipTimer = null;
    }
    if (this.tooltipText) {
      this.tooltipText.destroy();
      this.tooltipText = null;
    }
    if (this.tooltipContainer) {
      this.tooltipContainer.destroy({ children: true });
      this.tooltipContainer = null;
    }
  }

  /** Push a line to the mini-log (B5); keeps only the last 5 entries. */
  private addMiniLogEntry(text: string): void {
    if (!this.miniLogContainer) return;
    const lineH = 18;
    // Remove oldest if full.
    if (this.miniLogEntries.length >= 5) {
      const oldest = this.miniLogEntries.shift()!;
      oldest.textObj.destroy();
      for (const e of this.miniLogEntries) e.textObj.y -= lineH;
    }
    const textObj = new Text({
      text: `> ${text}`,
      style: {
        fontFamily: "Courier New",
        fontSize: scaledFont(11),
        fill: 0x88ccff,
      },
    });
    textObj.eventMode = "none";
    textObj.y = this.miniLogEntries.length * lineH;
    this.miniLogContainer.addChild(textObj);
    this.miniLogEntries.push({ textObj, elapsed: 0 });
  }

  /** Advance mini-log timers; fade out and remove expired entries each frame. */
  private updateMiniLog(deltaTime: number): void {
    const lineH = 18;
    for (const entry of this.miniLogEntries) {
      entry.elapsed += deltaTime;
      const fadeStart = this.MINI_LOG_DURATION - this.MINI_LOG_FADE_MS;
      if (entry.elapsed >= fadeStart) {
        const t =
          (entry.elapsed - fadeStart) / (this.MINI_LOG_DURATION - fadeStart);
        entry.textObj.alpha = Math.max(0, 1 - t);
      }
    }
    // Remove expired entries (oldest first).
    while (
      this.miniLogEntries.length > 0 &&
      this.miniLogEntries[0].elapsed >= this.MINI_LOG_DURATION
    ) {
      const removed = this.miniLogEntries.shift()!;
      removed.textObj.destroy();
      for (const e of this.miniLogEntries) e.textObj.y -= lineH;
    }
  }

  /** Animate the warp-exit flash + expanding rings, then clean up. */
  private updateWarpEffect(deltaTime: number): void {
    const fx = this.warpEffect;
    if (!fx) return;

    fx.elapsed += deltaTime;
    const t = Math.min(1, fx.elapsed / fx.duration);

    // Flash: bright then fades fast.
    fx.flash.alpha = Math.max(0, 1 - t * 2.2);
    fx.flash.scale.set(1 + t * 0.6);

    // Glow: swells in, fades out over the full duration.
    fx.glow.alpha = Math.sin(t * Math.PI) * 0.6;
    fx.glow.scale.set(0.6 + t * 1.4);

    // Rings: staggered expansion outward, thinning as they grow.
    fx.rings.forEach((ring, i) => {
      const rt = Math.max(0, Math.min(1, t * 1.3 - i * 0.18));
      ring.scale.set(0.2 + rt * 8);
      ring.alpha = Math.max(0, 1 - rt) * 0.9;
    });

    if (t >= 1) {
      this.renderer.gameLayer.removeChild(fx.container);
      fx.container.destroy({ children: true });
      this.warpEffect = null;
    }
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
      if (this.npcContactPanel) {
        this.closeNpcContactPanel();
      } else if (this.questJournalUI) {
        this.questJournalUI.destroy();
        this.questJournalUI = null;
      } else if (this.planetInfoPanel) {
        this.planetInfoPanel.destroy();
        this.planetInfoPanel = null;
      } else if (this.plannedRoute) {
        this.clearPlannedRoute();
        this.showMessage("Маршрут отменён", 0xffaa00);
      }
      return;
    }
    if (event.key === "j" || event.key === "J") {
      this.toggleQuestJournal();
    } else if (event.key === "i" || event.key === "I") {
      this.openInventory();
    }
  }

  /** Auto-complete BOUNTY quests targeting the defeated NpcShip. */
  private completeBountyQuestsByNpcKill(npcId: string): void {
    if (!this.gameEngine?.player) return;
    const player = this.gameEngine.player;
    const questManager = this.gameEngine.questManager;
    const currentSystemId = player.currentSystemId;

    for (const quest of questManager.getActiveQuests()) {
      if (quest.type !== QuestType.BOUNTY) continue;
      if (quest.isCompleted || quest.isFailed) continue;
      const matchesNpc = quest.targetObjectId === npcId;
      const matchesSystem =
        !quest.targetObjectId && quest.targetSystemId === currentSystemId;
      if (!matchesNpc && !matchesSystem) continue;
      const completed = questManager.forceCompleteQuest(quest.id, player);
      if (completed) {
        logger.info(
          `BOUNTY quest auto-completed: ${quest.title} (npcId=${npcId})`,
        );
      }
    }
  }

  /** Auto-complete EXPLORATION quests whose target is the current system. */
  private completeExplorationQuestsBySystemEntry(): void {
    if (!this.gameEngine?.player) return;
    const player = this.gameEngine.player;
    const questManager = this.gameEngine.questManager;
    const currentSystemId = player.currentSystemId;

    for (const quest of questManager.getActiveQuests()) {
      if (quest.type !== QuestType.EXPLORATION) continue;
      if (quest.isCompleted || quest.isFailed) continue;
      if (quest.targetSystemId !== currentSystemId) continue;
      const completed = questManager.forceCompleteQuest(quest.id, player);
      if (completed) {
        logger.info(
          `EXPLORATION quest auto-completed on system entry: ${quest.title}`,
        );
      }
    }
  }

  /** Auto-complete DEFENSE quests targeting the current system and liberate the adjacent OVERMIND system. */
  private completeDefenseQuestsBySystemEntry(): void {
    if (!this.gameEngine?.player || !this.gameEngine.galaxy) return;
    const player = this.gameEngine.player;
    const galaxy = this.gameEngine.galaxy;
    const questManager = this.gameEngine.questManager;
    const currentSystemId = player.currentSystemId;

    for (const quest of questManager.getActiveQuests()) {
      if (quest.type !== QuestType.DEFENSE) continue;
      if (quest.isCompleted || quest.isFailed) continue;
      if (quest.targetSystemId !== currentSystemId) continue;
      const completed = questManager.forceCompleteQuest(quest.id, player);
      if (completed) {
        // Remove the OVERMIND system stored in targetObjectId (the one being pushed back).
        if (quest.targetObjectId) {
          galaxy.removeOvermindSystem(quest.targetObjectId);
          logger.info(
            `DEFENSE quest completed: ${quest.title}, liberated OVERMIND system ${quest.targetObjectId}`,
          );
        }
      }
    }
  }

  /** Show a prompt when entering the OVERMIND core system so the player can fight the final encounter. */
  private showOvermindCorePrompt(): void {
    if (!this.gameEngine) return;
    const width = this.renderer.app.screen.width;
    const height = this.renderer.app.screen.height;

    const overlay = new Container();
    this.overmindOverlay = overlay;
    const bg = new Graphics();
    bg.roundRect(width / 2 - 240, height / 2 - 110, 480, 220, 6).fill({
      color: 0x000000,
      alpha: 0.85,
    });

    const border = new Graphics();
    border
      .roundRect(width / 2 - 240, height / 2 - 110, 480, 220, 6)
      .stroke({ width: 2, color: 0xff2200 });

    const title = new Text({
      text: "ЯДРО OVERMIND",
      style: {
        fontFamily: "Courier New",
        fontSize: scaledFont(20),
        fill: 0xff2200,
        fontWeight: "bold",
      },
    });
    title.anchor.set(0.5);
    title.x = width / 2;
    title.y = height / 2 - 80;
    title.eventMode = "none";

    const desc = new Text({
      text: "Вы вошли в систему ядра OVERMIND.\nУничтожьте его, чтобы спасти галактику.",
      style: {
        fontFamily: "Courier New",
        fontSize: scaledFont(14),
        fill: 0xcccccc,
        align: "center",
      },
    });
    desc.anchor.set(0.5);
    desc.x = width / 2;
    desc.y = height / 2 - 30;
    desc.eventMode = "none";

    const attackBtn = new Container();
    const attackBg = new Graphics();
    attackBg
      .roundRect(0, 0, 180, 36, 4)
      .fill({ color: 0x330000 })
      .stroke({ width: 1, color: 0xff2200 });
    const attackLabel = new Text({
      text: "[ Атаковать ядро ]",
      style: {
        fontFamily: "Courier New",
        fontSize: scaledFont(14),
        fill: 0xff4444,
      },
    });
    attackLabel.x = 8;
    attackLabel.y = 9;
    attackLabel.eventMode = "none";
    attackBtn.addChild(attackBg, attackLabel);
    attackBtn.x = width / 2 - 200;
    attackBtn.y = height / 2 + 40;
    attackBtn.eventMode = "static";
    attackBtn.cursor = "pointer";
    attackBtn.on("pointerdown", (e) => {
      e.stopPropagation();
      this.overmindOverlay = null;
      overlay.destroy();
      void this.gameEngine!.transitionTo(SceneType.COMBAT, {
        gameEngine: this.gameEngine!,
        isOvermindCore: true,
        npcEnemy: {
          id: "overmind_core",
          hullHP: 300,
          shields: 150,
          damage: 45,
          techLevel: 7,
        },
      });
    });

    const retreatBtn = new Container();
    const retreatBg = new Graphics();
    retreatBg
      .roundRect(0, 0, 180, 36, 4)
      .fill({ color: 0x0d1b2a })
      .stroke({ width: 1, color: 0x4488ff });
    const retreatLabel = new Text({
      text: "[ Отступить ]",
      style: {
        fontFamily: "Courier New",
        fontSize: scaledFont(14),
        fill: 0x4488ff,
      },
    });
    retreatLabel.x = 8;
    retreatLabel.y = 9;
    retreatLabel.eventMode = "none";
    retreatBtn.addChild(retreatBg, retreatLabel);
    retreatBtn.x = width / 2 + 20;
    retreatBtn.y = height / 2 + 40;
    retreatBtn.eventMode = "static";
    retreatBtn.cursor = "pointer";
    retreatBtn.on("pointerdown", (e) => {
      e.stopPropagation();
      this.overmindOverlay = null;
      overlay.destroy();
    });

    overlay.addChild(bg, border, title, desc, attackBtn, retreatBtn);
    this.renderer.uiLayer.addChild(overlay);
  }

  /**
   * Toggle quest journal UI
   */
  private toggleQuestJournal(): void {
    if (this.questJournalUI) {
      // Close journal
      this.questJournalUI.destroy();
      this.questJournalUI = null;
      logger.info("Quest journal closed");
    } else {
      // Open journal
      if (this.gameEngine?.questManager) {
        this.questJournalUI = new QuestJournalUI(
          this.gameEngine.questManager,
          this.renderer.app.screen.width,
          this.renderer.app.screen.height,
          () => {
            this.questJournalUI?.destroy();
            this.questJournalUI = null;
          },
          (locationId: string) => this.navigateToQuestObjective(locationId),
        );
        this.renderer.uiLayer.addChild(this.questJournalUI.container);
        logger.info("Quest journal opened");
      }
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
    const planetSprite = this.planetSprites.find(
      (s) => s.planet.id === locationId,
    );
    if (planetSprite && this.shipPhysics) {
      // Plan a star-avoiding route to the planet (same path as a manual click).
      this.planRouteTo(planetSprite.screenX, planetSprite.screenY);
      logger.info(
        `Planned navigation route to planet ${planetSprite.planet.name}`,
      );

      // Show planet info panel
      this.onPlanetClick(planetSprite.planet);
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
      zoom: this.cameraZoom,
      panX: this.cameraPanX,
      panY: this.cameraPanY,
    };
  }

  /** E2E helper: set camera zoom */
  e2eSetCameraZoom(zoom: number): void {
    if (!__DEBUG__) return;
    this.cameraZoom = Math.max(this.MIN_ZOOM, Math.min(this.MAX_ZOOM, zoom));
    this.applyCameraTransform();
  }

  /** E2E helper: set camera pan */
  e2eSetCameraPan(x: number, y: number): void {
    if (!__DEBUG__) return;
    this.cameraPanX = x;
    this.cameraPanY = y;
    this.applyCameraTransform();
  }

  /** E2E helper: check if minimap exists */
  e2eHasMinimap(): boolean {
    if (!__DEBUG__) return false;
    return this.systemMiniMap !== null;
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
    return (
      this.questJournalUI !== null && this.questJournalUI.container.visible
    );
  }

  /** E2E helper: return current system planets for test assertions */
  e2eGetPlanets(): { id: string; name: string }[] {
    if (!__DEBUG__) return [];
    return this.planetSprites.map((ps) => ({
      id: ps.planet.id,
      name: ps.planet.name,
    }));
  }

  /** E2E helper: transition directly to PLANET scene bypassing distance check */
  async e2eLandOnPlanet(): Promise<void> {
    if (!__DEBUG__) return;
    const planet = this.planetSprites[0]?.planet;
    if (!planet || !this.gameEngine) return;
    await this.gameEngine.transitionTo(SceneType.PLANET, {
      gameEngine: this.gameEngine,
      planet,
    });
  }

  /** E2E helper: count of NPC ship sprites currently in the scene */
  e2eGetNpcCount(): number {
    if (!__DEBUG__) return 0;
    return this.npcSprites.length;
  }

  e2ePlayPause(): void {
    if (!__DEBUG__) return;
    this.onPlayPause();
  }
}
