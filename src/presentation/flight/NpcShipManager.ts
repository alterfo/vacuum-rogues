import { Container, Graphics, Text } from "pixi.js";
import type { Renderer } from "../Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import type { ShipPhysics } from "@/systems/ShipPhysics";
import type { PlanetSprite } from "../PlanetSprite";
import { NpcShipSprite } from "../NpcShipSprite";
import type { SystemBounds } from "../NpcShipSprite";
import { NpcContactPanel } from "../NpcContactPanel";
import type { NpcShip } from "@/domain/NpcShip";
import { npcsPresentInSystem, NpcSimulator } from "@/systems/npc/NpcSimulator";
import { deterministicNpcOffset } from "@/systems/npc/npcPlacement";
import { FlightCombatResolver } from "@/systems/FlightCombatResolver";
import { solveInterceptPoint } from "@/utils/intercept";
import { shouldReaim } from "@/utils/flightGeometry";
import {
  SYSTEM_GEOMETRY,
  GAME_BALANCE,
  ARTIFACT_DROP_CHANCE,
} from "@/config/balance";
import { SceneType, NpcRole, QuestType, ResourceType } from "@/types";
import type { SpaceLootItem } from "@/types";
import { Faction } from "@/types/faction";
import { pickNpcDestination, type NpcBehaviorCtx } from "./npcBehavior";
import { hashStr } from "@/utils/hashStr";
import { scaledFont } from "@/utils/fontScale";
import { logger } from "@/utils/logger";
import { cargoCapacityOf } from "@/systems/equipment/GearBridge";
import type { FlightModule } from "./FlightModule";

/**
 * Fallback module ids for loot dropped by an NPC with no scanned loadout, so a
 * kill always yields something recognisable to salvage.
 */
const DEFAULT_LOOT_MODULES = [
  "salvaged_plating",
  "spare_capacitor",
  "scrap_thruster",
];

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
  /**
   * Begin in-flight combat against an aggressive sprite that reached attack
   * range (the scene routes this to its CombatModule — Tasks 11–14). Optional so
   * lightweight test/host setups without combat still satisfy the contract.
   */
  startInFlightCombat?(sprite: NpcShipSprite): void;
  /** True while in-flight combat is resolving (clicking an NPC retargets it). */
  isInCombat?(): boolean;
  /** Set the in-flight combat target to a clicked enemy sprite (Task 13). */
  selectCombatTarget?(sprite: NpcShipSprite): void;
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

  // When set, the ship is closing on this NPC via "Приблизиться" (non-combat):
  // the course is continuously re-aimed at the target's lead point while flying,
  // but never opens fire. Cleared on arrival, on a switch to attack, and when a
  // fresh route cancels it.
  private approachNpcId: string | null = null;
  // Final destination of the last route this manager plotted (the lead point),
  // so a drifting target can be re-aimed against the true endpoint rather than
  // the immediate (possibly sun-avoidance) waypoint ShipPhysics exposes.
  private lastAimX = 0;
  private lastAimY = 0;
  /** Lead-drift (world px) before a chase/approach re-plots its course. */
  private readonly REAIM_DRIFT_PX = 30;

  // Floating loot dropped by destroyed NPC ships (transient, presentation-only).
  // Public so the in-flight combat module (later tasks) and the gravity-tractor
  // pickup can read/mutate it; despawned after LOOT_TTL_MS by updateLoot().
  readonly spaceLoot: SpaceLootItem[] = [];
  // Per-loot glowing dot, keyed by loot id (yellow modules / cyan artifacts).
  private readonly lootGraphics = new Map<string, Graphics>();
  // Monotonic elapsed-ms clock driving loot lifetime + pulse (advanced in update,
  // independent of game time-scale so despawn tracks real elapsed time).
  private lootClockMs = 0;
  /** Loot lifetime before it despawns (60 s). */
  private readonly LOOT_TTL_MS = 60_000;

  private readonly WEAPON_RANGE = GAME_BALANCE.weaponRange;
  private readonly SCANNER_RANGE = GAME_BALANCE.scannerRange;
  private readonly COMBAT_ESCAPE_RANGE = GAME_BALANCE.combatEscapeRange;
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
    // Entering a captured system: its standing garrison immediately turns hostile
    // and pursues the player (combat resolves in-flight, not via CombatScene).
    this.applyGarrisonAggro();
    logger.info(`Created ${this.npcSprites.length} NPC sprites`);
  }

  /** Advance NPC movement only while the world is running (turn-based). */
  update(deltaTime: number, _bgElapsed: number): void {
    // Loot pulses and despawns on real elapsed time, regardless of whether the
    // turn is running (it must clear even after combat ends and the ship stops).
    this.updateLoot(deltaTime);
    // A gravity tractor pulls nearby loot into the hold every frame — including
    // after combat ends and the ship is parked, so a kill's drops are collected.
    this.applyGravTractor();

    // The world runs while the turn is running (flying, or holding station in
    // combat) — not only while the ship is physically moving.
    if (!this.deps.isTurnRunning()) return;

    const physics = this.deps.getShipPhysics();
    const timeScale = physics?.timeScale ?? 1;
    for (let i = this.npcSprites.length - 1; i >= 0; i--) {
      const sprite = this.npcSprites[i];
      // Garrison aggressors maneuver against the player ship: refresh their live
      // pursuit target (position + the player's CURRENT speed, which drives the
      // over-matched break-off check — a parked player isn't fleeing, so the
      // aggressor closes in) before advancing them, then open in-flight combat
      // once they close to attack range (no CombatScene hop — the scene's
      // CombatModule resolves the fight; Tasks 11–14).
      if (sprite.aggressive && physics) {
        const dx = sprite.x - physics.shipX;
        const dy = sprite.y - physics.shipY;
        const distSq = dx * dx + dy * dy;
        // Escape (Task 3): a faster player who has opened beyond the escape range
        // breaks the chase — the out-run aggressor gives up pursuit this
        // encounter (engaged combatants are pruned at the same range by
        // CombatModule). A parked/slower player never out-runs it, so the
        // aggressor keeps closing.
        if (
          distSq > this.COMBAT_ESCAPE_RANGE * this.COMBAT_ESCAPE_RANGE &&
          physics.canOutrun(GAME_BALANCE.npcSpeed)
        ) {
          sprite.setAggressive(false);
          this.npcAnchorPlanet.delete(sprite);
        } else {
          sprite.setPursuitTarget(
            physics.shipX,
            physics.shipY,
            physics.currentSpeed,
          );
          if (distSq <= this.WEAPON_RANGE * this.WEAPON_RANGE) {
            this.deps.startInFlightCombat?.(sprite);
          }
        }
      }
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

  /**
   * Write each live NPC sprite's position back to its domain ship as an offset
   * from the star centre, so the persisted world position reflects where the ship
   * actually is in flight (a save captures the live layout, and a star-map
   * round-trip respawns each ship exactly where the player last saw it — no
   * re-scatter). Presentation never invents a position from scratch — first
   * placement is the seed-derived job in {@link addNpcSprite}; this only mirrors
   * the live render position back. Called on teardown (which precedes a save /
   * scene transition) and exposed for an explicit pre-save flush.
   */
  persistLivePositions(): void {
    const center = this.deps.getStarCenter();
    for (const sprite of this.npcSprites) {
      sprite.npc.setWorldPosition(sprite.x - center.x, sprite.y - center.y);
    }
  }

  destroy(): void {
    // Capture where each ship actually is before tearing the sprites down, so the
    // persisted position survives the scene transition / save (no re-scatter).
    this.persistLivePositions();
    for (const sprite of this.npcSprites) {
      if (sprite.container.parent) {
        sprite.container.parent.removeChild(sprite.container);
      }
      sprite.destroy();
    }
    this.npcSprites = [];
    this.npcAnchorPlanet.clear();
    for (const g of this.lootGraphics.values()) {
      if (g.parent) g.parent.removeChild(g);
      if (!g.destroyed) g.destroy();
    }
    this.lootGraphics.clear();
    this.spaceLoot.length = 0;
    this.closeNpcContactPanel();
    this.followNpcId = null;
    this.approachNpcId = null;
    if (this.overmindOverlay) {
      if (!this.overmindOverlay.destroyed) {
        this.overmindOverlay.destroy({ children: true });
      }
      this.overmindOverlay = null;
    }
  }

  /**
   * Restyle the manager's text at the current font scale WITHOUT a scene re-init
   * (Task 1). The NPC ship sprites carry no text labels, so their containers are
   * left untouched (no rebuild); the only persistent {@link scaledFont} text the
   * manager owns is the OVERMIND-core prompt overlay, which is rebuilt at the new
   * size when open. (The contact panel uses fixed sizes — routed through the
   * shared scaledText helper in a later task.)
   */
  refreshFontScale(): void {
    if (this.overmindOverlay && !this.overmindOverlay.destroyed) {
      this.overmindOverlay.destroy({ children: true });
      this.overmindOverlay = null;
      this.showOvermindCorePrompt();
    }
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

  /**
   * E2E seam: place the first NPC just inside weapon range of the player ship,
   * flag it as a hostile aggressor and arm its pursuit, then return the sprite so
   * the scene can engage it in a deterministic dogfight. No-op (null) without a
   * ship or any NPCs. Guarded by `__DEBUG__` so it is stripped from production.
   */
  e2eForceAggressorInRange(weaponRange: number): NpcShipSprite | null {
    if (!__DEBUG__) return null;
    const physics = this.deps.getShipPhysics();
    const sprite = this.npcSprites[0];
    if (!physics || !sprite) return null;
    sprite.x = physics.shipX + weaponRange * 0.6;
    sprite.y = physics.shipY;
    sprite.container.x = sprite.x;
    sprite.container.y = sprite.y;
    // Deterministic combat stats so the staged fight reliably trades hull on both
    // sides (a generated NPC could roll 0 damage or already be near death).
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
   * placed at its persisted interior position — reused verbatim if the ship
   * already has one, else seed-derived once (deterministic, never random) and
   * stored so the next entry resolves to the same spot (no re-scatter).
   */
  private addNpcSprite(npc: NpcShip, entry: boolean): void {
    const bounds = this.npcBounds();
    let spawnX: number;
    let spawnY: number;

    if (!entry && npc.hasWorldPosition()) {
      // Persistent interior position (offset from the star centre): respawn the
      // ship exactly where it was, so a star-map round-trip leaves it in place.
      spawnX = bounds.cx + (npc.worldX as number);
      spawnY = bounds.cy + (npc.worldY as number);
    } else {
      // Deterministic placement keyed by the galaxy seed + ship id (no
      // Math.random): reproducible for old saves and stable across re-entry.
      const galaxySeed = this.gameEngine?.galaxy?.id ?? "";
      const base = deterministicNpcOffset(galaxySeed, npc.id);
      const angle = Math.atan2(base.y, base.x);
      // A ship that just hyperjumped in appears on the system boundary and flies
      // inward; an interior spawn sits at the seed-derived band offset.
      let offsetX = entry ? Math.cos(angle) * bounds.boundary : base.x;
      let offsetY = entry ? Math.sin(angle) * bounds.boundary : base.y;

      // Apply V-formation offset for convoy members so they don't overlap.
      // The perpendicular direction (angle + π/2) spaces ships ±30px apart.
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

      // Persist the resolved interior position so the next entry reuses it; the
      // simulation owns position change thereafter (presentation never invents
      // one). A boundary entry is transient (the ship flies inward), so it is
      // NOT persisted — it gets a stable interior position on the next re-entry.
      if (!entry) npc.setWorldPosition(offsetX, offsetY);

      spawnX = bounds.cx + offsetX;
      spawnY = bounds.cy + offsetY;
    }

    const sprite = new NpcShipSprite(npc, spawnX, spawnY, bounds);
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
    // Non-pirates re-anchor on every subsequent planet arrival via the callback
    // below — not just on initial spawn.
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

    // Re-evaluate garrison aggression: a freshly arrived garrison ship (or a
    // system that just turned hostile) must start pursuing the player too.
    this.applyGarrisonAggro();
  }

  /**
   * Resolve whether the player's current system is hostile and flag its garrison
   * sprites accordingly. Convenience wrapper around {@link checkGarrisonAggro}
   * used by {@link initialize} and {@link refresh}.
   */
  private applyGarrisonAggro(): void {
    const galaxy = this.gameEngine?.galaxy;
    const systemId = this.gameEngine?.player?.currentSystemId;
    if (!galaxy || !systemId) return;
    // Guard the domain call: lightweight galaxy stubs (tests) may omit it.
    const hostile =
      typeof galaxy.isHostileSystem === "function" &&
      galaxy.isHostileSystem(systemId);
    this.checkGarrisonAggro(systemId, hostile);
  }

  /**
   * Flag captured-system garrison sprites (OVERMIND faction or PIRATE role) as
   * aggressors while the player is inside a hostile system, so they break orbit
   * and pursue the player ship. Non-garrison ships are never flagged, and the
   * flag is cleared when the system is not hostile. Combat is NOT escalated to
   * CombatScene here — it resolves in-flight via the combat module (Tasks 11–14).
   */
  checkGarrisonAggro(_playerSystemId: string, isHostileSystem: boolean): void {
    for (const sprite of this.npcSprites) {
      const npc = sprite.npc;
      const isGarrison =
        npc.faction === Faction.OVERMIND || npc.role === NpcRole.PIRATE;
      const aggro = isHostileSystem && isGarrison;
      sprite.setAggressive(aggro);
      // Drop the orbit-planet anchor so the aggressor isn't re-anchored each
      // frame (setAggressive already cleared the sprite's own anchor fields).
      if (aggro) this.npcAnchorPlanet.delete(sprite);
    }
  }

  /**
   * The player attacked {@link target}: mark it openly hostile and propagate that
   * hostility to every same-faction ship sharing the target's system — attacking
   * one member of a faction turns the whole local contingent against you (Task
   * 14). Garrison/pirate ships already spawn hostile, so this is idempotent for
   * them. Refreshes the threat indicator on any affected sprite.
   */
  escalateHostility(target: NpcShip): void {
    target.markHostile();
    const systemId = target.currentSystemId;
    for (const npc of this.gameEngine?.galaxy?.npcShips ?? []) {
      if (npc.faction === target.faction && npc.currentSystemId === systemId) {
        npc.markHostile();
      }
    }
    // Re-render any sprite whose NPC just turned hostile so the threat ring shows.
    for (const sprite of this.npcSprites) {
      if (sprite.npc.hostile) sprite.refreshThreat();
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

  // ---------------------------------------------------------------------------
  // Space loot (drops from destroyed NPC ships)
  // ---------------------------------------------------------------------------

  /**
   * Spawn 0–2 floating loot items at a destroyed NPC's world position. Overmind
   * ships drop Overmind artifacts (40% per item, otherwise a salvaged module);
   * everyone else drops a random module from their scanned loadout. Called by
   * the in-flight combat death path (later tasks) when an NPC ship is destroyed.
   * `rng` is injectable so combat resolution / tests can drive the roll
   * deterministically (defaults to `Math.random`).
   */
  spawnLootForNpc(
    npc: NpcShip,
    worldX: number,
    worldY: number,
    rng: () => number = Math.random,
  ): void {
    const isOvermind = npc.faction === Faction.OVERMIND;
    const count = this.rollLootCount(rng);
    for (let i = 0; i < count; i++) {
      let moduleId: string | undefined;
      let artifactId: string | undefined;
      if (isOvermind && rng() < ARTIFACT_DROP_CHANCE) {
        artifactId = "ARTIFACTS";
      } else {
        moduleId = this.pickModuleId(npc, rng);
      }
      const item: SpaceLootItem = {
        id: `loot_${npc.id}_${Math.floor(this.lootClockMs)}_${i}`,
        moduleId,
        artifactId,
        x: worldX,
        y: worldY,
        spawnedAt: this.lootClockMs,
      };
      this.spaceLoot.push(item);
      this.mountLootSprite(item);
    }
  }

  /**
   * In-flight combat killed this NPC: drop its loot at the wreck, delete it from
   * the galaxy domain so the next refresh won't respawn it, and remove the sprite
   * from the scene. Called by the scene when {@link CombatModule} resolves a
   * lethal round (Task 13). `rng` is injectable for deterministic loot in tests.
   */
  handleInFlightDeath(
    sprite: NpcShipSprite,
    rng: () => number = Math.random,
  ): void {
    this.spawnLootForNpc(sprite.npc, sprite.x, sprite.y, rng);
    const galaxy = this.gameEngine?.galaxy;
    if (galaxy) this.npcSimulator.removeNpc(galaxy, sprite.npc.id);
    const idx = this.npcSprites.indexOf(sprite);
    if (idx >= 0) this.npcSprites.splice(idx, 1);
    this.npcAnchorPlanet.delete(sprite);
    if (sprite.container.parent) {
      sprite.container.parent.removeChild(sprite.container);
    }
    sprite.destroy();
  }

  /** Roll the per-kill loot count: 0, 1 or 2 (uniform thirds). */
  private rollLootCount(rng: () => number): number {
    const r = rng();
    if (r < 1 / 3) return 0;
    if (r < 2 / 3) return 1;
    return 2;
  }

  /** Pick a module id for a non-artifact drop: a scanned loadout item, else a
   *  generic salvage id when the NPC has no visible loadout. */
  private pickModuleId(npc: NpcShip, rng: () => number): string {
    const pool =
      npc.loadoutSummary.length > 0 ? npc.loadoutSummary : DEFAULT_LOOT_MODULES;
    return pool[Math.floor(rng() * pool.length) % pool.length];
  }

  /** Mount a small glowing dot for a loot item (yellow module / cyan artifact). */
  private mountLootSprite(item: SpaceLootItem): void {
    const color = item.artifactId ? 0x33ffff : 0xffdd33;
    const g = new Graphics();
    g.circle(0, 0, 10).fill({ color, alpha: 0.22 });
    g.circle(0, 0, 5).fill({ color, alpha: 0.95 });
    g.x = item.x;
    g.y = item.y;
    g.zIndex = 90; // above planet discs (50), below NPC hulls (100)
    g.eventMode = "none";
    this.gameLayer.addChild(g);
    this.lootGraphics.set(item.id, g);
  }

  /**
   * Advance the loot clock, pulse each dot's alpha (0.6 → 1.0 → 0.6 at ~1 Hz)
   * and despawn items older than {@link LOOT_TTL_MS}. Runs every frame.
   */
  private updateLoot(deltaTime: number): void {
    if (this.spaceLoot.length === 0) {
      this.lootClockMs += deltaTime;
      return;
    }
    this.lootClockMs += deltaTime;
    const pulse =
      0.6 +
      0.4 * (0.5 + 0.5 * Math.sin((this.lootClockMs / 1000) * Math.PI * 2));
    for (let i = this.spaceLoot.length - 1; i >= 0; i--) {
      const item = this.spaceLoot[i];
      if (this.lootClockMs - item.spawnedAt > this.LOOT_TTL_MS) {
        this.removeLootAt(i);
        continue;
      }
      const g = this.lootGraphics.get(item.id);
      if (g) g.alpha = pulse;
    }
  }

  /** Remove the loot item at `index` and dispose its glowing dot. */
  private removeLootAt(index: number): void {
    const item = this.spaceLoot[index];
    if (!item) return;
    const g = this.lootGraphics.get(item.id);
    if (g) {
      if (g.parent) g.parent.removeChild(g);
      if (!g.destroyed) g.destroy();
      this.lootGraphics.delete(item.id);
    }
    this.spaceLoot.splice(index, 1);
  }

  /**
   * Gravity tractor auto-pickup: when the player's loadout has a tractor
   * (`gravTractorRange > 0`), pull each floating loot item within that range
   * into the hold. Cargo usage tracks the canonical model (sum of resource
   * amounts vs `ship.cargoCapacity`, as in TradeSystem); a full hold logs a
   * warning and skips — loot stays in space until space frees up or despawns.
   * Module drops are salvaged into METALS; Overmind artifacts into ARTIFACTS.
   */
  private applyGravTractor(): void {
    if (this.spaceLoot.length === 0) return;
    const loadout = this.gameEngine?.playerLoadout;
    const player = this.gameEngine?.player;
    const physics = this.deps.getShipPhysics();
    if (!loadout || !player || !physics) return;
    const stats = loadout.derivedStats();
    const range = stats.gravTractorRange;
    if (range <= 0) return;
    const rangeSq = range * range;
    // Hold size is the loadout's cargo (authoritative), not the legacy getter.
    const capacity = cargoCapacityOf(loadout);
    for (let i = this.spaceLoot.length - 1; i >= 0; i--) {
      const item = this.spaceLoot[i];
      const dx = item.x - physics.shipX;
      const dy = item.y - physics.shipY;
      if (dx * dx + dy * dy > rangeSq) continue; // out of tractor reach
      const used = player.inventory.resources.reduce(
        (sum, r) => sum + r.amount,
        0,
      );
      if (used >= capacity) {
        logger.warn("Гравитяга: трюм полон, добыча оставлена в космосе");
        break; // hold won't free up this frame — stop pulling
      }
      const type = item.artifactId
        ? ResourceType.ARTIFACTS
        : ResourceType.METALS;
      player.inventory.addResource(type, 1);
      this.removeLootAt(i);
      const label = item.artifactId ? "артефакт" : (item.moduleId ?? "модуль");
      this.deps.showMessage(`Гравитяга подобрала: ${label}`, 0xffdd33);
      logger.info(`Gravity tractor picked up loot ${item.id} (${type})`);
    }
  }

  // ---------------------------------------------------------------------------
  // Contact panel + actions
  // ---------------------------------------------------------------------------

  /** Open the contact panel for a clicked NPC ship. */
  private onNpcClick(npc: NpcShip): void {
    // During an in-flight fight a click on an enemy ship retargets the combat
    // module instead of opening the contact panel (Task 13).
    if (this.deps.isInCombat?.()) {
      const sprite = this.npcSprites.find((s) => s.npc.id === npc.id);
      if (sprite) this.deps.selectCombatTarget?.(sprite);
      return;
    }
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
    this.approachNpcId = npc.id; // …but keep tracking it so the course corrects
    this.deps.clearRouteTarget();
    const lead = this.npcLeadPoint(sprite);
    this.aimRoute(lead.x, lead.y);
    this.deps.showMessage(`Сближение: ${npc.name}`, 0x88ccff);
  }

  /**
   * Plot a route to (x,y) and remember it as the live destination so a moving
   * target can be re-aimed against the true endpoint (the immediate waypoint
   * ShipPhysics exposes may be a sun-avoidance bend, not the destination).
   */
  private aimRoute(x: number, y: number): void {
    this.lastAimX = x;
    this.lastAimY = y;
    this.deps.executeRouteTo(x, y);
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
   * "Атаковать": if already within weapon range, engage real-time in-flight
   * combat immediately. Otherwise, close the panel and set the ship to
   * auto-follow (intercept) the target — updateCombat() engages once in range.
   */
  private onAttackNpc(npc: NpcShip): void {
    // Declaring an attack turns the target — and every same-faction ship in the
    // player's system — openly hostile (Task 14). No-op for garrison/pirate ships
    // that already spawned hostile.
    this.escalateHostility(npc);
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
    this.approachNpcId = null; // attack supersedes a non-combat approach
    this.deps.clearRouteTarget();
    const lead = this.npcLeadPoint(sprite);
    this.aimRoute(lead.x, lead.y);
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

  /**
   * Remember the ship's current flight position on the GameEngine (transient,
   * unsaved) so the SPACE_FLIGHT re-entry after a CombatScene round-trip resumes
   * the ship right here instead of edge-spawning it (applyEntrySpawn fallback).
   */
  private rememberFlightPos(): void {
    const physics = this.deps.getShipPhysics();
    if (physics && this.gameEngine) {
      this.gameEngine.lastFlightShipPos = {
        x: physics.shipX,
        y: physics.shipY,
      };
    }
  }

  /**
   * Engage real-time in-flight combat against a specific NPC (no CombatScene hop
   * and no ship freeze — the scene's CombatModule resolves the fight while ships
   * keep moving). Adds the NPC to the combatant set and selects it as the
   * player's auto-fire target. The auto-follow/approach intent is cleared now
   * that the target is engaged.
   */
  private launchCombatWithNpc(npc: NpcShip): void {
    const sprite = this.npcSprites.find((s) => s.npc.id === npc.id);
    if (!sprite) return;
    this.followNpcId = null;
    this.approachNpcId = null;
    this.deps.startInFlightCombat?.(sprite);
    this.deps.selectCombatTarget?.(sprite);
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

    // Non-combat approach ("Приблизиться"): continuously re-aim at the moving
    // target's lead point while flying, but never open fire. Handled before the
    // combat decision so an approach never escalates to a CombatScene launch.
    if (this.approachNpcId) {
      this.updateApproach(physics);
      return;
    }

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
      case "chase": {
        // Re-aim at a fresh lead point so the chase curves to lead a crossing
        // target rather than heading at its old position. Re-aim at the start of
        // each leg (stopped) AND continuously mid-flight once the target drifts
        // beyond the threshold — so the ship corrects course toward a manoeuvring
        // target instead of trailing it to where it was.
        const chased = this.npcSprites.find(
          (s) => s.npc.id === this.followNpcId,
        );
        const lead = chased
          ? this.npcLeadPoint(chased)
          : { x: decision.targetX, y: decision.targetY };
        if (
          !physics.isMoving ||
          shouldReaim(
            { x: this.lastAimX, y: this.lastAimY },
            lead,
            this.REAIM_DRIFT_PX,
          )
        ) {
          this.aimRoute(lead.x, lead.y);
        }
        return;
      }
      case "launch":
        // In range: engage in-flight combat. The ship is NOT frozen — it keeps
        // its current momentum (navigation is locked while the fight is on, so
        // the player can't plot a new course, but the ship is never pinned).
        this.launchCombatWithNpc(decision.npc);
        return;
    }
  }

  /**
   * "Приблизиться" tracking: while the ship is flying toward the approached NPC,
   * re-plot the course at its fresh lead point once it drifts past the threshold
   * so the ship corrects toward where the target is now, not where it was at the
   * click. Clears the tracking when the ship arrives (stops) or the target is
   * gone — without ever launching combat.
   */
  private updateApproach(physics: ShipPhysics): void {
    const sprite = this.npcSprites.find((s) => s.npc.id === this.approachNpcId);
    if (!sprite || !physics.isMoving) {
      // Target lost, or the ship reached the (re-aimed) lead point and stopped.
      this.approachNpcId = null;
      return;
    }
    const lead = this.npcLeadPoint(sprite);
    if (
      shouldReaim(
        { x: this.lastAimX, y: this.lastAimY },
        lead,
        this.REAIM_DRIFT_PX,
      )
    ) {
      this.aimRoute(lead.x, lead.y);
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
      queueMicrotask(() => overlay.destroy({ children: true }));
      this.rememberFlightPos(); // resume here after combat, not at the system edge
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
      queueMicrotask(() => overlay.destroy({ children: true }));
    });

    overlay.addChild(bg, border, title, desc, attackBtn, retreatBtn);
    this.uiLayer.addChild(overlay);
  }
}
