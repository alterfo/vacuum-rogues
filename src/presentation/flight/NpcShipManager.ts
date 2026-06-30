import { Container, Graphics, Text } from "pixi.js";
import type { Renderer } from "../Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import type { ShipPhysics } from "@/systems/ShipPhysics";
import type { PlanetSprite } from "../PlanetSprite";
import { NpcShipSprite } from "../NpcShipSprite";
import type { SystemBounds } from "../NpcShipSprite";
import { ContactPanelManager } from "./ContactPanelManager";
import type { NpcShip } from "@/domain/NpcShip";
import { npcsPresentInSystem, NpcSimulator } from "@/systems/npc/NpcSimulator";
import {
  wantsToShakedownPlayer,
  shipCombatStrength,
  shakedownTribute,
  attemptFlee,
  acceptsHire,
  hireFee,
  hireGoal,
} from "@/systems/npc/NpcBrain";
import {
  isHostile,
  factionKindOf,
  mutuallyHostile,
  overmindCombatTargets,
  type RangedNpc,
} from "@/systems/npc/factionHostility";
import {
  PIRATE_FACTION_ID,
  grantPirateTributeRep,
} from "@/systems/galaxy/landingAccess";
import {
  payTribute,
  adjustPlayerCredits,
  GL_COUNTERPARTY,
} from "@/systems/banking/economy";
import { pirateSalvageAmount } from "@/systems/combat/pirateSalvage";
import { SeededRNG } from "@/utils/seededRNG";
import { deterministicNpcOffset } from "@/systems/npc/npcPlacement";
import { FlightCombatResolver } from "@/systems/FlightCombatResolver";
import { solveInterceptPoint } from "@/utils/intercept";
import {
  shouldReaim,
  smoothLeadPoint,
  shouldReplotRoute,
  avoidStarPath,
  type Point,
} from "@/utils/flightGeometry";
import {
  SYSTEM_GEOMETRY,
  GAME_BALANCE,
  ARTIFACT_DROP_CHANCE,
  ENCOUNTER_CONFIG,
  ENCOUNTER_OUTCOME_CONFIG,
} from "@/config/balance";
import { SceneType, NpcRole, QuestType, ResourceType } from "@/types";
import type { SpaceLootItem } from "@/types";
import { Faction } from "@/types/faction";
import { pickNpcDestination, type NpcBehaviorCtx } from "./npcBehavior";
import { hashStr } from "@/utils/hashStr";
import { scaledFont } from "@/utils/fontScale";
import { logger } from "@/utils/logger";
import {
  cargoCapacityOf,
  acquireUninstalledGear,
} from "@/systems/equipment/GearBridge";
import { gearById, gearIdForToken } from "@/systems/equipment/GearCatalog";
import { t } from "@/i18n/i18n";
import {
  commsContextFor,
  overmindGibberish,
} from "@/systems/comms/commsOptions";
import {
  rollEncounter,
  type Encounter,
  type EncounterType,
} from "@/systems/encounters/encounterGenerator";
import {
  resolveEncounter,
  type EncounterChoice,
  type EncounterOutcome,
} from "@/systems/encounters/encounterOutcome";
import {
  applyEncounterOutcome,
  encounterPlayerStateFor,
  encounterSystemView,
} from "@/systems/encounters/encounterFlight";
import type { FlightModule } from "./FlightModule";
import { ShipDeathFxRenderer } from "./shipDeathFxRenderer";

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
 * Galaxy/combatant id of the synthetic OVERMIND-core final boss. Killing the
 * sprite carrying this id in real-time in-flight combat wins the game
 * (see {@link NpcShipManager.handleInFlightDeath}).
 */
const OVERMIND_CORE_ID = "overmind_core";

/** Per-type copy + accent for the exploration-encounter prompt (Task 3). */
const ENCOUNTER_PROMPT_COPY: Record<
  EncounterType,
  { title: string; desc: string; engageLabel: string; color: number }
> = {
  derelict: {
    title: "ОБЛОМОК КОРАБЛЯ",
    desc: "Дрейфующий корпус судна.\nПристыковаться и обыскать его?",
    engageLabel: "[ Обыскать ]",
    color: 0xffaa33,
  },
  anomaly: {
    title: "АНОМАЛИЯ",
    desc: "Странное пространственное возмущение.\nПросканировать его?",
    engageLabel: "[ Сканировать ]",
    color: 0x33ddff,
  },
  distress: {
    title: "СИГНАЛ SOS",
    desc: "Кто-то зовёт на помощь.\nОткликнуться на сигнал бедствия?",
    engageLabel: "[ Откликнуться ]",
    color: 0x66ff88,
  },
};

/** Toast colour for a resolved encounter: good green, bad red, neutral grey. */
function encounterOutcomeColor(kind: EncounterOutcome["kind"]): number {
  switch (kind) {
    case "salvage":
    case "bonus":
    case "rescue":
      return 0x66ff88;
    case "trap":
    case "ambush":
    case "hazard":
      return 0xff5555;
    case "ignored":
    default:
      return 0xaaaaaa;
  }
}

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
  private readonly panels: ContactPanelManager;
  // Forwarding getter so tests that inspect internal state via type-cast can
  // still read the open panel's NPC id (state now lives in ContactPanelManager).
  private get contactNpcId(): string | null {
    return this.panels.openNpcId;
  }
  private overmindOverlay: Container | null = null;
  // Exploration-encounter prompt overlay (derelict/anomaly/distress) + the
  // encounter it is presenting; transient, ephemeral (no save state).
  private encounterOverlay: Container | null = null;
  private activeEncounter: Encounter | null = null;
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
  // ms accumulated toward the next in-flight NPC-vs-NPC (cross-faction) fire
  // round — the Overmind-vs-pirate brawl resolves on the same cadence as the
  // player's combat fire interval. Reset each time a round fires.
  private npcCrossfireTimer = 0;
  // Pirate ids already rolled for a "кошелёк или жизнь" shakedown this encounter,
  // so a passing pirate demands tribute at most once (the roll is deterministic
  // and must not re-fire every frame it sits inside scanner range).
  private readonly shakedownEvaluated = new Set<string>();
  // Final destination of the last route this manager plotted (the lead point),
  // so a drifting target can be re-aimed against the true endpoint rather than
  // the immediate (possibly sun-avoidance) waypoint ShipPhysics exposes.
  private lastAimX = 0;
  private lastAimY = 0;
  /** Lead-drift (world px) before a chase/approach re-plots its course. */
  private readonly REAIM_DRIFT_PX = 30;
  // Smooth chase steering (smooth-auto-follow Task 3): the in-combat pursuit and
  // the «Приблизиться» approach steer continuously toward a *smoothed* lead point
  // via the ShipPhysics turn-rate limiter instead of re-plotting a curved spline
  // every frame. The smoothed point and the id it tracks are reset when the chase
  // target changes so a fresh leg never lags from the previous target's lead.
  private smoothedLead: Point | null = null;
  private steerTargetId: string | null = null;
  // True while the chase is bowing around the star: the *first* frame the direct
  // lead-line becomes blocked must re-plot the curved bypass immediately (a safety
  // re-plot can't wait on the target-drift gate — the clear-shot nudge keeps
  // `lastAim` glued to the lead, so that gate never trips on a steady-heading
  // target). A sustained block then throttles refresh re-plots via shouldReplotRoute.
  private steerStarAvoiding = false;
  /** Monotonic ms clock for the curved-re-plot hysteresis (advanced in updateCombat). */
  private chaseClockMs = 0;
  /** Last curved-route re-plot timestamp (ms on {@link chaseClockMs}). */
  private lastReplotMs = -Infinity;
  /**
   * EMA + max-step smoothing for the noisy per-frame lead point (matches the
   * Task 2 `chaseSteering.test` config: maxStepPx ≤ the 8px smoothness bound).
   */
  private readonly LEAD_SMOOTHER = { alpha: 0.25, maxStepPx: 6 } as const;
  /** Min ms between curved star-avoidance re-plots (hysteresis throttle). */
  private readonly REPLOT_MIN_INTERVAL_MS = 500;

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

  // Ship-death explosion FX (pure emitter + pooled particle renderer). Built in
  // initialize() — after the scene's clearGameLayer — so its particle layer
  // survives, advanced each frame (real elapsed time, like loot) and torn down in
  // destroy(). A burst is gated on reducedMotion() inside the renderer.
  private deathFx: ShipDeathFxRenderer | null = null;

  private readonly WEAPON_RANGE = GAME_BALANCE.weaponRange;
  // Combat strafe radius: while engaged, orbit the target at this standoff —
  // comfortably inside WEAPON_RANGE — so auto-fire always has a target in range
  // (the orbit fix). 0.6 × 240 = 144px.
  private readonly COMBAT_ORBIT_RANGE = GAME_BALANCE.weaponRange * 0.6;
  // Anti-spin floor (playtest 2026-06-27): well inside the orbit radius the
  // tangential (circling) steering component is faded out so a target nearly on
  // top of the ship makes it back STRAIGHT out to range instead of spiralling
  // tightly (several full turns/sec → "ship spins on its axis + camera circles").
  // The tangent fades fully back in by this distance, so the steady orbit at
  // COMBAT_ORBIT_RANGE is unchanged. 0.5 × 144 = 72px.
  private readonly COMBAT_ORBIT_MIN_RANGE =
    GAME_BALANCE.weaponRange * 0.6 * 0.5;
  // The combat orbit steers toward a carrot projected this far ahead along the
  // desired heading. It must exceed ShipPhysics' final-leg stopping distance so the
  // ship never decelerates or stops mid-orbit (it would fall behind the target and
  // slingshot out) — only the heading matters; the ship keeps cruising.
  private readonly COMBAT_ORBIT_CARROT = 2000;
  // Break-off (Task 3): set when the player commits a manual route mid-fight (to a
  // planet / to flee). While set, the combat auto-pursuit yields navigation so the
  // ship flies the player's course instead of being pinned in its strafe orbit. It
  // clears the instant the player's route completes (ship stops) — pursuit then
  // re-engages only if a hostile is still in range — and on a fresh engagement /
  // explicit retarget (the player chose to fight again).
  private pursuitSuspended = false;
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
    this.panels = new ContactPanelManager({
      uiLayer,
      getScreenSize: () => ({
        width: renderer.app.screen.width,
        height: renderer.app.screen.height,
      }),
    });
  }

  // ---------------------------------------------------------------------------
  // FlightModule lifecycle
  // ---------------------------------------------------------------------------

  /** Create NPC ship sprites for every NPC currently present in this system. */
  initialize(): void {
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
    this.updateLoot(deltaTime);
    // Floating drops are collected by flying near them (hands-on proximity), and
    // a gravity tractor extends the reach — every frame, including after combat
    // ends and the ship is parked, so a kill's drops are always collectible.
    this.applyLootPickup();

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
      // Garrison aggressors maneuver against the player ship: refresh their live
      // pursuit target (position + the player's CURRENT speed, which drives the
      // over-matched break-off check — a parked player isn't fleeing, so the
      // aggressor closes in) before advancing them, then open in-flight combat
      // once they close to attack range (no CombatScene hop — the scene's
      // CombatModule resolves the fight; Tasks 11–14).
      if (sprite.aggressive && physics) {
        // Good pirate reputation leaves the player alone (no attack, no ransom):
        // an aggressive pirate breaks off pursuit before it can shake the player
        // down or open fire. The good-rep exemption lives in the factionHostility
        // matrix (single source of truth); reactive aggression after the player
        // attacks first is handled elsewhere (markHostile), not gated here.
        if (
          sprite.npc.role === NpcRole.PIRATE &&
          this.playerIsGoodWithPirates() &&
          !(this.deps.isCombatant?.(sprite) ?? false)
        ) {
          // Good pirate rep buys peace — UNLESS the fight is already joined (you
          // attacked it / it's an active combatant), in which case it keeps
          // pursuing instead of breaking off mid-engagement.
          sprite.setAggressive(false);
          this.npcAnchorPlanet.delete(sprite);
        } else {
          const dx = sprite.x - physics.shipX;
          const dy = sprite.y - physics.shipY;
          const distSq = dx * dx + dy * dy;
          // "Кошелёк или жизнь" (Task 2): a hostile pirate that closes to talking
          // (scanner) range may open a shakedown hail BEFORE weapon range instead
          // of attacking outright. Rolled once per pirate, deterministically. A
          // positive roll opens the contact panel in pirate-shakedown context and
          // halts flight so the demand interrupts the player.
          if (
            sprite.npc.role === NpcRole.PIRATE &&
            !this.shakedownEvaluated.has(sprite.npc.id) &&
            distSq <= this.SCANNER_RANGE * this.SCANNER_RANGE
          ) {
            this.shakedownEvaluated.add(sprite.npc.id);
            if (this.rollShakedown(sprite.npc)) {
              this.openShakedownHail(sprite.npc);
              return; // turn halted by the hail — stop advancing NPCs this frame
            }
          }
          // Escape (Task 3): a faster player who has opened beyond the escape range
          // breaks the chase — the out-run aggressor gives up pursuit this
          // encounter (engaged combatants are pruned at the same range by
          // CombatModule). A parked/slower player never out-runs it, so the
          // aggressor keeps closing.
          if (
            distSq > this.COMBAT_ESCAPE_RANGE * this.COMBAT_ESCAPE_RANGE &&
            physics.canOutrun(sprite.cruiseSpeed)
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
      }
      // NPC-vs-NPC engagement: a ship NOT hunting the player closes on its
      // nearest hostile NPC so cross-faction foes visibly fight instead of
      // coexisting — e.g. a pirate intruder caught in an Overmind-held system
      // engages the garrison rather than drifting past it. Player-aggressors keep
      // chasing the player (their NPC target is cleared so it never competes).
      if (sprite.aggressive) {
        sprite.clearNpcCombatTarget();
      } else {
        const enemy = this.nearestNpcEnemy(sprite);
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
   * The nearest live NPC sprite this one is mutually hostile to AND within
   * engagement (scanner) range — the steering target that makes hostile factions
   * actively fight in-flight instead of drifting past each other. Scoped to
   * engagements INVOLVING the Overmind (the only pair {@link resolveNpcVsNpcCombat}
   * resolves damage for), so a steered pair always actually trades fire rather
   * than orbiting silently; the OVERMIND core (the player's duel target) is
   * excluded on both sides. Pure read over the live sprites (no RNG/I/O).
   */
  private nearestNpcEnemy(sprite: NpcShipSprite): NpcShipSprite | null {
    if (sprite.npc.id === OVERMIND_CORE_ID) return null;
    const selfKind = factionKindOf(sprite.npc);
    let best: NpcShipSprite | null = null;
    let bestD2 = this.SCANNER_RANGE * this.SCANNER_RANGE;
    for (const other of this.npcSprites) {
      if (other === sprite || other.isGone()) continue;
      if (other.npc.id === OVERMIND_CORE_ID) continue;
      const otherKind = factionKindOf(other.npc);
      // Only Overmind-involving pairs have a damage path — don't steer two ships
      // into a silent non-fight.
      if (selfKind !== "overmind" && otherKind !== "overmind") continue;
      if (!mutuallyHostile(selfKind, otherKind, { pirateRep: 0 })) continue;
      const dx = other.x - sprite.x;
      const dy = other.y - sprite.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = other;
      }
    }
    return best;
  }

  /**
   * In-flight NPC-vs-NPC combat (Task 5): the Overmind's indiscriminate aggression
   * plays out as a real cross-faction brawl in the player's system, independent of
   * the player. Every {@link GAME_BALANCE.combatFireIntervalMs} each present
   * Overmind sprite fires on the nearest **mutually-hostile** sprite within weapon
   * range (a strayed pirate in a captured system, a liberating ranger…) selected
   * through the shared hostility matrix ({@link overmindCombatTargets}, the single
   * source of truth). Damage is mutual — the foe shoots back — and a lethal round
   * routes through the normal in-flight death path ({@link handleInFlightDeath}:
   * loot drop + domain removal). Scoped to Overmind attackers and gated on weapon
   * range, so a system with no Overmind present is wholly unperturbed. Peaceful
   * kinds (traders) are never mutual-hostile with the Overmind, so the brawl stays
   * between armed factions; the Overmind's aggression toward the player is the
   * separate garrison-aggro path above.
   */
  private resolveNpcVsNpcCombat(deltaTime: number): void {
    // The active pause freezes the WHOLE fight — NPC-vs-NPC crossfire too, not
    // just the player ship and the per-frame movement step above. Honour the
    // single `combatPause.paused` signal directly (the same gate the movement
    // advance uses) rather than depending on the scene folding pause into
    // `isTurnRunning`, and bail BEFORE accruing the fire timer so unpause can't
    // unleash a backed-up volley (the timer holds its pre-pause value).
    if (this.deps.isPaused?.()) return;
    this.npcCrossfireTimer += deltaTime;
    if (this.npcCrossfireTimer < GAME_BALANCE.combatFireIntervalMs) return;
    this.npcCrossfireTimer = 0;
    if (this.npcSprites.length < 2) return;

    // Exclude the OVERMIND core: it is the player's duel target (engaged via
    // CombatModule) and killing it wins the game in handleInFlightDeath. Letting
    // a strayed pirate / liberating ranger kill it via NPC-vs-NPC crossfire would
    // fire a false-positive victory before the player ever lands a shot.
    const combatants: RangedNpc[] = this.npcSprites
      .filter((s) => s.npc.id !== OVERMIND_CORE_ID)
      .map((s) => ({
        id: s.npc.id,
        kind: factionKindOf(s.npc),
        x: s.x,
        y: s.y,
      }));
    const engagements = overmindCombatTargets(combatants, this.WEAPON_RANGE, {
      pirateRep: 0,
    });
    if (engagements.size === 0) return;

    const byId = new Map(this.npcSprites.map((s) => [s.npc.id, s]));
    const killed = new Set<NpcShipSprite>();
    for (const [attackerId, targetId] of engagements) {
      const attacker = byId.get(attackerId);
      const target = byId.get(targetId);
      if (!attacker || !target) continue;
      if (killed.has(attacker) || killed.has(target)) continue;
      // Mutual damage — the Overmind strikes and the foe fires back.
      target.npc.hullHP = Math.max(0, target.npc.hullHP - attacker.npc.damage);
      attacker.npc.hullHP = Math.max(
        0,
        attacker.npc.hullHP - target.npc.damage,
      );
      if (target.npc.hullHP <= 0) killed.add(target);
      if (attacker.npc.hullHP <= 0) killed.add(attacker);
    }
    // Resolve kills after the round so the loot/removal splice never disturbs the
    // engagement iteration. These are NPC-vs-NPC kills, not the player's, so they
    // drop loot + remove the ship but pay NO salvage and grant NO liberation
    // (killedByPlayer = false) — those rewards are earned by the player's own shots.
    for (const sprite of killed) {
      this.handleInFlightDeath(sprite, Math.random, false);
    }
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
    this.deathFx?.destroy(); // removes + destroys its particle layer
    this.deathFx = null;
    this.panels.close();
    this.followNpcId = null;
    this.approachNpcId = null;
    this.pursuitSuspended = false;
    this.shakedownEvaluated.clear();
    if (this.overmindOverlay) {
      if (!this.overmindOverlay.destroyed) {
        this.overmindOverlay.destroy({ children: true });
      }
      this.overmindOverlay = null;
    }
    if (this.encounterOverlay) {
      if (!this.encounterOverlay.destroyed) {
        this.encounterOverlay.destroy({ children: true });
      }
      this.encounterOverlay = null;
      this.activeEncounter = null;
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
    // Rebuild the open encounter prompt at the new size (it holds scaledFont text).
    if (this.activeEncounter && this.encounterOverlay) {
      const enc = this.activeEncounter;
      if (!this.encounterOverlay.destroyed) {
        this.encounterOverlay.destroy({ children: true });
      }
      this.encounterOverlay = null;
      this.activeEncounter = null;
      this.showEncounterPrompt(enc);
    }
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
    return (
      this.panels.hasOpenModal() ||
      this.overmindOverlay !== null ||
      this.encounterOverlay !== null
    );
  }

  /** True while the exploration-encounter prompt is open (Escape close-chain). */
  get isEncounterPromptOpen(): boolean {
    return this.encounterOverlay !== null;
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
    if (this.overmindOverlay) {
      const ov = this.overmindOverlay;
      this.overmindOverlay = null;
      // Guard: a scene transition may run clearUILayer() (which destroys this
      // overlay) before the microtask fires — destroying it twice throws.
      queueMicrotask(() => {
        if (!ov.destroyed) ov.destroy({ children: true });
      });
    }
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
          (npc.isAggressive() &&
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
    killedByPlayer = true,
  ): void {
    const wasOvermindCore = sprite.npc.id === OVERMIND_CORE_ID;
    // Punch the kill with a brief explosion at the wreck (gated on reduced motion
    // inside the renderer) + a one-shot SFX — captured before the sprite is torn
    // down. Fires for EVERY death (player kill, crossfire, the core) so any ship
    // blowing up reads + sounds the same.
    this.deathFx?.spawn(sprite.x, sprite.y);
    void this.gameEngine?.audio?.playSfx("explosion")?.catch(() => {});
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
    // The per-day cap bookkeeping lives on the long-lived GameEngine (not this
    // per-scene manager, rebuilt on every warp / land→take-off) so the cap can't
    // be reset back to the full budget by leaving and re-entering a system within
    // the same galaxy day.
    const day = galaxy.gameDays ?? 0;
    if (day !== engine.salvageDay) {
      engine.salvageDay = day;
      engine.salvagedToday = 0;
    }
    const award = pirateSalvageAmount(
      npc.credits,
      GAME_BALANCE.pirateSalvageFraction,
      engine.salvagedToday ?? 0,
      GAME_BALANCE.pirateSalvageDailyCap,
    );
    if (award <= 0) return;
    engine.salvagedToday = (engine.salvagedToday ?? 0) + award;
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
   * Loot auto-pickup (Task 6: "the yellow dot can't be collected" fix). A
   * floating drop within the hands-on {@link GAME_BALANCE.lootPickupRadius} is
   * collected **without** any gear; a fitted gravity tractor *extends* the reach
   * (the effective radius is the max of the base radius and `gravTractorRange`),
   * so the tractor is an upgrade rather than the only pickup path. Each item is
   * collected at most once (removed in place — no double-collect).
   *
   * A drop whose `moduleId` resolves to **real catalog gear** ({@link
   * gearIdForToken}: a fitted-gear drop like `eq_tank`/`grav_tractor_1`, or an
   * NPC `loadoutSummary` display name like «Топливный бак») lands in the player's
   * **gear inventory** (`ownedGearIds` via {@link acquireUninstalledGear}), not
   * salvaged to metal — it shows up in the hangar СКЛАД. Gear is **not** resource
   * cargo, so it bypasses the resource-hold capacity gate (`ownedGearIds` has no
   * hard cap). Non-gear salvage **is** resource cargo: Overmind artifacts →
   * ARTIFACTS, everything else (junk-salvage fallbacks) → METALS, and these honour
   * the loadout cargo capacity — a full hold leaves them in space (logs a warning)
   * but still collects gear later in the list.
   */
  private applyLootPickup(): void {
    if (this.spaceLoot.length === 0) return;
    const loadout = this.gameEngine?.playerLoadout;
    const player = this.gameEngine?.player;
    const physics = this.deps.getShipPhysics();
    if (!loadout || !player || !physics) return;
    const stats = loadout.derivedStats();
    const baseRadius = GAME_BALANCE.lootPickupRadius;
    // Hands-on proximity always applies; a gravity tractor only ever widens it.
    const range = Math.max(baseRadius, stats.gravTractorRange);
    if (range <= 0) return;
    const rangeSq = range * range;
    const baseSq = baseRadius * baseRadius;
    // Hold size is the loadout's cargo (authoritative), not the legacy getter.
    const capacity = cargoCapacityOf(loadout);
    for (let i = this.spaceLoot.length - 1; i >= 0; i--) {
      const item = this.spaceLoot[i];
      const dx = item.x - physics.shipX;
      const dy = item.y - physics.shipY;
      const distSq = dx * dx + dy * dy;
      if (distSq > rangeSq) continue; // out of pickup reach
      // Hands-on grab vs. tractor pull get distinct flavour; both are localized.
      const handsOn = distSq <= baseSq;

      // Real gear → the gear inventory (not metal). No resource-hold gate: gear
      // isn't resource cargo and `ownedGearIds` is uncapped, so it's never
      // dropped on the floor for a full *resource* hold.
      const gearId = item.moduleId ? gearIdForToken(item.moduleId) : undefined;
      if (gearId) {
        acquireUninstalledGear(player, gearId);
        this.removeLootAt(i); // single collect — splice + dispose the dot
        const label = gearById(gearId)?.name ?? gearId;
        this.deps.showMessage(
          handsOn
            ? t("flight.lootPickup", { item: label })
            : t("flight.lootTractor", { item: label }),
          0xffdd33,
        );
        logger.info(`Picked up gear loot ${item.id} (${gearId})`);
        continue;
      }

      // Non-gear salvage is resource cargo → honour the hold capacity.
      const used = player.inventory.resources.reduce(
        (sum, r) => sum + r.amount,
        0,
      );
      if (used >= capacity) {
        logger.warn("Loot pickup: hold full, drop left in space");
        continue; // hold won't free up this frame — skip, but keep collecting gear
      }
      const type = item.artifactId
        ? ResourceType.ARTIFACTS
        : ResourceType.METALS;
      player.inventory.addResource(type, 1);
      this.removeLootAt(i); // single collect — splice + dispose the dot (no leak)
      const label = item.artifactId
        ? t("flight.lootArtifact")
        : (item.moduleId ?? t("flight.lootModule"));
      this.deps.showMessage(
        handsOn
          ? t("flight.lootPickup", { item: label })
          : t("flight.lootTractor", { item: label }),
        0xffdd33,
      );
      logger.info(`Picked up loot ${item.id} (${type})`);
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
      // Clicking an enemy mid-fight is an explicit "engage this one" — drop any
      // break-off so the auto-pursuit resumes toward the (re)selected target.
      this.pursuitSuspended = false;
      return;
    }
    if (this.deps.isTurnRunning()) return;

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
    this.panels.open(
      npc,
      {
        onHail: () => this.onHailNpc(npc),
        onTrade: () => this.onTradeNpc(npc),
        onAttack: () => this.onAttackNpc(npc),
        onApproach: () => this.onApproachNpc(npc),
        onClose: () => this.panels.close(),
        onHire: () => this.offerHireContract(npc, "hire"),
        onAlly: () => this.offerHireContract(npc, "ally"),
      },
      inRange,
      scanPower,
    );

    // Hailing an Overmind ("Предтечи") craft is futile: it answers with nonsense
    // and the panel surfaces no actionable options (commsOptionsFor → []). Emit a
    // gibberish transmission so the dead-end reads as alien static, not a bug.
    if (inRange && commsContextFor(npc) === "overmind") {
      const day = this.gameEngine?.galaxy?.gameDays ?? 0;
      const line = overmindGibberish(
        new SeededRNG(`overmind:${npc.id}:${day}`),
      );
      this.deps.showMessage(`${npc.name}: «${line}»`, 0xaa66ff);
    }
  }

  /**
   * The player's current combat strength (hull + shields + weapon damage), used
   * to gauge how a passing pirate sizes the player up before a shakedown. Reads
   * the live ship pools + the loadout's derived weapon damage; 0 when no ship.
   */
  private playerCombatStrength(): number {
    const ship = this.gameEngine?.player?.ship;
    if (!ship) return 0;
    const damage =
      this.gameEngine?.playerLoadout?.derivedStats().weaponDamage ?? 0;
    return shipCombatStrength({
      hullHP: ship.hullHP,
      shields: ship.shields,
      damage,
    });
  }

  /**
   * The player's current reputation with the pirate faction. A player at/above
   * the good-pirate-rep threshold is left alone by pirates (no attack, no ransom)
   * — see {@link playerIsGoodWithPirates} and {@link rollShakedown}. Optional
   * chaining tolerates a mock player without the method (treated as rep 0).
   */
  private playerPirateRep(): number {
    return this.gameEngine?.player?.getReputation?.(PIRATE_FACTION_ID) ?? 0;
  }

  /**
   * Whether the player has good enough pirate reputation to be left alone: the
   * {@link isHostile} matrix (single source of truth) reports a pirate as
   * non-hostile to the player. Drives the in-flight attack exemption.
   */
  private playerIsGoodWithPirates(): boolean {
    return !isHostile("pirate", "player", {
      pirateRep: this.playerPirateRep(),
    });
  }

  /**
   * Roll the pure {@link wantsToShakedownPlayer} decision for a pirate, seeded
   * deterministically by ship id + galaxy day so the outcome is stable for the
   * encounter (and reproducible in tests / replays). A player with good pirate
   * reputation is exempt — the decision short-circuits to `false`.
   */
  private rollShakedown(npc: NpcShip): boolean {
    const day = this.gameEngine?.galaxy?.gameDays ?? 0;
    const rng = new SeededRNG(`shakedown:${npc.id}:${day}`);
    return wantsToShakedownPlayer(
      npc,
      this.playerCombatStrength(),
      this.playerPirateRep(),
      rng,
    );
  }

  /**
   * Open the universal comms window in pirate-shakedown context ("Кошелёк или
   * жизнь!") and halt flight so the demand interrupts the player. The panel
   * surfaces the three responses: Откупиться (pay tribute → the pirate
   * disengages), Атаковать (refuse → fight), and Бежать (flee → escape-by-speed
   * roll). Pay/flee are resolved here (Task 3); attack reuses {@link onAttackNpc}.
   */
  private openShakedownHail(npc: NpcShip): void {
    this.deps.endTurn(); // freeze flight so the hail can't be flown past
    const scanPower =
      this.gameEngine?.playerLoadout?.derivedStats().scanPower ?? 0;
    this.panels.open(
      npc,
      {
        onHail: () => this.onHailNpc(npc),
        onTrade: () => this.onTradeNpc(npc),
        onAttack: () => this.onAttackNpc(npc),
        onApproach: () => this.onApproachNpc(npc),
        onClose: () => this.panels.close(),
        onPayTribute: () => this.onPayTribute(npc),
        onFlee: () => this.onFleeShakedown(npc),
      },
      true, // the pirate has closed to talking distance — full readout + options
      scanPower,
      "pirate-shakedown",
    );
    this.deps.showMessage(`${npc.name}: «Кошелёк или жизнь!»`, 0xff5555);
  }

  /**
   * "Откупиться": pay the pirate's tribute through the bank bus (a balanced
   * player → pirate transfer — never a direct credit write) and the pirate
   * disengages, leaving the player alone this encounter. The tribute is a pure
   * function of the player's purse ({@link shakedownTribute}).
   *
   * Buying off a shakedown is also the **repeatable recovery path** for pirate
   * standing: it grants a small, capped +pirate-rep ({@link grantPirateTributeRep}),
   * so a player whose pirate rep fell to −50 can climb back to landable on
   * pirate-captured systems over several (costly) payoffs.
   */
  private onPayTribute(npc: NpcShip): void {
    const player = this.gameEngine?.player;
    this.panels.close();
    if (!player) return;
    const tribute = shakedownTribute(player.credits);
    payTribute(
      this.gameEngine?.bank,
      player,
      npc,
      tribute,
      t("flight.tributeReason", { name: npc.name }),
    );
    // Pirate standing is *bought*, not free: only a real (non-zero) payoff
    // raises rep, so a penniless player (tribute === 0) can't farm +rep for
    // nothing. The pirate still disengages either way.
    const gainedRep = tribute > 0;
    if (gainedRep) grantPirateTributeRep(player);
    this.disengagePirate(npc);
    this.deps.showMessage(
      gainedRep
        ? t("flight.tributePaidRep", { amount: tribute, name: npc.name })
        : t("flight.tributePaid", { amount: tribute, name: npc.name }),
      0xffee88,
    );
  }

  /**
   * "Бежать": attempt to out-run the pirate. The escape is a pure
   * {@link attemptFlee} roll on the player's vs the pirate's speed, seeded
   * deterministically by ship id + galaxy day. Success → the pirate breaks off;
   * failure → the pirate runs you down and opens fire.
   */
  private onFleeShakedown(npc: NpcShip): void {
    this.panels.close();
    const physics = this.deps.getShipPhysics();
    const sprite = this.npcSprites.find((s) => s.npc.id === npc.id);
    const playerSpeed = physics?.getMaxSpeed() ?? 0;
    const day = this.gameEngine?.galaxy?.gameDays ?? 0;
    const escaped = attemptFlee(
      playerSpeed,
      npc.speed,
      new SeededRNG(`flee:${npc.id}:${day}`),
    );
    if (escaped) {
      this.disengagePirate(npc);
      this.deps.showMessage(`Вы оторвались от ${npc.name}!`, 0x88ff88);
      return;
    }
    // Caught — the pirate runs you down and opens fire. Engage in-flight combat
    // AND resume the turn that openShakedownHail froze via endTurn(): CombatModule
    // .update is gated on isTurnRunning, so without re-arming it the fight would sit
    // dormant (no NPC fire, no active-pause overlay) until the player manually
    // pressed Play. Closing on the pirate through executeRouteTo re-arms the turn
    // and tracks the (moving) mark — the same path the "refuse → Атаковать" button
    // uses when the target is out of weapon range.
    this.deps.showMessage(`Уйти не удалось — ${npc.name} атакует!`, 0xff5555);
    if (sprite) {
      this.followNpcId = npc.id;
      this.deps.startInFlightCombat?.(sprite);
      this.deps.selectCombatTarget?.(sprite);
      this.deps.executeRouteTo(sprite.x, sprite.y);
    }
  }

  /**
   * A pirate breaks off its shakedown (paid off or out-run): drop its pursuit
   * aggression and orbit anchor so it stops chasing the player this encounter.
   */
  private disengagePirate(npc: NpcShip): void {
    const sprite = this.npcSprites.find((s) => s.npc.id === npc.id);
    if (!sprite) return;
    sprite.setAggressive(false);
    this.npcAnchorPlanet.delete(sprite);
  }

  /**
   * "Приблизиться": plot a course that LEADS the moving target so the ship
   * closes to firing range aiming where it will be, not where it is, without
   * opening fire (US-070 #2; lead added playtest4 C). The player can then
   * re-open the panel to hail/trade or attack.
   */
  private onApproachNpc(npc: NpcShip): void {
    const sprite = this.npcSprites.find((s) => s.npc.id === npc.id);
    this.panels.close();
    if (!sprite || !this.deps.getShipPhysics()) return;
    this.followNpcId = null; // approach only — not an attack
    this.approachNpcId = npc.id; // …but keep tracking it so the course corrects
    this.steerTargetId = null; // fresh chase leg — reset the lead smoother
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
    this.panels.close();

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
   * "Нанять" / "Союз": offer the hailed ship credits to turn on the player's
   * current threat. Both reduce to a merc contract against the nearest ship that
   * is openly hostile to the player (the target you actually need help with) —
   * they differ only in framing. The player pays the ship's {@link hireFee}
   * asking price; an accepted contract pays through the bank bus (a balanced
   * player → NPC transfer, never a direct credit write) and {@link hireGoal}
   * retargets the hired ship to hunt the mark. Declined when no hostile target is
   * present, the ship won't attack its own faction, or the player can't afford
   * the fee.
   */
  private offerHireContract(npc: NpcShip, mode: "hire" | "ally"): void {
    this.panels.close();
    const target = this.nearestHostileNpc(npc.id);
    if (!target) {
      this.deps.showMessage(
        "Рядом нет враждебных целей для контракта.",
        0xffaa00,
      );
      return;
    }
    // acceptsHire still gates the meaningful declines (won't betray its own
    // faction / itself / won't take the coin while hostile to the player). The
    // price branch is always satisfied here since the offer equals the fee.
    if (!acceptsHire(npc, hireFee(target), target)) {
      this.deps.showMessage(`${npc.name}: «Своих не трогаю.»`, 0xffaa00);
      return;
    }
    // Known Limitation #1 (plan 20260619-universal-comms-and-pirate-encounters):
    // the simulator has no NPC-vs-NPC engagement path yet, so a hire/ally contract
    // cannot actually be delivered. Do NOT debit the player (via payHire) for an
    // effect that will not occur — the previous code charged the full fee for an
    // inert contract, a money-loss bug. Payment is deferred until the merc can
    // really engage the mark. The hunt goal is still recorded for that future
    // path (harmless if the daily tick later recomputes it).
    //
    // NOTE: do NOT stash the mark in `npc.activeQuestTarget` — that field is a
    // *system* id consumed by NpcSimulator's RANGER questing (completion compares
    // it to `currentSystemId`; a ranger only accepts a new quest while it is null,
    // and it persists via the save schema). Writing a *ship* id here permanently
    // wedges a hired ranger out of questing. `npc.goal = hireGoal(target)` already
    // records the contract for any future NPC-vs-NPC engagement.
    npc.goal = hireGoal(target);
    const verb = mode === "ally" ? "готов вступить в бой" : "берёт контракт";
    this.deps.showMessage(
      `${npc.name} ${verb} против ${target.name} — бой между кораблями пока не поддержан, плата не взята.`,
      0xffcc44,
    );
  }

  /**
   * The nearest NPC openly hostile to the player (excluding `excludeId`), by
   * world distance to the player ship — the threat a hired/allied ship is paid to
   * deal with. Null when no hostile ship is present or the player ship is absent.
   */
  private nearestHostileNpc(excludeId: string): NpcShip | null {
    const physics = this.deps.getShipPhysics();
    if (!physics) return null;
    let best: NpcShip | null = null;
    let bestDist = Infinity;
    for (const sprite of this.npcSprites) {
      if (sprite.npc.id === excludeId || !sprite.npc.isAggressive()) continue;
      const d = Math.hypot(sprite.x - physics.shipX, sprite.y - physics.shipY);
      if (d < bestDist) {
        bestDist = d;
        best = sprite.npc;
      }
    }
    return best;
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
    this.panels.close();
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
   * sprite heading (the hull faces its direction of travel) and the ship's own
   * class cruise speed (`sprite.cruiseSpeed`) — basic ships drift slower than the
   * interceptor tier, so the lead must not over-predict a slow trader's travel.
   * Falls back to the NPC's current position when no lead solves.
   */
  private npcLeadPoint(sprite: NpcShipSprite): { x: number; y: number } {
    const physics = this.deps.getShipPhysics();
    if (!physics) return { x: sprite.x, y: sprite.y };
    const heading = sprite.container.rotation;
    const v = sprite.cruiseSpeed;
    const vx = Math.cos(heading) * v;
    const vy = Math.sin(heading) * v;
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
   * unsaved) so a SPACE_FLIGHT re-entry resumes the ship right here instead of
   * edge-spawning it (applyEntrySpawn fallback). Retained as a re-entry helper
   * after the hex CombatScene round-trip was removed (combat is now real-time
   * in-flight, so the boss no longer needs to stash position before a hop).
   */
  rememberFlightPos(): void {
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
    this.steerTargetId = null; // fresh chase leg — reset the lead smoother
    this.pursuitSuspended = false; // fresh engagement re-arms the auto-pursuit
    // A player-initiated engagement makes the target an active aggressor so it
    // auto-closes on the player and holds weapon range (Task 3) instead of
    // orbiting its planet / drifting. Garrison + shakedown paths already flag it.
    sprite.setAggressive(true);
    this.deps.startInFlightCombat?.(sprite);
    this.deps.selectCombatTarget?.(sprite);
    this.deps.onPlayerEngagesCombat?.(sprite); // pause immediately — no orbit before dialog
  }

  /**
   * Auto-attack: while a follow target is set and the turn is running, close to
   * weapon range, then hold station and exchange fire until the target is
   * destroyed, the player drops below 30% hull, or the target is lost.
   * Decision logic delegated to FlightCombatResolver for testability.
   */
  updateCombat(deltaTime: number): void {
    const physics = this.deps.getShipPhysics();
    if (!physics) return;
    // Advance the chase clock that throttles curved star-avoidance re-plots
    // (smooth-auto-follow Task 3 hysteresis).
    this.chaseClockMs += deltaTime;

    // Real-time combat tracking (Task 3): while a fight is engaged, auto-track
    // the live combat target every frame — close to weapon range and hold it
    // without a fresh "Ход". Distinct from the pre-combat chase resolver below
    // (which brings an out-of-range target INTO the fight); once engaged this
    // branch owns the player's maneuvering.
    if (this.deps.isInCombat?.()) {
      this.updateCombatPursuit(physics);
      return;
    }

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
        // Losing the chase target stops the running turn — otherwise the calendar
        // keeps advancing on a chase with nothing left to pursue (mirrors the
        // shakedown-hail freeze in openShakedownHail).
        this.deps.endTurn();
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
   * Break off the combat auto-pursuit so a player-plotted route (to a planet, or
   * an explicit flee) takes over navigation instead of the ship being pinned in
   * its strafe orbit (Task 3). The scene calls this whenever the player commits a
   * manual route while a fight is engaged. The override is self-clearing: once the
   * route completes (ship stops) {@link updateCombatPursuit} resumes pursuit — and
   * a fresh engagement / explicit retarget clears it immediately (the player chose
   * to fight again). Combat (auto-fire) keeps resolving throughout; only the
   * auto-maneuvering yields.
   */
  breakOffCombatPursuit(): void {
    this.pursuitSuspended = true;
  }

  /**
   * Real-time combat auto-track (Task 3): while a fight is engaged, keep the
   * player ship inside weapon range of the live combat target without a fresh
   * "Ход". Outside weapon range it re-closes toward the target's smoothed lead;
   * inside range it circle-strafes at {@link COMBAT_ORBIT_RANGE}. Frozen by the
   * active-pause.
   *
   * The old "no steer inside weapon range" hold is gone: ship movement is arc-only
   * — the ship ALWAYS cruises forward and can't stop — so holding a dead heading
   * let it coast straight through the target and out the far side, drop out of
   * range, re-close, and oscillate unboundedly (the playtest orbit bug, which also
   * starved auto-fire of an in-range target). A controlled tangential orbit keeps
   * the target inside WEAPON_RANGE continuously, so auto-fire always has a hit.
   */
  private updateCombatPursuit(physics: ShipPhysics): void {
    if (this.deps.isPaused?.()) return; // active-pause: maneuvering frozen
    if (!this.deps.isTurnRunning()) return; // orbit is turn-gated: Space ends the turn → orbit stops
    // Player break-off (Task 3): a manually plotted route (to a planet / to flee)
    // takes over navigation — yield the auto-pursuit while the player's course is
    // flying so the ship is never pinned in its strafe orbit. The override ends the
    // instant the route completes (ship stops): pursuit re-engages only if a hostile
    // is still in range (and per the escape rules).
    if (this.pursuitSuspended) {
      if (physics.isMoving) return;
      this.pursuitSuspended = false;
    }
    const targetId = this.deps.getCombatTargetId?.() ?? null;
    if (!targetId) return;
    const sprite = this.npcSprites.find((s) => s.npc.id === targetId);
    if (!sprite) return;
    const dx = sprite.x - physics.shipX;
    const dy = sprite.y - physics.shipY;
    // Out of weapon range — re-close, steering continuously toward the target's
    // (smoothed) lead so the chase curves to where it's heading without stutter.
    if (dx * dx + dy * dy > this.WEAPON_RANGE * this.WEAPON_RANGE) {
      this.steerTowardLead(physics, sprite, targetId);
      return;
    }
    // Inside weapon range — circle-strafe at COMBAT_ORBIT_RANGE so the target stays
    // inside firing range continuously instead of coasting out of it.
    this.steerCombatOrbit(physics, sprite);
  }

  /**
   * Combat range-keeping (orbit/strafe): inside weapon range, circle the target at
   * {@link COMBAT_ORBIT_RANGE} rather than holding a dead heading. The ship steers
   * toward a carrot projected far along the desired orbit heading — a tangent
   * (perpendicular to the target line, in the ship's current orbital sense) plus a
   * radial pull back onto the strafe circle (outward when too close, inward when
   * too far). Because the carrot is far ({@link COMBAT_ORBIT_CARROT}), ShipPhysics
   * stays in its cruise phase and never decelerates/stops mid-orbit — only the
   * heading is consumed, recomputed each frame, so the orbit tracks the live target
   * accurately and holds it inside weapon range whether it's stationary, drifting,
   * fleeing, or closing. Arc-movement-compatible; no in-place pivot.
   *
   * The heading is intentionally NOT smoothed: a turn-rate-limited smoother (as the
   * approach uses) lags too far behind the live orbit geometry and the ship
   * slingshots out — holding range needs the accurate instantaneous heading.
   * ShipPhysics still turn-rate-limits the actual hull rotation, so the motion is
   * smooth even though the steering carrot snaps. (The far carrot is plotted as a
   * route via {@link ShipPhysics.setPath} so the redundant heading crosshair stays
   * hidden during the fight.)
   */
  private steerCombatOrbit(physics: ShipPhysics, sprite: NpcShipSprite): void {
    const toShipX = physics.shipX - sprite.x;
    const toShipY = physics.shipY - sprite.y;
    const dist = Math.hypot(toShipX, toShipY);
    // Radial unit vector (target → ship). When the target sits (almost) exactly
    // on the ship the direction is undefined — fall back to the ship's current
    // facing so it backs out deterministically instead of pivoting in place.
    let ux: number;
    let uy: number;
    if (dist < 1e-3) {
      ux = Math.cos(physics.shipAngle);
      uy = Math.sin(physics.shipAngle);
    } else {
      ux = toShipX / dist;
      uy = toShipY / dist;
    }
    // Tangent in the ship's current orbital sense (so dropping into the orbit
    // never demands a hard reversal).
    const headDot =
      Math.cos(physics.shipAngle) * -uy + Math.sin(physics.shipAngle) * ux;
    const s = headDot >= 0 ? 1 : -1;
    const tx = -uy * s;
    const ty = ux * s;
    // Radial correction: >0 pushes outward (too close), <0 pulls inward (too far).
    const radial = (this.COMBAT_ORBIT_RANGE - dist) / this.COMBAT_ORBIT_RANGE;
    // Anti-spin guard (playtest 2026-06-27): fade OUT the tangential (circling)
    // component when well inside the orbit radius so a target nearly on top of
    // the ship makes it back STRAIGHT out (radial-dominated) instead of
    // spiralling through many tight, fast revolutions — which wound the hull
    // round and round and made the auto-follow camera circle. The radial push is
    // always strong this close (radial ≥ 0.5), so the steer direction never
    // collapses to zero; the tangent is fully restored by COMBAT_ORBIT_MIN_RANGE,
    // leaving the steady orbit at COMBAT_ORBIT_RANGE untouched.
    const tanWeight = Math.min(1, dist / this.COMBAT_ORBIT_MIN_RANGE);
    let dirX = tx * tanWeight + ux * radial;
    let dirY = ty * tanWeight + uy * radial;
    const dlen = Math.hypot(dirX, dirY) || 1;
    dirX /= dlen;
    dirY /= dlen;
    const carrot = {
      x: physics.shipX + dirX * this.COMBAT_ORBIT_CARROT,
      y: physics.shipY + dirY * this.COMBAT_ORBIT_CARROT,
    };
    this.lastAimX = carrot.x;
    this.lastAimY = carrot.y;
    // Plot as a >1-point route: keeps ShipPhysics on a non-final leg (full cruise,
    // no deceleration/arc-cap) AND hides the heading crosshair while engaged.
    physics.setPath([
      carrot,
      {
        x: physics.shipX + dirX * this.COMBAT_ORBIT_CARROT * 2,
        y: physics.shipY + dirY * this.COMBAT_ORBIT_CARROT * 2,
      },
    ]);
  }

  /**
   * "Приблизиться" tracking: while the ship is flying toward the approached NPC,
   * steer continuously toward its (smoothed) lead point so the ship corrects
   * toward where the target is now, not where it was at the click. Clears the
   * tracking when the ship arrives (stops) or the target is gone — without ever
   * launching combat.
   */
  private updateApproach(physics: ShipPhysics): void {
    const approachId = this.approachNpcId;
    const sprite = this.npcSprites.find((s) => s.npc.id === approachId);
    if (!approachId || !sprite || !physics.isMoving) {
      // Target lost, or the ship reached the (re-aimed) lead point and stopped.
      this.approachNpcId = null;
      return;
    }
    this.steerTowardLead(physics, sprite, approachId);
  }

  /**
   * Smooth chase steering (smooth-auto-follow Task 3): nudge the ship's heading
   * continuously toward a *smoothed* lead point via the ShipPhysics turn-rate
   * limiter, instead of re-plotting a fresh curved spline every frame (the old
   * `aimRoute`-per-drift loop, which whipped the aim around on a noisy
   * target-velocity estimate and snapped the ship onto a new path each tick).
   *
   * The curved `executeRouteTo` spline is reserved for two cases: a *fresh leg*
   * (the ship is stopped — re-arm the turn + establish a path), and *star
   * avoidance* (the direct lead-line would cross the star, so the bow-around
   * waypoints are correct there). The star re-plot is hysteresis-gated
   * ({@link shouldReplotRoute}) so a fast-manoeuvring target re-plots at most once
   * per interval; everything else is the direct heading nudge.
   */
  private steerTowardLead(
    physics: ShipPhysics,
    sprite: NpcShipSprite,
    targetId: string,
  ): void {
    // A new chase target resets the smoother so a fresh leg never lags toward the
    // previous target's last lead point.
    if (targetId !== this.steerTargetId) {
      this.steerTargetId = targetId;
      this.smoothedLead = null;
      this.steerStarAvoiding = false;
    }
    const raw = this.npcLeadPoint(sprite);
    this.smoothedLead = smoothLeadPoint(
      this.smoothedLead,
      raw,
      this.LEAD_SMOOTHER,
    );
    const lead = this.smoothedLead;

    // Fresh leg (stopped): plot a curved route — re-arms the turn and establishes
    // a star-avoiding path the continuous nudge then refines.
    if (!physics.isMoving) {
      this.replotChase(lead);
      return;
    }

    // The direct lead-line would fly through the sun — fall back to the curved
    // star-avoidance spline. Re-plot the bypass the *instant* the path becomes
    // blocked (the clear→blocked transition), because the safety re-plot must NOT
    // be gated by the target-drift threshold: the clear-shot branch below keeps
    // `lastAim` glued to the smoothed lead (≤ maxStepPx apart), so a steady-heading
    // target never drifts far enough to trip shouldReaim and the ship would keep
    // steering straight across the star. Once already avoiding, throttle refresh
    // re-plots (BOTH the interval AND the drift) so a manoeuvring target can't
    // thrash the spline every frame.
    if (this.leadLineCrossesStar(physics, lead)) {
      const justBlocked = !this.steerStarAvoiding;
      if (
        justBlocked ||
        shouldReplotRoute(
          {
            endpoint: { x: this.lastAimX, y: this.lastAimY },
            lastReplotMs: this.lastReplotMs,
          },
          lead,
          this.REAIM_DRIFT_PX,
          this.chaseClockMs,
          this.REPLOT_MIN_INTERVAL_MS,
        )
      ) {
        this.replotChase(lead);
      }
      this.steerStarAvoiding = true;
      return;
    }
    this.steerStarAvoiding = false;

    // Clear shot: steer the heading directly toward the smoothed lead. ShipPhysics
    // turn-rate-limits the heading change, so the motion stays smooth (no snap).
    this.lastAimX = lead.x;
    this.lastAimY = lead.y;
    physics.setTarget(lead.x, lead.y);
  }

  /** Re-plot the curved route toward a lead point and stamp the re-plot clock. */
  private replotChase(lead: Point): void {
    this.lastReplotMs = this.chaseClockMs;
    this.aimRoute(lead.x, lead.y);
  }

  /**
   * Whether the straight line from the ship to `lead` would fly through the star:
   * the avoidance path bows around it (gains intermediate waypoints) exactly when
   * the direct segment is blocked. Absent star radius ⇒ no fallback (keep the
   * direct nudge).
   */
  private leadLineCrossesStar(physics: ShipPhysics, lead: Point): boolean {
    const radius = this.deps.getStarAvoidRadius?.();
    if (radius == null) return false;
    const center = this.deps.getStarCenter();
    return (
      avoidStarPath(
        physics.shipX,
        physics.shipY,
        lead.x,
        lead.y,
        center.x,
        center.y,
        radius,
      ).length > 1
    );
  }

  // ---------------------------------------------------------------------------
  // OVERMIND core final-encounter prompt
  // ---------------------------------------------------------------------------

  /**
   * Spawn the OVERMIND-core final boss as a real in-flight combatant — real-time
   * combat only, no hex CombatScene. The core enters as a hostile OVERMIND craft
   * that auto-closes on the player (aggressor maneuver, Task 3) and is selected
   * as the player's auto-fire target; killing it in-flight wins the game
   * ({@link handleInFlightDeath}). Idempotent: a second prompt-attack while the
   * core is already engaged is a no-op.
   */
  private spawnOvermindCoreCombatant(): void {
    if (this.npcSprites.some((s) => s.npc.id === OVERMIND_CORE_ID)) return;
    const systemId = this.gameEngine?.player?.currentSystemId ?? "";
    const rng = new SeededRNG(`overmind-core:${systemId}`);
    const core = this.npcSimulator.spawnOvermindInSystem(
      rng,
      OVERMIND_CORE_ID,
      systemId,
    );
    // Boss stats: far tougher than a patrol Доминатор. Real-time combat does NOT
    // model shields (firePlayerShot/fireNpcShot only touch hullHP), so fold the
    // old hex encounter's 150-shield layer into the hull — 300 hull + 150 shields
    // = 450 effective HP — to preserve the boss's intended toughness. Damage 45 as
    // before.
    core.name = "Ядро OVERMIND";
    core.hullHP = 450;
    core.maxHull = 450;
    core.damage = 45;
    core.markHostile();

    // Register the boss in the domain galaxy like every other in-system spawn
    // (garrison/capture-fleet callers push too): a day boundary during the fight
    // calls advanceGalaxyDay() → refresh(), which begins-departure on any sprite
    // absent from galaxy.npcShips. Without this the core flies out and the win
    // becomes unreachable; handleInFlightDeath's removeNpc would also no-op.
    const galaxy = this.gameEngine?.galaxy;
    if (galaxy) galaxy.npcShips.push(core);

    this.addNpcSprite(core, true); // enter from the boundary and fly in
    const sprite = this.npcSprites.find((s) => s.npc.id === OVERMIND_CORE_ID);
    if (!sprite) return;
    sprite.setAggressive(true); // pursue the player to weapon range
    this.deps.startInFlightCombat?.(sprite);
    this.deps.selectCombatTarget?.(sprite);
    this.deps.showMessage("Ядро OVERMIND вступает в бой!", 0xff2200);
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
   * already owns the screen, or before the galaxy/player are wired.
   */
  private maybeShowEntryEncounter(): void {
    // Don't pop a "dock the derelict?" modal while a fight is already underway
    // (a hostile system turns its garrison aggressive on entry, and hostile
    // space is exactly where encounters fire most often).
    if (this.inCombat || this.overmindOverlay || this.encounterOverlay) return;
    const encounter = this.rollEntryEncounter();
    if (!encounter) return;
    // The roll is deterministic by (system, day) and initialize() runs on every
    // entry into a fresh flight scene (land→take-off, star-map round trip,
    // in-session reload) WITHOUT advancing the day. Offer each (system, day)
    // encounter at most once per session, else the identical encounter re-fires
    // and a good salvage is re-claimable for free credits/cargo.
    const offered = this.gameEngine?.offeredEncounterIds;
    if (offered) {
      if (offered.has(encounter.id)) return;
      offered.add(encounter.id);
    }
    this.showEncounterPrompt(encounter);
  }

  /**
   * Pure roll seeded by (system, day): a given entry is deterministic/replay-
   * stable, yet a re-entry on a later day differs. Reads the live galaxy danger +
   * player progression. Returns null when nothing fires.
   */
  private rollEntryEncounter(): Encounter | null {
    const galaxy = this.gameEngine?.galaxy;
    const player = this.gameEngine?.player;
    if (!galaxy || !player) return null;
    // Defensive: a lightweight host/test galaxy/player may not implement the
    // danger/rep surface the pure helpers read — skip the roll rather than throw.
    if (
      typeof galaxy.isOvermindSystem !== "function" ||
      typeof player.getReputation !== "function"
    ) {
      return null;
    }
    const systemId = player.currentSystemId;
    const seed = `${systemId}:${galaxy.gameDays}`;
    return rollEncounter(
      encounterSystemView(galaxy, systemId),
      seed,
      encounterPlayerStateFor(player),
      ENCOUNTER_CONFIG,
    );
  }

  /**
   * Resolve the player's response to a presented encounter and apply it through
   * the existing seams: credits/cargo/rep via {@link applyEncounterOutcome}, and
   * a trap/ambush's combat by spawning a hostile into the in-flight CombatModule.
   * `rng` is injectable so a test can drive a specific branch. Returns the outcome.
   */
  applyEncounterChoice(
    encounter: Encounter,
    choice: EncounterChoice,
    rng?: () => number,
  ): EncounterOutcome {
    // `rng` undefined ⇒ resolveEncounter falls back to its deterministic default
    // (seeded off encounter.id); the balance config is always supplied.
    const outcome = resolveEncounter(
      encounter,
      choice,
      rng,
      ENCOUNTER_OUTCOME_CONFIG,
    );
    const player = this.gameEngine?.player;
    const galaxy = this.gameEngine?.galaxy;
    if (player && galaxy) {
      applyEncounterOutcome(
        {
          bank: this.gameEngine?.bank,
          player,
          galaxy,
          loadout: this.gameEngine?.playerLoadout,
        },
        encounter,
        outcome,
      );
    }
    if (outcome.startCombat) this.spawnEncounterAmbush(encounter);
    this.deps.showMessage(
      this.encounterOutcomeMessage(outcome),
      encounterOutcomeColor(outcome.kind),
    );
    return outcome;
  }

  /** Russian toast for a resolved outcome (the resolver's `message` is English). */
  private encounterOutcomeMessage(outcome: EncounterOutcome): string {
    const credits = outcome.credits ?? 0;
    switch (outcome.kind) {
      case "salvage":
        return `Обломок обчищен: +${credits} кр.`;
      case "trap":
        return "Это была ловушка — враги открывают огонь!";
      case "bonus":
        return `Аномалия просканирована: +${credits} кр.`;
      case "hazard":
        return `Аномалия повредила системы: ${credits} кр.`;
      case "rescue":
        return `Экипаж спасён: +${credits} кр. и доброе имя.`;
      case "ambush":
        return "Сигнал SOS оказался засадой!";
      case "ignored":
      default:
        return "Вы уходите, не вмешиваясь.";
    }
  }

  /**
   * Spawn the hostile a trap/ambush spills into and open in-flight combat with
   * it (mirrors {@link spawnOvermindCoreCombatant} but a plain pirate). Registered
   * in the domain galaxy so a day-boundary refresh can't despawn it mid-fight.
   */
  private spawnEncounterAmbush(encounter: Encounter): void {
    const systemId = this.gameEngine?.player?.currentSystemId ?? "";
    const id = `enc-ambush:${encounter.id}`;
    if (this.npcSprites.some((s) => s.npc.id === id)) return;
    const rng = new SeededRNG(id);
    const foe = this.npcSimulator.spawnPirateInSystem(rng, id, systemId);
    foe.name = encounter.type === "distress" ? "Засада" : "Ловушка";
    foe.markHostile();
    const galaxy = this.gameEngine?.galaxy;
    if (galaxy) galaxy.npcShips.push(foe);
    this.addNpcSprite(foe, true);
    const sprite = this.npcSprites.find((s) => s.npc.id === id);
    if (!sprite) return;
    sprite.setAggressive(true);
    this.deps.startInFlightCombat?.(sprite);
    this.deps.selectCombatTarget?.(sprite);
  }

  /** Tear down the encounter prompt overlay (idempotent). */
  closeEncounterPrompt(): void {
    if (!this.encounterOverlay) return;
    const ov = this.encounterOverlay;
    this.encounterOverlay = null;
    this.activeEncounter = null;
    // Guard: a scene transition's clearUILayer() may already have destroyed it.
    queueMicrotask(() => {
      if (!ov.destroyed) ov.destroy({ children: true });
    });
  }

  /**
   * Present the two-choice prompt for a rolled encounter (engage / leave). A
   * lightweight overlay reusing the OVERMIND-core prompt's layout — engaging runs
   * {@link applyEncounterChoice}; leaving resolves it as the neutral `ignored`.
   */
  showEncounterPrompt(encounter: Encounter): void {
    if (!this.gameEngine) return;
    this.closeEncounterPrompt();
    this.activeEncounter = encounter;
    const copy = ENCOUNTER_PROMPT_COPY[encounter.type];
    const width = this.renderer.app.screen.width;
    const height = this.renderer.app.screen.height;

    const overlay = new Container();
    this.encounterOverlay = overlay;
    const bg = new Graphics();
    bg.roundRect(width / 2 - 240, height / 2 - 110, 480, 220, 6).fill({
      color: 0x000000,
      alpha: 0.85,
    });
    // Swallow clicks on the panel so they don't bubble to the route handler.
    bg.eventMode = "static";
    bg.on("pointerdown", (e) => e.stopPropagation());

    const border = new Graphics();
    border
      .roundRect(width / 2 - 240, height / 2 - 110, 480, 220, 6)
      .stroke({ width: 2, color: copy.color });

    const title = new Text({
      text: copy.title,
      style: {
        fontFamily: "Courier New",
        fontSize: scaledFont(20),
        fill: copy.color,
        fontWeight: "bold",
      },
    });
    title.anchor.set(0.5);
    title.x = width / 2;
    title.y = height / 2 - 80;
    title.eventMode = "none";

    const desc = new Text({
      text: copy.desc,
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

    const engageBtn = this.buildEncounterButton(
      copy.engageLabel,
      copy.color,
      () => {
        this.closeEncounterPrompt();
        this.applyEncounterChoice(encounter, "engage");
      },
    );
    engageBtn.x = width / 2 - 200;
    engageBtn.y = height / 2 + 40;

    const leaveBtn = this.buildEncounterButton("[ Уйти ]", 0x4488ff, () => {
      this.closeEncounterPrompt();
      this.applyEncounterChoice(encounter, "ignore");
    });
    leaveBtn.x = width / 2 + 20;
    leaveBtn.y = height / 2 + 40;

    overlay.addChild(bg, border, title, desc, engageBtn, leaveBtn);
    this.uiLayer.addChild(overlay);
  }

  /** Build one labelled prompt button wired to `onPress` (stops propagation). */
  private buildEncounterButton(
    label: string,
    color: number,
    onPress: () => void,
  ): Container {
    const btn = new Container();
    const g = new Graphics();
    g.roundRect(0, 0, 180, 36, 4)
      .fill({ color: 0x111820 })
      .stroke({ width: 1, color });
    const text = new Text({
      text: label,
      style: {
        fontFamily: "Courier New",
        fontSize: scaledFont(14),
        fill: color,
      },
    });
    text.x = 8;
    text.y = 9;
    text.eventMode = "none";
    btn.addChild(g, text);
    btn.eventMode = "static";
    btn.cursor = "pointer";
    btn.on("pointerdown", (e) => {
      e.stopPropagation();
      onPress();
    });
    return btn;
  }

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
      // Real-time only: the core fights in-flight via the CombatModule (no hex
      // CombatScene hop). Killing it wins the game (handleInFlightDeath).
      this.spawnOvermindCoreCombatant();
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
