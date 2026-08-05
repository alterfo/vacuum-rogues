import { Container, Graphics, Sprite, Text } from "pixi.js";
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
  landingDenialMessage,
  OVERMIND_FACTION_ID,
  PIRATE_FACTION_ID,
  type LandingDenialReason,
} from "@/systems/galaxy/landingAccess";
import { scaledFont } from "@/utils/fontScale";
import { logger } from "@/utils/logger";
import { tex } from "../textures";
import { stationSpriteKey } from "./stationArt";
import type { FlightModule } from "./FlightModule";

export const STATION_SPRITE_SIZE = 80;
export const STATION_LABEL_Y = STATION_SPRITE_SIZE / 2 + 4;

export interface StationMarker {
  station: Station;
  container: Container;
  x: number;
  y: number;
  label: Text;
}

export interface PlanetManagerDeps {
  getShipPhysics(): ShipPhysics | null;
  getStarCenter(): { x: number; y: number };
  isTurnRunning(): boolean;
  getOrbitalDay(): number;
  showPlanetTooltip(
    planet: Planet,
    faction: Faction,
    screenX: number,
    screenY: number,
    landingDenial: LandingDenialReason | null,
  ): void;
  hideTooltip(): void;
  clearFollow(): void;
}

export class PlanetManager implements FlightModule {
  private readonly renderer: Renderer;
  private readonly gameEngine: GameEngine | null;
  private readonly gameLayer: Container;
  private readonly uiLayer: Container;
  private readonly deps: PlanetManagerDeps;

  planetSprites: PlanetSprite[] = [];
  stationMarkers: StationMarker[] = [];
  private planetInfoPanel: PlanetInfoPanel | null = null;

  routeTargetPlanetId: string | null = null;
  routeTargetStationId: string | null = null;

  private readonly LANDING_RANGE = 60;

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

  initialize(): void {
    this.createPlanets();
    this.createStations();
  }

  update(deltaTime: number, _bgElapsed: number): void {
    const currentDays = this.deps.getOrbitalDay();
    const timeScale = this.deps.isTurnRunning()
      ? (this.deps.getShipPhysics()?.timeScale ?? 1)
      : 1;
    const scaledDt = deltaTime * timeScale;
    for (const sprite of this.planetSprites) {
      sprite.setOrbitForDay(currentDays);
      sprite.update(scaledDt);
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

  refreshFontScale(): void {
    for (const m of this.stationMarkers) {
      m.label.style.fontSize = scaledFont(10);
    }
  }

  landingThreshold(sprite: PlanetSprite): number {
    return sprite.displayRadius + this.LANDING_RANGE;
  }

  shipReachedPlanet(planet: Planet, physics: ShipPhysics): boolean {
    const sprite = this.planetSprites.find((s) => s.planet.id === planet.id);
    if (!sprite) return true;
    const d = Math.hypot(
      sprite.screenX - physics.shipX,
      sprite.screenY - physics.shipY,
    );
    return d <= this.landingThreshold(sprite);
  }

  landingDenial(planet: Planet): LandingDenialReason | null {
    const player = this.gameEngine?.player;
    if (!player) return null;
    const galaxy = this.gameEngine?.galaxy;
    const systemId = player.currentSystemId;
    let captor: string | null =
      (planet.capturedBy as unknown as string | null) ?? null;
    if (
      galaxy &&
      systemId &&
      typeof galaxy.isOvermindSystem === "function" &&
      typeof galaxy.isPirateSystem === "function"
    ) {
      if (galaxy.isOvermindSystem(systemId)) captor = OVERMIND_FACTION_ID;
      else if (galaxy.isPirateSystem(systemId)) captor = PIRATE_FACTION_ID;
    }
    const access = canLandOnPlanet(
      { capturedBy: captor as Planet["capturedBy"] },
      player,
    );
    return access.allowed ? null : (access.reason ?? null);
  }

  getPlanetAt(x: number, y: number): PlanetSprite | null {
    return (
      this.planetSprites.find((s) => {
        const dx = s.screenX - x;
        const dy = s.screenY - y;
        return Math.sqrt(dx * dx + dy * dy) < 50;
      }) ?? null
    );
  }

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

  getStationAt(x: number, y: number): StationMarker | null {
    return (
      this.stationMarkers.find((m) => {
        const dx = m.x - x;
        const dy = m.y - y;
        return Math.sqrt(dx * dx + dy * dy) < 50;
      }) ?? null
    );
  }

  get hasInfoPanel(): boolean {
    return this.planetInfoPanel !== null;
  }

  closeInfoPanel(): void {
    const info = this.planetInfoPanel;
    this.planetInfoPanel = null;
    if (info) queueMicrotask(() => info.destroy());
  }

  setCursors(turnRunning: boolean): void {
    const cursor = turnRunning ? "default" : "pointer";
    for (const sprite of this.planetSprites) {
      sprite.graphics.cursor = cursor;
    }
  }

  e2eHasFilterPlanet(): boolean {
    if (!__DEBUG__) return false;
    return this.planetSprites.some((s) => s.e2eHasRotationFilter());
  }

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
        (p, sx, sy) =>
          this.deps.showPlanetTooltip(
            p,
            systemFaction,
            sx,
            sy,
            this.landingDenial(p),
          ),
        () => this.deps.hideTooltip(),
      );

      if (questLocations.includes(planet.id)) {
        this.addQuestMarker(sprite);
      }

      sprite.container.zIndex = 50;
      this.gameLayer.addChild(sprite.container);
      this.planetSprites.push(sprite);
    }

    logger.info(`Created ${this.planetSprites.length} planet sprites`);
  }

  private addQuestMarker(sprite: PlanetSprite): void {
    const marker = new Graphics();

    const radius = questMarkerRadius(sprite.displayRadius);
    marker.circle(0, 0, radius);
    marker.stroke({ width: 3, color: 0xffff00, alpha: 0.8 });

    sprite.container.addChild(marker);

    logger.debug(`Added quest marker to planet ${sprite.planet.name}`);
  }

  handlePlanetClick(planet: Planet): void {
    if (this.deps.isTurnRunning()) return;

    const physics = this.deps.getShipPhysics();
    const planetSprite = this.planetSprites.find(
      (s) => s.planet.id === planet.id,
    );
    if (!planetSprite || !physics) return;

    this.deps.clearFollow(); // picking a planet cancels auto-follow

    const approachPt = planetApproachPoint(
      physics.shipX,
      physics.shipY,
      planetSprite.screenX,
      planetSprite.screenY,
      planetSprite.displayRadius,
      GAME_BALANCE.landingApproachOffset,
    );

    this.onPlanetRouteRequested?.(planet.id, approachPt.x, approachPt.y);

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
    const ownerFaction = currentSystem?.ownerFaction;
    const player = this.gameEngine?.player;
    const reputation =
      ownerFaction != null && typeof player?.getReputation === "function"
        ? player.getReputation(ownerFaction)
        : undefined;
    const denial = this.landingDenial(planet);
    const landingDenialText = denial ? landingDenialMessage(denial) : undefined;
    this.planetInfoPanel = new PlanetInfoPanel(
      planet,
      this.renderer.app.screen.width,
      this.renderer.app.screen.height,
      flightDays,
      shipAtPlanet ? () => this.onPlanetLanding?.(planet.id) : undefined,
      ownerFaction,
      currentSystem?.economyType,
      currentSystem?.politicalSystem,
      reputation,
      landingDenialText,
    );
    this.uiLayer.addChild(this.planetInfoPanel.container);
  }

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

      const stationColor = this.stationColor(
        station.type as import("@/types").StationType,
      );

      const spriteKey = stationSpriteKey(
        station.type as import("@/types").StationType,
        station.id,
      );
      const stationTex = spriteKey ? tex(spriteKey) : undefined;
      if (stationTex) {
        const sprite = new Sprite(stationTex);
        sprite.anchor.set(0.5);
        sprite.width = STATION_SPRITE_SIZE;
        sprite.height = STATION_SPRITE_SIZE;
        sprite.eventMode = "none";
        sprite.rotation =
          Math.atan2(center.y - wy, center.x - wx) + Math.PI / 2;
        ctn.addChild(sprite);
      } else {
        const g = new Graphics();
        g.poly([0, -14, 10, 0, 0, 14, -10, 0]);
        g.fill({ color: stationColor, alpha: 0.85 });
        g.stroke({ color: 0xffffff, width: 1, alpha: 0.4 });
        g.eventMode = "none";
        ctn.addChild(g);
      }

      const label = new Text({
        text: station.name.slice(0, 22),
        style: {
          fontSize: scaledFont(10),
          fill: stationColor,
          fontFamily: "monospace",
        },
      });
      label.anchor.set(0.5, 0);
      label.y = STATION_LABEL_Y;
      label.eventMode = "none";
      ctn.addChild(label);

      const hit = new Graphics();
      hit.circle(0, 0, STATION_SPRITE_SIZE / 2);
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
