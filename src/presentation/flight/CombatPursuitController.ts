import type { GameEngine } from "@/systems/GameEngine";
import type { NpcShip } from "@/domain/NpcShip";
import type { NpcShipSprite } from "../NpcShipSprite";
import type { ShipPhysics } from "@/systems/ShipPhysics";
import type { NpcShipManagerDeps } from "./NpcShipManager";
import { OVERMIND_CORE_ID } from "./NpcShipManager";
import {
  factionKindOf,
  mutuallyHostile,
  overmindCombatTargets,
  type RangedNpc,
} from "@/systems/npc/factionHostility";
import { FlightCombatResolver } from "@/systems/FlightCombatResolver";
import {
  shouldReaim,
  smoothLeadPoint,
  shouldReplotRoute,
  avoidStarPath,
  type Point,
} from "@/utils/flightGeometry";
import { GAME_BALANCE } from "@/config/balance";

/**
 * Everything the pursuit controller reads from (or pushes back to) the owning
 * {@link NpcShipManager} without depending on the concrete manager class.
 *
 * The scene-facing accessors are re-exposed via {@link NpcShipManagerDeps}
 * (`flight`); `npcLeadPoint`/`aimRoute` are the manager's forwarders onto
 * `NpcInteractionController` (Task 1) — kept there since the lead-intercept
 * math and route-planning bookkeeping belong to the interaction cluster, not
 * combat steering.
 */
export interface CombatPursuitDeps {
  /** Scene-facing accessors (the manager's own {@link NpcShipManagerDeps}). */
  flight: NpcShipManagerDeps;
  /** The owning engine (nullable in lightweight test/host setups). */
  getGameEngine(): GameEngine | null;
  /** Live NPC sprites present in the player's system. */
  getNpcSprites(): NpcShipSprite[];
  /** Predicted intercept lead point for chasing a moving NPC. */
  npcLeadPoint(sprite: NpcShipSprite): { x: number; y: number };
  /** Plot a route and remember it as the live re-aim destination. */
  aimRoute(x: number, y: number): void;
  /** Radar/scanner reach (world px) — the NPC-vs-NPC engagement gate. */
  scannerRange: number;
  /** Weapon reach (world px) — the in-range combat/orbit gate. */
  weaponRange: number;
  /**
   * In-flight kill resolution (loot drop + domain removal + win/salvage
   * dispatch) — stays on the manager since it also owns loot/deathFx/liberation.
   */
  handleInFlightDeath(
    sprite: NpcShipSprite,
    rng: () => number,
    killedByPlayer: boolean,
  ): void;
}

/**
 * Owns the combat steering / orbit / chase-state cluster extracted from
 * {@link NpcShipManager}: the auto-follow → close-to-range → fire loop, the
 * real-time in-combat orbit/strafe, the smoothed chase steering (with star
 * avoidance), and the Overmind-involving NPC-vs-NPC crossfire.
 *
 * Mirrors the {@link NpcInteractionController} shape — constructed with a
 * narrow deps bundle, owned by the manager as a property, its methods
 * forwarded 1:1 so the manager's public/tested surface is unchanged.
 */
export class CombatPursuitController {
  // When set, the ship auto-follows this NPC (used by "Атаковать"): on each
  // arrival it re-routes to the target's current position (auto-follow). Read
  // by the manager's `followNpcId` accessor (a de-facto public field read by
  // the scene's flight/turn loop; the scene clears it on low-hull stop / route
  // cancel).
  followNpcId: string | null = null;

  // When set, the ship is closing on this NPC via "Приблизиться" (non-combat):
  // the course is continuously re-aimed at the target's lead point while
  // flying, but never opens fire. Cleared on arrival, on a switch to attack,
  // and when a fresh route cancels it.
  approachNpcId: string | null = null;

  // ms accumulated toward the next in-flight NPC-vs-NPC (cross-faction) fire
  // round — the Overmind-vs-pirate brawl resolves on the same cadence as the
  // player's combat fire interval. Reset each time a round fires.
  npcCrossfireTimer = 0;

  // Final destination of the last route this controller plotted (the lead
  // point), so a drifting target can be re-aimed against the true endpoint
  // rather than the immediate (possibly sun-avoidance) waypoint ShipPhysics
  // exposes.
  lastAimX = 0;
  lastAimY = 0;
  /** Lead-drift (world px) before a chase/approach re-plots its course. */
  private readonly REAIM_DRIFT_PX = 30;

  // Smooth chase steering (smooth-auto-follow Task 3): the in-combat pursuit
  // and the «Приблизиться» approach steer continuously toward a *smoothed*
  // lead point via the ShipPhysics turn-rate limiter instead of re-plotting a
  // curved spline every frame. The smoothed point and the id it tracks are
  // reset when the chase target changes so a fresh leg never lags from the
  // previous target's lead.
  smoothedLead: Point | null = null;
  steerTargetId: string | null = null;
  // True while the chase is bowing around the star: the *first* frame the
  // direct lead-line becomes blocked must re-plot the curved bypass
  // immediately (a safety re-plot can't wait on the target-drift gate — the
  // clear-shot nudge keeps `lastAim` glued to the lead, so that gate never
  // trips on a steady-heading target). A sustained block then throttles
  // refresh re-plots via shouldReplotRoute.
  steerStarAvoiding = false;
  /** Monotonic ms clock for the curved-re-plot hysteresis (advanced in updateCombat). */
  chaseClockMs = 0;
  /** Last curved-route re-plot timestamp (ms on {@link chaseClockMs}). */
  lastReplotMs = -Infinity;
  /**
   * EMA + max-step smoothing for the noisy per-frame lead point (matches the
   * Task 2 `chaseSteering.test` config: maxStepPx ≤ the 8px smoothness bound).
   */
  private readonly LEAD_SMOOTHER = { alpha: 0.25, maxStepPx: 6 } as const;
  /** Min ms between curved star-avoidance re-plots (hysteresis throttle). */
  private readonly REPLOT_MIN_INTERVAL_MS = 500;

  // Break-off (Task 3): set when the player commits a manual route mid-fight
  // (to a planet / to flee). While set, the combat auto-pursuit yields
  // navigation so the ship flies the player's course instead of being pinned
  // in its strafe orbit. It clears the instant the player's route completes
  // (ship stops) — pursuit then re-engages only if a hostile is still in
  // range — and on a fresh engagement / explicit retarget (the player chose
  // to fight again).
  pursuitSuspended = false;

  private readonly WEAPON_RANGE: number;
  private readonly SCANNER_RANGE: number;
  // Combat strafe radius: while engaged, orbit the target at this standoff —
  // comfortably inside WEAPON_RANGE — so auto-fire always has a target in
  // range (the orbit fix). 0.6 × 240 = 144px.
  private readonly COMBAT_ORBIT_RANGE: number;
  // Anti-spin floor (playtest 2026-06-27): well inside the orbit radius the
  // tangential (circling) steering component is faded out so a target nearly
  // on top of the ship makes it back STRAIGHT out to range instead of
  // spiralling tightly. The tangent fades fully back in by this distance, so
  // the steady orbit at COMBAT_ORBIT_RANGE is unchanged. 0.5 × 144 = 72px.
  private readonly COMBAT_ORBIT_MIN_RANGE: number;
  // The combat orbit steers toward a carrot projected this far ahead along
  // the desired heading — only the heading matters; the ship keeps cruising.
  private readonly COMBAT_ORBIT_CARROT = 2000;

  private readonly combatResolver = new FlightCombatResolver();

  constructor(private readonly deps: CombatPursuitDeps) {
    this.WEAPON_RANGE = deps.weaponRange;
    this.SCANNER_RANGE = deps.scannerRange;
    this.COMBAT_ORBIT_RANGE = this.WEAPON_RANGE * 0.6;
    this.COMBAT_ORBIT_MIN_RANGE = this.WEAPON_RANGE * 0.6 * 0.5;
  }

  /** Clear auto-follow/approach/break-off state — called on scene teardown. */
  reset(): void {
    this.followNpcId = null;
    this.approachNpcId = null;
    this.pursuitSuspended = false;
  }

  /**
   * Engage real-time in-flight combat against a specific NPC (no CombatScene
   * hop and no ship freeze — the scene's CombatModule resolves the fight
   * while ships keep moving). Adds the NPC to the combatant set and selects
   * it as the player's auto-fire target. The auto-follow/approach intent is
   * cleared now that the target is engaged.
   */
  launchCombatWithNpc(npc: NpcShip): void {
    const sprite = this.deps.getNpcSprites().find((s) => s.npc.id === npc.id);
    if (!sprite) return;
    this.followNpcId = null;
    this.approachNpcId = null;
    this.steerTargetId = null; // fresh chase leg — reset the lead smoother
    this.pursuitSuspended = false; // fresh engagement re-arms the auto-pursuit
    // A player-initiated engagement makes the target an active aggressor so it
    // auto-closes on the player and holds weapon range (Task 3) instead of
    // orbiting its planet / drifting. Garrison + shakedown paths already flag it.
    sprite.setAggressive(true);
    this.deps.flight.startInFlightCombat?.(sprite);
    this.deps.flight.selectCombatTarget?.(sprite);
    this.deps.flight.onPlayerEngagesCombat?.(sprite); // pause immediately — no orbit before dialog
  }

  /**
   * Auto-attack: while a follow target is set and the turn is running, close
   * to weapon range, then hold station and exchange fire until the target is
   * destroyed, the player drops below 30% hull, or the target is lost.
   * Decision logic delegated to FlightCombatResolver for testability.
   */
  updateCombat(deltaTime: number): void {
    const physics = this.deps.flight.getShipPhysics();
    if (!physics) return;
    // Advance the chase clock that throttles curved star-avoidance re-plots
    // (smooth-auto-follow Task 3 hysteresis).
    this.chaseClockMs += deltaTime;

    // Real-time combat tracking (Task 3): while a fight is engaged, auto-track
    // the live combat target every frame — close to weapon range and hold it
    // without a fresh "Ход". Distinct from the pre-combat chase resolver below
    // (which brings an out-of-range target INTO the fight); once engaged this
    // branch owns the player's maneuvering.
    if (this.deps.flight.isInCombat?.()) {
      this.updateCombatPursuit(physics);
      return;
    }

    // Non-combat approach ("Приблизиться"): continuously re-aim at the moving
    // target's lead point while flying, but never open fire. Handled before
    // the combat decision so an approach never escalates to a CombatScene
    // launch.
    if (this.approachNpcId) {
      this.updateApproach(physics);
      return;
    }

    const ship = this.deps.getGameEngine()?.player?.ship;
    if (!ship) return;

    const decision = this.combatResolver.decide({
      isTurnRunning: this.deps.flight.isTurnRunning(),
      followNpcId: this.followNpcId,
      shipPhysics: physics,
      npcSprites: this.deps.getNpcSprites(),
      weaponRange: this.WEAPON_RANGE,
    });

    switch (decision.action) {
      case "idle":
        return;
      case "lost":
        this.deps.flight.showMessage("Цель потеряна", 0xffaa00);
        this.followNpcId = null;
        // Losing the chase target stops the running turn — otherwise the
        // calendar keeps advancing on a chase with nothing left to pursue
        // (mirrors the shakedown-hail freeze in openShakedownHail).
        this.deps.flight.endTurn();
        return;
      case "chase": {
        // Re-aim at a fresh lead point so the chase curves to lead a crossing
        // target rather than heading at its old position. Re-aim at the start
        // of each leg (stopped) AND continuously mid-flight once the target
        // drifts beyond the threshold — so the ship corrects course toward a
        // manoeuvring target instead of trailing it to where it was.
        const chased = this.deps
          .getNpcSprites()
          .find((s) => s.npc.id === this.followNpcId);
        const lead = chased
          ? this.deps.npcLeadPoint(chased)
          : { x: decision.targetX, y: decision.targetY };
        if (
          !physics.isMoving ||
          shouldReaim(
            { x: this.lastAimX, y: this.lastAimY },
            lead,
            this.REAIM_DRIFT_PX,
          )
        ) {
          this.deps.aimRoute(lead.x, lead.y);
        }
        return;
      }
      case "launch":
        // In range: engage in-flight combat. The ship is NOT frozen — it
        // keeps its current momentum (navigation is locked while the fight
        // is on, so the player can't plot a new course, but the ship is
        // never pinned).
        this.launchCombatWithNpc(decision.npc);
        return;
    }
  }

  /**
   * Break off the combat auto-pursuit so a player-plotted route (to a planet,
   * or an explicit flee) takes over navigation instead of the ship being
   * pinned in its strafe orbit (Task 3). The scene calls this whenever the
   * player commits a manual route while a fight is engaged. The override is
   * self-clearing: once the route completes (ship stops) {@link
   * updateCombatPursuit} resumes pursuit — and a fresh engagement / explicit
   * retarget clears it immediately (the player chose to fight again). Combat
   * (auto-fire) keeps resolving throughout; only the auto-maneuvering yields.
   */
  breakOffCombatPursuit(): void {
    this.pursuitSuspended = true;
  }

  /**
   * Real-time combat auto-track (Task 3): while a fight is engaged, keep the
   * player ship inside weapon range of the live combat target without a
   * fresh "Ход". Outside weapon range it re-closes toward the target's
   * smoothed lead; inside range it circle-strafes at
   * {@link COMBAT_ORBIT_RANGE}. Frozen by the active-pause.
   */
  private updateCombatPursuit(physics: ShipPhysics): void {
    if (this.deps.flight.isPaused?.()) return; // active-pause: maneuvering frozen
    if (!this.deps.flight.isTurnRunning()) return; // orbit is turn-gated: Space ends the turn → orbit stops
    // Player break-off (Task 3): a manually plotted route (to a planet / to
    // flee) takes over navigation — yield the auto-pursuit while the
    // player's course is flying so the ship is never pinned in its strafe
    // orbit. The override ends the instant the route completes (ship stops):
    // pursuit re-engages only if a hostile is still in range (and per the
    // escape rules).
    if (this.pursuitSuspended) {
      if (physics.isMoving) return;
      this.pursuitSuspended = false;
    }
    const targetId = this.deps.flight.getCombatTargetId?.() ?? null;
    if (!targetId) return;
    const sprite = this.deps.getNpcSprites().find((s) => s.npc.id === targetId);
    if (!sprite) return;
    const dx = sprite.x - physics.shipX;
    const dy = sprite.y - physics.shipY;
    // Out of weapon range — re-close, steering continuously toward the
    // target's (smoothed) lead so the chase curves to where it's heading
    // without stutter.
    if (dx * dx + dy * dy > this.WEAPON_RANGE * this.WEAPON_RANGE) {
      this.steerTowardLead(physics, sprite, targetId);
      return;
    }
    // Inside weapon range — circle-strafe at COMBAT_ORBIT_RANGE so the target
    // stays inside firing range continuously instead of coasting out of it.
    this.steerCombatOrbit(physics, sprite);
  }

  /**
   * Combat range-keeping (orbit/strafe): inside weapon range, circle the
   * target at {@link COMBAT_ORBIT_RANGE} rather than holding a dead heading.
   * The ship steers toward a carrot projected far along the desired orbit
   * heading — a tangent (perpendicular to the target line, in the ship's
   * current orbital sense) plus a radial pull back onto the strafe circle
   * (outward when too close, inward when too far). Because the carrot is far
   * ({@link COMBAT_ORBIT_CARROT}), ShipPhysics stays in its cruise phase and
   * never decelerates/stops mid-orbit — only the heading is consumed,
   * recomputed each frame, so the orbit tracks the live target accurately
   * and holds it inside weapon range whether it's stationary, drifting,
   * fleeing, or closing. Arc-movement-compatible; no in-place pivot.
   */
  private steerCombatOrbit(physics: ShipPhysics, sprite: NpcShipSprite): void {
    const toShipX = physics.shipX - sprite.x;
    const toShipY = physics.shipY - sprite.y;
    const dist = Math.hypot(toShipX, toShipY);
    // Radial unit vector (target → ship). When the target sits (almost)
    // exactly on the ship the direction is undefined — fall back to the
    // ship's current facing so it backs out deterministically instead of
    // pivoting in place.
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
    // Radial correction: >0 pushes outward (too close), <0 pulls inward (too
    // far).
    const radial = (this.COMBAT_ORBIT_RANGE - dist) / this.COMBAT_ORBIT_RANGE;
    // Anti-spin guard (playtest 2026-06-27): fade OUT the tangential
    // (circling) component when well inside the orbit radius so a target
    // nearly on top of the ship makes it back STRAIGHT out (radial-dominated)
    // instead of spiralling through many tight, fast revolutions. The radial
    // push is always strong this close (radial ≥ 0.5), so the steer
    // direction never collapses to zero; the tangent is fully restored by
    // COMBAT_ORBIT_MIN_RANGE, leaving the steady orbit at COMBAT_ORBIT_RANGE
    // untouched.
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
    // Plot as a >1-point route: keeps ShipPhysics on a non-final leg (full
    // cruise, no deceleration/arc-cap) AND hides the heading crosshair while
    // engaged.
    physics.setPath([
      carrot,
      {
        x: physics.shipX + dirX * this.COMBAT_ORBIT_CARROT * 2,
        y: physics.shipY + dirY * this.COMBAT_ORBIT_CARROT * 2,
      },
    ]);
  }

  /**
   * "Приблизиться" tracking: while the ship is flying toward the approached
   * NPC, steer continuously toward its (smoothed) lead point so the ship
   * corrects toward where the target is now, not where it was at the click.
   * Clears the tracking when the ship arrives (stops) or the target is gone
   * — without ever launching combat.
   */
  private updateApproach(physics: ShipPhysics): void {
    const approachId = this.approachNpcId;
    const sprite = this.deps
      .getNpcSprites()
      .find((s) => s.npc.id === approachId);
    if (!approachId || !sprite || !physics.isMoving) {
      // Target lost, or the ship reached the (re-aimed) lead point and
      // stopped.
      this.approachNpcId = null;
      return;
    }
    this.steerTowardLead(physics, sprite, approachId);
  }

  /**
   * Smooth chase steering (smooth-auto-follow Task 3): nudge the ship's
   * heading continuously toward a *smoothed* lead point via the ShipPhysics
   * turn-rate limiter, instead of re-plotting a fresh curved spline every
   * frame.
   *
   * The curved `aimRoute` spline is reserved for two cases: a *fresh leg*
   * (the ship is stopped — re-arm the turn + establish a path), and *star
   * avoidance* (the direct lead-line would cross the star, so the bow-around
   * waypoints are correct there). The star re-plot is hysteresis-gated
   * ({@link shouldReplotRoute}) so a fast-manoeuvring target re-plots at most
   * once per interval; everything else is the direct heading nudge.
   */
  private steerTowardLead(
    physics: ShipPhysics,
    sprite: NpcShipSprite,
    targetId: string,
  ): void {
    // A new chase target resets the smoother so a fresh leg never lags toward
    // the previous target's last lead point.
    if (targetId !== this.steerTargetId) {
      this.steerTargetId = targetId;
      this.smoothedLead = null;
      this.steerStarAvoiding = false;
    }
    const raw = this.deps.npcLeadPoint(sprite);
    this.smoothedLead = smoothLeadPoint(
      this.smoothedLead,
      raw,
      this.LEAD_SMOOTHER,
    );
    const lead = this.smoothedLead;

    // Fresh leg (stopped): plot a curved route — re-arms the turn and
    // establishes a star-avoiding path the continuous nudge then refines.
    if (!physics.isMoving) {
      this.replotChase(lead);
      return;
    }

    // The direct lead-line would fly through the sun — fall back to the
    // curved star-avoidance spline. Re-plot the bypass the *instant* the path
    // becomes blocked (the clear→blocked transition), because the safety
    // re-plot must NOT be gated by the target-drift threshold: the clear-shot
    // branch below keeps `lastAim` glued to the smoothed lead (≤ maxStepPx
    // apart), so a steady-heading target never drifts far enough to trip
    // shouldReaim and the ship would keep steering straight across the star.
    // Once already avoiding, throttle refresh re-plots (BOTH the interval AND
    // the drift) so a manoeuvring target can't thrash the spline every frame.
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

    // Clear shot: steer the heading directly toward the smoothed lead.
    // ShipPhysics turn-rate-limits the heading change, so the motion stays
    // smooth (no snap).
    this.lastAimX = lead.x;
    this.lastAimY = lead.y;
    physics.setTarget(lead.x, lead.y);
  }

  /** Re-plot the curved route toward a lead point and stamp the re-plot clock. */
  private replotChase(lead: Point): void {
    this.lastReplotMs = this.chaseClockMs;
    this.deps.aimRoute(lead.x, lead.y);
  }

  /**
   * Whether the straight line from the ship to `lead` would fly through the
   * star: the avoidance path bows around it (gains intermediate waypoints)
   * exactly when the direct segment is blocked. Absent star radius ⇒ no
   * fallback (keep the direct nudge).
   */
  private leadLineCrossesStar(physics: ShipPhysics, lead: Point): boolean {
    const radius = this.deps.flight.getStarAvoidRadius?.();
    if (radius == null) return false;
    const center = this.deps.flight.getStarCenter();
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

  /**
   * Remember the ship's current flight position on the GameEngine (transient,
   * unsaved) so a SPACE_FLIGHT re-entry resumes the ship right here instead
   * of edge-spawning it (applyEntrySpawn fallback).
   */
  rememberFlightPos(): void {
    const physics = this.deps.flight.getShipPhysics();
    const engine = this.deps.getGameEngine();
    if (physics && engine) {
      engine.lastFlightShipPos = { x: physics.shipX, y: physics.shipY };
    }
  }

  /**
   * The nearest live NPC sprite this one is mutually hostile to AND within
   * engagement (scanner) range — the steering target that makes hostile
   * factions actively fight in-flight instead of drifting past each other.
   * Scoped to engagements INVOLVING the Overmind (the only pair
   * {@link resolveNpcVsNpcCombat} resolves damage for), so a steered pair
   * always actually trades fire rather than orbiting silently; the OVERMIND
   * core (the player's duel target) is excluded on both sides. Pure read over
   * the live sprites (no RNG/I/O).
   */
  nearestNpcEnemy(sprite: NpcShipSprite): NpcShipSprite | null {
    if (sprite.npc.id === OVERMIND_CORE_ID) return null;
    const selfKind = factionKindOf(sprite.npc);
    let best: NpcShipSprite | null = null;
    let bestD2 = this.SCANNER_RANGE * this.SCANNER_RANGE;
    for (const other of this.deps.getNpcSprites()) {
      if (other === sprite || other.isGone()) continue;
      if (other.npc.id === OVERMIND_CORE_ID) continue;
      const otherKind = factionKindOf(other.npc);
      // Only Overmind-involving pairs have a damage path — don't steer two
      // ships into a silent non-fight.
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
   * In-flight NPC-vs-NPC combat (Task 5): the Overmind's indiscriminate
   * aggression plays out as a real cross-faction brawl in the player's
   * system, independent of the player. Every
   * {@link GAME_BALANCE.combatFireIntervalMs} each present Overmind sprite
   * fires on the nearest **mutually-hostile** sprite within weapon range (a
   * strayed pirate in a captured system, a liberating ranger…) selected
   * through the shared hostility matrix ({@link overmindCombatTargets}, the
   * single source of truth). Damage is mutual — the foe shoots back — and a
   * lethal round routes through the normal in-flight death path (via
   * {@link CombatPursuitDeps.handleInFlightDeath}). Scoped to Overmind
   * attackers and gated on weapon range, so a system with no Overmind present
   * is wholly unperturbed.
   */
  resolveNpcVsNpcCombat(deltaTime: number): void {
    // The active pause freezes the WHOLE fight — NPC-vs-NPC crossfire too, not
    // just the player ship and the per-frame movement step. Honour the single
    // `combatPause.paused` signal directly, and bail BEFORE accruing the fire
    // timer so unpause can't unleash a backed-up volley (the timer holds its
    // pre-pause value).
    if (this.deps.flight.isPaused?.()) return;
    this.npcCrossfireTimer += deltaTime;
    if (this.npcCrossfireTimer < GAME_BALANCE.combatFireIntervalMs) return;
    this.npcCrossfireTimer = 0;
    const npcSprites = this.deps.getNpcSprites();
    if (npcSprites.length < 2) return;

    // Exclude the OVERMIND core: it is the player's duel target (engaged via
    // CombatModule) and killing it wins the game in handleInFlightDeath.
    // Letting a strayed pirate / liberating ranger kill it via NPC-vs-NPC
    // crossfire would fire a false-positive victory before the player ever
    // lands a shot.
    const combatants: RangedNpc[] = npcSprites
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

    const byId = new Map(npcSprites.map((s) => [s.npc.id, s]));
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
    // Resolve kills after the round so the loot/removal splice never disturbs
    // the engagement iteration. These are NPC-vs-NPC kills, not the player's,
    // so they drop loot + remove the ship but pay NO salvage and grant NO
    // liberation (killedByPlayer = false) — those rewards are earned by the
    // player's own shots.
    for (const sprite of killed) {
      this.deps.handleInFlightDeath(sprite, Math.random, false);
    }
  }
}
