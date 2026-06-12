import { Container, Graphics, Text } from "pixi.js";
import type { Renderer } from "../Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import type { ShipPhysics } from "@/systems/ShipPhysics";
import type { PlanetSprite } from "../PlanetSprite";
import { NpcShipSprite } from "../NpcShipSprite";
import type { SystemBounds } from "../NpcShipSprite";
import { NpcContactPanel } from "../NpcContactPanel";
import type { NpcShip } from "@/domain/NpcShip";
import type { Galaxy } from "@/domain/Galaxy";
import {
  npcsPresentInSystem,
  NpcSimulator,
  npcRoleTechLevel,
} from "@/systems/npc/NpcSimulator";
import { FlightCombatResolver } from "@/systems/FlightCombatResolver";
import { solveInterceptPoint } from "@/utils/intercept";
import { SYSTEM_GEOMETRY, GAME_BALANCE } from "@/config/balance";
import { SceneType, NpcRole, QuestType } from "@/types";
import { pickNpcDestination, type NpcBehaviorCtx } from "./npcBehavior";
import { scaledFont } from "@/utils/fontScale";
import { logger } from "@/utils/logger";
import type { FlightModule } from "./FlightModule";

/**
 * Live state the manager reads from (or pushes back to) the host scene without
 * depending on the concrete {@link SpaceFlightScene}. Route planning, the turn
 * loop, the HUD (toast/tooltip) and the authoritative ship/planet/star geometry
 * all stay in the scene; the manager reads them through these accessors
 * (Low Coupling / DIP — it depends on abstractions, not the scene class).
 */
export interface NpcShipManagerDeps {
  /** Authoritative ship physics (null before the ship spawns). */
  getShipPhysics(): ShipPhysics | null;
  /** Planet sprites for anchoring + depth sorting (they drift each frame). */
  getPlanetSprites(): PlanetSprite[];
  /** System centre (the star's centre) for the NPC movement band. */
  getStarCenter(): { x: number; y: number };
  /** True while the turn is running (NPCs move, clicks are disabled). */
  isTurnRunning(): boolean;
  /** Transient toast + mini-log feedback (owned by the scene's HUD). */
  showMessage(text: string, color?: number): void;
  /** Hover tooltip (delegated to the scene's HUD). */
  showTooltip(text: string, screenX: number, screenY: number): void;
  hideTooltip(): void;
  /** Plot and fly a course to a world point (scene owns route planning). */
  executeRouteTo(x: number, y: number): void;
  /** Clear the active route's planet/station target so arrival doesn't land. */
  clearRouteTarget(): void;
  /** End the running turn (used before a combat-scene transition). */
  endTurn(): void;
}

/**
 * Owns the living-galaxy NPC ships present in the player's system: their sprite
 * lifecycle (spawn on entry / hyperjump in-out), per-frame movement, depth
 * sorting behind planet discs, the contact panel and its hail/trade/attack/
 * approach actions, the auto-follow → close-to-range → fire combat loop, and the
 * OVERMIND-core final-encounter prompt. Extracted from {@link SpaceFlightScene}
 * as a {@link FlightModule}.
 *
 * The manager mounts NPC sprites on the injected game layer and the contact
 * panel / overmind overlay on the UI layer. It depends on {@link GameEngine}
 * and a set of injected {@link NpcShipManagerDeps} accessors — never on the
 * scene class itself (High Cohesion / Information Expert: NPC state + behaviour
 * live together).
 */
export class NpcShipManager implements FlightModule {
  private readonly renderer: Renderer;
  private readonly gameEngine: GameEngine | null;
  private readonly gameLayer: Container;
  private readonly uiLayer: Container;
  private readonly deps: NpcShipManagerDeps;

  private readonly combatResolver = new FlightCombatResolver();
  private readonly npcSimulator = new NpcSimulator();

  // NPC ships present in the player's system (Feature 8, slice 2).
  private npcSprites: NpcShipSprite[] = [];
  // Maps each non-pirate NPC sprite to the planet sprite it orbits so the
  // anchor can be refreshed each frame as planets drift along their orbits.
  private npcAnchorPlanet = new Map<NpcShipSprite, PlanetSprite>();
  private npcContactPanel: NpcContactPanel | null = null;
  private contactNpcId: string | null = null;
  private overmindOverlay: Container | null = null;
  // Guard: prevents multiple simultaneous CombatScene transition requests.
  private combatTransitionPending = false;
  // Last camera zoom fanned out by the scene (updateHitAreas). Applied to
  // newly spawned sprites too — otherwise a ship arriving while the player is
  // zoomed out keeps its default 40-world-px hit circle (~10 screen px at
  // MIN_ZOOM) until the next camera transform, making it near-unhoverable.
  private lastCameraZoom = 1;

  // When set, the ship auto-follows this NPC (used by "Атаковать"): on each
  // arrival it re-routes to the target's current position (auto-follow). Read by
  // the scene's flight/turn loop; the scene clears it on low-hull stop / route
  // cancel, so it stays a public mutable field.
  followNpcId: string | null = null;

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
    this.renderer = renderer;
    this.gameEngine = gameEngine;
    this.gameLayer = gameLayer;
    this.uiLayer = uiLayer;
    this.deps = deps;
  }

  // ---------------------------------------------------------------------------
  // FlightModule lifecycle
  // ---------------------------------------------------------------------------

  /** Create NPC ship sprites for every NPC currently present in this system. */
  initialize(): void {
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

  /** Advance NPC movement only while the world is running (turn-based). */
  update(deltaTime: number, _bgElapsed: number): void {
    // The world runs while the turn is running (flying, or holding station in
    // combat) — not only while the ship is physically moving.
    if (!this.deps.isTurnRunning()) return;

    const timeScale = this.deps.getShipPhysics()?.timeScale ?? 1;
    for (let i = this.npcSprites.length - 1; i >= 0; i--) {
      const sprite = this.npcSprites[i];
      // Keep the orbit center aligned with the planet's current orbital position.
      const anchorPlanet = this.npcAnchorPlanet.get(sprite);
      if (anchorPlanet) {
        sprite.updateAnchorPosition(anchorPlanet.screenX, anchorPlanet.screenY);
      }
      sprite.update(deltaTime * timeScale);
      if (sprite.isGone()) {
        this.npcAnchorPlanet.delete(sprite);
        sprite.destroy();
        this.npcSprites.splice(i, 1);
      } else {
        // When a sprite's dwell timer fires it clears its own anchor — remove
        // the stale entry so updateAnchorPosition is not re-called next frame.
        if (this.npcAnchorPlanet.has(sprite) && !sprite.isAnchored()) {
          this.npcAnchorPlanet.delete(sprite);
        }

        this.updateNpcDepth(sprite);
      }
    }
  }

  destroy(): void {
    for (const sprite of this.npcSprites) {
      if (sprite.container.parent) {
        sprite.container.parent.removeChild(sprite.container);
      }
      sprite.destroy();
    }
    this.npcSprites = [];
    this.npcAnchorPlanet.clear();
    this.closeNpcContactPanel();
    this.followNpcId = null;
    if (this.overmindOverlay) {
      if (!this.overmindOverlay.destroyed) {
        this.overmindOverlay.destroy({ children: true });
      }
      this.overmindOverlay = null;
    }
    this.combatTransitionPending = false;
  }

  // ---------------------------------------------------------------------------
  // Queries the scene reads from
  // ---------------------------------------------------------------------------

  /** Number of NPC ship sprites currently in the scene (E2E + debug helper). */
  get npcCount(): number {
    return this.npcSprites.length;
  }

  /**
   * E2E seam: trigger the contact-panel click for the NPC sprite at `index`,
   * exactly as a real pointer tap would. Lives here (not the scene) because the
   * NPC sprites + click handler are this module's data (Information Expert).
   * No-op when the index is out of range. Guarded by `__DEBUG__` so the body is
   * stripped from production builds.
   */
  e2eClickNpc(index: number): void {
    if (!__DEBUG__) return;
    const sprite = this.npcSprites[index];
    if (sprite) this.onNpcClick(sprite.npc);
  }

  /** Mini-map radar dots: world position + faction colour per NPC. */
  getNpcDots(): { x: number; y: number; color: number }[] {
    return this.npcSprites.map((s) => ({ x: s.x, y: s.y, color: s.mapColor }));
  }

  /** World position of the auto-follow target, or null when none is set/found. */
  getFollowTarget(): { x: number; y: number } | null {
    if (!this.followNpcId) return null;
    const sprite = this.npcSprites.find((s) => s.npc.id === this.followNpcId);
    return sprite ? { x: sprite.x, y: sprite.y } : null;
  }

  /** True while a panel the manager owns should swallow outside-clicks. */
  hasOpenModal(): boolean {
    return this.npcContactPanel !== null || this.overmindOverlay !== null;
  }

  /** True while the NPC contact panel is open (for the Escape close-chain). */
  get isContactPanelOpen(): boolean {
    return this.npcContactPanel !== null;
  }

  /** Close just the NPC contact panel (Escape handler / scene). */
  closeContactPanel(): void {
    this.closeNpcContactPanel();
  }

  /** Close the NPC contact panel and the OVERMIND-core overlay (if open). */
  closeModals(): void {
    this.closeNpcContactPanel();
    if (this.overmindOverlay) {
      const ov = this.overmindOverlay;
      this.overmindOverlay = null;
      // Guard: a scene transition may run clearUILayer() (which destroys this
      // overlay) before the microtask fires — destroying it twice throws.
      queueMicrotask(() => {
        if (!ov.destroyed) ov.destroy({ children: true });
      });
    }
  }

  /**
   * Switch NPC cursors so hovering shows intent (reticle over pirates, pointer
   * over others) only when not mid-turn; restore click/hover interactivity on
   * every ship that isn't leaving the system when the turn ends.
   */
  setCursors(turnRunning: boolean): void {
    for (const sprite of this.npcSprites) {
      sprite.container.cursor = turnRunning
        ? "default"
        : sprite.npc.role === NpcRole.PIRATE
          ? "target"
          : "pointer";
      // When the turn ends, restore click/hover interactivity on every ship that
      // isn't leaving the system — a ship that lost its hit-area mid-turn becomes
      // clickable again (Task 6).
      if (!turnRunning) sprite.restoreInteractivity();
    }
  }

  /** Keep NPC hit areas a fixed screen size regardless of zoom level. */
  updateHitAreas(cameraZoom: number): void {
    this.lastCameraZoom = cameraZoom;
    for (const s of this.npcSprites) s.updateHitArea(cameraZoom);
  }

  /**
   * Remove a defeated NPC from the galaxy domain (called on a victorious return
   * from CombatScene, before {@link initialize} rebuilds the sprite list).
   */
  removeDefeatedNpc(galaxy: Galaxy, npcId: string): void {
    this.npcSimulator.removeNpc(galaxy, npcId);
  }

  // ---------------------------------------------------------------------------
  // Sprite lifecycle
  // ---------------------------------------------------------------------------

  /** Geometry NPC ships move within (band + boundary edge). */
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
    sprite.updateHitArea(this.lastCameraZoom);
    sprite.setHoverHandler(
      (n, sx, sy) => this.deps.showTooltip(`${n.name} [${n.role}]`, sx, sy),
      () => this.deps.hideTooltip(),
    );
    sprite.container.zIndex = 100; // above planet discs so clicks reach the ship

    // Inject a role-driven target provider so pickNewTarget uses purposeful
    // destinations (planet visits, pirate hunts) instead of random ring points.
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

    // Non-pirates "visit" a planet: anchor them to orbit near one (deterministic
    // by id) so traders/rangers/patrols cluster at planets instead of aimlessly
    // crossing the system.  The orbit code path in NpcShipSprite.update() takes
    // priority over pickNewTarget, so the target provider above is the fallback
    // when no anchor is set (pirates) or the initial constructor call.
    const planets = this.deps.getPlanetSprites();
    if (npc.role !== NpcRole.PIRATE && planets.length > 0) {
      const idx = this.hashId(npc.id) % planets.length;
      const p = planets[idx];
      sprite.setAnchor(p.screenX, p.screenY);
      this.npcAnchorPlanet.set(sprite, p);
    }
    this.gameLayer.addChild(sprite.container);
    this.npcSprites.push(sprite);
  }

  /**
   * Sync NPC sprites with the simulation after a day passes (Scenario 8.5):
   * ships that left the system fly out to the boundary and hyperjump; newly
   * arrived ships appear on the boundary and fly in. No mid-system pop-in/out.
   */
  refresh(): void {
    const galaxy = this.gameEngine?.galaxy;
    const systemId = this.gameEngine?.player?.currentSystemId;
    if (!galaxy || !systemId) return;

    const present = npcsPresentInSystem(galaxy, systemId);
    const presentIds = new Set(present.map((n) => n.id));

    // NPCs no longer present begin flying out toward the boundary (removed once
    // they reach it, in update()).
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

  /**
   * Set NPC zIndex so the ship is occluded by planet discs it passes behind.
   * Planet discs sit at zIndex 50; ships at 40 render under them, ships at 100
   * render above. We switch to 40 whenever the ship's world position is within
   * the disc radius of any planet.
   */
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

  /** Small deterministic hash of a string id (FNV-1a) for stable assignment. */
  private hashId(s: string): number {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  // ---------------------------------------------------------------------------
  // Contact panel + actions
  // ---------------------------------------------------------------------------

  /** Open the contact panel for a clicked NPC ship. */
  private onNpcClick(npc: NpcShip): void {
    if (this.deps.isTurnRunning()) return;

    this.closeNpcContactPanel();
    this.contactNpcId = npc.id;
    // Hailing/trading and the detailed readout are offered within radar/scanner
    // range; beyond it the panel only offers "Приблизиться" to close the gap
    // (US-070 #3). The gate is the scanner range, not the (much shorter) firing
    // range — you can talk and trade well before you are in weapons reach.
    const sprite = this.npcSprites.find((s) => s.npc.id === npc.id);
    const physics = this.deps.getShipPhysics();
    const inRange =
      !!sprite &&
      !!physics &&
      Math.hypot(sprite.x - physics.shipX, sprite.y - physics.shipY) <=
        this.SCANNER_RANGE;
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
    this.uiLayer.addChild(this.npcContactPanel.container);
  }

  /**
   * "Приблизиться": plot a course that LEADS the moving target so the ship
   * closes to firing range aiming where it will be, not where it is, without
   * opening fire (US-070 #2; lead added playtest4 C). The player can then
   * re-open the panel to hail/trade or attack.
   */
  private onApproachNpc(npc: NpcShip): void {
    const sprite = this.npcSprites.find((s) => s.npc.id === npc.id);
    this.closeNpcContactPanel();
    if (!sprite || !this.deps.getShipPhysics()) return;
    this.followNpcId = null; // approach only — not an attack
    this.deps.clearRouteTarget();
    const lead = this.npcLeadPoint(sprite);
    this.deps.executeRouteTo(lead.x, lead.y);
    this.deps.showMessage(`Сближение: ${npc.name}`, 0x88ccff);
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
    this.deps.showMessage(`${npc.name}: «${line}»`, 0x88ccff);
  }

  /** "Торговать": trade-with-ships is not implemented yet — be honest. */
  private onTradeNpc(npc: NpcShip): void {
    this.deps.showMessage(
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
    const physics = this.deps.getShipPhysics();
    if (!sprite || !physics) return;

    const dist = Math.hypot(sprite.x - physics.shipX, sprite.y - physics.shipY);

    if (dist <= this.WEAPON_RANGE) {
      this.launchCombatWithNpc(npc);
      return;
    }

    // Not yet in range — auto-follow to close the gap, aiming at a lead point
    // so the intercept curves to where the target is heading (Task 5).
    this.followNpcId = npc.id;
    this.deps.clearRouteTarget();
    const lead = this.npcLeadPoint(sprite);
    this.deps.executeRouteTo(lead.x, lead.y);
    this.deps.showMessage(`Перехват: ${npc.name}`, 0xff5555);
  }

  /**
   * Predicted intercept point for chasing an NPC: leads the target along its
   * current heading so the pursuit curves toward where it will be rather than
   * pointing at its present position (Task 5). NPC velocity is derived from its
   * sprite heading (the hull faces its direction of travel) and the shared NPC
   * cruise speed. Falls back to the NPC's current position when no lead solves.
   */
  private npcLeadPoint(sprite: NpcShipSprite): { x: number; y: number } {
    const physics = this.deps.getShipPhysics();
    if (!physics) return { x: sprite.x, y: sprite.y };
    const heading = sprite.container.rotation;
    const vx = Math.cos(heading) * GAME_BALANCE.npcSpeed;
    const vy = Math.sin(heading) * GAME_BALANCE.npcSpeed;
    return solveInterceptPoint(
      physics.shipX,
      physics.shipY,
      physics.getMaxSpeed(),
      sprite.x,
      sprite.y,
      vx,
      vy,
    );
  }

  /** Transition to the turn-based CombatScene for a specific NPC. */
  private launchCombatWithNpc(npc: NpcShip): void {
    if (!this.gameEngine || this.combatTransitionPending) return;
    this.combatTransitionPending = true;
    this.followNpcId = null;
    this.deps.endTurn();
    const playerSystemId = this.gameEngine.player?.currentSystemId ?? "";
    const isHostileSystem = !!(
      playerSystemId && this.gameEngine.galaxy?.isHostileSystem(playerSystemId)
    );
    void this.gameEngine.transitionTo(SceneType.COMBAT, {
      gameEngine: this.gameEngine,
      isHostileSystem,
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
   * Auto-attack: while a follow target is set and the turn is running, close to
   * weapon range, then hold station and exchange fire until the target is
   * destroyed, the player drops below 30% hull, or the target is lost.
   * Decision logic delegated to FlightCombatResolver for testability.
   */
  updateCombat(_deltaTime: number): void {
    const physics = this.deps.getShipPhysics();
    if (!physics) return;
    const ship = this.gameEngine?.player?.ship;
    if (!ship) return;

    const decision = this.combatResolver.decide({
      isTurnRunning: this.deps.isTurnRunning(),
      followNpcId: this.followNpcId,
      shipPhysics: physics,
      npcSprites: this.npcSprites,
      weaponRange: this.WEAPON_RANGE,
    });

    switch (decision.action) {
      case "idle":
        return;
      case "lost":
        this.deps.showMessage("Цель потеряна", 0xffaa00);
        this.followNpcId = null;
        return;
      case "chase":
        if (!physics.isMoving) {
          // Re-aim at a fresh lead point each leg so the chase curves to lead a
          // crossing target rather than always heading at its old position.
          const chased = this.npcSprites.find(
            (s) => s.npc.id === this.followNpcId,
          );
          const lead = chased
            ? this.npcLeadPoint(chased)
            : { x: decision.targetX, y: decision.targetY };
          this.deps.executeRouteTo(lead.x, lead.y);
        }
        return;
      case "launch":
        if (physics.isMoving) {
          physics.setTarget(physics.shipX, physics.shipY);
          physics.isMoving = false;
          physics.currentSpeed = 0;
        }
        this.launchCombatWithNpc(decision.npc);
        return;
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

  // ---------------------------------------------------------------------------
  // OVERMIND core final-encounter prompt
  // ---------------------------------------------------------------------------

  /** Show a prompt when entering the OVERMIND core system so the player can fight the final encounter. */
  showOvermindCorePrompt(): void {
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
    // Swallow clicks on the modal panel so they do not bubble to the stage
    // route-planning handler behind it (playtest3 F6 audit, CLAUDE.md Rule 2).
    bg.eventMode = "static";
    bg.on("pointerdown", (e) => e.stopPropagation());

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
    this.uiLayer.addChild(overlay);
  }
}
