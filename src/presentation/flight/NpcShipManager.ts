import { Container } from "pixi.js";
import type { Renderer } from "../Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import type { ShipPhysics } from "@/systems/ShipPhysics";
import type { PlanetSprite } from "../PlanetSprite";
import { NpcShipSprite } from "../NpcShipSprite";
import type { SystemBounds } from "../NpcShipSprite";
import { ContactPanelManager } from "./ContactPanelManager";
import { NpcInteractionController } from "./NpcInteractionController";
import { CombatPursuitController } from "./CombatPursuitController";
import { EncounterController } from "./EncounterController";
import { OvermindBossController } from "./OvermindBossController";
import type { NpcShip } from "@/domain/NpcShip";
import type { CommsContext } from "@/systems/comms/commsOptions";
import { npcsPresentInSystem, NpcSimulator } from "@/systems/npc/NpcSimulator";
import { grappleHoldFraction } from "@/systems/npc/NpcBrain";
import { isHostile, factionKindOf } from "@/systems/npc/factionHostility";
import {
  adjustPlayerCredits,
  GL_COUNTERPARTY,
} from "@/systems/banking/economy";
import { pirateSalvageAmount } from "@/systems/combat/pirateSalvage";
import { deterministicNpcOffset } from "@/systems/npc/npcPlacement";
import {
  SYSTEM_GEOMETRY,
  GAME_BALANCE,
  NEUTRAL_AGGRO_POWER_THRESHOLD,
} from "@/config/balance";
import { NpcRole } from "@/types";
import type { SpaceLootItem } from "@/types";
import { pickNpcDestination, type NpcBehaviorCtx } from "./npcBehavior";
import { npcNameplateTooltip } from "../npcLabels";
import { hashStr } from "@/utils/hashStr";
import { logger } from "@/utils/logger";
import { t } from "@/i18n/i18n";
import { LootDropHandler } from "./LootDropHandler";
import type { Encounter } from "@/systems/encounters/encounterGenerator";
import type {
  EncounterChoice,
  EncounterOutcome,
} from "@/systems/encounters/encounterOutcome";
import type { FlightModule } from "./FlightModule";
import { ShipDeathFxRenderer } from "./shipDeathFxRenderer";
import type { FlightSessionState } from "@/systems/FlightSessionState";

export const OVERMIND_CORE_ID = "overmind_core";

export interface NpcShipManagerDeps {
  getShipPhysics(): ShipPhysics | null;
  getPlanetSprites(): PlanetSprite[];
  getStarCenter(): { x: number; y: number };
  isTurnRunning(): boolean;
  showMessage(text: string, color?: number): void;
  showTooltip(text: string, screenX: number, screenY: number): void;
  hideTooltip(): void;
  executeRouteTo(x: number, y: number): void;
  clearRouteTarget(): void;
  endTurn(): void;
  startInFlightCombat?(sprite: NpcShipSprite): void;
  deferDeathLoot?(npc: NpcShip): boolean;
  onPlayerEngagesCombat?(sprite: NpcShipSprite): void;
  isInCombat?(): boolean;
  selectCombatTarget?(sprite: NpcShipSprite): void;
  getCombatTargetId?(): string | null;
  isCombatant?(sprite: NpcShipSprite): boolean;
  isPaused?(): boolean;
  getStarAvoidRadius?(): number;
  sessionState?: FlightSessionState;
}

export class NpcShipManager implements FlightModule {
  private readonly gameEngine: GameEngine | null;
  private readonly gameLayer: Container;
  private readonly deps: NpcShipManagerDeps;

  private readonly npcSimulator = new NpcSimulator();

  private npcSprites: NpcShipSprite[] = [];
  private npcAnchorPlanet = new Map<NpcShipSprite, PlanetSprite>();
  private warnedAggressorIds = new Set<string>();
  private grappledHintIds = new Set<string>();
  private readonly panels: ContactPanelManager;
  private readonly interaction: NpcInteractionController;
  private readonly pursuit: CombatPursuitController;
  private get contactNpcId(): string | null {
    return this.panels.openNpcId;
  }
  private readonly encounters: EncounterController;
  private readonly overmind: OvermindBossController;
  private lastCameraZoom = 1;

  get followNpcId(): string | null {
    return this.pursuit.followNpcId;
  }
  set followNpcId(id: string | null) {
    this.pursuit.followNpcId = id;
  }
  get pursuitSuspended(): boolean {
    return this.pursuit.pursuitSuspended;
  }
  set pursuitSuspended(v: boolean) {
    this.pursuit.pursuitSuspended = v;
  }
  get npcCrossfireTimer(): number {
    return this.pursuit.npcCrossfireTimer;
  }

  private readonly loot: LootDropHandler;
  get spaceLoot(): SpaceLootItem[] {
    return this.loot.spaceLoot;
  }
  get lootGraphics() {
    return this.loot.lootGraphics;
  }

  private deathFx: ShipDeathFxRenderer | null = null;

  private readonly WEAPON_RANGE = GAME_BALANCE.weaponRange;
  private readonly SCANNER_RANGE = GAME_BALANCE.scannerRange;
  private readonly SYSTEM_INNER_RADIUS = SYSTEM_GEOMETRY.innerRadius;
  private readonly SYSTEM_OUTER_RADIUS = SYSTEM_GEOMETRY.outerRadius;
  private readonly SYSTEM_BOUNDARY_RADIUS = SYSTEM_GEOMETRY.boundaryRadius;

  constructor(
    renderer: Renderer,
    gameEngine: GameEngine | null,
    gameLayer: Container,
    uiLayer: Container,
    deps: NpcShipManagerDeps,
  ) {
    this.gameEngine = gameEngine;
    this.gameLayer = gameLayer;
    this.deps = deps;
    this.panels = new ContactPanelManager({
      uiLayer,
      getScreenSize: () => ({
        width: renderer.app.screen.width,
        height: renderer.app.screen.height,
      }),
    });
    this.pursuit = new CombatPursuitController({
      flight: deps,
      getGameEngine: () => this.gameEngine,
      getNpcSprites: () => this.npcSprites,
      npcLeadPoint: (sprite) => this.interaction.npcLeadPoint(sprite),
      aimRoute: (x, y) => this.interaction.aimRoute(x, y),
      scannerRange: this.SCANNER_RANGE,
      weaponRange: this.WEAPON_RANGE,
      handleInFlightDeath: (sprite, rng, killedByPlayer) =>
        this.handleInFlightDeath(sprite, rng, killedByPlayer),
      playerIsGoodWithPirates: () => this.interaction.playerIsGoodWithPirates(),
      rollShakedown: (npc) => this.interaction.rollShakedown(npc),
      openShakedownHail: (npc) => this.interaction.openShakedownHail(npc),
      clearNpcAnchor: (sprite) => {
        this.npcAnchorPlanet.delete(sprite);
      },
    });
    this.interaction = new NpcInteractionController({
      flight: deps,
      panels: this.panels,
      getGameEngine: () => this.gameEngine,
      getNpcSprites: () => this.npcSprites,
      scannerRange: this.SCANNER_RANGE,
      weaponRange: this.WEAPON_RANGE,
      escalateHostility: (npc) => this.escalateHostility(npc),
      launchCombatWithNpc: (npc) => this.launchCombatWithNpc(npc),
      setFollowNpcId: (id) => {
        this.pursuit.followNpcId = id;
      },
      setApproachNpcId: (id) => {
        this.pursuit.approachNpcId = id;
      },
      setSteerTargetId: (id) => {
        this.pursuit.steerTargetId = id;
      },
      setPursuitSuspended: (v) => {
        this.pursuit.pursuitSuspended = v;
      },
      setLastAim: (x, y) => {
        this.pursuit.lastAimX = x;
        this.pursuit.lastAimY = y;
      },
      clearNpcAnchor: (sprite) => {
        this.npcAnchorPlanet.delete(sprite);
      },
    });
    this.loot = new LootDropHandler(gameLayer);
    this.encounters = new EncounterController({
      uiLayer,
      getScreenSize: () => ({
        width: renderer.app.screen.width,
        height: renderer.app.screen.height,
      }),
      flight: deps,
      getGameEngine: () => this.gameEngine,
      getNpcSprites: () => this.npcSprites,
      isOvermindPromptOpen: () => this.overmind.isOpen,
      addNpcSprite: (npc, entry) => this.addNpcSprite(npc, entry),
      spawnPirateInSystem: (rng, id, systemId) =>
        this.npcSimulator.spawnPirateInSystem(rng, id, systemId),
    });
    this.overmind = new OvermindBossController({
      uiLayer,
      getScreenSize: () => ({
        width: renderer.app.screen.width,
        height: renderer.app.screen.height,
      }),
      flight: deps,
      getGameEngine: () => this.gameEngine,
      getNpcSprites: () => this.npcSprites,
      addNpcSprite: (npc, entry) => this.addNpcSprite(npc, entry),
      spawnOvermindInSystem: (rng, id, systemId, sizeTier) =>
        this.npcSimulator.spawnOvermindInSystem(rng, id, systemId, sizeTier),
    });
  }

  initialize(isResumedFlight = false): void {
    this.deathFx?.destroy();
    this.deathFx = new ShipDeathFxRenderer(this.gameLayer);
    const galaxy = this.gameEngine?.galaxy;
    const systemId = this.gameEngine?.player?.currentSystemId;
    if (!galaxy || !systemId) return;

    for (const npc of npcsPresentInSystem(galaxy, systemId)) {
      this.addNpcSprite(npc, false);
    }
    this.applyGarrisonAggro();
    if (isResumedFlight) this.reengageNearbyHostiles();
    logger.info(`Created ${this.npcSprites.length} NPC sprites`);
    this.maybeShowLiberationHint();
    this.maybeShowEntryEncounter();
  }

  update(deltaTime: number, _bgElapsed: number): void {
    this.loot.update(deltaTime);
    this.loot.collectIfInRange({
      getPlayer: () => this.gameEngine?.player ?? null,
      getLoadout: () => this.gameEngine?.playerLoadout ?? null,
      getShipPosition: () => {
        const p = this.deps.getShipPhysics();
        return p ? { x: p.shipX, y: p.shipY } : null;
      },
      showMessage: (text, color) => this.deps.showMessage(text, color),
    });

    this.deathFx?.update(deltaTime);

    if (!this.deps.isTurnRunning()) return;

    const physics = this.deps.getShipPhysics();
    const timeScale = physics?.timeScale ?? 1;
    for (let i = this.npcSprites.length - 1; i >= 0; i--) {
      const sprite = this.npcSprites[i];
      if (sprite.aggressive) {
        if (
          !this.warnedAggressorIds.has(sprite.npc.id) &&
          !(this.deps.isCombatant?.(sprite) ?? false)
        ) {
          this.deps.showMessage(
            t("flight.incomingAttacker", { name: sprite.npc.name }),
            0xff4444,
          );
        }
        this.warnedAggressorIds.add(sprite.npc.id);
        const grappleStrength =
          this.gameEngine?.playerLoadout?.derivedStats().grappleStrength ?? 0;
        const grappleHold = grappleHoldFraction(
          grappleStrength,
          sprite.npc.maxHull,
        );
        const nowGrappled = grappleHold >= 1;
        sprite.setGrappled(nowGrappled);
        if (nowGrappled) {
          if (!this.grappledHintIds.has(sprite.npc.id)) {
            this.grappledHintIds.add(sprite.npc.id);
            this.deps.showMessage(
              t("flight.grappledHint", { name: sprite.npc.name }),
              0x44ddff,
            );
          }
        } else {
          this.grappledHintIds.delete(sprite.npc.id);
        }
      } else {
        this.warnedAggressorIds.delete(sprite.npc.id);
        this.grappledHintIds.delete(sprite.npc.id);
        sprite.setGrappled(false);
      }
      if (
        sprite.aggressive &&
        physics &&
        this.pursuit.tickAggressor(sprite, physics)
      ) {
        return;
      }
      if (sprite.aggressive) {
        sprite.clearNpcCombatTarget();
      } else {
        const enemy = this.pursuit.nearestNpcEnemy(sprite);
        if (enemy) sprite.setNpcCombatTarget(enemy.x, enemy.y);
        else sprite.clearNpcCombatTarget();
      }
      const anchorPlanet = this.npcAnchorPlanet.get(sprite);
      if (anchorPlanet) {
        sprite.updateAnchorPosition(anchorPlanet.screenX, anchorPlanet.screenY);
      }
      if (!this.deps.isPaused?.()) {
        sprite.update(deltaTime * timeScale);
      }
      if (sprite.isGone()) {
        this.npcAnchorPlanet.delete(sprite);
        this.warnedAggressorIds.delete(sprite.npc.id);
        this.grappledHintIds.delete(sprite.npc.id);
        sprite.destroy();
        this.npcSprites.splice(i, 1);
      } else {
        if (this.npcAnchorPlanet.has(sprite) && !sprite.isAnchored()) {
          this.npcAnchorPlanet.delete(sprite);
        }

        this.updateNpcDepth(sprite);
      }
    }

    this.resolveNpcVsNpcCombat(deltaTime);
  }

  private resolveNpcVsNpcCombat(deltaTime: number): void {
    this.pursuit.resolveNpcVsNpcCombat(deltaTime);
  }

  persistLivePositions(): void {
    const center = this.deps.getStarCenter();
    for (const sprite of this.npcSprites) {
      if (typeof sprite.npc.setWorldPosition !== "function") continue;
      sprite.npc.setWorldPosition(sprite.x - center.x, sprite.y - center.y);
    }
  }

  destroy(): void {
    this.persistLivePositions();
    for (const sprite of this.npcSprites) {
      if (sprite.container.parent) {
        sprite.container.parent.removeChild(sprite.container);
      }
      sprite.destroy();
    }
    this.npcSprites = [];
    this.npcAnchorPlanet.clear();
    this.loot.destroy();
    this.deathFx?.destroy(); // removes + destroys its particle layer
    this.deathFx = null;
    this.panels.close();
    this.pursuit.reset();
    this.overmind.destroy();
    this.encounters.destroy();
  }

  refreshFontScale(): void {
    this.overmind.refreshFontScale();
    this.encounters.refreshFontScale();
  }

  refreshFactionColors(): void {
    for (const sprite of this.npcSprites) sprite.refreshPaletteColors();
  }

  get npcCount(): number {
    return this.npcSprites.length;
  }

  e2eClickNpc(index: number): void {
    if (!__DEBUG__) return;
    const sprite = this.npcSprites[index];
    if (sprite) this.onNpcClick(sprite.npc);
  }

  e2eForceAggressorInRange(weaponRange: number): NpcShipSprite | null {
    if (!__DEBUG__) return null;
    const physics = this.deps.getShipPhysics();
    const sprite = this.npcSprites[0];
    if (!physics || !sprite) return null;
    sprite.x = physics.shipX + weaponRange * 0.6;
    sprite.y = physics.shipY;
    sprite.container.x = sprite.x;
    sprite.container.y = sprite.y;
    sprite.npc.hullHP = 200;
    sprite.npc.maxHull = 200;
    sprite.npc.damage = 12;
    sprite.npc.markHostile();
    this.npcAnchorPlanet.delete(sprite);
    sprite.setAggressive(true);
    sprite.setPursuitTarget(physics.shipX, physics.shipY, physics.currentSpeed);
    sprite.refreshThreat();
    return sprite;
  }

  e2eEngageCombat(targetId?: string): void {
    if (!__DEBUG__) return;
    const sprite = targetId
      ? (this.npcSprites.find((s) => s.npc.id === targetId) ??
        this.npcSprites[0])
      : this.npcSprites[0];
    if (!sprite) return;
    this.deps.startInFlightCombat?.(sprite);
  }

  getNpcDots(): { x: number; y: number; color: number; aggressive: boolean }[] {
    return this.npcSprites.map((s) => ({
      x: s.x,
      y: s.y,
      color: s.mapColor,
      aggressive: s.aggressive,
    }));
  }

  getFollowTarget(): { x: number; y: number } | null {
    if (!this.followNpcId) return null;
    const sprite = this.npcSprites.find((s) => s.npc.id === this.followNpcId);
    return sprite ? { x: sprite.x, y: sprite.y } : null;
  }

  hasOpenModal(): boolean {
    return (
      this.panels.hasOpenModal() ||
      this.overmind.isOpen ||
      this.encounters.isOpen
    );
  }

  get isEncounterPromptOpen(): boolean {
    return this.encounters.isOpen;
  }

  get activeEncounter(): Encounter | null {
    return this.encounters.current;
  }

  get isContactPanelOpen(): boolean {
    return this.panels.isOpen;
  }

  get isOvermindPromptOpen(): boolean {
    return this.overmind.isOpen;
  }

  get openContactNpc(): {
    npc: NpcShip;
    context: CommsContext | undefined;
  } | null {
    const id = this.panels.openNpcId;
    if (id == null) return null;
    const sprite = this.npcSprites.find((s) => s.npc.id === id);
    if (!sprite) return null;
    return { npc: sprite.npc, context: this.panels.context };
  }

  closeContactPanel(): void {
    this.panels.close();
  }

  closeModals(): void {
    this.panels.close();
    this.overmind.close();
    this.closeEncounterPrompt();
  }

  setCursors(turnRunning: boolean): void {
    for (const sprite of this.npcSprites) {
      sprite.container.cursor = turnRunning
        ? "default"
        : sprite.npc.role === NpcRole.PIRATE
          ? "target"
          : "pointer";
      if (!turnRunning) sprite.restoreInteractivity();
    }
  }

  updateHitAreas(cameraZoom: number): void {
    this.lastCameraZoom = cameraZoom;
    for (const s of this.npcSprites) s.updateHitArea(cameraZoom);
  }

  private npcBounds(): SystemBounds {
    const center = this.deps.getStarCenter();
    return {
      cx: center.x,
      cy: center.y,
      rInner: this.SYSTEM_INNER_RADIUS,
      rOuter: this.SYSTEM_OUTER_RADIUS,
      boundary: this.SYSTEM_BOUNDARY_RADIUS,
    };
  }

  private addNpcSprite(npc: NpcShip, entry: boolean): void {
    const bounds = this.npcBounds();
    let spawnX: number;
    let spawnY: number;

    if (!entry && npc.hasWorldPosition()) {
      spawnX = bounds.cx + (npc.worldX as number);
      spawnY = bounds.cy + (npc.worldY as number);
    } else {
      const galaxySeed = this.gameEngine?.galaxy?.id ?? "";
      const base = deterministicNpcOffset(galaxySeed, npc.id);
      const angle = Math.atan2(base.y, base.x);
      let offsetX = entry ? Math.cos(angle) * bounds.boundary : base.x;
      let offsetY = entry ? Math.sin(angle) * bounds.boundary : base.y;

      if (npc.convoyId) {
        const convoyIndex = this.npcSprites.filter(
          (s) => s.npc.convoyId === npc.convoyId,
        ).length;
        const offsets = [0, 30, -30];
        const perpOffset = offsets[convoyIndex % offsets.length] ?? 0;
        const perpAngle = angle + Math.PI / 2;
        offsetX += Math.cos(perpAngle) * perpOffset;
        offsetY += Math.sin(perpAngle) * perpOffset;
      }

      if (!entry) npc.setWorldPosition(offsetX, offsetY);

      spawnX = bounds.cx + offsetX;
      spawnY = bounds.cy + offsetY;
    }

    const sprite = new NpcShipSprite(npc, spawnX, spawnY, bounds);
    sprite.setClickHandler((n) => this.onNpcClick(n));
    sprite.updateHitArea(this.lastCameraZoom);
    sprite.setHoverHandler(
      (n, sx, sy) =>
        this.deps.showTooltip(npcNameplateTooltip(n.name, n.role), sx, sy),
      () => this.deps.hideTooltip(),
    );
    sprite.container.zIndex = 100; // above planet discs so clicks reach the ship

    sprite.setTargetProvider((seq) => {
      const bounds = this.npcBounds();
      const planets = this.deps
        .getPlanetSprites()
        .map((p) => ({ x: p.screenX, y: p.screenY }));
      const ctx: NpcBehaviorCtx = {
        bounds,
        planets,
        traders:
          npc.role === NpcRole.PIRATE
            ? this.npcSprites
                .filter((s) => s !== sprite && s.npc.role === NpcRole.TRADER)
                .map((s) => ({ x: s.x, y: s.y }))
            : undefined,
      };
      return pickNpcDestination(npc.role, npc.id, seq, ctx);
    });

    sprite.setArrivalCallback(() => {
      if (sprite.npc.role === NpcRole.PIRATE) return;
      const ps = this.deps.getPlanetSprites();
      if (ps.length === 0) return;
      let nearest = ps[0];
      let nd = Math.hypot(
        sprite.x - nearest.screenX,
        sprite.y - nearest.screenY,
      );
      for (const p of ps.slice(1)) {
        const d = Math.hypot(sprite.x - p.screenX, sprite.y - p.screenY);
        if (d < nd) {
          nearest = p;
          nd = d;
        }
      }
      if (nd < nearest.displayRadius) {
        sprite.setAnchor(nearest.screenX, nearest.screenY);
        this.npcAnchorPlanet.set(sprite, nearest);
      }
    });

    const planets = this.deps.getPlanetSprites();
    if (npc.role !== NpcRole.PIRATE && planets.length > 0) {
      const idx = hashStr(npc.id) % planets.length;
      const p = planets[idx];
      sprite.setAnchor(p.screenX, p.screenY);
      this.npcAnchorPlanet.set(sprite, p);
    }
    this.gameLayer.addChild(sprite.container);
    this.npcSprites.push(sprite);
  }

  refresh(): void {
    const galaxy = this.gameEngine?.galaxy;
    const systemId = this.gameEngine?.player?.currentSystemId;
    if (!galaxy || !systemId) return;

    const present = npcsPresentInSystem(galaxy, systemId);
    const presentIds = new Set(present.map((n) => n.id));

    for (const sprite of this.npcSprites) {
      if (!presentIds.has(sprite.npc.id)) sprite.beginDeparture();
    }

    const existing = new Set(this.npcSprites.map((s) => s.npc.id));
    for (const npc of present) {
      if (!existing.has(npc.id)) this.addNpcSprite(npc, true);
    }

    if (this.contactNpcId && !presentIds.has(this.contactNpcId)) {
      this.panels.close();
    }

    this.applyGarrisonAggro();
  }

  private applyGarrisonAggro(): void {
    const galaxy = this.gameEngine?.galaxy;
    const systemId = this.gameEngine?.player?.currentSystemId;
    if (!galaxy || !systemId) return;
    const hostile =
      typeof galaxy.isHostileSystem === "function" &&
      galaxy.isHostileSystem(systemId);
    this.checkGarrisonAggro(systemId, hostile);
  }

  private reengageNearbyHostiles(): void {
    const physics = this.deps.getShipPhysics();
    if (!physics) return;
    const range = GAME_BALANCE.combatEscapeRange;
    for (const sprite of this.npcSprites) {
      if (!sprite.npc.hostile || sprite.aggressive) continue;
      const dx = sprite.x - physics.shipX;
      const dy = sprite.y - physics.shipY;
      if (dx * dx + dy * dy <= range * range) sprite.setAggressive(true);
    }
  }

  checkGarrisonAggro(playerSystemId: string, isHostileSystem: boolean): void {
    const pirateControlled =
      this.gameEngine?.galaxy?.isPirateSystem?.(playerSystemId) ?? false;
    const rawPower = this.gameEngine?.campaignPeakPower;
    const neutralAggroAllowed =
      rawPower === undefined
        ? true
        : (rawPower ?? 0) >= NEUTRAL_AGGRO_POWER_THRESHOLD;
    for (const sprite of this.npcSprites) {
      const npc = sprite.npc;
      const kind = factionKindOf(npc);
      const overmindAggro =
        kind === "overmind" &&
        (isHostileSystem ||
          (neutralAggroAllowed &&
            npc.isAggressive() &&
            isHostile("overmind", "player", { pirateRep: 0 })));
      const pirateAggro = kind === "pirate" && pirateControlled;
      const engaged = this.deps.isCombatant?.(sprite) ?? false;
      const aggro = overmindAggro || pirateAggro || engaged;
      sprite.setAggressive(aggro);
      if (aggro) this.npcAnchorPlanet.delete(sprite);
    }
  }

  escalateHostility(target: NpcShip): void {
    target.markHostile();
    const systemId = target.currentSystemId;
    for (const npc of this.gameEngine?.galaxy?.npcShips ?? []) {
      if (npc.faction === target.faction && npc.currentSystemId === systemId) {
        npc.markHostile();
      }
    }
    for (const sprite of this.npcSprites) {
      if (sprite.npc.hostile) sprite.refreshThreat();
    }
  }

  private updateNpcDepth(sprite: NpcShipSprite): void {
    for (const planet of this.deps.getPlanetSprites()) {
      const dx = sprite.x - planet.screenX;
      const dy = sprite.y - planet.screenY;
      if (dx * dx + dy * dy < planet.displayRadius * planet.displayRadius) {
        sprite.container.zIndex = 40;
        return;
      }
    }
    sprite.container.zIndex = 100;
  }

  spawnLootForNpc(
    npc: NpcShip,
    worldX: number,
    worldY: number,
    rng: () => number = Math.random,
    count?: number,
  ): void {
    const day = this.gameEngine?.galaxy?.gameDays ?? Infinity;
    this.loot.spawn(npc, worldX, worldY, rng, day, count);
  }

  rollDeathLootCount(npc: NpcShip, rng: () => number = Math.random): number {
    return this.loot.rollDropCount(npc, rng);
  }

  getNpcSpritesView(): readonly NpcShipSprite[] {
    return this.npcSprites;
  }

  handleInFlightDeath(
    sprite: NpcShipSprite,
    rng: () => number = Math.random,
    killedByPlayer = true,
  ): void {
    const wasOvermindCore = sprite.npc.id === OVERMIND_CORE_ID;
    this.deathFx?.spawn(sprite.x, sprite.y);
    void this.gameEngine?.audio?.playSfx("explosion")?.catch(() => {});
    if (!this.deps.deferDeathLoot?.(sprite.npc)) {
      this.spawnLootForNpc(sprite.npc, sprite.x, sprite.y, rng);
    }
    const galaxy = this.gameEngine?.galaxy;
    if (galaxy) this.npcSimulator.removeNpc(galaxy, sprite.npc.id);
    const idx = this.npcSprites.indexOf(sprite);
    if (idx >= 0) this.npcSprites.splice(idx, 1);
    this.npcAnchorPlanet.delete(sprite);
    this.warnedAggressorIds.delete(sprite.npc.id);
    if (sprite.container.parent) {
      sprite.container.parent.removeChild(sprite.container);
    }
    sprite.destroy();
    if (wasOvermindCore) {
      const coreGalaxy = this.gameEngine?.galaxy;
      if (coreGalaxy?.overmindCoreSystemId) {
        coreGalaxy.tryLiberate(coreGalaxy.overmindCoreSystemId, "player");
      }
      if (coreGalaxy && (coreGalaxy.overmindSystems?.length ?? 0) === 0) {
        this.gameEngine?.showGameOutcomeScreen(true);
      } else {
        this.deps.showMessage(t("flight.overmindCoreBroken"), 0xaa66ff);
      }
      return;
    }
    if (killedByPlayer) {
      this.awardSalvageCredits(sprite.npc);
      this.maybeLiberateClearedSystem();
    }
  }

  handlePlayerDeath(): void {
    const physics = this.deps.getShipPhysics();
    if (physics) this.deathFx?.spawn(physics.shipX, physics.shipY);
    void this.gameEngine?.audio?.playSfx("explosion")?.catch(() => {});
    this.gameEngine?.triggerPlayerDeath();
  }

  private awardSalvageCredits(npc: NpcShip): void {
    const engine = this.gameEngine;
    const player = engine?.player;
    const galaxy = engine?.galaxy;
    if (!engine || !player || !galaxy) return;
    if (!npc.credits || npc.credits <= 0) return;
    const session = this.deps.sessionState;
    const day = galaxy.gameDays ?? 0;
    let salvagedToday: number;
    if (session) {
      salvagedToday = session.salvagedTodayFor(day);
    } else {
      if (day !== engine.salvageDay) {
        engine.salvageDay = day;
        engine.salvagedToday = 0;
      }
      salvagedToday = engine.salvagedToday ?? 0;
    }
    const award = pirateSalvageAmount(
      npc.credits,
      GAME_BALANCE.pirateSalvageFraction,
      salvagedToday,
      GAME_BALANCE.pirateSalvageDailyCap,
    );
    if (award <= 0) return;
    if (session) {
      session.recordSalvage(award);
    } else {
      engine.salvagedToday = (engine.salvagedToday ?? 0) + award;
    }
    adjustPlayerCredits(
      engine.bank,
      player,
      award,
      GL_COUNTERPARTY.PLUNDER,
      t("flight.salvageReason"),
    );
    this.deps.showMessage(
      t("flight.salvageTrophy", { amount: award }),
      0xffdd33,
    );
  }

  private maybeShowLiberationHint(): void {
    const galaxy = this.gameEngine?.galaxy;
    const systemId = this.gameEngine?.player?.currentSystemId;
    if (!galaxy || !systemId) return;
    if (typeof galaxy.isHostileSystem !== "function") return;
    if (!galaxy.isHostileSystem(systemId)) return;
    this.deps.showMessage(t("flight.liberationHint"), 0xffcc66);
  }

  private maybeLiberateClearedSystem(): void {
    const engine = this.gameEngine;
    const galaxy = engine?.galaxy;
    const systemId = engine?.player?.currentSystemId;
    if (!engine || !galaxy || !systemId) return;
    if (typeof engine.liberateCurrentSystem !== "function") return;
    if (engine.liberateCurrentSystem()) {
      const sys = galaxy.systems.find((s) => s.id === systemId);
      this.deps.showMessage(
        t("flight.systemLiberated", { name: sys?.name ?? systemId }),
        0x66ff99,
      );
    }
  }

  private onNpcClick(npc: NpcShip): void {
    this.interaction.onNpcClick(npc);
  }

  onPayTribute(npc: NpcShip): void {
    this.interaction.onPayTribute(npc);
  }

  onFleeShakedown(npc: NpcShip): void {
    this.interaction.onFleeShakedown(npc);
  }

  onAttackNpc(npc: NpcShip): void {
    this.interaction.onAttackNpc(npc);
  }

  rememberFlightPos(): void {
    this.pursuit.rememberFlightPos();
  }

  private launchCombatWithNpc(npc: NpcShip): void {
    this.pursuit.launchCombatWithNpc(npc);
  }

  updateCombat(deltaTime: number): void {
    this.pursuit.updateCombat(deltaTime);
  }

  breakOffCombatPursuit(): void {
    this.pursuit.breakOffCombatPursuit();
  }

  isPursuitSuspended(): boolean {
    return this.pursuit.pursuitSuspended;
  }

  get inCombat(): boolean {
    return this.deps.isInCombat?.() ?? false;
  }

  private maybeShowEntryEncounter(): void {
    this.encounters.maybeShowEntryEncounter();
  }

  applyEncounterChoice(
    encounter: Encounter,
    choice: EncounterChoice,
    rng?: () => number,
  ): EncounterOutcome {
    return this.encounters.applyEncounterChoice(encounter, choice, rng);
  }

  closeEncounterPrompt(): void {
    this.encounters.closeEncounterPrompt();
  }

  spawnOvermindCoreCombatant(): void {
    this.overmind.spawnOvermindCoreCombatant();
  }

  showEncounterPrompt(encounter: Encounter): void {
    this.encounters.showEncounterPrompt(encounter);
  }

  showOvermindCorePrompt(): void {
    this.overmind.showOvermindCorePrompt();
  }
}
