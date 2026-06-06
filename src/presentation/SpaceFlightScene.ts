import { GameScene } from "./GameScene";
import {
  Graphics,
  Text,
  Container,
  Sprite,
  TilingSprite,
  FederatedPointerEvent,
  BlurFilter,
} from "pixi.js";
import { buildSphereMesh, type SphereMesh } from "./sphereMesh";
import type { GameEngine } from "@/systems/GameEngine";
import { SceneType, StarType, NpcRole, QuestType } from "@/types";
import { pickVariant, tex } from "./textures";
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
import { SeededRNG } from "@/utils/seededRNG";
import { SAMPLE_TEXT_QUESTS } from "@/domain/TextQuest";
import {
  dayTickMarks,
  avoidStarPath,
  hashToAngle,
} from "@/utils/flightGeometry";
import { ShipPhysics } from "@/systems/ShipPhysics";
import { FlightCombatResolver } from "@/systems/FlightCombatResolver";
import { PanZoomController } from "@/systems/PanZoomController";
import { SYSTEM_GEOMETRY, GAME_BALANCE } from "@/config/balance";

interface NebulaLayer {
  container: Container;
  driftX: number;
  driftY: number;
  pulseAmp: number;
  pulseSpeed: number;
  phase: number;
  baseAlpha: number;
}

interface TwinkleStar {
  graphics: Graphics;
  baseAlpha: number;
  phase: number;
  speed: number;
}

interface WarpArrivalEffect {
  container: Container;
  rings: Graphics[];
  flash: Graphics;
  glow: Graphics;
  elapsed: number;
  duration: number;
}

interface StarLayer {
  container: Container;
  // Parallax depth: on-screen pan shift = cameraPan * depth (smaller = farther
  // and slower). zoomDepth: how much the layer scales with camera zoom.
  depth: number;
  zoomDepth: number;
}

interface DustMote {
  graphics: Graphics;
  x: number;
  y: number;
  depth: number; // 0..1 — nearer motes streak faster (parallax)
}

interface AsteroidMote {
  graphics: Graphics;
  x: number;
  y: number;
  vx: number; // px/ms (asteroids only)
  vy: number;
  spin: number; // rad/ms (asteroids only)
  comet: boolean;
  // Orbital parameters — comets only
  orbitA: number; // semi-major axis (world px)
  orbitB: number; // semi-minor axis (world px)
  orbitAngle: number; // current angle (rad)
  orbitSpeed: number; // rad/ms, sign = direction
  orbitTilt: number; // orbit plane rotation in world xy (rad)
}

interface SwarmLayer {
  container: Container;
  driftX: number;
  driftY: number;
  pulseSpeed: number;
  pulseAmp: number;
  phase: number;
  baseAlpha: number;
}

export class SpaceFlightScene extends GameScene {
  private readonly combatResolver = new FlightCombatResolver();
  private gameEngine: GameEngine | null = null;
  private shipContainer: Container | null = null;
  private shipGraphics: Graphics | null = null;
  // Player-ship art (if available); falls back to the procedural triangle.
  private shipSprite: Sprite | null = null;
  // Heading 0 points +X (east); the ship art faces "up" (nose at the top of the
  // image), so the sprite is pre-rotated +90° (clockwise) to align art-forward
  // with the heading.
  private readonly SHIP_SPRITE_ROTATION = Math.PI / 2;
  private backgroundContainer: Container | null = null; // Nebula clouds (world-space, blurred)
  // Screen-fixed deep-space backdrop (crisp far stars + twinkle), sits behind
  // the world so panning never reveals an edge. Added to renderer.stage.
  private skyContainer: Container | null = null;
  // Nebula art sprite in screen-space (skyContainer child). Screen-space means
  // it's always viewport-sized, never shows its edge even at max zoom-out.
  private nebulaBackdropSprite: Sprite | null = null;
  private starLayers: StarLayer[] = [];
  private nebulaeContainer: Container | null = null;
  private nebulaLayers: NebulaLayer[] = []; // Animated nebula clouds
  private twinkleStars: TwinkleStar[] = []; // Bright "hero" stars that pulse
  private twinkleContainer: Container | null = null; // parallaxed with the near layer
  private swarmLayers: SwarmLayer[] = []; // Glowing swarms drifting in the nebula
  // Foreground dust motes (screen-fixed) that streak past with ship velocity —
  // the main sense-of-speed cue. Added to uiLayer (above world, below HUD).
  private dustContainer: Container | null = null;
  private dustMotes: DustMote[] = [];
  // Occasional foreground asteroids/comets drifting across the view (US-070 #1).
  private asteroidContainer: Container | null = null;
  private asteroids: AsteroidMote[] = [];
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
  private starCenterX: number = 0;
  private starCenterY: number = 0;
  private starSurface: Container | null = null; // rotating star surface
  private starHaloContainer: Container | null = null; // blurred glow behind star
  // Equirect sun map scrolled under a circular mask for real axial rotation
  // (US-070 #4) when the sphere mesh is unavailable.
  private starTiling: TilingSprite | null = null;
  // Preferred sun rendering: an equirect map on a hemisphere mesh (see
  // sphereMesh.ts) so it really turns rather than scrolling flat.
  private sunSphere: SphereMesh | null = null;
  private readonly STAR_RADIUS = GAME_BALANCE.starRadius;
  private readonly STAR_AVOID_RADIUS = SYSTEM_GEOMETRY.starAvoidRadius;
  private orbitGraphics: Graphics | null = null;
  private systemMiniMap: SystemMiniMap | null = null;

  // NPC ships present in the player's system (Feature 8, slice 2)
  private npcSprites: NpcShipSprite[] = [];
  private npcContactPanel: NpcContactPanel | null = null;
  private contactNpcId: string | null = null;
  // When set, the ship auto-follows this NPC (used by "Атаковать"): on each
  // arrival it re-routes to the target's current position (auto-follow).
  private followNpcId: string | null = null;
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

  // Turn control (Play/Pause). The turn "runs" (ship flies, NPCs/planets move,
  // combat resolves) while isTurnRunning; Pause ends it at the next day segment.
  private isTurnRunning = false;
  private pauseRequested = false;
  private playPauseButton: Text | null = null;
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

  // Two-step movement: plan route, then execute
  private plannedRoute: { x: number; y: number } | null = null;
  // If the active route targets a planet, its id — the ship auto-lands on arrival.
  private routeTargetPlanetId: string | null = null;
  // Full curved path (around the star) kept for drawing the route line; the
  // ship flows through it via ShipPhysics.setPath (no scene-side waypoint queue).
  private routePath: { x: number; y: number }[] = [];
  private routeLineGraphics: Graphics | null = null;

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
    const loadoutStats = this.gameEngine?.playerLoadout?.derivedStats();
    const cruise = loadoutStats
      ? loadoutStats.speed
      : (this.DISTANCE_PER_DAY / 1000) *
        Math.min(1.4, Math.max(0.8, this.gameEngine?.player?.ship.speed ?? 1));
    this.shipPhysics = new ShipPhysics(entryX, entryY, cruise || 0.1);

    this.renderer.clearGameLayer();
    this.renderer.clearUILayer();

    // Explicit z-ordering so interactive ships always sit (and hit-test) above
    // the large planet discs and the star — planets render big, and without this
    // a planet's interactive disc could swallow clicks meant for an NPC drifting
    // over it (US-070 #6). zIndex tiers: background 0, star/planets default,
    // NPCs Z_NPC, player ship Z_SHIP, decorative FX in between.
    this.renderer.gameLayer.sortableChildren = true;

    // Store star center position
    this.starCenterX = centerX;
    this.starCenterY = centerY;

    // Screen-fixed deep-space backdrop (crisp far stars + twinkle), behind the
    // whole world so panning/zooming never exposes a hard background edge.
    this.skyContainer = new Container();
    this.skyContainer.eventMode = "none";
    this.renderer.stage.addChildAt(this.skyContainer, 0);

    // Reserved world-space container (currently empty; nebulae moved to skyContainer).
    this.backgroundContainer = new Container();
    this.renderer.gameLayer.addChild(this.backgroundContainer);

    this.createNebulae(); // Screen-space nebula clouds (skyContainer) + swarms
    this.createStarField(); // Crisp far stars (screen-fixed)
    this.createTwinkleStars(); // Bright pulsing hero stars (screen-fixed)
    this.createStar();
    this.createOrbits();
    this.createSystemBoundary(); // Edge where hyperjumps happen
    this.createPlanets(); // Planets added to gameLayer directly (not blurred)
    this.createStations(); // Space stations in this system (US-066)
    this.createNpcShips(); // NPC ships present in this system (Feature 8)
    this.createShip();
    this.createTargetIndicator();
    this.createDust(); // Foreground streaking motes (screen-fixed, above world)
    this.createAsteroids(); // Occasional foreground asteroids/comets (US-070 #1)
    this.createVignette(); // Screen-fixed edge darkening (added before HUD)
    this.createUI();

    // Took off from a planet → spawn right next to it (just outside its orbit),
    // not at the system edge. Planets are placed at a random orbital angle each
    // time the scene loads, so we resolve the position after createPlanets().
    if (ctx?.fromPlanetId && this.shipPhysics) {
      const sprite = this.planetSprites.find(
        (s) => s.planet.id === ctx.fromPlanetId,
      );
      if (sprite) {
        const dx = sprite.screenX - this.starCenterX;
        const dy = sprite.screenY - this.starCenterY;
        const len = Math.hypot(dx, dy) || 1;
        const spawnX = sprite.screenX + (dx / len) * 80; // 80px further out
        const spawnY = sprite.screenY + (dy / len) * 80;
        // teleport() also resets the physics target, so the ship parks here
        // instead of flying back toward its initial (edge) spawn point.
        this.shipPhysics.teleport(spawnX, spawnY);
        if (this.shipContainer) {
          this.shipContainer.x = spawnX;
          this.shipContainer.y = spawnY;
        }
      }
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
    this.updateStarField(deltaTime);
    this.updateDust(deltaTime);
    this.updateAsteroids(deltaTime);
    this.updateStar(deltaTime);
    this.updateNebulae();
    this.updateSwarms();
    this.updateTwinkleStars();
    this.updateWarpEffect(deltaTime);
    this.updateShip(deltaTime);
    this.updateCombat(deltaTime);
    this.updateCameraReturn();
    this.updateCamera();
    this.updateNpcShips(deltaTime);
    this.updatePlanets(deltaTime);
    this.updateTargetIndicator();
    this.updatePlayPauseButton();
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
    this.isTurnRunning = false;
    this.pauseRequested = false;
    this._combatTransitionPending = false;
    this.cameraReturning = false;

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

    // Destroy quest journal
    if (this.questJournalUI) {
      this.questJournalUI.destroy();
      this.questJournalUI = null;
    }

    // Destroy mini-map
    if (this.systemMiniMap) {
      this.systemMiniMap.destroy();
      this.systemMiniMap = null;
    }

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
      this.skyContainer.destroy({ children: true });
      this.skyContainer = null;
    }

    this.starLayers = [];
    this.nebulaLayers = [];
    this.twinkleStars = [];
    this.twinkleContainer = null;
    this.nebulaBackdropSprite = null;
    this.swarmLayers = [];
    this.dustMotes = [];
    this.asteroids = [];
    // Layers are torn down by clearGameLayer/clearUILayer on the next scene
    // init; just drop our references (consistent with uiContainer handling).
    this.warpEffect = null;
    this.bgElapsed = 0;
    this.shipContainer = null;
    this.shipGraphics = null;
    this.shipSprite = null;
    this.backgroundContainer = null;
    this.dustContainer = null;
    this.asteroidContainer = null;
    this.nebulaeContainer = null;
    this.uiContainer = null;
    this.cameraDebugText = null;
    this.dayCounterText = null;
    this.shipPhysics = null;
    this.starSurface = null;
    this.starHaloContainer = null;
    this.starTiling = null;
    this.sunSphere = null;
    this.orbitGraphics = null;
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

  private createStarField(): void {
    if (!this.skyContainer) return;

    const width = this.renderer.app.screen.width;
    const height = this.renderer.app.screen.height;

    // Depth layers, deepest → nearest. `depth` = on-screen pan parallax rate
    // (far moves least → reads as distant); `zoomDepth` = how much it scales with
    // zoom. Stars are laid out in a large field CENTRED on the origin and the
    // whole layer is translated by cameraPan*depth — no per-pan reshuffling/
    // wrapping, so stars don't pop/change as you pan (US-070 parallax fix).
    const cx = width / 2;
    const cy = height / 2;
    // Depth hierarchy (pan parallax rate × cameraPan = on-screen shift per px).
    // Far layer barely moves (deep-background cue); near layer clearly trails
    // behind as you pan (close-foreground cue). The 5.5× ratio between layers
    // makes the depth effect read clearly without stars "flying" off screen.
    // zoomDepth: subtle size change on zoom-in/out — near-layer stars feel
    // like local dust/debris; far-layer stars are unaffected by zoom (infinity).
    // spread: field half-extent in screen-widths/heights; near layer uses more
    // so its larger pan shifts never expose an edge.
    const layerConfigs = [
      // Deepest layer: ultra-dense carpet of faint micro-stars (the "infinity" cue).
      // Very low alpha individually — they stack into a dense milky band rather than
      // isolated dots. No zoom-depth: they sit at infinite distance.
      {
        count: 3400,
        depth: 0.02,
        zoomDepth: 0.0,
        size: [0.18, 0.55],
        alpha: [0.1, 0.42],
        spread: 1.0,
      },
      // Mid layer: slightly larger, begin to show color, visible individually.
      {
        count: 1200,
        depth: 0.08,
        zoomDepth: 0.03,
        size: [0.42, 1.15],
        alpha: [0.28, 0.72],
        spread: 1.3,
      },
      // No near/foreground star layer — foreground is dust streaks only (per art direction).
    ];

    // Weighted color pool: 60% blue-white (hot stellar cores), 15% pure white,
    // 8% cool blue, 8% warm yellow-white, 5% nebula-lit pink, 4% warm orange.
    // This matches photographic star fields where cool/hot stars dominate and
    // a few warm/pink ones signal nebula illumination.
    const starColorPool: number[] = [];
    const pushColors = (c: number, w: number) => {
      for (let i = 0; i < w; i++) starColorPool.push(c);
    };
    pushColors(0xe8f2ff, 35); // blue-white (dominant)
    pushColors(0xffffff, 20); // pure white
    pushColors(0xccddff, 12); // cool blue
    pushColors(0xfff5e0, 12); // warm yellow-white
    pushColors(0xffd0d0, 10); // nebula-lit pink
    pushColors(0xffc090, 7); // warm orange
    pushColors(0xddccff, 4); // faint violet

    for (const config of layerConfigs) {
      const container = new Container();

      for (let i = 0; i < config.count; i++) {
        const fw = width * config.spread;
        const fh = height * config.spread;
        const x = (Math.random() * 2 - 1) * fw;
        const y = (Math.random() * 2 - 1) * fh;
        const size =
          config.size[0] + Math.random() * (config.size[1] - config.size[0]);
        const alpha =
          config.alpha[0] + Math.random() * (config.alpha[1] - config.alpha[0]);

        const graphics = new Graphics();
        graphics.circle(x, y, size);
        graphics.fill({
          color:
            starColorPool[Math.floor(Math.random() * starColorPool.length)],
          alpha,
        });
        container.addChild(graphics);
      }

      container.x = cx; // field centre starts at screen centre
      container.y = cy;
      this.starLayers.push({
        container,
        depth: config.depth,
        zoomDepth: config.zoomDepth,
      });
      this.skyContainer.addChild(container); // Crisp, screen-fixed backdrop
    }
  }

  /**
   * A handful of bright "hero" stars with a 4-point glint that gently pulse
   * (twinkle). Only these few are animated per-frame, so it stays cheap.
   */
  private createTwinkleStars(): void {
    if (!this.skyContainer) return;

    const width = this.renderer.app.screen.width;
    const height = this.renderer.app.screen.height;
    const container = new Container();
    // Mix of colors: most blue-white (hot giants), some warm, some pink (nebula-lit).
    const twinkleColors = [
      { c: 0xffffff, w: 8 }, // pure white
      { c: 0xe0eeff, w: 12 }, // blue-white (most common)
      { c: 0xfff5cc, w: 6 }, // warm yellow
      { c: 0xffcccc, w: 5 }, // nebula pink
      { c: 0xffddaa, w: 4 }, // warm orange
      { c: 0xccddff, w: 5 }, // cool blue
    ];
    const twinklePool: number[] = [];
    for (const { c, w } of twinkleColors) {
      for (let k = 0; k < w; k++) twinklePool.push(c);
    }

    const count = 60;

    for (let i = 0; i < count; i++) {
      const x = Math.random() * width * 2.2 - width * 0.6;
      const y = Math.random() * height * 2.2 - height * 0.6;
      const color = twinklePool[Math.floor(Math.random() * twinklePool.length)];
      // vary size: most small, a few large "hero" stars
      const r =
        Math.random() < 0.15
          ? 2.2 + Math.random() * 1.4 // bright hero star
          : 1.1 + Math.random() * 1.4; // normal bright star
      const baseAlpha = 0.55 + Math.random() * 0.45;

      const g = new Graphics();
      // outer soft diffraction halo
      g.circle(0, 0, r * 5).fill({ color, alpha: 0.06 });
      g.circle(0, 0, r * 2.8).fill({ color, alpha: 0.18 });
      // 4-point diffraction spike
      const len = r * (r > 2 ? 9 : 6);
      g.moveTo(-len, 0).lineTo(len, 0).moveTo(0, -len).lineTo(0, len);
      g.stroke({ width: r > 2 ? 1.0 : 0.7, color, alpha: 0.45 });
      // bright core
      g.circle(0, 0, r).fill({ color, alpha: 1 });
      g.x = x;
      g.y = y;
      g.alpha = baseAlpha;
      container.addChild(g);

      this.twinkleStars.push({
        graphics: g,
        baseAlpha,
        phase: Math.random() * Math.PI * 2,
        speed: 0.0008 + Math.random() * 0.0018,
      });
    }

    this.skyContainer.addChild(container);
    this.twinkleContainer = container;
  }

  /** Blend a hex colour toward white by `amount` [0..1]. */
  private lightenColor(color: number, amount: number): number {
    const r = (color >> 16) & 0xff;
    const g = (color >> 8) & 0xff;
    const b = color & 0xff;
    const lr = Math.round(r + (255 - r) * amount);
    const lg = Math.round(g + (255 - g) * amount);
    const lb = Math.round(b + (255 - b) * amount);
    return (lr << 16) | (lg << 8) | lb;
  }

  /**
   * Big, organic, multi-tone nebula clouds spread across the whole system.
   * Each cloud is built from many overlapping soft blobs baked into a single
   * blurred Graphics (drawn once), then only its transform/alpha is animated —
   * slow drift + gentle "breathing" pulse — so it's cheap but feels alive.
   * The palette and layout are seeded from the system id, so every system has a
   * distinct but stable look.
   */
  private createNebulae(): void {
    if (!this.skyContainer) return;

    this.nebulaeContainer = new Container();
    this.nebulaeContainer.eventMode = "none";

    const systemId = this.gameEngine?.player?.currentSystemId ?? "default";
    const rng = new SeededRNG(`nebula_${systemId}`);

    const sw = this.renderer.app.screen.width;
    const sh = this.renderer.app.screen.height;

    // Photorealistic nebula palettes — [dark-outer, mid-body, inner-hot, core-bright, accent].
    const palettes = [
      [0x6e0a00, 0xcc2000, 0xff4400, 0xff8800, 0xffbb22], // warm red-orange
      [0x05082a, 0x0d1a88, 0x2244cc, 0x4466ff, 0x88aaff], // deep blue-violet
      [0x380012, 0x880030, 0xdd1060, 0xff44aa, 0xffaadd], // crimson-magenta
      [0x2a1000, 0x993300, 0xff6600, 0xffaa00, 0xffee44], // amber-gold
      [0x180040, 0x440088, 0x8800cc, 0xaa44ff, 0xddaaff], // purple-indigo
    ];
    const palIdx = rng.nextInt(0, palettes.length - 1);
    const palette = palettes[palIdx];

    // Backdrop art sprite (if present) — behind everything in skyContainer.
    const palNames = ["red", "blue", "red", "red", "blue"];
    const backdrop =
      pickVariant("nebula", `${palNames[palIdx]}_mid`, systemId) ??
      pickVariant("nebula", `${palNames[palIdx]}_near`, systemId);
    if (backdrop) {
      const bg = new Sprite(backdrop);
      bg.anchor.set(0.5);
      bg.x = sw / 2;
      bg.y = sh / 2;
      const size = Math.max(sw, sh) * 2.4;
      bg.width = size;
      bg.height = size;
      bg.alpha = 0.38;
      bg.eventMode = "none";
      this.nebulaBackdropSprite = bg;
      this.skyContainer.addChildAt(bg, 0);
    }

    // Clouds are in screen-space (skyContainer), centred on (0,0) relative to
    // nebulaeContainer. nebulaeContainer is placed at screen-centre and translated
    // by cameraPan × NEBULA_DEPTH for gentle parallax — same model as star layers.
    // Each cloud gets a BlurFilter to dissolve hard circle edges into smooth gradients.
    const cloudCount = rng.nextInt(4, 6);

    for (let c = 0; c < cloudCount; c++) {
      const cloud = new Container();
      // Symmetric spread so clouds fill and slightly overflow the viewport.
      cloud.x = rng.nextFloat(-sw * 0.7, sw * 0.7);
      cloud.y = rng.nextFloat(-sh * 0.7, sh * 0.7);

      const outerColor = palette[0];
      const bodyColor = palette[rng.nextInt(1, 2)];
      const innerColor = palette[3];
      const coreColor = palette[4];

      // cloudR in screen pixels (was world-px, caused scaling artifacts on zoom).
      const cloudR = rng.nextFloat(200, 450);
      const squash = rng.nextFloat(0.45, 0.92);
      const rot = rng.next() * Math.PI;

      // OUTER HAZE — fills the whole cloud area, very soft
      const outerG = new Graphics();
      for (let b = 0; b < 24; b++) {
        const ang = rng.next() * Math.PI * 2;
        const dist = rng.next() * cloudR;
        let bx = Math.cos(ang) * dist;
        let by = Math.sin(ang) * dist * squash;
        const rx = bx * Math.cos(rot) - by * Math.sin(rot);
        const ry = bx * Math.sin(rot) + by * Math.cos(rot);
        bx = rx;
        by = ry;
        const r = rng.nextFloat(55, 140) * (1 - (dist / cloudR) * 0.3);
        outerG
          .circle(bx, by, r)
          .fill({ color: outerColor, alpha: rng.nextFloat(0.05, 0.12) });
      }
      cloud.addChild(outerG);

      // BODY — denser toward centre
      const bodyG = new Graphics();
      for (let b = 0; b < 32; b++) {
        const ang = rng.next() * Math.PI * 2;
        const dist = rng.next() * rng.next() * cloudR * 0.85;
        let bx = Math.cos(ang) * dist;
        let by = Math.sin(ang) * dist * squash;
        const rx = bx * Math.cos(rot) - by * Math.sin(rot);
        const ry = bx * Math.sin(rot) + by * Math.cos(rot);
        bx = rx;
        by = ry;
        const r = rng.nextFloat(35, 100) * (1 - (dist / cloudR) * 0.55);
        bodyG
          .circle(bx, by, r)
          .fill({ color: bodyColor, alpha: rng.nextFloat(0.08, 0.2) });
      }
      cloud.addChild(bodyG);

      // HOT INNER — tight bright zone
      const innerG = new Graphics();
      for (let b = 0; b < 16; b++) {
        const ang = rng.next() * Math.PI * 2;
        const dist = rng.next() * rng.next() * cloudR * 0.42;
        let bx = Math.cos(ang) * dist;
        let by = Math.sin(ang) * dist * squash;
        const rx = bx * Math.cos(rot) - by * Math.sin(rot);
        const ry = bx * Math.sin(rot) + by * Math.cos(rot);
        bx = rx;
        by = ry;
        const r = rng.nextFloat(18, 55);
        innerG
          .circle(bx, by, r)
          .fill({ color: innerColor, alpha: rng.nextFloat(0.12, 0.28) });
      }
      cloud.addChild(innerG);

      // LUMINOUS CORE — tiny bright hot-spots
      const coreG = new Graphics();
      const coreCount = rng.nextInt(1, 3);
      for (let e = 0; e < coreCount; e++) {
        const ex = rng.nextFloat(-cloudR * 0.15, cloudR * 0.15);
        const ey = rng.nextFloat(-cloudR * 0.15, cloudR * 0.15) * squash;
        const cr = rng.nextFloat(10, 28);
        coreG
          .circle(ex, ey, cr * 2.2)
          .fill({ color: coreColor, alpha: rng.nextFloat(0.08, 0.16) });
        coreG
          .circle(ex, ey, cr)
          .fill({ color: coreColor, alpha: rng.nextFloat(0.22, 0.42) });
      }
      cloud.addChild(coreG);

      // Container-level screen blend + GPU blur converts sharp circle edges into
      // volumetric gradients. Applied to whole container = single GPU pass per cloud.
      cloud.blendMode = "screen";
      cloud.filters = [new BlurFilter({ strength: 72, quality: 3 })];
      cloud.eventMode = "none";

      this.nebulaeContainer.addChild(cloud);
      this.nebulaLayers.push({
        container: cloud,
        driftX: rng.nextFloat(-0.004, 0.004),
        driftY: rng.nextFloat(-0.004, 0.004),
        pulseAmp: rng.nextFloat(0.08, 0.18),
        pulseSpeed: rng.nextFloat(0.0003, 0.0009),
        phase: rng.next() * Math.PI * 2,
        baseAlpha: 1,
      });
    }

    this.createSwarms(rng, palette);
    this.createNebulaPillars(rng, sw, sh);

    // Add behind star layers: backdrop(0) → nebulae(1) → stars(2+).
    this.skyContainer.addChild(this.nebulaeContainer);
  }

  /**
   * A few drifting swarms of tiny glowing motes — the luminous "fireflies" that
   * cluster inside the nebula in the reference shot. Each swarm is a baked
   * Graphics of soft dots (cheap), animated only by a slow drift + breathing
   * pulse on its container.
   */
  private createSwarms(rng: SeededRNG, palette: number[]): void {
    if (!this.nebulaeContainer) return;

    const sw = this.renderer.app.screen.width;
    const sh = this.renderer.app.screen.height;
    const swarmCount = rng.nextInt(3, 6);

    for (let s = 0; s < swarmCount; s++) {
      const container = new Container();
      // Screen-space positions relative to nebulaeContainer origin (screen centre).
      container.x = rng.nextFloat(-sw * 0.55, sw * 0.55);
      container.y = rng.nextFloat(-sh * 0.55, sh * 0.55);

      // Brighten a palette colour toward white for a "glowing" mote.
      const tint = this.lightenColor(
        palette[rng.nextInt(0, palette.length - 1)],
        0.6,
      );
      // Small, tight cluster of luminous motes — like the reference's green
      // "fireflies". Key: small spread + no blur filter + low baseAlpha so they
      // don't coalesce into the cartoon glowing balls that plagued the old version.
      const spread = rng.nextFloat(50, 110);
      const motes = rng.nextInt(22, 44);

      const g = new Graphics();
      for (let m = 0; m < motes; m++) {
        const ang = rng.next() * Math.PI * 2;
        const dist = rng.next() * rng.next() * spread;
        const mx = Math.cos(ang) * dist;
        const my = Math.sin(ang) * dist;
        const r = rng.nextFloat(0.6, 1.8);
        // minimal halo (r×1.6), bright-but-small core
        g.circle(mx, my, r * 1.6).fill({ color: tint, alpha: 0.08 });
        g.circle(mx, my, r).fill({ color: tint, alpha: 0.7 });
      }
      // No blur filter — blur was the root cause of cartoon blobs (US-070)
      container.addChild(g);
      this.nebulaeContainer.addChild(container);

      this.swarmLayers.push({
        container,
        driftX: rng.nextFloat(-0.005, 0.005),
        driftY: rng.nextFloat(-0.005, 0.005),
        pulseSpeed: rng.nextFloat(0.0006, 0.0014),
        pulseAmp: rng.nextFloat(0.12, 0.22),
        phase: rng.next() * Math.PI * 2,
        baseAlpha: rng.nextFloat(0.22, 0.45), // much subtler than before
      });
    }
  }

  /**
   * Dark dust-lane pillars composited over the nebula clouds with multiply blend.
   * The reference (SR2) shows dark gas columns visible against the lit nebula —
   * elongated, slightly rotated, softly blurred so they read as absorption zones
   * rather than painted stripes.
   */
  private createNebulaPillars(rng: SeededRNG, sw: number, sh: number): void {
    if (!this.nebulaeContainer) return;

    const pillarCount = rng.nextInt(3, 5);
    for (let p = 0; p < pillarCount; p++) {
      const g = new Graphics();

      // Position near the core of the nebula, offset slightly.
      const cx = rng.nextFloat(-sw * 0.35, sw * 0.35);
      const cy = rng.nextFloat(-sh * 0.35, sh * 0.35);

      // Each pillar is 3–5 overlapping dark ellipses at a common angle to form
      // a column. Random tilt makes them organic rather than axis-aligned.
      const tilt = rng.nextFloat(-Math.PI * 0.45, Math.PI * 0.45);
      const segments = rng.nextInt(3, 5);
      for (let s = 0; s < segments; s++) {
        const along = rng.nextFloat(-80, 80); // offset along the pillar axis
        const perp = rng.nextFloat(-18, 18); // slight wobble perpendicular
        const ex = cx + Math.cos(tilt) * along - Math.sin(tilt) * perp;
        const ey = cy + Math.sin(tilt) * along + Math.cos(tilt) * perp;
        const w = rng.nextFloat(22, 48);
        const h = rng.nextFloat(65, 150);
        g.ellipse(ex, ey, w, h);
        g.fill({ color: 0x000000, alpha: rng.nextFloat(0.55, 0.82) });
      }

      const pillarC = new Container();
      pillarC.addChild(g);
      pillarC.rotation = tilt;
      pillarC.blendMode = "multiply";
      pillarC.filters = [new BlurFilter({ strength: 28, quality: 2 })];
      pillarC.eventMode = "none";
      this.nebulaeContainer.addChild(pillarC);
    }
  }

  /** Slow drift + breathing pulse so the glowing swarms shimmer. */
  private updateSwarms(): void {
    for (const s of this.swarmLayers) {
      s.container.x += s.driftX;
      s.container.y += s.driftY;
      const pulse =
        1 + Math.sin(this.bgElapsed * s.pulseSpeed + s.phase) * s.pulseAmp;
      s.container.alpha = Math.max(0, Math.min(1, s.baseAlpha * pulse));
    }
  }

  /**
   * Foreground dust motes (screen-fixed) that streak past with the ship's
   * velocity — the primary sense-of-speed cue, like flying through fine debris.
   * Added to the UI layer (above the world, below the HUD) so they always fill
   * the screen and never expose a world edge.
   */
  private createDust(): void {
    const width = this.renderer.app.screen.width;
    const height = this.renderer.app.screen.height;

    this.dustContainer = new Container();
    this.dustContainer.eventMode = "none";

    const count = 190;
    for (let i = 0; i < count; i++) {
      const g = new Graphics();
      const x = Math.random() * width;
      const y = Math.random() * height;
      g.x = x;
      g.y = y;
      g.eventMode = "none";
      this.dustContainer.addChild(g);
      this.dustMotes.push({
        graphics: g,
        x,
        y,
        depth: 0.3 + Math.random() * 0.7,
      });
    }

    // First child of the UI layer → above the world, below HUD/minimap.
    this.renderer.uiLayer.addChildAt(this.dustContainer, 0);
  }

  /**
   * Move dust motes opposite the ship's velocity (parallax by depth), wrapping
   * around the screen. Fast motion stretches each mote into a short streak.
   */
  private updateDust(deltaTime: number): void {
    if (!this.shipPhysics || this.dustMotes.length === 0) return;

    const width = this.renderer.app.screen.width;
    const height = this.renderer.app.screen.height;

    const velX =
      Math.cos(this.shipPhysics.shipAngle) * this.shipPhysics.currentSpeed;
    const velY =
      Math.sin(this.shipPhysics.shipAngle) * this.shipPhysics.currentSpeed;

    for (const mote of this.dustMotes) {
      const vx = -velX * mote.depth * deltaTime * 1.8;
      const vy = -velY * mote.depth * deltaTime * 1.8;
      mote.x += vx;
      mote.y += vy;

      // Wrap around the screen edges so the field is seamless.
      if (mote.x < 0) mote.x += width;
      else if (mote.x > width) mote.x -= width;
      if (mote.y < 0) mote.y += height;
      else if (mote.y > height) mote.y -= height;

      mote.graphics.x = mote.x;
      mote.graphics.y = mote.y;

      const speed = Math.hypot(vx, vy);
      const g = mote.graphics;
      g.clear();
      // Only render motion streaks (the sense-of-speed cue). At rest nothing is
      // drawn — static foreground dots read as dirt on the screen, which the
      // player would want to wipe off (US-070 #1: no stars in the foreground).
      if (speed > 2.5) {
        const alpha = Math.min(0.6, (speed - 2.5) * 0.12) * (0.4 + mote.depth);
        const len = Math.min(34, speed * 2.8);
        const nx = vx / speed;
        const ny = vy / speed;
        g.moveTo(0, 0)
          .lineTo(-nx * len, -ny * len)
          .stroke({ color: 0xbfd8ff, width: mote.depth * 1.4, alpha });
      }
    }
  }

  /**
   * Spawn a few asteroids/comets that drift through the system (US-070 #1).
   * They live in **world space** (the star's frame) so they pan and zoom with the
   * world rather than sliding across the screen as the ship moves — they belong
   * to the system, not the camera. A high zIndex keeps them reading in front of
   * the ship/planets ("foreground" flybys). The field stays sparse: each one
   * respawns at the system edge once it drifts past it.
   */
  private createAsteroids(): void {
    this.asteroidContainer = new Container();
    this.asteroidContainer.eventMode = "none";
    this.asteroidContainer.zIndex = 120; // in front of ship (110) / planets
    const count = 8;
    for (let i = 0; i < count; i++) {
      const g = new Graphics();
      g.eventMode = "none";
      this.asteroidContainer.addChild(g);
      const a: AsteroidMote = {
        graphics: g,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        spin: 0,
        comet: false,
        orbitA: 0,
        orbitB: 0,
        orbitAngle: 0,
        orbitSpeed: 0,
        orbitTilt: 0,
      };
      this.drawAsteroid(a);
      this.respawnAsteroid(a, true);
      this.asteroids.push(a);
    }
    // World-space (moves with the system), above the ship/planets.
    this.renderer.gameLayer.addChild(this.asteroidContainer);
  }

  /** Draw an irregular grey rock (or a comet with solar-wind tail). */
  private drawAsteroid(a: AsteroidMote): void {
    const g = a.graphics;
    g.clear();
    const r = a.comet ? 13 + Math.random() * 5 : 9 + Math.random() * 14;
    if (a.comet) {
      // Tail in local +x direction; rotation is updated each frame so +x always
      // points anti-sunward (solar wind blows tail away from the star).
      // Photorealistic look: many overlapping narrow wedges at slightly different
      // angles accumulate into a smooth volumetric gradient — no solid triangles.

      // DUST TAIL — 10 wedge layers fanning across ±14° total spread
      const dustColor = 0xd0e0ff;
      for (let i = 0; i < 10; i++) {
        const ang = (i / 9 - 0.5) * 0.24; // ±0.12 rad ≈ ±7°
        const len = r * (28 - i * 0.6);
        const hw = r * (2.6 - i * 0.08); // half-width at origin
        g.poly([Math.cos(ang) * len, Math.sin(ang) * len, 0, -hw, 0, hw]).fill({
          color: dustColor,
          alpha: 0.028,
        });
      }
      // Brighter inner spine — tight wedges
      for (let i = 0; i < 6; i++) {
        const ang = (i / 5 - 0.5) * 0.07;
        const len = r * 18;
        const hw = r * 0.8;
        g.poly([Math.cos(ang) * len, Math.sin(ang) * len, 0, -hw, 0, hw]).fill({
          color: 0xe8f0ff,
          alpha: 0.045,
        });
      }
      // ION TAIL — straight, narrow, blue-white
      g.poly([
        r * 38,
        r * 0.18,
        r * 38,
        -r * 0.18,
        0,
        -r * 0.3,
        0,
        r * 0.3,
      ]).fill({ color: 0x7aacff, alpha: 0.13 });
      g.poly([
        r * 30,
        r * 0.11,
        r * 30,
        -r * 0.11,
        0,
        -r * 0.18,
        0,
        r * 0.18,
      ]).fill({ color: 0x99c2ff, alpha: 0.2 });

      // COMA — stacked diffuse halos around the nucleus
      g.circle(0, 0, r * 5.0).fill({ color: 0x80a8d0, alpha: 0.03 });
      g.circle(0, 0, r * 3.2).fill({ color: 0xa0c0e0, alpha: 0.06 });
      g.circle(0, 0, r * 2.0).fill({ color: 0xc0d8f0, alpha: 0.1 });
      g.circle(0, 0, r * 1.2).fill({ color: 0xd8eaff, alpha: 0.18 });

      // NUCLEUS — icy, compact, with a hot interior point
      g.circle(0, 0, r * 0.9).fill({ color: 0xcce4ff, alpha: 0.92 });
      g.circle(0, 0, r * 0.45).fill({ color: 0xeef6ff, alpha: 0.96 });
      g.circle(0, 0, r * 0.15).fill({ color: 0xffffff, alpha: 1.0 });
    } else {
      const pts: number[] = [];
      const sides = 7;
      for (let i = 0; i < sides; i++) {
        const ang = (i / sides) * Math.PI * 2;
        const rr = r * (0.7 + Math.random() * 0.5);
        pts.push(Math.cos(ang) * rr, Math.sin(ang) * rr);
      }
      g.poly(pts).fill({ color: 0x6b6256, alpha: 0.85 });
      g.poly(pts).stroke({ width: 1, color: 0x2a251f, alpha: 0.6 });
      // a couple of craters
      g.circle(-r * 0.2, -r * 0.1, r * 0.22).fill({
        color: 0x4a443b,
        alpha: 0.7,
      });
      g.circle(r * 0.25, r * 0.2, r * 0.16).fill({
        color: 0x4a443b,
        alpha: 0.6,
      });
    }
  }

  /** Radius of the asteroid field around the star (world units). */
  private asteroidFieldRadius(): number {
    return this.SYSTEM_BOUNDARY_RADIUS * 1.1;
  }

  /**
   * Place an asteroid in world space: it enters at the system edge and drifts
   * across toward the far side (passing near the star). `initial` instead
   * scatters it somewhere inside the field so the first batch isn't all bunched
   * at the rim.
   */
  private respawnAsteroid(a: AsteroidMote, initial = false): void {
    const cx = this.starCenterX;
    const cy = this.starCenterY;
    const R = this.asteroidFieldRadius();

    if (a.comet) {
      // Elliptical orbit around the star. Highly eccentric like real comets.
      a.orbitA = R * (0.38 + Math.random() * 0.5); // 38–88% of boundary
      a.orbitB = a.orbitA * (0.2 + Math.random() * 0.45); // b/a = 0.20–0.65
      a.orbitAngle = Math.random() * Math.PI * 2;
      a.orbitSpeed =
        (0.00004 + Math.random() * 0.00008) * (Math.random() < 0.5 ? 1 : -1);
      a.orbitTilt = Math.random() * Math.PI * 2;
      // Set initial world position from orbital parameters
      const cos = Math.cos(a.orbitAngle);
      const sin = Math.sin(a.orbitAngle);
      a.x =
        cx +
        a.orbitA * cos * Math.cos(a.orbitTilt) -
        a.orbitB * sin * Math.sin(a.orbitTilt);
      a.y =
        cy +
        a.orbitA * cos * Math.sin(a.orbitTilt) +
        a.orbitB * sin * Math.cos(a.orbitTilt);
    } else {
      const speed = 0.012 + Math.random() * 0.03;
      const entryAng = Math.random() * Math.PI * 2;
      a.x = cx + Math.cos(entryAng) * R;
      a.y = cy + Math.sin(entryAng) * R;
      const aimAng = entryAng + Math.PI + (Math.random() - 0.5) * 1.1;
      a.vx = Math.cos(aimAng) * speed;
      a.vy = Math.sin(aimAng) * speed;
      a.spin = (Math.random() - 0.5) * 0.0008;
      if (initial) {
        const rr = Math.sqrt(Math.random()) * R;
        const ang2 = Math.random() * Math.PI * 2;
        a.x = cx + Math.cos(ang2) * rr;
        a.y = cy + Math.sin(ang2) * rr;
      }
    }
    a.graphics.x = a.x;
    a.graphics.y = a.y;
  }

  /** Drift + spin the asteroids in world space, respawning past the field edge. */
  private updateAsteroids(deltaTime: number): void {
    if (this.asteroids.length === 0) return;
    const cx = this.starCenterX;
    const cy = this.starCenterY;
    const limit = this.asteroidFieldRadius() * 1.15;
    const limitSq = limit * limit;
    for (const a of this.asteroids) {
      if (a.comet) {
        // Advance orbital angle (Kepler-lite: uniform angular speed)
        a.orbitAngle += a.orbitSpeed * deltaTime;
        const cos = Math.cos(a.orbitAngle);
        const sin = Math.sin(a.orbitAngle);
        a.x =
          cx +
          a.orbitA * cos * Math.cos(a.orbitTilt) -
          a.orbitB * sin * Math.sin(a.orbitTilt);
        a.y =
          cy +
          a.orbitA * cos * Math.sin(a.orbitTilt) +
          a.orbitB * sin * Math.cos(a.orbitTilt);
        a.graphics.x = a.x;
        a.graphics.y = a.y;
        // Tail points away from the star (solar wind). local +x → anti-sunward.
        const sunDx = a.x - cx;
        const sunDy = a.y - cy;
        a.graphics.rotation = Math.atan2(sunDy, sunDx);
        // Tail visible only in the inner system (orbit 2-3 zone ≈ 1050–1950 px).
        // Fade in from 2200 px, fully visible inside 1500 px.
        const dist = Math.hypot(sunDx, sunDy);
        const FULL = 1500;
        const FADE = 2200;
        a.graphics.alpha =
          dist <= FULL
            ? 1
            : dist >= FADE
              ? 0
              : 1 - (dist - FULL) / (FADE - FULL);
      } else {
        a.x += a.vx * deltaTime;
        a.y += a.vy * deltaTime;
        a.graphics.x = a.x;
        a.graphics.y = a.y;
        a.graphics.rotation += a.spin * deltaTime;
        const dx = a.x - cx;
        const dy = a.y - cy;
        if (dx * dx + dy * dy > limitSq) {
          this.drawAsteroid(a);
          this.respawnAsteroid(a);
        }
      }
    }
  }

  /**
   * Screen-fixed vignette that darkens the edges so the action reads in the
   * centre. Built as a heavily blurred thick border (no gradient API needed).
   */
  private createVignette(): void {
    const width = this.renderer.app.screen.width;
    const height = this.renderer.app.screen.height;

    // Stacked edge strokes fading inward — a vignette without a BlurFilter (a
    // blurred full-screen rect showed up as bands across the whole canvas).
    const v = new Graphics();
    const bands = 16;
    for (let i = 0; i < bands; i++) {
      const inset = i * 16;
      const alpha = 0.06 * (1 - i / bands);
      v.rect(inset, inset, width - 2 * inset, height - 2 * inset);
      v.stroke({ width: 32, color: 0x000000, alpha });
    }
    v.eventMode = "none"; // never intercept clicks
    // Added before the HUD so it sits underneath it (above the world). Torn
    // down by clearUILayer on the next scene init.
    this.renderer.uiLayer.addChild(v);
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

  /**
   * Create a beautiful star (sun) at the center of the system
   */
  private createStar(): void {
    const R = this.STAR_RADIUS;
    const rng = new SeededRNG(
      `star_${this.gameEngine?.player?.currentSystemId ?? "x"}`,
    );

    // Volumetric glow halo — a blurred container in screen blend, placed behind
    // the surface so the star appears to radiate warm light into the void.
    this.starHaloContainer = this.buildStarHalo(R);
    this.renderer.gameLayer.addChild(this.starHaloContainer);

    // --- Rotating surface: generated star art if available, else procedural ---
    const surface = new Container();
    surface.eventMode = "none"; // decorative — never intercept clicks
    surface.x = this.starCenterX;
    surface.y = this.starCenterY;

    // Preferred: equirectangular fire map projected onto a hemisphere so the
    // surface really turns (US-070 #4), tinted per star type. Falls back to a
    // flat scrolling disc if the mesh can't be built.
    const sunMap = tex("star_maps/sun_01") ?? this.pickStarTexture();
    if (sunMap) {
      const W = R * 2;
      const tint = this.starTint();
      this.sunSphere = buildSphereMesh(sunMap, R, tint);
      const mesh = this.sunSphere?.mesh ?? null;

      // No overlays on the sun: the hot-core fill and pulsing flares read as a
      // weird bright blob over the surface, so they were removed — the rotating
      // fire texture carries the look on its own.
      if (mesh) {
        surface.addChild(mesh);
      } else {
        // Fallback: flat scrolling disc under a circular mask.
        const maskC = new Graphics().circle(0, 0, R).fill({ color: 0xffffff });
        const tiling = new TilingSprite({
          texture: sunMap,
          width: W,
          height: W,
        });
        tiling.x = -R;
        tiling.y = -R;
        const scale = sunMap.height > 0 ? W / sunMap.height : 1;
        tiling.tileScale.set(scale, scale);
        tiling.tint = tint;
        tiling.mask = maskC;
        this.starTiling = tiling;
        surface.addChild(maskC, tiling);
      }

      this.starSurface = surface;
      this.renderer.gameLayer.addChild(surface);
      return;
    }

    const disc = new Graphics();
    // base disc, brighter toward the centre
    disc.circle(0, 0, R).fill({ color: 0xff8800 });
    disc.circle(0, 0, R * 0.82).fill({ color: 0xffab1f });
    disc.circle(0, 0, R * 0.55).fill({ color: 0xffd24a });
    // turbulent surface patches (darker spots + bright flares)
    const spots = rng.nextInt(22, 30);
    for (let i = 0; i < spots; i++) {
      const ang = rng.next() * Math.PI * 2;
      const dist = rng.next() * R * 0.95;
      const px = Math.cos(ang) * dist;
      const py = Math.sin(ang) * dist;
      const pr = rng.nextFloat(R * 0.08, R * 0.26);
      const dark = rng.next() < 0.5;
      disc.circle(px, py, pr).fill({
        color: dark ? 0xc23a12 : 0xfff0a0,
        alpha: rng.nextFloat(0.25, 0.6),
      });
    }
    // bright hot core
    disc.circle(0, 0, R * 0.32).fill({ color: 0xfff6cc, alpha: 0.85 });
    disc.filters = [this.paddedBlur(2)]; // crisp, slight softening

    // Clip mottling to the disc so nothing spills past the rim.
    const mask = new Graphics();
    mask.circle(0, 0, R).fill({ color: 0xffffff });
    surface.addChild(mask);
    disc.mask = mask;
    surface.addChild(disc);

    this.starSurface = surface;
    this.renderer.gameLayer.addChild(surface);
  }

  /**
   * Generated star art for the current system's star type (deterministic per
   * system), or undefined to fall back to the procedural sun.
   */
  private pickStarTexture(): import("pixi.js").Texture | undefined {
    const systemId = this.gameEngine?.player?.currentSystemId;
    if (!systemId) return undefined;
    const system = this.gameEngine?.galaxy?.systems.find(
      (s) => s.id === systemId,
    );
    if (!system) return undefined;
    const prefix: Partial<Record<StarType, string>> = {
      [StarType.RED_DWARF]: "red_dwarf",
      [StarType.YELLOW_DWARF]: "yellow",
      [StarType.BLUE_GIANT]: "blue_giant",
      [StarType.WHITE_DWARF]: "white_dwarf",
      [StarType.NEUTRON]: "neutron",
    };
    const p = prefix[system.starType];
    return p ? pickVariant("stars", p, systemId) : undefined;
  }

  /** Tint for the equirect sun map, by the current system's star type. */
  private starTint(): number {
    const systemId = this.gameEngine?.player?.currentSystemId;
    const system = this.gameEngine?.galaxy?.systems.find(
      (s) => s.id === systemId,
    );
    switch (system?.starType) {
      case StarType.RED_DWARF:
        return 0xff7a4d; // deep red-orange
      case StarType.BLUE_GIANT:
        return 0x8fb8ff; // blue-white
      case StarType.WHITE_DWARF:
        return 0xfff2e6; // near white
      case StarType.NEUTRON:
        return 0xcfe0ff; // cold brilliant
      default:
        return 0xffd9a0; // warm yellow sun
    }
  }

  /**
   * Diffuse volumetric glow behind the star. Uses BlurFilter on a container so
   * the falloff is smooth without concentric rings. Screen blend integrates
   * naturally with the dark space background.
   */
  private buildStarHalo(R: number): Container {
    const halo = new Container();
    halo.eventMode = "none";
    halo.x = this.starCenterX;
    halo.y = this.starCenterY;

    const systemId = this.gameEngine?.player?.currentSystemId;
    const system = this.gameEngine?.galaxy?.systems.find(
      (s) => s.id === systemId,
    );

    // Inner and outer halo colours keyed to star type.
    let innerC = 0xffeebb;
    let outerC = 0xff8800;
    switch (system?.starType) {
      case StarType.RED_DWARF:
        innerC = 0xff9966;
        outerC = 0xcc2200;
        break;
      case StarType.BLUE_GIANT:
        innerC = 0xddeeff;
        outerC = 0x4488ff;
        break;
      case StarType.WHITE_DWARF:
        innerC = 0xffffff;
        outerC = 0xaaccff;
        break;
      case StarType.NEUTRON:
        innerC = 0xeeffff;
        outerC = 0x6699ff;
        break;
    }

    const g = new Graphics();
    // Concentric fills, outermost first — BlurFilter smears them into a
    // smooth gradient so no individual ring is visible.
    g.circle(0, 0, R * 5.5).fill({ color: outerC, alpha: 0.03 });
    g.circle(0, 0, R * 4.0).fill({ color: outerC, alpha: 0.05 });
    g.circle(0, 0, R * 2.8).fill({ color: outerC, alpha: 0.09 });
    g.circle(0, 0, R * 1.9).fill({ color: innerC, alpha: 0.14 });
    g.circle(0, 0, R * 1.35).fill({ color: innerC, alpha: 0.22 });
    halo.addChild(g);

    halo.blendMode = "screen";
    halo.filters = [this.paddedBlur(110)];
    return halo;
  }

  /**
   * Animate the sun: roll the surface for axial rotation. Falls back to the
   * scrolling disc / procedural container when no mesh/map is available.
   */
  private updateStar(deltaTime: number): void {
    if (this.sunSphere) {
      // Roll the surface — the hemisphere mesh gives real spherical foreshortening.
      this.sunSphere.advance(0.00012 * deltaTime);
    } else if (this.starTiling) {
      // Fallback: scroll the map horizontally.
      this.starTiling.tilePosition.x -= 0.012 * deltaTime;
    } else if (this.starSurface) {
      this.starSurface.rotation += 0.00004 * deltaTime;
    }
  }

  /**
   * Draw visible orbital paths for planets
   */
  private createOrbits(): void {
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
      return;
    }

    this.orbitGraphics = new Graphics();
    this.orbitGraphics.eventMode = "none"; // decorative — never intercept clicks

    // Get unique orbital radii
    const uniqueRadii = new Set<number>();
    for (const planet of currentSystem.planets) {
      uniqueRadii.add(planet.orbitalRadius);
    }

    // Draw orbit circle for each unique radius
    for (const radius of uniqueRadii) {
      this.orbitGraphics.circle(this.starCenterX, this.starCenterY, radius);
      this.orbitGraphics.stroke({ color: 0x444444, width: 1, alpha: 0.3 });
    }

    // Add orbits to game layer (above star, below planets)
    this.renderer.gameLayer.addChild(this.orbitGraphics);
  }

  private createShip(): void {
    if (!this.shipPhysics) return;

    this.shipContainer = new Container();
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
      const pulse = Math.sin(Date.now() / 200) * 0.3 + 0.7; // Pulsing effect

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

    // Main hull
    this.shipGraphics
      .poly([
        size,
        0,
        -size * 0.7,
        -size * 0.6,
        -size * 0.4,
        0,
        -size * 0.7,
        size * 0.6,
      ])
      .fill({ color: 0x4488cc });

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

    // Engine glow (visible when ship is moving)
    if (this.shipPhysics.isMoving) {
      this.shipGraphics
        .poly([
          -size * 0.5,
          -size * 0.3,
          -size * 0.5 - size * 0.5 * Math.random(),
          0,
          -size * 0.5,
          size * 0.3,
        ])
        .fill({ color: 0x00ffff, alpha: 0.6 });
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
        fontSize: 13,
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
          fontSize: 12,
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
      style: { fontFamily: "Courier New", fontSize: 14, fill: 0x00ffff },
    });
    this.dayCounterText.x = 20;
    this.dayCounterText.y = 50;
    this.uiContainer.addChild(this.dayCounterText);

    // Quest Journal button
    const questBtn = new Text({
      text: "[КВЕСТЫ]",
      style: {
        fontFamily: "Courier New",
        fontSize: 14,
        fill: 0xffaa00,
        fontWeight: "bold" as const,
      },
    });
    questBtn.x = 20;
    questBtn.y = 80;
    questBtn.eventMode = "static";
    questBtn.cursor = "pointer";
    questBtn.on("pointerdown", (event) => {
      event.stopPropagation(); // Prevent stage from also handling this click
      logger.info("Quest journal button clicked");
      this.toggleQuestJournal();
    });
    questBtn.on("pointerover", () => {
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
        fontSize: 14,
        fill: 0xffaa00,
        fontWeight: "bold" as const,
      },
    });
    backBtn.x = this.renderer.app.screen.width - 220;
    backBtn.y = 20;
    backBtn.eventMode = "static";
    backBtn.cursor = "pointer";
    backBtn.on("pointerdown", async (event) => {
      event.stopPropagation(); // Prevent stage from also handling this click
      logger.info("Star map button clicked");
      await this.returnToStarMap();
    });

    // Add hover effect
    backBtn.on("pointerover", () => {
      backBtn.alpha = 0.7;
    });
    backBtn.on("pointerout", () => {
      backBtn.alpha = 1;
    });

    this.uiContainer.addChild(backBtn);
    this.backButton = backBtn;

    // Play / Pause turn control (bottom-centre). Play runs the planned turn;
    // while moving it becomes Pause, which ends the turn at the next day segment.
    const playBtn = new Text({
      text: "▶ ХОД",
      style: {
        fontFamily: "Courier New",
        fontSize: 18,
        fill: 0x00ff88,
        fontWeight: "bold" as const,
        stroke: { color: 0x000000, width: 4 },
      },
    });
    playBtn.anchor.set(0.5);
    playBtn.x = this.renderer.app.screen.width / 2;
    playBtn.y = this.renderer.app.screen.height - 40;
    playBtn.eventMode = "static";
    playBtn.cursor = "pointer";
    playBtn.on("pointerdown", (event) => {
      event.stopPropagation();
      this.onPlayPause();
    });
    playBtn.on("pointerover", () => {
      playBtn.alpha = 0.7;
    });
    playBtn.on("pointerout", () => {
      playBtn.alpha = 1;
    });
    this.uiContainer.addChild(playBtn);
    this.playPauseButton = playBtn;

    this.renderer.uiLayer.addChild(this.uiContainer);

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
        this.starCenterX,
        this.starCenterY,
        baseAngle,
        gameDays,
      );

      // Set up click handler
      sprite.createHitArea(this.onPlanetClick.bind(this));

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
        this.starCenterX + Math.cos(station.orbitAngle) * station.orbitRadius;
      const wy =
        this.starCenterY + Math.sin(station.orbitAngle) * station.orbitRadius;

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
        style: { fontSize: 10, fill: stationColor, fontFamily: "monospace" },
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
    logger.debug(`Planet clicked: ${planet.name}`);

    const planetSprite = this.planetSprites.find(
      (s) => s.planet.id === planet.id,
    );
    if (!planetSprite || !this.shipPhysics) return;

    // This route targets a planet → the ship will auto-land on arrival.
    this.routeTargetPlanetId = planet.id;
    this.followNpcId = null; // picking a planet cancels auto-follow

    // Two-step movement logic
    if (this.plannedRoute) {
      // Check if clicking on the same planet (within 50px of planned route)
      const dx = planetSprite.screenX - this.plannedRoute.x;
      const dy = planetSprite.screenY - this.plannedRoute.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < 50) {
        // Second click - execute the route (curving around the star if needed)
        this.executeRouteTo(this.plannedRoute.x, this.plannedRoute.y);
        logger.info(`▶️ Executing route to planet ${planet.name}`);
      } else {
        // Different planet - update planned route (preview bows around the star)
        this.planRouteTo(planetSprite.screenX, planetSprite.screenY);
        logger.info(`🗺️ Route updated to planet ${planet.name}`);
      }
    } else {
      // First click - plan the route (preview bows around the star)
      this.planRouteTo(planetSprite.screenX, planetSprite.screenY);
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

    logger.info(
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

    logger.info(`🔍 WHEEL EVENT FIRED! deltaY: ${event.deltaY}`);

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
      this.playPauseButton.x = w / 2;
      this.playPauseButton.y = h - 40;
    }
    this.systemMiniMap?.reposition(w, h);

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
    const minX = this.starCenterX - half;
    const maxX = this.starCenterX + half;
    const panXMax = -minX * z;
    const panXMin = sw - maxX * z;
    this.cameraPanX =
      panXMin > panXMax
        ? (panXMin + panXMax) / 2
        : Math.max(panXMin, Math.min(panXMax, this.cameraPanX));

    const minY = this.starCenterY - half;
    const maxY = this.starCenterY + half;
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

  private updateShip(deltaTime: number): void {
    if (!this.shipContainer || !this.shipGraphics || !this.shipPhysics) return;

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

        // Pause requested → end the turn at this day boundary (the ship stops at
        // the end of the day segment, per the Play/Pause spec).
        if (this.pauseRequested) {
          this.endTurn();
          this.showMessage("⏸ Ход завершён", 0xffcc00);
          break;
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
   * are committed to the galaxy as they tick over, and a requested Pause ends the
   * turn at the next day boundary — mirroring the in-flight day model.
   */
  private advanceWaitTime(deltaTime: number): void {
    this.waitDayAccum += deltaTime / this.MS_PER_WAIT_DAY;
    while (this.waitDayAccum >= 1) {
      this.waitDayAccum -= 1;
      if (this.gameEngine?.galaxy) {
        this.gameEngine.advanceGalaxyDay();
        this.updateDayCounter();
        this.refreshNpcShips();
      }
      if (this.pauseRequested) {
        this.endTurn();
        this.showMessage("⏸ Ход завершён", 0xffcc00);
        return;
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
   * Draw planned route line from ship to target
   */
  private drawRouteLine(): void {
    if (!this.shipPhysics || !this.plannedRoute) return;

    // Remove old route line
    if (this.routeLineGraphics) {
      this.renderer.gameLayer.removeChild(this.routeLineGraphics);
      this.routeLineGraphics.destroy();
    }

    // Create new route line. Non-interactive so its dashes/markers can never
    // sit over a ship and swallow its click (US-070 #7).
    this.routeLineGraphics = new Graphics();
    this.routeLineGraphics.eventMode = "none";

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

    const dashLength = 20;
    const gapLength = 10;
    const totalLength = dashLength + gapLength;

    // Dash along each segment of the polyline.
    for (let s = 0; s < points.length - 1; s++) {
      const ax = points[s].x;
      const ay = points[s].y;
      const bx = points[s + 1].x;
      const by = points[s + 1].y;
      const dx = bx - ax;
      const dy = by - ay;
      const distance = Math.hypot(dx, dy);
      const numSegments = Math.floor(distance / totalLength);
      for (let i = 0; i < numSegments; i++) {
        const t1 = (i * totalLength) / distance;
        const t2 = (i * totalLength + dashLength) / distance;
        this.routeLineGraphics.moveTo(ax + dx * t1, ay + dy * t1);
        this.routeLineGraphics.lineTo(ax + dx * t2, ay + dy * t2);
      }
    }

    this.routeLineGraphics.stroke({ color: 0x00ffff, width: 2, alpha: 0.6 });

    // Per-day tick marks along the route: a short perpendicular dash every
    // DISTANCE_PER_DAY pixels, so the player can read how many days the trip
    // takes (like the day "divisions" in the original game). See dayTickMarks.
    const tickLen = 6;
    for (const t of dayTickMarks(points, this.DISTANCE_PER_DAY)) {
      this.routeLineGraphics.moveTo(t.x - t.px * tickLen, t.y - t.py * tickLen);
      this.routeLineGraphics.lineTo(t.x + t.px * tickLen, t.y + t.py * tickLen);
    }
    this.routeLineGraphics.stroke({ color: 0xffee66, width: 2, alpha: 0.9 });

    // Check if route target is near a planet (within 50px radius)
    const isLandingOnPlanet = this.planetSprites.some((sprite) => {
      const pdx = sprite.screenX - toX;
      const pdy = sprite.screenY - toY;
      const planetDistance = Math.sqrt(pdx * pdx + pdy * pdy);
      return planetDistance < 50; // Within planet interaction radius
    });

    // Draw different marker based on whether this is a landing or empty space navigation
    if (isLandingOnPlanet) {
      // Landing marker: downward arrow + landing circles
      this.drawLandingMarker(toX, toY);
    } else {
      // Navigation marker: simple pulsing circle
      this.drawNavigationMarker(toX, toY);
    }

    this.renderer.gameLayer.addChild(this.routeLineGraphics);
  }

  /**
   * Draw landing marker for planetary approach
   */
  private drawLandingMarker(x: number, y: number): void {
    if (!this.routeLineGraphics) return;

    // Outer landing zone circles (kept compact so the marker doesn't swamp the
    // planet it points at).
    this.routeLineGraphics.circle(x, y, 12);
    this.routeLineGraphics.stroke({ color: 0xff9900, width: 2, alpha: 0.8 });
    this.routeLineGraphics.circle(x, y, 16);
    this.routeLineGraphics.stroke({ color: 0xff9900, width: 1.5, alpha: 0.4 });

    // Downward arrow (landing symbol)
    const arrowSize = 8;
    const arrowWidth = 5;

    // Arrow shaft
    this.routeLineGraphics.moveTo(x, y - arrowSize);
    this.routeLineGraphics.lineTo(x, y + arrowSize * 0.3);
    this.routeLineGraphics.stroke({ color: 0xff9900, width: 3, alpha: 1.0 });

    // Arrow head (triangle pointing down)
    this.routeLineGraphics
      .poly([
        x,
        y + arrowSize, // Bottom point
        x - arrowWidth,
        y, // Left point
        x + arrowWidth,
        y, // Right point
      ])
      .fill({ color: 0xff9900, alpha: 1.0 });

    // Small base platform indicator
    this.routeLineGraphics.moveTo(x - 8, y + arrowSize + 4);
    this.routeLineGraphics.lineTo(x + 8, y + arrowSize + 4);
    this.routeLineGraphics.stroke({ color: 0xff9900, width: 1.5, alpha: 0.7 });
  }

  /**
   * Draw navigation marker for empty space movement
   */
  private drawNavigationMarker(x: number, y: number): void {
    if (!this.routeLineGraphics) return;

    // Pulsing circles for generic navigation target (compact)
    this.routeLineGraphics.circle(x, y, 8);
    this.routeLineGraphics.stroke({ color: 0x00ffff, width: 2, alpha: 0.8 });
    this.routeLineGraphics.circle(x, y, 11);
    this.routeLineGraphics.stroke({ color: 0x00ffff, width: 1.5, alpha: 0.4 });
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
      this.starCenterX,
      this.starCenterY,
      this.STAR_AVOID_RADIUS,
    );
  }

  /**
   * Set the planned-route point and draw its preview, bowing the preview around
   * the star so the dashed line never appears to cut through the sun before the
   * player commits (US-070 #6: the route was drawn straight through the star on
   * the first click, only curving once executed).
   */
  private planRouteTo(x: number, y: number): void {
    if (!this.shipPhysics) return;
    this.plannedRoute = { x, y };
    this.routePath = this.computeAvoidancePath(
      this.shipPhysics.shipX,
      this.shipPhysics.shipY,
      x,
      y,
    );
    this.drawRouteLine();
  }

  /** Start flying to (x,y) along a star-avoiding path of waypoints. */
  private executeRouteTo(x: number, y: number): void {
    if (!this.shipPhysics) return;
    this.routePath = this.computeAvoidancePath(
      this.shipPhysics.shipX,
      this.shipPhysics.shipY,
      x,
      y,
    );
    // Hand the whole curved path to physics; it flows through the waypoints
    // without stopping (smooth motion around the star — US-070 #5).
    this.shipPhysics.setPath(this.routePath);
    this.plannedRoute = { x, y };
    this.isTurnRunning = true; // executing a route runs the turn (Play)
    this.drawRouteLine();
  }

  private clearPlannedRoute(): void {
    this.plannedRoute = null;
    this.routeTargetPlanetId = null;
    this.routeTargetStationId = null;
    this.followNpcId = null;
    this.routePath = [];

    if (this.routeLineGraphics) {
      this.renderer.gameLayer.removeChild(this.routeLineGraphics);
      this.routeLineGraphics.destroy();
      this.routeLineGraphics = null;
    }
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
      for (const sprite of this.planetSprites) {
        sprite.update(deltaTime);
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
        this.starCenterX,
        this.starCenterY,
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
   * Draw the system boundary — the edge where ships hyperjump in and out.
   * Faint dashed-looking ring; non-interactive so it never blocks clicks.
   */
  private createSystemBoundary(): void {
    const ring = new Graphics();
    ring.circle(
      this.starCenterX,
      this.starCenterY,
      this.SYSTEM_BOUNDARY_RADIUS,
    );
    ring.stroke({ width: 2, color: 0x2266aa, alpha: 0.35 });
    ring.eventMode = "none";
    // Cleaned up with the rest of the game layer in destroy(); no field needed.
    this.renderer.gameLayer.addChild(ring);
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
      cx: this.starCenterX,
      cy: this.starCenterY,
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
    sprite.container.zIndex = 100; // above planet discs so clicks reach the ship
    // Non-pirates "visit" a planet: anchor them to loiter near one (deterministic
    // by id) so traders/rangers/patrols cluster at planets instead of aimlessly
    // crossing the system. Pirates keep roaming the whole band.
    if (npc.role !== NpcRole.PIRATE && this.planetSprites.length > 0) {
      const idx = this.hashId(npc.id) % this.planetSprites.length;
      const p = this.planetSprites[idx];
      sprite.setAnchor(p.screenX, p.screenY);
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
      sprite.update(deltaTime);
      if (sprite.isGone()) {
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
      const domainQuest = SAMPLE_TEXT_QUESTS[0];
      if (domainQuest) {
        void this.gameEngine.transitionTo(SceneType.TEXT_QUEST, {
          gameEngine: this.gameEngine,
          quest: domainQuest,
          returnScene: SceneType.SPACE_FLIGHT,
          returnContext: { gameEngine: this.gameEngine },
        });
        return;
      }
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

    // Not yet in range — auto-follow to close the gap.
    this.followNpcId = npc.id;
    this.routeTargetPlanetId = null;
    this.executeRouteTo(sprite.x, sprite.y);
    this.showMessage(`Перехват: ${npc.name}`, 0xff5555);
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
      },
    });
  }

  /**
   * Play/Pause turn control. When paused: Play executes the planned route (the
   * turn starts running). While running: Pause ends the turn at the next day
   * segment (or immediately if the ship is holding station in combat).
   */
  private onPlayPause(): void {
    if (this.isTurnRunning) {
      // Pause: stop at the end of the current day segment while flying; if the
      // ship is holding station (e.g. firing on a target) end the turn now.
      if (this.shipPhysics?.isMoving) {
        this.pauseRequested = true;
        this.showMessage("⏸ Пауза в конце отрезка дня", 0xffcc00);
      } else {
        this.endTurn();
      }
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
      this.showMessage("⏳ Ожидание… (мир движется)", 0x88ccff);
    }
  }

  /** End the running turn: stop the ship and freeze the world (pause). */
  private endTurn(): void {
    this.isTurnRunning = false;
    this.pauseRequested = false;
    this.waitDayAccum = 0;
    if (this.shipPhysics) {
      this.shipPhysics.setTarget(
        this.shipPhysics.shipX,
        this.shipPhysics.shipY,
      );
      this.shipPhysics.isMoving = false;
      this.shipPhysics.currentSpeed = 0;
    }
  }

  /** Refresh the Play/Pause button label/colour to match the turn state. */
  private updatePlayPauseButton(): void {
    if (!this.playPauseButton) return;
    if (this.isTurnRunning) {
      this.playPauseButton.text = this.pauseRequested ? "⏸ …" : "⏸ ПАУЗА";
      this.playPauseButton.style.fill = 0xffcc00;
    } else {
      // ХОД is always available — with a course it flies it, without one it runs
      // a wait turn (US-070 #5), so the button is always shown active.
      this.playPauseButton.text = "▶ ХОД";
      this.playPauseButton.style.fill = 0x00ff88;
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
        if (!this.shipPhysics.isMoving)
          this.executeRouteTo(decision.targetX, decision.targetY);
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
    return this.npcContactPanel !== null || this.questJournalUI !== null;
  }

  /** Close any open blocking modal (NPC contact / quest journal). */
  private closeBlockingModals(): void {
    this.closeNpcContactPanel();
    const journal = this.questJournalUI;
    this.questJournalUI = null;
    if (journal) queueMicrotask(() => journal.destroy());
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
        fontSize: 15,
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

  /** Slow drift + gentle "breathing" pulse so the nebulae feel alive. */
  private updateNebulae(): void {
    // Nebulae live in skyContainer (screen-space) — they don't scale with gameLayer
    // zoom, so depth remains consistent at any zoom level. Gentle parallax
    // (NEBULA_DEPTH ≈ 0.04) is midway between far stars (0.02) and mid stars (0.08).
    const NEBULA_DEPTH = 0.04;
    if (this.nebulaeContainer) {
      const cx = this.renderer.app.screen.width / 2;
      const cy = this.renderer.app.screen.height / 2;
      this.nebulaeContainer.x = cx + this.cameraPanX * NEBULA_DEPTH;
      this.nebulaeContainer.y = cy + this.cameraPanY * NEBULA_DEPTH;
    }

    const DRIFT_X = 0.006;
    const DRIFT_Y = 0.004;
    for (const n of this.nebulaLayers) {
      n.container.x += n.driftX + DRIFT_X;
      n.container.y += n.driftY + DRIFT_Y;
      const pulse =
        1 + Math.sin(this.bgElapsed * n.pulseSpeed + n.phase) * n.pulseAmp;
      n.container.alpha = Math.max(0, Math.min(1, n.baseAlpha * pulse));
      const s =
        1 + Math.sin(this.bgElapsed * n.pulseSpeed * 0.7 + n.phase) * 0.03;
      n.container.scale.set(s);
    }
  }

  /** Twinkle the few bright hero stars by oscillating their alpha. */
  private updateTwinkleStars(): void {
    for (const s of this.twinkleStars) {
      const t = 0.55 + 0.45 * Math.sin(this.bgElapsed * s.speed + s.phase);
      s.graphics.alpha = s.baseAlpha * t;
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

  private updateStarField(_deltaTime: number): void {
    if (!this.skyContainer) return;

    const cx = this.renderer.app.screen.width / 2;
    const cy = this.renderer.app.screen.height / 2;

    // Nebula art backdrop drifts almost imperceptibly (0.01) — it reads as an
    // infinite-distance cosmic cloud that barely reacts to local camera motion.
    if (this.nebulaBackdropSprite) {
      this.nebulaBackdropSprite.x = cx + this.cameraPanX * 0.01;
      this.nebulaBackdropSprite.y = cy + this.cameraPanY * 0.01;
    }

    // Each depth layer is a centred field translated by cameraPan*depth. Stars
    // also scale slightly with zoom (except the deepest layer — it's at infinity
    // and never scales). No Math.max clamp: stars can shrink at zoom-out, giving
    // the correct depth cue that distant stars look smaller when you step back.
    for (const layer of this.starLayers) {
      const s = Math.max(0.4, 1 + (this.cameraZoom - 1) * layer.zoomDepth);
      layer.container.scale.set(s);
      layer.container.x = cx + this.cameraPanX * layer.depth;
      layer.container.y = cy + this.cameraPanY * layer.depth;
    }

    // Twinkle stars ride with the mid layer — bright distant stars, not foreground.
    if (this.twinkleContainer) {
      this.twinkleContainer.x = cx + this.cameraPanX * 0.08;
      this.twinkleContainer.y = cy + this.cameraPanY * 0.08;
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
    const bg = new Graphics();
    bg.fill({ color: 0x000000, alpha: 0.85 });
    bg.roundRect(width / 2 - 240, height / 2 - 110, 480, 220, 6);
    bg.fill();

    const border = new Graphics();
    border.stroke({ width: 2, color: 0xff2200 });
    border.roundRect(width / 2 - 240, height / 2 - 110, 480, 220, 6);
    border.stroke();

    const title = new Text({
      text: "ЯДРО OVERMIND",
      style: {
        fontFamily: "Courier New",
        fontSize: 20,
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
        fontSize: 14,
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
    attackBg.fill({ color: 0x330000 });
    attackBg.stroke({ width: 1, color: 0xff2200 });
    attackBg.roundRect(0, 0, 180, 36, 4);
    attackBg.fill();
    attackBg.stroke();
    const attackLabel = new Text({
      text: "[ Атаковать ядро ]",
      style: { fontFamily: "Courier New", fontSize: 14, fill: 0xff4444 },
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
    retreatBg.fill({ color: 0x0d1b2a });
    retreatBg.stroke({ width: 1, color: 0x4488ff });
    retreatBg.roundRect(0, 0, 180, 36, 4);
    retreatBg.fill();
    retreatBg.stroke();
    const retreatLabel = new Text({
      text: "[ Отступить ]",
      style: { fontFamily: "Courier New", fontSize: 14, fill: 0x4488ff },
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
    await this.gameEngine.transitionTo("INVENTORY" as any, {
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
      // Set ship target to planet
      this.shipPhysics.setTarget(planetSprite.screenX, planetSprite.screenY);
      logger.info(
        `Set navigation target to planet ${planetSprite.planet.name}`,
      );

      // Show planet info panel
      this.onPlanetClick(planetSprite.planet);
    } else {
      logger.warn(`Could not find planet with ID: ${locationId}`);
    }
  }

  /** E2E helper: click back to star map */
  async e2eClickBackToMap(): Promise<void> {
    await this.returnToStarMap();
  }

  /** E2E helper: set ship target position */
  e2eSetTarget(x: number, y: number): void {
    if (this.shipPhysics) {
      this.shipPhysics.setTarget(x, y);
    }
  }

  /** E2E helper: get camera state */
  e2eGetCameraState(): { zoom: number; panX: number; panY: number } {
    return {
      zoom: this.cameraZoom,
      panX: this.cameraPanX,
      panY: this.cameraPanY,
    };
  }

  /** E2E helper: set camera zoom */
  e2eSetCameraZoom(zoom: number): void {
    this.cameraZoom = Math.max(this.MIN_ZOOM, Math.min(this.MAX_ZOOM, zoom));
    this.applyCameraTransform();
  }

  /** E2E helper: set camera pan */
  e2eSetCameraPan(x: number, y: number): void {
    this.cameraPanX = x;
    this.cameraPanY = y;
    this.applyCameraTransform();
  }

  /** E2E helper: check if minimap exists */
  e2eHasMinimap(): boolean {
    return this.systemMiniMap !== null;
  }

  /** E2E helper: get ship position */
  e2eGetShipPosition(): { x: number; y: number } {
    return {
      x: this.shipPhysics?.shipX ?? 0,
      y: this.shipPhysics?.shipY ?? 0,
    };
  }

  /** E2E helper: check if quest journal is open */
  e2eIsQuestJournalOpen(): boolean {
    return (
      this.questJournalUI !== null && this.questJournalUI.container.visible
    );
  }

  /** E2E helper: return current system planets for test assertions */
  e2eGetPlanets(): { id: string; name: string }[] {
    return this.planetSprites.map((ps) => ({
      id: ps.planet.id,
      name: ps.planet.name,
    }));
  }
}
