import { Container, Graphics, Text } from "pixi.js";
import type { Renderer } from "../Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import type { ShipPhysics } from "@/systems/ShipPhysics";
import type { Planet } from "@/domain/Planet";
import type { Station } from "@/domain/Station";
import type { Faction } from "@/types/faction";
import { PlanetSprite } from "../PlanetSprite";
import { PlanetInfoPanel } from "../PlanetInfoPanel";
import {
  hashToAngle,
  planetApproachPoint,
  questMarkerRadius,
  shouldReaim,
} from "@/utils/flightGeometry";
import { solveInterceptPoint } from "@/utils/intercept";
import { GAME_BALANCE } from "@/config/balance";
import {
  canLandOnPlanet,
  OVERMIND_FACTION_ID,
  PIRATE_FACTION_ID,
  type LandingDenialReason,
} from "@/systems/galaxy/landingAccess";
import { scaledFont } from "@/utils/fontScale";
import { logger } from "@/utils/logger";
import type { FlightModule } from "./FlightModule";

/** A space-station marker: its domain record, display container and world position. */
export interface StationMarker {
  station: Station;
  container: Container;
  x: number;
  y: number;
  /** The marker's name label — kept so a font-scale change can restyle it in
   *  place (no marker rebuild). See {@link PlanetManager.refreshFontScale}. */
  label: Text;
}

/**
 * Live state the manager reads from the host scene without depending on the
 * concrete {@link SpaceFlightScene}. Route planning, the turn loop, the HUD
 * (tooltip) and the authoritative ship/star geometry all stay in the scene; the
 * manager reads them through these accessors (Low Coupling / DIP — it depends on
 * abstractions, not the scene class).
 */
export interface PlanetManagerDeps {
  /** Authoritative ship physics (null before the ship spawns). */
  getShipPhysics(): ShipPhysics | null;
  /** System centre (the star's centre) for orbital layout. */
  getStarCenter(): { x: number; y: number };
  /** True while the turn is running (planets spin, clicks are disabled). */
  isTurnRunning(): boolean;
  /**
   * Cumulative game-day value used to position planets on their orbits
   * (whole days + in-flight fraction + waited sub-day). Owned by the scene's
   * route/turn bookkeeping.
   */
  getOrbitalDay(): number;
  /** Rich planet hover tooltip (delegated to the scene's HUD). */
  showPlanetTooltip(
    planet: Planet,
    faction: Faction,
    screenX: number,
    screenY: number,
  ): void;
  hideTooltip(): void;
  /** Cancel any NPC auto-follow target — picking a body cancels a chase. */
  clearFollow(): void;
}

/**
 * Owns all planet and space-station visual state in the player's current system:
 * the planet sprite + quest-marker lifecycle, station markers, the planet info
 * panel, and per-frame orbital motion. Extracted from {@link SpaceFlightScene} as
 * a {@link FlightModule}.
 *
 * Click handling sets the manager-owned route targets and delegates the actual
 * route planning / landing / docking back to the scene through the public
 * callbacks ({@link onPlanetRouteRequested}, {@link onPlanetLanding},
 * {@link onStationDock}) — the scene is the Information Expert for route data, so
 * it keeps that logic while the manager owns the bodies (High Cohesion).
 *
 * The {@link FlightModule} `update(dt, bgElapsed)` signature can't carry the
 * orbital-day/turn state the motion needs, so those are injected via
 * {@link PlanetManagerDeps} accessors — matching the {@link NpcShipManager}
 * precedent (the plan's "PanZoomController reference" was unnecessary here: no
 * method touches the camera).
 */
export class PlanetManager implements FlightModule {
  private readonly renderer: Renderer;
  private readonly gameEngine: GameEngine | null;
  private readonly gameLayer: Container;
  private readonly uiLayer: Container;
  private readonly deps: PlanetManagerDeps;

  // Planet sprites for the current system (public — the scene's route/landing/
  // spawn/mini-map code reads them in many places).
  planetSprites: PlanetSprite[] = [];
  // Station markers (US-066). Public for the scene's docking + re-entry spawn.
  stationMarkers: StationMarker[] = [];
  private planetInfoPanel: PlanetInfoPanel | null = null;

  // Active route targets (public mutable — the scene's two-step route planner and
  // updateShip arrival logic read and clear these).
  routeTargetPlanetId: string | null = null;
  routeTargetStationId: string | null = null;

  // px past a planet's surface at which landing is allowed (planets render large,
  // so the ship lands at the disc edge, not the centre).
  private readonly LANDING_RANGE = 60;

  // Route planning, landing and docking stay in the scene (Information Expert).
  // The manager fans these out when a body is clicked / the land button is hit.
  onPlanetRouteRequested:
    | ((planetId: string, x: number, y: number) => void)
    | null = null;
  onPlanetLanding: ((planetId: string) => void) | null = null;
  onStationDock: ((stationId: string) => void) | null = null;

  constructor(
    renderer: Renderer,
    gameEngine: GameEngine | null,
    gameLayer: Container,
    uiLayer: Container,
    deps: PlanetManagerDeps,
  ) {
    this.renderer = renderer;
    this.gameEngine = gameEngine;
    this.gameLayer = gameLayer;
    this.uiLayer = uiLayer;
    this.deps = deps;
  }

  // ---------------------------------------------------------------------------
  // FlightModule lifecycle
  // ---------------------------------------------------------------------------

  /** Build planet sprites and station markers for the current system. */
  initialize(): void {
    this.createPlanets();
    this.createStations();
  }

  /**
   * Advance planet orbital positions (a pure function of elapsed game days) and,
   * while the turn runs, their cosmetic axial spin / moons. The mini-map refresh
   * stays in the scene (it reads route + camera state).
   */
  update(deltaTime: number, _bgElapsed: number): void {
    const currentDays = this.deps.getOrbitalDay();
    for (const sprite of this.planetSprites) {
      sprite.setOrbitForDay(currentDays);
    }

    if (this.deps.isTurnRunning()) {
      const scaledDt = deltaTime * (this.deps.getShipPhysics()?.timeScale ?? 1);
      for (const sprite of this.planetSprites) {
        sprite.update(scaledDt);
      }
    }
  }

  destroy(): void {
    for (const sprite of this.planetSprites) {
      sprite.destroy();
    }
    this.planetSprites = [];

    for (const m of this.stationMarkers) {
      this.gameLayer.removeChild(m.container);
      m.container.destroy({ children: true });
    }
    this.stationMarkers = [];
    this.routeTargetStationId = null;
    this.routeTargetPlanetId = null;

    if (this.planetInfoPanel) {
      this.planetInfoPanel.destroy();
      this.planetInfoPanel = null;
    }
  }

  /**
   * Restyle the manager's text labels at the current font scale WITHOUT a scene
   * re-init (Task 1): the only persistent text the manager owns is the station
   * marker name labels, so just re-apply {@link scaledFont} to each in place. The
   * planet sprites, station diamonds, hit-areas and orbits are left untouched —
   * a font change no longer rebuilds the world.
   */
  refreshFontScale(): void {
    for (const m of this.stationMarkers) {
      m.label.style.fontSize = scaledFont(10);
    }
  }

  // ---------------------------------------------------------------------------
  // Queries the scene reads from
  // ---------------------------------------------------------------------------

  /**
   * Distance (px) from the ship to a planet's centre at which landing is allowed:
   * the surface radius plus a fixed approach margin (planets render large, so the
   * ship would otherwise have to fly to the disc's centre before it could land).
   */
  landingThreshold(sprite: PlanetSprite): number {
    return sprite.displayRadius + this.LANDING_RANGE;
  }

  /**
   * True once the ship has reached `planet`'s landing margin — the sprite-find +
   * distance + {@link landingThreshold} check the scene's land guard used to
   * inline. A planet with no live sprite counts as reached (the scene then
   * defers to its own logic). Information Expert: the manager owns the planet
   * sprites and the threshold geometry.
   */
  shipReachedPlanet(planet: Planet, physics: ShipPhysics): boolean {
    const sprite = this.planetSprites.find((s) => s.planet.id === planet.id);
    if (!sprite) return true;
    const d = Math.hypot(
      sprite.screenX - physics.shipX,
      sprite.screenY - physics.shipY,
    );
    return d <= this.landingThreshold(sprite);
  }

  /**
   * Captured-system landing gate: the denial reason when the current player may
   * not land on `planet` (Overmind-held → always; pirate-held → without good
   * pirate rep), else null. The manager owns the planet bodies, so the access
   * rule lives here (delegating to the pure {@link canLandOnPlanet}); the scene
   * shows the message + clears the route.
   */
  landingDenial(planet: Planet): LandingDenialReason | null {
    const player = this.gameEngine?.player;
    if (!player) return null;
    // Effective controller: Overmind / pirate capture is tracked per-*system* on
    // the galaxy (`overmindSystems` / `pirateSystems`, mutated by GameEngine's
    // ownership tick) — **never** on `planet.capturedBy` (typed FactionType, which
    // has no Overmind/Pirate member and is never written in production). Every
    // flight-scene planet belongs to the current system, so the system the player
    // is in decides who holds it; fall back to the planet's own `capturedBy` only
    // when galaxy / system context is unavailable (e.g. a unit harness).
    const galaxy = this.gameEngine?.galaxy;
    const systemId = player.currentSystemId;
    let captor: string | null =
      (planet.capturedBy as unknown as string | null) ?? null;
    if (galaxy && systemId) {
      if (galaxy.isOvermindSystem(systemId)) captor = OVERMIND_FACTION_ID;
      else if (galaxy.isPirateSystem(systemId)) captor = PIRATE_FACTION_ID;
    }
    const access = canLandOnPlanet(
      { capturedBy: captor as Planet["capturedBy"] },
      player,
    );
    return access.allowed ? null : (access.reason ?? null);
  }

  /** First planet whose disc the world point (x,y) falls within (or null). */
  getPlanetAt(x: number, y: number): PlanetSprite | null {
    return (
      this.planetSprites.find((s) => {
        const dx = s.screenX - x;
        const dy = s.screenY - y;
        return Math.sqrt(dx * dx + dy * dy) < 50;
      }) ?? null
    );
  }

  /**
   * Lead point for pursuing an orbiting planet: solve the intercept against the
   * planet's orbital-tangent velocity so a chase aims where the planet WILL be,
   * not where it is now (playtest4 C). The planet's velocity is geometry the
   * sprite owns (px/game-day); we convert it to px/ms to match the ship's cruise
   * speed — 1 game-day of cruise covers `pixelsPerDay` px at `getMaxSpeed()`
   * px/ms, so px/ms = (px/day) · maxSpeed / pixelsPerDay. Falls back to the
   * planet's current centre when no intercept solves (handled by the solver).
   */
  planetLeadPoint(sprite: PlanetSprite): { x: number; y: number } {
    const physics = this.deps.getShipPhysics();
    if (!physics) return { x: sprite.screenX, y: sprite.screenY };
    const maxSpeed = physics.getMaxSpeed();
    const { vx, vy } = sprite.orbitalVelocityPerDay(); // px / game-day
    const scale = maxSpeed / GAME_BALANCE.pixelsPerDay; // px/day → px/ms
    return solveInterceptPoint(
      physics.shipX,
      physics.shipY,
      maxSpeed,
      sprite.screenX,
      sprite.screenY,
      vx * scale,
      vy * scale,
    );
  }

  /**
   * Decide what an in-flight ship aimed at the current planet target should do
   * this frame: `land` once it touches the planet's surface margin (planets
   * render large, US-070 #3), or `reaim` at the planet's fresh lead point once
   * the orbiting planet has drifted past the threshold from the route
   * `endpoint` — so the ship corrects course mid-flight instead of trailing it.
   * `null` = keep flying the current route. Keeps the landing/lead/threshold
   * math in the module that owns the planet sprites; the scene just acts on it.
   */
  updateRouteToTarget(
    shipX: number,
    shipY: number,
    endpoint: { x: number; y: number } | null,
    driftPx = 30,
  ):
    | { kind: "land"; planet: Planet }
    | { kind: "reaim"; x: number; y: number }
    | null {
    if (!this.routeTargetPlanetId) return null;
    const sprite = this.planetSprites.find(
      (s) => s.planet.id === this.routeTargetPlanetId,
    );
    if (!sprite) return null;
    const d = Math.hypot(sprite.screenX - shipX, sprite.screenY - shipY);
    if (d <= this.landingThreshold(sprite)) {
      return { kind: "land", planet: sprite.planet };
    }
    if (endpoint) {
      const lead = this.planetLeadPoint(sprite);
      if (shouldReaim(endpoint, lead, driftPx)) {
        return { kind: "reaim", x: lead.x, y: lead.y };
      }
    }
    return null;
  }

  /** First station marker the world point (x,y) falls within (or null). */
  getStationAt(x: number, y: number): StationMarker | null {
    return (
      this.stationMarkers.find((m) => {
        const dx = m.x - x;
        const dy = m.y - y;
        return Math.sqrt(dx * dx + dy * dy) < 50;
      }) ?? null
    );
  }

  /** True while the planet info panel is open (for the Escape close-chain). */
  get hasInfoPanel(): boolean {
    return this.planetInfoPanel !== null;
  }

  /** Close the planet info panel (deferred so it never tears down mid-dispatch). */
  closeInfoPanel(): void {
    const info = this.planetInfoPanel;
    this.planetInfoPanel = null;
    if (info) queueMicrotask(() => info.destroy());
  }

  /**
   * Set the planet hover cursors: "pointer" when idle (a click plots a course),
   * "default" while a turn is running (clicks are disabled). The manager owns the
   * planet sprites, so it owns their cursor too — mirrors
   * {@link NpcShipManager.setCursors} so the scene's Controller never reaches into
   * a sprite's Graphics directly.
   */
  setCursors(turnRunning: boolean): void {
    const cursor = turnRunning ? "default" : "pointer";
    for (const sprite of this.planetSprites) {
      sprite.graphics.cursor = cursor;
    }
  }

  /** E2E: true once at least one planet renders via the GLSL rotation filter. */
  e2eHasFilterPlanet(): boolean {
    if (!__DEBUG__) return false;
    return this.planetSprites.some((s) => s.e2eHasRotationFilter());
  }

  /**
   * E2E (F1 pixel assertion): isolate the first GLSL-filtered planet — hide
   * every other planet sprite this manager owns and strip the target down to
   * its filtered body (delegated to the sprite, which owns its children) —
   * and return its on-screen geometry. The manager owns the planet sprites,
   * so the test seam lives here, not in the spec (Information Expert).
   */
  e2eIsolateFilterPlanet(): {
    screenX: number;
    screenY: number;
    displayRadius: number;
  } | null {
    if (!__DEBUG__) return null;
    const target = this.planetSprites.find((s) => s.e2eHasRotationFilter());
    if (!target) return null;
    for (const sprite of this.planetSprites) {
      sprite.container.visible = sprite === target;
    }
    return target.e2eIsolateFilterBody();
  }

  // ---------------------------------------------------------------------------
  // Planet sprites
  // ---------------------------------------------------------------------------

  private createPlanets(): void {
    if (!this.gameEngine?.player) return;

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

    const questLocations =
      this.gameEngine.questManager.getActiveQuestLocations();

    const center = this.deps.getStarCenter();
    // Orbital position is a deterministic function of the (persisted) game-day
    // count, so planets sit where they should every time the scene loads. The
    // base angle is derived from the planet id so each planet starts at a stable,
    // distinct point on its orbit.
    const gameDays = this.gameEngine.galaxy?.gameDays ?? 0;
    for (const planet of currentSystem.planets) {
      const baseAngle = hashToAngle(planet.id);
      const sprite = new PlanetSprite(
        planet,
        center.x,
        center.y,
        baseAngle,
        gameDays,
      );

      sprite.createHitArea(this.handlePlanetClick.bind(this));

      const systemFaction = currentSystem.ownerFaction;
      sprite.setTooltipHandlers(
        (p, sx, sy) => this.deps.showPlanetTooltip(p, systemFaction, sx, sy),
        () => this.deps.hideTooltip(),
      );

      if (questLocations.includes(planet.id)) {
        this.addQuestMarker(sprite);
      }

      // zIndex 50 so ships behind the disc (zIndex 40) are occluded and ships in
      // front (zIndex 100) render on top — see NpcShipManager.updateNpcDepth().
      sprite.container.zIndex = 50;
      this.gameLayer.addChild(sprite.container);
      this.planetSprites.push(sprite);
    }

    logger.info(`Created ${this.planetSprites.length} planet sprites`);
  }

  /** Add a quest marker (ring halo) to a planet sprite. */
  private addQuestMarker(sprite: PlanetSprite): void {
    const marker = new Graphics();

    // Halo just OUTSIDE the disc: planets render large (US-070 #3), so a fixed
    // small ring used to sit inside the planet and read as a stray circle.
    const radius = questMarkerRadius(sprite.displayRadius);
    marker.circle(0, 0, radius);
    marker.stroke({ width: 3, color: 0xffff00, alpha: 0.8 });

    // Add to planet container so it rotates with the planet.
    sprite.container.addChild(marker);

    logger.debug(`Added quest marker to planet ${sprite.planet.name}`);
  }

  /**
   * Handle a planet click: cancel any chase, preview/commit a route to the disc
   * edge (delegated to the scene), and show the planet info panel. The land
   * button is only offered once the ship has actually reached the planet.
   */
  handlePlanetClick(planet: Planet): void {
    if (this.deps.isTurnRunning()) return;

    const physics = this.deps.getShipPhysics();
    const planetSprite = this.planetSprites.find(
      (s) => s.planet.id === planet.id,
    );
    if (!planetSprite || !physics) return;

    this.deps.clearFollow(); // picking a planet cancels auto-follow

    // Approach point at the planet edge (ship-facing side) so the route preview
    // stops at the disc surface rather than cutting through to the centre.
    const approachPt = planetApproachPoint(
      physics.shipX,
      physics.shipY,
      planetSprite.screenX,
      planetSprite.screenY,
      planetSprite.displayRadius,
      GAME_BALANCE.landingApproachOffset,
    );

    // Route planning (plan vs execute + landing curve) stays in the scene.
    this.onPlanetRouteRequested?.(planet.id, approachPt.x, approachPt.y);

    // Show planet info panel. Landing is only offered once the ship has actually
    // flown to the planet; otherwise a single click would teleport the player
    // there (game-days only accrue while the ship is in motion).
    if (this.planetInfoPanel) {
      this.planetInfoPanel.destroy();
      this.planetInfoPanel = null;
    }

    const distanceX = planetSprite.screenX - physics.shipX;
    const distanceY = planetSprite.screenY - physics.shipY;
    const distanceToPlanet = Math.sqrt(
      distanceX * distanceX + distanceY * distanceY,
    );
    const flightDays = Math.max(
      1,
      Math.ceil(distanceToPlanet / GAME_BALANCE.pixelsPerDay),
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
      shipAtPlanet ? () => this.onPlanetLanding?.(planet.id) : undefined,
      currentSystem?.ownerFaction,
    );
    this.uiLayer.addChild(this.planetInfoPanel.container);
  }

  // ---------------------------------------------------------------------------
  // Station markers (US-066)
  // ---------------------------------------------------------------------------

  private createStations(): void {
    const currentSystemId = this.gameEngine?.player?.currentSystemId;
    const galaxy = this.gameEngine?.galaxy;
    if (!currentSystemId || !galaxy) return;

    const currentSystem = galaxy.systems.find((s) => s.id === currentSystemId);
    if (!currentSystem || !currentSystem.stations.length) return;

    const center = this.deps.getStarCenter();
    for (const station of currentSystem.stations) {
      const wx = center.x + Math.cos(station.orbitAngle) * station.orbitRadius;
      const wy = center.y + Math.sin(station.orbitAngle) * station.orbitRadius;

      const ctn = new Container();
      ctn.x = wx;
      ctn.y = wy;
      ctn.zIndex = 90;

      // Diamond shape coloured by station type.
      const stationColor = this.stationColor(
        station.type as import("@/types").StationType,
      );
      const g = new Graphics();
      g.poly([0, -14, 10, 0, 0, 14, -10, 0]);
      g.fill({ color: stationColor, alpha: 0.85 });
      g.stroke({ color: 0xffffff, width: 1, alpha: 0.4 });
      g.eventMode = "none";
      ctn.addChild(g);

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

      // Hit area for clicking.
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

      this.gameLayer.addChild(ctn);
      this.stationMarkers.push({
        station,
        container: ctn,
        x: wx,
        y: wy,
        label,
      });
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

  /**
   * Handle a station click: set this station as the route target, cancel any
   * chase, and delegate the route planning / docking approach to the scene.
   */
  private onStationClick(station: Station): void {
    logger.debug(`Station clicked: ${station.name}`);
    if (!this.deps.getShipPhysics()) return;

    const marker = this.stationMarkers.find((m) => m.station.id === station.id);
    if (!marker) return;

    this.routeTargetStationId = station.id;
    this.routeTargetPlanetId = null;
    this.deps.clearFollow();

    this.onStationDock?.(station.id);
  }
}
