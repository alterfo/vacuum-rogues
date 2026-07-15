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
import { npcsPresentInSystem, NpcSimulator } from "@/systems/npc/NpcSimulator";
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

/**
 * Galaxy/combatant id of the synthetic OVERMIND-core final boss. Killing the
 * sprite carrying this id in real-time in-flight combat wins the game
 * (see {@link NpcShipManager.handleInFlightDeath}).
 */
export const OVERMIND_CORE_ID = "overmind_core";

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
  /**
   * Whether a combat kill's instant loot dump should be DEFERRED (Task 14/14.5c):
   * the execute-window wreck takes over and emits the same drops staggered along
   * its drift. One-shot per kill — the host consumes the mark. Absent/false ⇒
   * the legacy at-death loot dump (crossfire deaths always stay legacy).
   */
  deferDeathLoot?(npc: NpcShip): boolean;
  /**
   * Called when the *player* deliberately initiates combat (vs. NPC aggro). The
   * scene uses this to raise the active-pause immediately so the weapon-choice
   * overlay appears before any orbital maneuvering, not after the first NPC shot.
   */
  onPlayerEngagesCombat?(sprite: NpcShipSprite): void;
  /** True while in-flight combat is resolving (clicking an NPC retargets it). */
  isInCombat?(): boolean;
  /** Set the in-flight combat target to a clicked enemy sprite (Task 13). */
  selectCombatTarget?(sprite: NpcShipSprite): void;
  /**
   * Id of the live auto-fire combat target (the CombatModule's selected enemy),
   * or null. Drives the player's real-time auto-track during a fight so it keeps
   * weapon range without a fresh "Ход" (Task 3). Optional for test/host setups.
   */
  getCombatTargetId?(): string | null;
  /**
   * Whether a sprite is an active in-flight combatant. Keeps an engaged enemy
   * pursuing even when the captured-system garrison gate would otherwise clear
   * its aggression (Task 3). Optional for lightweight setups.
   */
  isCombatant?(sprite: NpcShipSprite): boolean;
  /** True while the active-pause is frozen — combat maneuvering halts (Task 3). */
  isPaused?(): boolean;
  /**
   * Star-avoidance radius (world px) used by smooth chase steering to decide when
   * the straight lead-line would fly through the sun: while the shot is clear the
   * heading is nudged directly; when the line crosses the star it falls back to
   * the curved {@link executeRouteTo} avoidance spline (smooth-auto-follow Task 3).
   * Optional: absent ⇒ no star fallback (lightweight test/host setups keep the
   * direct nudge).
   */
  getStarAvoidRadius?(): number;
  /**
   * Shared anti-farm bookkeeping (offered encounters, per-day salvage cap —
   * plan Task 5). Optional and additive so existing fake deps bundles keep
   * compiling; when absent, callers fall back to the `GameEngine` accessors
   * of the same name.
   */
  sessionState?: FlightSessionState;
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
  private readonly gameEngine: GameEngine | null;
  private readonly gameLayer: Container;
  private readonly deps: NpcShipManagerDeps;

  private readonly npcSimulator = new NpcSimulator();

  // NPC ships present in the player's system (Feature 8, slice 2).
  private npcSprites: NpcShipSprite[] = [];
  // Maps each non-pirate NPC sprite to the planet sprite it orbits so the
  // anchor can be refreshed each frame as planets drift along their orbits.
  private npcAnchorPlanet = new Map<NpcShipSprite, PlanetSprite>();
  // NPC ids already warned about via the incoming-attacker toast (Task 5) —
  // cleared once the sprite drops aggression so a later re-aggro warns again.
  private warnedAggressorIds = new Set<string>();
  private readonly panels: ContactPanelManager;
  // Owns the player-vs-NPC contact-panel action cluster (hail/trade/attack/
  // approach/hire + the pirate shakedown flow). Constructed in the ctor with a
  // deps bundle over this manager; the moved methods below forward 1:1 so the
  // manager's tested surface (onNpcClick/onPayTribute/onFleeShakedown/onAttackNpc)
  // is unchanged — mirrors the ContactPanelManager/LootDropHandler delegation.
  private readonly interaction: NpcInteractionController;
  // Owns the combat steering / orbit / chase-state cluster (auto-follow →
  // close-to-range → fire, real-time combat orbit, smoothed chase steering,
  // NPC-vs-NPC crossfire). Constructed in the ctor with a deps bundle over
  // this manager; the moved methods below forward 1:1 so the manager's tested
  // surface (updateCombat/breakOffCombatPursuit/followNpcId/
  // launchCombatWithNpc/resolveNpcVsNpcCombat) is unchanged.
  private readonly pursuit: CombatPursuitController;
  // Forwarding getter so tests that inspect internal state via type-cast can
  // still read the open panel's NPC id (state now lives in ContactPanelManager).
  private get contactNpcId(): string | null {
    return this.panels.openNpcId;
  }
  // Owns the exploration-encounter cluster (derelict/anomaly/distress prompt +
  // outcome resolution); transient, ephemeral (no save state). Constructed in
  // the ctor with a deps bundle over this manager; the moved methods below
  // forward 1:1 so the manager's tested surface (isEncounterPromptOpen/
  // closeEncounterPrompt/showEncounterPrompt/applyEncounterChoice) is unchanged.
  private readonly encounters: EncounterController;
  // Owns the OVERMIND-core final-boss prompt + combatant spawn. Constructed in
  // the ctor with a deps bundle over this manager; the moved methods below
  // forward 1:1 so the manager's tested surface (showOvermindCorePrompt) is
  // unchanged.
  private readonly overmind: OvermindBossController;
  // Last camera zoom fanned out by the scene (updateHitAreas). Applied to
  // newly spawned sprites too — otherwise a ship arriving while the player is
  // zoomed out keeps its default 40-world-px hit circle (~10 screen px at
  // MIN_ZOOM) until the next camera transform, making it near-unhoverable.
  private lastCameraZoom = 1;

  // Auto-follow target id (used by "Атаковать"): state now lives on
  // CombatPursuitController (Task 2); kept as a get/set accessor so external
  // readers (the scene's flight/turn loop) keep using `manager.followNpcId`
  // as a public mutable field with no signature change.
  get followNpcId(): string | null {
    return this.pursuit.followNpcId;
  }
  set followNpcId(id: string | null) {
    this.pursuit.followNpcId = id;
  }
  // Forwarding accessors so the existing type-cast tests
  // (`pursuitSuspended`/`npcCrossfireTimer`) keep reading the moved
  // CombatPursuitController state directly off the manager. Public (not
  // private) because neither has an internal reader — a private accessor with
  // no in-class caller trips `noUnusedLocals` (mirrors the Task 1 precedent).
  get pursuitSuspended(): boolean {
    return this.pursuit.pursuitSuspended;
  }
  set pursuitSuspended(v: boolean) {
    this.pursuit.pursuitSuspended = v;
  }
  get npcCrossfireTimer(): number {
    return this.pursuit.npcCrossfireTimer;
  }

  // Floating loot handler (spawn / TTL despawn / pickup). Owns spaceLoot,
  // lootGraphics, and lootClockMs; extracted from this class so loot logic is
  // independently testable. Initialised in the constructor (needs gameLayer).
  private readonly loot: LootDropHandler;
  /** Floating drops currently live in this system — forwarded from LootDropHandler. */
  get spaceLoot(): SpaceLootItem[] {
    return this.loot.spaceLoot;
  }
  // Forwarding accessor so the existing test cast
  // `(manager as { lootGraphics: Map<...> }).lootGraphics.size` keeps working
  // without touching any test assertion.
  get lootGraphics() {
    return this.loot.lootGraphics;
  }

  // Ship-death explosion FX (pure emitter + pooled particle renderer). Built in
  // initialize() — after the scene's clearGameLayer — so its particle layer
  // survives, advanced each frame (real elapsed time, like loot) and torn down in
  // destroy(). A burst is gated on reducedMotion() inside the renderer.
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

  // ---------------------------------------------------------------------------
  // FlightModule lifecycle
  // ---------------------------------------------------------------------------

  /** Create NPC ship sprites for every NPC currently present in this system. */
  /**
   * @param isResumedFlight True only when this re-initializes an
   * ALREADY-LIVE flight (a reload/resume, or a pure HUD rebuild — both pass
   * `preserveShipPos`), never a fresh system entry (undock/hyperjump/first
   * arrival). Gates {@link reengageNearbyHostiles}: it must not fire on a
   * normal entry, where a hostile NPC merely being nearby is unremarkable
   * and must stay gated by the usual neutral-aggro pacing.
   */
  initialize(isResumedFlight = false): void {
    // Build the ship-death blast renderer first (before the no-galaxy early
    // return) so update()/destroy()/spawn always have it on a live scene. Tear
    // down any prior renderer first so a re-init without an intervening
    // destroy() can't orphan its particle layer on gameLayer.
    this.deathFx?.destroy();
    this.deathFx = new ShipDeathFxRenderer(this.gameLayer);
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
    if (isResumedFlight) this.reengageNearbyHostiles();
    logger.info(`Created ${this.npcSprites.length} NPC sprites`);
    // Entering a captured system: surface the liberation counter-play so the
    // player learns they can free it by destroying the garrison (Task 4).
    this.maybeShowLiberationHint();
    // Spice the entry with a random exploration encounter (derelict/anomaly/
    // distress). Skipped when the OVERMIND-core prompt already owns the screen.
    this.maybeShowEntryEncounter();
  }

  /** Advance NPC movement only while the world is running (turn-based). */
  update(deltaTime: number, _bgElapsed: number): void {
    // Loot pulses and despawns on real elapsed time, regardless of whether the
    // turn is running (it must clear even after combat ends and the ship stops).
    this.loot.update(deltaTime);
    // Floating drops are collected by flying near them (hands-on proximity), and
    // a gravity tractor extends the reach — every frame, including after combat
    // ends and the ship is parked, so a kill's drops are always collectible.
    this.loot.collectIfInRange({
      getPlayer: () => this.gameEngine?.player ?? null,
      getLoadout: () => this.gameEngine?.playerLoadout ?? null,
      getShipPosition: () => {
        const p = this.deps.getShipPhysics();
        return p ? { x: p.shipX, y: p.shipY } : null;
      },
      showMessage: (text, color) => this.deps.showMessage(text, color),
    });

    // Death blast ages on real elapsed time too (like loot), so a kill's
    // explosion keeps expanding + fading even after the ship stops / combat ends.
    this.deathFx?.update(deltaTime);

    // The world runs while the turn is running (flying, or holding station in
    // combat) — not only while the ship is physically moving.
    if (!this.deps.isTurnRunning()) return;

    const physics = this.deps.getShipPhysics();
    const timeScale = physics?.timeScale ?? 1;
    for (let i = this.npcSprites.length - 1; i >= 0; i--) {
      const sprite = this.npcSprites[i];
      // Incoming-attacker warning (Task 5): a one-shot toast the moment a
      // sprite turns aggressive, so a closing hostile isn't a surprise. Gated
      // on "not yet a combatant" — once weapon range is reached the fight's
      // own HUD/pause makes the engagement obvious, and this also keeps a
      // player-initiated attack (already a combatant by the next tick) from
      // reading as an "incoming" warning about itself.
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
      } else {
        this.warnedAggressorIds.delete(sprite.npc.id);
      }
      // Garrison aggressors maneuver against the player ship: the good-rep
      // breakoff, the pirate shakedown roll/hail, the out-run escape breakoff,
      // and the pursuit-target refresh + in-range combat launch are all one
      // per-frame tick on CombatPursuitController (Task 6). A positive
      // shakedown roll halts the whole frame's sprite loop (the hail
      // interrupts the player), mirroring the pre-extraction inline `return`.
      if (
        sprite.aggressive &&
        physics &&
        this.pursuit.tickAggressor(sprite, physics)
      ) {
        return;
      }
      // NPC-vs-NPC engagement: a ship NOT hunting the player closes on its
      // nearest hostile NPC so cross-faction foes visibly fight instead of
      // coexisting — e.g. a pirate intruder caught in an Overmind-held system
      // engages the garrison rather than drifting past it. Player-aggressors keep
      // chasing the player (their NPC target is cleared so it never competes).
      if (sprite.aggressive) {
        sprite.clearNpcCombatTarget();
      } else {
        const enemy = this.pursuit.nearestNpcEnemy(sprite);
        if (enemy) sprite.setNpcCombatTarget(enemy.x, enemy.y);
        else sprite.clearNpcCombatTarget();
      }
      // Keep the orbit center aligned with the planet's current orbital position.
      const anchorPlanet = this.npcAnchorPlanet.get(sprite);
      if (anchorPlanet) {
        sprite.updateAnchorPosition(anchorPlanet.screenX, anchorPlanet.screenY);
      }
      // The active pause (FTL-style) freezes the WHOLE fight, not just the
      // player ship: skip the per-frame movement advance so enemy ships stop
      // pursuing/circling while the overlay is up. Honour the single
      // `combatPause.paused` freeze signal directly (the same `isPaused` gate
      // `updateCombatPursuit` uses for the player orbit) rather than depending
      // on the scene folding pause into `isTurnRunning`. Hit-area/depth
      // bookkeeping below stays harmless while frozen.
      if (!this.deps.isPaused?.()) {
        sprite.update(deltaTime * timeScale);
      }
      if (sprite.isGone()) {
        this.npcAnchorPlanet.delete(sprite);
        this.warnedAggressorIds.delete(sprite.npc.id);
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

    // After moving every ship, resolve any in-flight NPC-vs-NPC brawl (the
    // Overmind's indiscriminate aggression playing out against a strayed pirate /
    // liberating ranger), independent of the player.
    this.resolveNpcVsNpcCombat(deltaTime);
  }

  /**
   * In-flight NPC-vs-NPC combat (Task 5): the Overmind's indiscriminate crossfire
   * against a strayed pirate / liberating ranger, independent of the player.
   * Moved to {@link CombatPursuitController.resolveNpcVsNpcCombat} (Task 2);
   * kept as a private forwarder for the per-frame caller below and the
   * existing type-cast test (`(manager as {...}).resolveNpcVsNpcCombat(...)`).
   */
  private resolveNpcVsNpcCombat(deltaTime: number): void {
    this.pursuit.resolveNpcVsNpcCombat(deltaTime);
  }

  /**
   * Write each live NPC sprite's position back to its domain ship as an offset
   * from the star centre, so the persisted world position reflects where the ship
   * actually is in flight (a save captures the live layout, and a star-map
   * round-trip respawns each ship exactly where the player last saw it — no
   * re-scatter). Presentation never invents a position from scratch — first
   * placement is the seed-derived job in {@link addNpcSprite}; this only mirrors
   * the live render position back. Called on teardown, which precedes the normal
   * scene-transition autosave, so that save captures the live layout.
   *
   * KNOWN GAP: in-flight saves that fire BEFORE teardown — the hyperjump autosave
   * (`SpaceFlightScene.doHyperjump`) and the emergency autosave
   * (`GameEngine.handleCriticalError`) — do not flush through here, so they
   * persist the positions from the start of the session, not the live ones. This
   * method is public so those paths can call it before serializing once wired.
   */
  persistLivePositions(): void {
    const center = this.deps.getStarCenter();
    for (const sprite of this.npcSprites) {
      // Defensive: some lightweight test doubles stub `npc` as a plain object
      // without the full NpcShip API — skip rather than throw.
      if (typeof sprite.npc.setWorldPosition !== "function") continue;
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
    this.loot.destroy();
    this.deathFx?.destroy(); // removes + destroys its particle layer
    this.deathFx = null;
    this.panels.close();
    this.pursuit.reset();
    this.overmind.destroy();
    this.encounters.destroy();
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
    this.overmind.refreshFontScale();
    // Rebuild the open encounter prompt at the new size (it holds scaledFont text).
    this.encounters.refreshFontScale();
  }

  /**
   * Re-apply the active colourblind palette to every live NPC ship (hull + radar
   * dot). The scene wires this to the accessibility ПАЛИТРА control so a palette
   * change made in flight recolours the existing ships at once (playtest bug pass
   * 2, Task 4 — "the palette change does nothing"), instead of waiting for the
   * next scene rebuild to pick the new hue up.
   */
  refreshFactionColors(): void {
    for (const sprite of this.npcSprites) sprite.refreshPaletteColors();
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

  /**
   * E2E seam: directly register the first NPC sprite as a combatant, bypassing the
   * normal aggression-propagation cycle. Call this immediately after
   * {@link e2eForceAggressorInRange} when the test needs `combatModule.isActive`
   * before any tick fires — without this, the first `advanceGalaxyDay` →
   * `refresh` → `checkGarrisonAggro` cycle clears the forced aggressive flag before
   * `npcManager.update` can call `startInFlightCombat`. Guarded by `__DEBUG__`.
   */
  e2eEngageCombat(targetId?: string): void {
    if (!__DEBUG__) return;
    const sprite = targetId
      ? (this.npcSprites.find((s) => s.npc.id === targetId) ??
        this.npcSprites[0])
      : this.npcSprites[0];
    if (!sprite) return;
    this.deps.startInFlightCombat?.(sprite);
  }

  /**
   * Mini-map radar dots: world position + faction colour per NPC, plus
   * whether it is currently an aggressor closing in on the player (Task 5) so
   * the mini-map can mark it as an incoming threat distinct from a merely
   * nearby, non-hostile ship of the same faction colour.
   */
  getNpcDots(): { x: number; y: number; color: number; aggressive: boolean }[] {
    return this.npcSprites.map((s) => ({
      x: s.x,
      y: s.y,
      color: s.mapColor,
      aggressive: s.aggressive,
    }));
  }

  /** World position of the auto-follow target, or null when none is set/found. */
  getFollowTarget(): { x: number; y: number } | null {
    if (!this.followNpcId) return null;
    const sprite = this.npcSprites.find((s) => s.npc.id === this.followNpcId);
    return sprite ? { x: sprite.x, y: sprite.y } : null;
  }

  /** True while a panel the manager owns should swallow outside-clicks. */
  hasOpenModal(): boolean {
    return (
      this.panels.hasOpenModal() ||
      this.overmind.isOpen ||
      this.encounters.isOpen
    );
  }

  /** True while the exploration-encounter prompt is open (Escape close-chain). */
  get isEncounterPromptOpen(): boolean {
    return this.encounters.isOpen;
  }

  /** True while the NPC contact panel is open (for the Escape close-chain). */
  get isContactPanelOpen(): boolean {
    return this.panels.isOpen;
  }

  /** Close just the NPC contact panel (Escape handler / scene). */
  closeContactPanel(): void {
    this.panels.close();
  }

  /** Close the NPC contact panel and the OVERMIND-core overlay (if open). */
  closeModals(): void {
    this.panels.close();
    this.overmind.close();
    this.closeEncounterPrompt();
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
      // one from scratch — persistLivePositions() only mirrors live drift back).
      // A boundary entry is transient (the ship flies inward), so its spawn point
      // is NOT persisted here; if the player lingers, destroy()'s write-back
      // captures wherever it settled, otherwise the next entry re-derives one.
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
      this.panels.close();
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
   * Re-arm pursuit for a persisted-hostile NPC that's still close to the
   * player right after scene init — a reload mid-fight (`CombatModule.combatants`
   * starts empty on the fresh scene) otherwise leaves it `npc.hostile===true`
   * but passive forever, since `checkGarrisonAggro`'s `engaged` check can't see
   * it yet. Scoped to nearby sprites only (not every hostile system-wide) so an
   * old, successfully-escaped grudge from a past visit doesn't resume chasing —
   * only one still close enough to plausibly have been mid-engagement at save
   * time. One-time nudge into `aggressive`; the existing per-frame pursuit loop
   * closes to weapon range and calls `startInFlightCombat` on its own from there,
   * which keeps `engaged` (and so `aggressive`) true on every later re-check.
   */
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

  /**
   * Flag captured-system garrison sprites (OVERMIND faction or PIRATE role) as
   * aggressors while the player is inside a hostile system, so they break orbit
   * and pursue the player ship. Non-garrison ships are never flagged, and the
   * flag is cleared when the system is not hostile. Combat is NOT escalated to
   * CombatScene here — it resolves in-flight via the combat module (Tasks 11–14).
   */
  checkGarrisonAggro(playerSystemId: string, isHostileSystem: boolean): void {
    // The system's CONTROLLING faction decides which garrison defends it: an
    // Overmind-held system is defended by the Overmind, a pirate-held system by
    // pirates. The two are mutual enemies (faction-hostility matrix), so they must
    // NOT both aggro the player in the same system — a stray pirate passing through
    // an Overmind-captured system is an INTRUDER the Overmind fights (cross-faction
    // combat), never an ally ganging up on the player. That mixed aggro is what
    // made pirates + Overmind look allied (playtest 2026-06-27, Issue 6).
    const pirateControlled =
      this.gameEngine?.galaxy?.isPirateSystem?.(playerSystemId) ?? false;
    // Task 9 (iii): a weak ship (ratcheted campaign power below the battle-ready
    // band) is NOT hunted by wandering NEUTRAL-system aggressors — the Overview's
    // "gentle while weak, relentless once armed" applied to aggro, not just the
    // per-shot damage (Task 9 (i)). A weak ship that is never chased never eats
    // the un-outrunnable interceptor's crossing volleys (the neutral half of the
    // Task 9 combat-exposure deaths). The shield lifts as the player arms (power
    // ≥ threshold ⇒ hunted again); it is INERT without a wired campaign context
    // (legacy DI stubs read `undefined` ⇒ hunt, byte-identical) and NEVER touches
    // a captured system's garrison (isHostileSystem) or an engaged combatant.
    const rawPower = this.gameEngine?.campaignPeakPower;
    const neutralAggroAllowed =
      rawPower === undefined
        ? true
        : (rawPower ?? 0) >= NEUTRAL_AGGRO_POWER_THRESHOLD;
    for (const sprite of this.npcSprites) {
      const npc = sprite.npc;
      const kind = factionKindOf(npc);
      // The Overmind is indiscriminately hostile to the player (faction-hostility
      // matrix). A live Overmind craft spawns hostile and besieges neutral border
      // systems *before* they fall, so it hunts the player wherever it is present
      // (gated on isAggressive() so a passive stub stays in orbit), AND it defends
      // any hostile (captured/besieged) system it garrisons.
      const overmindAggro =
        kind === "overmind" &&
        (isHostileSystem ||
          (neutralAggroAllowed &&
            npc.isAggressive() &&
            isHostile("overmind", "player", { pirateRep: 0 })));
      // Pirates defend ONLY their own turf: a pirate aggros the player in a
      // pirate-CONTROLLED system, never in an Overmind system (where it is the
      // Overmind's prey, not its ally).
      const pirateAggro = kind === "pirate" && pirateControlled;
      // An active in-flight combatant keeps pursuing regardless of the gate (Task
      // 3): a foe you engaged in a now-neutral system must not have its aggression
      // cleared out from under the fight.
      const engaged = this.deps.isCombatant?.(sprite) ?? false;
      const aggro = overmindAggro || pirateAggro || engaged;
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
   * Spawn 0–2 floating loot items at a destroyed NPC's world position. Delegates
   * to {@link LootDropHandler.spawn} — see that method for the full contract.
   * `rng` is injectable so tests can drive the roll deterministically.
   */
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

  /** Roll a kill's total drop count (the loot handler's own distribution) —
   *  the wreck-drift cadence pre-rolls this once, then emits via `count: 1`. */
  rollDeathLootCount(npc: NpcShip, rng: () => number = Math.random): number {
    return this.loot.rollDropCount(npc, rng);
  }

  /** Read-only view of the live NPC sprites (call-for-help candidates, 14.5c). */
  getNpcSpritesView(): readonly NpcShipSprite[] {
    return this.npcSprites;
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
    killedByPlayer = true,
  ): void {
    const wasOvermindCore = sprite.npc.id === OVERMIND_CORE_ID;
    // Punch the kill with a brief explosion at the wreck (gated on reduced motion
    // inside the renderer) + a one-shot SFX — captured before the sprite is torn
    // down. Fires for EVERY death (player kill, crossfire, the core) so any ship
    // blowing up reads + sounds the same.
    this.deathFx?.spawn(sprite.x, sprite.y);
    void this.gameEngine?.audio?.playSfx("explosion")?.catch(() => {});
    // A wreck-drift loot cadence (Task 14/14.5c) may take over this kill's drop
    // — the same total, emitted staggered along the wreck's drift instead of
    // all at once at the death point. Crossfire deaths keep the instant dump.
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
    // Destroying the OVERMIND core in-flight is the win condition (the old hex
    // CombatScene victory called showGameOutcomeScreen(true) on the same kill).
    if (wasOvermindCore) {
      this.gameEngine?.showGameOutcomeScreen(true);
      return;
    }
    // Salvage + liberation are PLAYER-earned rewards, so only a kill the player
    // actually made pays out. NPC-vs-NPC crossfire (resolveNpcVsNpcCombat) routes
    // through this same death path for the loot drop + domain removal, but must
    // NOT hand the spectating player free salvage credits (an Overmind fleet
    // farming strayed pirates beside the player would otherwise fill the daily
    // cap passively) or a free liberation it never fought for (NpcSimulator's own
    // "clear and hold" path still auto-liberates genuinely NPC-cleared systems).
    if (killedByPlayer) {
      // Salvage the wreck's credits (Task 5) — a fraction of the NPC's cash routed
      // through the ledger, bounded by the per-day anti-farm cap.
      this.awardSalvageCredits(sprite.npc);
      // Clearing the last hostile in a captured system frees it immediately
      // (player-driven liberation, Task 4) — no-ops until the final defender dies.
      this.maybeLiberateClearedSystem();
    }
  }

  /**
   * The player's own ship was destroyed in flight: play the one-shot death SFX
   * and trigger the GAME_OVER death. Routed here (from the scene's
   * `onPlayerDestroyed` callback) so the player death reuses the same FX/SFX seam
   * NPC kills use, without growing the scene controller.
   *
   * NOTE: the visual blast is seeded for parity with NPC kills but is NOT visible
   * today — `triggerPlayerDeath()` synchronously transitions to GAME_OVER, which
   * tears this scene (and the FX renderer) down the same frame the burst is
   * seeded, before any frame can render it. So the SFX is the player's death
   * feedback. Showing the blast would need the GAME_OVER transition deferred AND
   * the scene frozen for the animation (to avoid a brief "dead but interactive"
   * window) — a deferred follow-up, not done here. The burst is gated on
   * reducedMotion() inside the renderer.
   */
  handlePlayerDeath(): void {
    const physics = this.deps.getShipPhysics();
    if (physics) this.deathFx?.spawn(physics.shipX, physics.shipY);
    void this.gameEngine?.audio?.playSfx("explosion")?.catch(() => {});
    this.gameEngine?.triggerPlayerDeath();
  }

  /**
   * Pay the player a salvage payout for destroying a credit-carrying NPC — a
   * fraction of the wreck's cash, routed through the ledger via
   * {@link adjustPlayerCredits} (a balanced NPC-plunder → player transfer, whole
   * credits, never `player.credits +=`). A per-galaxy-day cap
   * ({@link GAME_BALANCE.pirateSalvageDailyCap}) stops respawning pirates being
   * an infinite credit faucet. No-ops on a wreck with no credits.
   */
  private awardSalvageCredits(npc: NpcShip): void {
    const engine = this.gameEngine;
    const player = engine?.player;
    const galaxy = engine?.galaxy;
    if (!engine || !player || !galaxy) return;
    if (!npc.credits || npc.credits <= 0) return;
    // The per-day cap bookkeeping lives on the long-lived GameEngine's shared
    // FlightSessionState (not this per-scene manager, rebuilt on every warp /
    // land→take-off) so the cap can't be reset back to the full budget by
    // leaving and re-entering a system within the same galaxy day. Prefer the
    // deps-provided session state (Task 5); fall back to the GameEngine
    // accessors for fake/host setups that don't wire it.
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

  /**
   * On entering a captured (hostile) system, tell the player they can free it by
   * destroying its garrison — surfaces the liberation counter-play so it's
   * discoverable. Presentation-only; a no-op for a faction-held system.
   */
  private maybeShowLiberationHint(): void {
    const galaxy = this.gameEngine?.galaxy;
    const systemId = this.gameEngine?.player?.currentSystemId;
    if (!galaxy || !systemId) return;
    if (typeof galaxy.isHostileSystem !== "function") return;
    if (!galaxy.isHostileSystem(systemId)) return;
    this.deps.showMessage(t("flight.liberationHint"), 0xffcc66);
  }

  /**
   * After a kill, free the current system if it was captured and the player has
   * now cleared its last hostile defender. The immediate, player-earned sibling
   * of the NpcSimulator "clear and hold" auto-liberate — works for both pirate-
   * and Overmind-captured systems via {@link GameEngine.liberateCurrentSystem}
   * (which gates on the garrison being fully cleared, so this no-ops otherwise).
   */
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

  // ---------------------------------------------------------------------------
  // Contact panel + actions
  // ---------------------------------------------------------------------------

  // The player-vs-NPC contact-panel action cluster now lives in
  // NpcInteractionController (constructed in the ctor). The good-pirate-rep/
  // shakedown-roll/hail forwarders moved on to CombatPursuitController.tickAggressor
  // (Task 6), wired directly to `this.interaction` in the ctor. The methods
  // below are the remaining 1:1 forwarders retained for the manager's
  // internal click wiring and the existing type-cast tests
  // (onNpcClick/onPayTribute/onFleeShakedown/onAttackNpc). No behaviour change.

  /** Open the contact panel for a clicked NPC ship. */
  private onNpcClick(npc: NpcShip): void {
    this.interaction.onNpcClick(npc);
  }

  /**
   * "Откупиться": pay the pirate's tribute through the bank bus. Public so the
   * existing `(manager as { onPayTribute }).onPayTribute(...)` tests keep working
   * now that the panel callbacks live in NpcInteractionController.
   */
  onPayTribute(npc: NpcShip): void {
    this.interaction.onPayTribute(npc);
  }

  /** "Бежать": attempt to out-run the shaking-down pirate (public for tests). */
  onFleeShakedown(npc: NpcShip): void {
    this.interaction.onFleeShakedown(npc);
  }

  /**
   * "Атаковать": engage now if in weapon range, else auto-follow to intercept.
   * Public so the existing overmindCombat/npcHostility type-cast tests keep
   * working now that the panel callbacks live in NpcInteractionController.
   */
  onAttackNpc(npc: NpcShip): void {
    this.interaction.onAttackNpc(npc);
  }

  // ---------------------------------------------------------------------------
  // Combat steering / pursuit
  // ---------------------------------------------------------------------------
  // The combat steering / orbit / chase-state cluster now lives in
  // CombatPursuitController (constructed in the ctor). The methods below are
  // 1:1 forwarders retained for the manager's internal callers (interaction
  // controller wiring + the scene's per-frame combat loop) and the existing
  // type-cast tests (launchCombatWithNpc/resolveNpcVsNpcCombat). No behaviour
  // change.

  /**
   * Remember the ship's current flight position on the GameEngine (transient,
   * unsaved) so a SPACE_FLIGHT re-entry resumes the ship right here instead of
   * edge-spawning it. Public so the existing type-cast test keeps working.
   */
  rememberFlightPos(): void {
    this.pursuit.rememberFlightPos();
  }

  /** Engage real-time in-flight combat against a specific NPC. */
  private launchCombatWithNpc(npc: NpcShip): void {
    this.pursuit.launchCombatWithNpc(npc);
  }

  /**
   * Auto-attack: while a follow target is set and the turn is running, close
   * to weapon range, then hold station and exchange fire. Called by the scene
   * every frame while the turn is running.
   */
  updateCombat(deltaTime: number): void {
    this.pursuit.updateCombat(deltaTime);
  }

  /**
   * Break off the combat auto-pursuit so a player-plotted route (to a planet,
   * or an explicit flee) takes over navigation. Called by the scene whenever
   * the player commits a manual route while a fight is engaged.
   */
  breakOffCombatPursuit(): void {
    this.pursuit.breakOffCombatPursuit();
  }

  // ---------------------------------------------------------------------------
  // Exploration encounters (derelict / anomaly / distress) — Task 3 wiring
  // ---------------------------------------------------------------------------

  /** True while the manager is engaged in an in-flight fight (test/Escape seam). */
  get inCombat(): boolean {
    return this.deps.isInCombat?.() ?? false;
  }

  /**
   * Roll a random exploration encounter for this system entry and, if one fires,
   * present its choice prompt. No-op when an OVERMIND-core or encounter overlay
   * already owns the screen, or before the galaxy/player are wired. Forwards to
   * {@link EncounterController} (Task 3).
   */
  private maybeShowEntryEncounter(): void {
    this.encounters.maybeShowEntryEncounter();
  }

  /**
   * Resolve the player's response to a presented encounter and apply it through
   * the existing seams: credits/cargo/rep, and a trap/ambush's combat by
   * spawning a hostile into the in-flight CombatModule. `rng` is injectable so
   * a test can drive a specific branch. Returns the outcome. Forwards to
   * {@link EncounterController} (Task 3) — public: exercised directly by
   * `encounters.test.ts`.
   */
  applyEncounterChoice(
    encounter: Encounter,
    choice: EncounterChoice,
    rng?: () => number,
  ): EncounterOutcome {
    return this.encounters.applyEncounterChoice(encounter, choice, rng);
  }

  /** Tear down the encounter prompt overlay (idempotent). Forwards to {@link EncounterController}. */
  closeEncounterPrompt(): void {
    this.encounters.closeEncounterPrompt();
  }

  /**
   * Spawn the OVERMIND-core final boss as a real in-flight combatant. Forwards
   * to {@link OvermindBossController} (Task 4) — not private: exercised
   * directly, via type-cast, by `combat/overmindCoreInflight.test.ts`.
   */
  spawnOvermindCoreCombatant(): void {
    this.overmind.spawnOvermindCoreCombatant();
  }

  /**
   * Present the two-choice prompt for a rolled encounter (engage / leave).
   * Forwards to {@link EncounterController} — public: exercised directly by
   * `encounters.test.ts`.
   */
  showEncounterPrompt(encounter: Encounter): void {
    this.encounters.showEncounterPrompt(encounter);
  }

  /**
   * Show a prompt when entering the OVERMIND core system so the player can
   * fight the final encounter. Forwards to {@link OvermindBossController}
   * (Task 4) — public: called by `SpaceFlightScene`.
   */
  showOvermindCorePrompt(): void {
    this.overmind.showOvermindCorePrompt();
  }
}
