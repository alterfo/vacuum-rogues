/**
 * Execute-window orchestrator for the pause-and-plan combat loop (Task 14.5c of
 * `docs/plans/20260713-tactical-pause-combat-rework.md`).
 *
 * Tasks 2–14 each landed their mechanic as a pure, unit-tested module; 14.5a/b wired
 * the loop trigger + planning UI live. This controller folds the REMAINING mechanics
 * into the live per-frame combat flow, consuming the pure modules verbatim:
 *
 * - **Gravity assist** (Task 4): `gravityAssistTotal` over the live planet discs →
 *   folded into `ShipPhysics.currentSpeed` each execute-window frame.
 * - **Afterburner** (Task 8): `plan.afterburner` → `engageAfterburner` at confirm;
 *   the window multiplier is applied as extra forward displacement for exactly one
 *   window, engine wear persists across the fight and resets on the next engagement.
 * - **Missiles** (Task 7): a `WeaponClass.MISSILE` gun's planned shot launches a
 *   tracked `MissileState` instead of the instant hit-scan; advanced each frame,
 *   settled via `resolveMissileArrival` with an injected roll, damage landed through
 *   the same `CombatModule` kill path. The smoke trail (Task 13) tracks the flown path.
 * - **Consumables** (Task 9): `plan.consumableId` resolved at confirm — shield
 *   restore / AoE blast / weapon jam (the jam suppresses the target's fire gate).
 * - **Comms** (Task 10): `plan.commsAction` resolved at confirm — bribe (tribute via
 *   the bank bus, everyone disengages), demand-surrender (role/hull-gated: yields loot
 *   + flees), call-for-help (nearest eligible ally joins and fires at the hostiles).
 * - **VFX** (Tasks 11–14): banking roll on the player sprite from the live turn rate;
 *   shield-hit flash + floating hull/shield bars; weapon-type shot styles
 *   (beam/burst/distortion) replacing the flat tracer for player fire; drifting wreck
 *   + staggered loot emissions from the wreck's live drift position.
 *
 * The scene ticks {@link CombatExecutionController.update} only while the sim is not
 * frozen (planning/active-pause), so every entity here freezes with the fight.
 * Everything is transient execute-window state — no save/schema impact.
 */

import { Graphics, type Container } from "pixi.js";
import { t } from "@/i18n/i18n";
import {
  GAME_BALANCE,
  GRAVITY_ASSIST,
  AFTERBURNER,
  MISSILE_COMBAT,
  COMBAT_CONSUMABLE,
  COMBAT_COMMS,
  BANKING,
  SHIELD_COMBAT,
  WRECK,
} from "@/config/balance";
import { WeaponAbility } from "@/types";
import { WeaponClass, type WeaponSpec } from "@/systems/equipment/GearCatalog";
import { npcWeaponRange } from "@/systems/combat/npcWeapon";
import type { NpcShip } from "@/domain/NpcShip";
import type { NpcShipSprite } from "../NpcShipSprite";
import type { PlannedTurn } from "./combatPlanning";
import { gravityAssistTotal } from "./combatGravity";
import {
  pristineEngine,
  engageAfterburner,
  canAfterburn,
  type EngineWearState,
} from "./combatAfterburner";
import {
  launchMissile,
  advanceMissile,
  resolveMissileArrival,
  isMissileDone,
  type MissileState,
} from "./combatMissile";
import {
  consumableById,
  applyShieldRestore,
  aoeDamageTargets,
  jamTarget,
  isJamActive,
  type WeaponJam,
} from "./combatConsumable";
import {
  resolveBribe,
  resolveSurrenderDemand,
  findCallForHelpAlly,
} from "./combatComms";
import { shipTurnRate, bankingAngle, approachRoll } from "./combatBanking";
import { shieldFlashAlpha } from "./combatShield";
import { drawShieldFlashes, type ShieldFlashSpec } from "./combatShieldFlash";
import { drawShipStatusBars, type ShipStatusBarSpec } from "./combatStatusBars";
import {
  selectWeaponVfx,
  missileTrailPoints,
  WeaponVfxKind,
} from "./combatWeaponVfx";
import { drawWeaponVfx, type WeaponVfxSpec } from "./combatWeaponVfxOverlay";
import { drawWrecks } from "./combatWreckRenderer";
import {
  shipVelocity,
  spawnWreck,
  advanceWreck,
  isWreckDone,
  wreckAlpha,
  wreckLootEmissionTimes,
  dueLootEmissions,
  type WreckState,
} from "./combatWreck";

/** How long a hit-scan shot's styled tracer stays on screen (ms). */
const SHOT_FX_MS = 280;
/** Rough on-screen ship radius (px) for flash sizing + wreck silhouettes. */
const SHIP_VISUAL_RADIUS = 16;
/**
 * Fraction of the wreck's life across which its loot emissions are staggered.
 * Exported so a non-clicking driver (the dev-only live autopilot's
 * `PlayerAgent.driveAttack`) can compute how long to linger near a fresh kill
 * before the last drop has had a chance to spawn — see its "loot lingering"
 * comment.
 */
export const WRECK_LOOT_SPREAD_FRACTION = 0.6;
/** Friendly ally tracer tint (distinct from the player's hot cyan). */
const ALLY_SHOT_COLOR = 0x7dff9a;
/** Toast tints matching the planning-phase convention. */
const EXEC_TINT = 0x66ccff;
const WARN_TINT = 0xffcc00;

/** The minimal `ShipPhysics` surface the execute-window folds drive. */
export interface ExecutionShipPhysics {
  shipX: number;
  shipY: number;
  shipAngle: number;
  currentSpeed: number;
  timeScale: number;
  isMoving: boolean;
}

/** One live missile the execute loop is tracking. */
interface TrackedMissile {
  state: MissileState;
  readonly target: NpcShipSprite;
  readonly weapon: WeaponSpec;
  /** Flown positions for the Task 13 smoke trail. */
  readonly trail: { x: number; y: number }[];
}

/** A friendly NPC recruited by call-for-help, firing at the hostiles. */
interface AllyState {
  readonly sprite: NpcShipSprite;
  fireTimerMs: number;
}

/** A drifting wreck plus its staggered loot-emission schedule. */
interface TrackedWreck {
  state: WreckState;
  readonly npc: NpcShip;
  readonly emissionTimes: number[];
}

/** A live shield flash (position re-anchored to the ship each frame is overkill —
 *  the flash is ~350ms; it stays where the hit landed). */
interface FlashState {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  ageMs: number;
}

/** A fading styled shot tracer (beam/burst + distortion). */
interface ShotFxState {
  readonly spec: Omit<WeaponVfxSpec, "alpha">;
  ageMs: number;
}

/** The live scene state the execute-window orchestrator reads (all closures). */
export interface CombatExecutionHost {
  getShipPhysics(): ExecutionShipPhysics | null;
  getGameLayer(): Container;
  /** Live planet discs — position + rendered radius (the gravity mass-proxy). */
  getPlanets(): readonly { x: number; y: number; radius: number }[];
  /** The player's domain ship (shield pool consumer). */
  getPlayerShip(): {
    hullHP: number;
    maxHull: number;
    shields: number;
    maxShields: number;
  } | null;
  /** The player ship's world container, for the banking roll (null headless). */
  getPlayerVisual(): { scale: { x: number; y: number } } | null;
  getPlayerInventory(): {
    hasConsumable(id: string): boolean;
    removeConsumable(id: string): boolean;
  } | null;
  getPlayerCredits(): number;
  /** Move bribe credits through the bank bus (`payTribute`). */
  payBribe(amount: number, npc: NpcShip): void;
  /** Live engaged hostiles (`CombatModule.combatants`). */
  combatants(): readonly NpcShipSprite[];
  selectedTarget(): NpcShipSprite | null;
  isCombatActive(): boolean;
  /** True while a confirmed execute window runs (`combatPlanning.isExecuting`). */
  isExecuting(): boolean;
  /** Land damage through the canonical player-offense path (`CombatModule`). */
  landShot(
    target: NpcShipSprite,
    rawDamage: number,
    from: { x: number; y: number } | null,
  ): void;
  /** Drop a combatant from the fight without killing it (`CombatModule.disengage`). */
  disengage(sprite: NpcShipSprite): void;
  /** Every live NPC sprite in-system (call-for-help candidates). */
  npcSprites(): readonly NpcShipSprite[];
  /** Spawn `count` loot dots at a world point via the existing LootDropHandler path. */
  spawnLoot(npc: NpcShip, x: number, y: number, count?: number): void;
  /** Roll the total drop count for a kill (the existing loot distribution). */
  rollLootCount(npc: NpcShip): number;
  /**
   * Re-arm the round-based incoming-damage budget (`CombatModule.beginCombatRound`).
   * Optional so partial test hosts stay valid; the live scene MUST wire it —
   * without a per-window re-arm the `roundComplete` latch permanently halts
   * BOTH sides' fire once ~34% of max hull has landed (review 2026-07-15).
   */
  beginRound?(): void;
  /**
   * True only while the ship is genuinely still trying to get away — the
   * combat auto-pursuit is yielding to a player/agent-plotted route, not
   * driving the ship itself (round-budget hardening, win-rate-100pct plan).
   * Optional so partial test hosts default to `false` (the safe choice: a
   * missing dep re-arms every window, same as before this hardening pass).
   */
  isPursuitSuspended?(): boolean;
  showMessage(text: string, color?: number): void;
}

/**
 * Owns every execute-window mechanic the scene folds into the live loop each frame.
 * Constructed once per flight scene; `update(dt)` is ticked only while the sim is
 * not frozen, `beginWindow(plan)` on each confirmed turn, `endFight()` when the
 * fight resolves (wrecks keep drifting past the fight's end on purpose).
 */
export class CombatExecutionController {
  private readonly host: CombatExecutionHost;

  private engineWear: EngineWearState = pristineEngine();
  private windowMult = 1;
  private missiles: TrackedMissile[] = [];
  private jams: WeaponJam<NpcShipSprite>[] = [];
  private allies: AllyState[] = [];
  private wrecks: TrackedWreck[] = [];
  private flashes: FlashState[] = [];
  private shotFx: ShotFxState[] = [];
  /** One-shot loot-deferral marks consumed by the NPC death path. */
  private readonly deferredLootNpcIds = new Set<string>();
  /** Shield max snapshots per NPC id (NpcShip persists only the live pool). */
  private readonly npcShieldMax = new Map<string, number>();

  private clockMs = 0;
  private roll = 0;
  private prevShipAngle: number | null = null;
  private missileSeq = 0;

  /** Injected RNG (missile evasion rolls) — public setter for deterministic tests,
   *  the `SettingsPanel.selectFont` testability convention. */
  private rng: () => number = Math.random;

  constructor(host: CombatExecutionHost) {
    this.host = host;
  }

  setRng(fn: () => number): void {
    this.rng = fn;
  }

  /** The active window's afterburner speed multiplier (1 = no boost). The
   *  boost lives exactly one execute window: outside EXECUTING it reads 1 even
   *  before the next (frozen-planning) tick clears the internal value. */
  get windowBoostMultiplier(): number {
    return this.host.isExecuting() ? this.windowMult : 1;
  }

  /** Remaining engine integrity 0..1 (afterburner wear, per-fight). */
  get engineIntegrity(): number {
    return this.engineWear.integrity;
  }

  /** Whether the engine can still afterburn this fight. */
  canAfterburn(): boolean {
    return canAfterburn(this.engineWear, AFTERBURNER);
  }

  get missileCount(): number {
    return this.missiles.length;
  }

  get wreckCount(): number {
    return this.wrecks.length;
  }

  /** Live wreck positions (tests assert drift). */
  wreckPositions(): { x: number; y: number }[] {
    return this.wrecks.map((w) => ({ x: w.state.x, y: w.state.y }));
  }

  get allyCount(): number {
    return this.allies.length;
  }

  get shieldFlashCount(): number {
    return this.flashes.length;
  }

  get shotFxCount(): number {
    return this.shotFx.length;
  }

  /** The player sprite's current visual banking roll (radians). */
  get bankingRoll(): number {
    return this.roll;
  }

  // ---------------------------------------------------------------------------
  // Confirm-time resolution (planning-phase actions)
  // ---------------------------------------------------------------------------

  /**
   * A turn was confirmed: resolve the one-shot planned actions for this window.
   *
   * Each confirmed window is one combat round — reset the damage budget.
   * EXCEPT a re-confirm that leaves an ALREADY-in-flight course untouched
   * (win-rate-100pct plan, Task 6 — the round-count telemetry's own
   * root-cause finding): `planningDriver.ts`'s own convention is "destination
   * untouched (a null destination leaves the current course, so a warp-edge
   * or fly-forward route keeps flying through the execute window)" — a
   * committed flee re-confirms with `plan.destination === null` every window
   * while the ship is still physically moving toward the system boundary
   * from an EARLIER route, not planning a fresh one. That is a continuation,
   * not a new tactical decision, so it does not re-arm a fresh
   * 34%-of-current-hull allowance — restoring `PlayerAgent.completeWarp`'s
   * own documented (but silently defeated) intent that "a committed
   * flee/warp crossing is ONE round," for live play too (this class has one
   * production wiring site, shared by both). A genuinely fresh decision —
   * an explicit new destination this window, OR no destination while the
   * ship is stationary (standing to fight) — still arms a fresh round
   * exactly as before; only an in-flight, unredirected continuation is
   * exempt.
   *
   * **Hardening (round-budget hardening pass):** `isMoving` alone is NOT
   * enough to detect "in-flight continuation" — ordinary standing combat's
   * own auto-orbit (`CombatPursuitController.steerCombatOrbit`) also keeps
   * `isMoving` true throughout a fight (it re-`setPath`s every unfrozen frame
   * to hold weapon range, by design — see `flight/CLAUDE.md`), which would
   * otherwise exempt EVERY multi-window fight from re-arming, not just
   * genuine flees (verified live: an ordinary stand-and-fight with no
   * destination ever plotted still reads `isMoving === true` by the end of
   * its first window). `isPursuitSuspended()` is the real signal: it is only
   * true while the auto-pursuit is actually yielding to a player/agent route
   * (`CombatPursuitController.pursuitSuspended`) — false for the auto-orbit
   * case. Both conditions must hold for the exemption.
   */
  beginWindow(plan: PlannedTurn<NpcShipSprite, WeaponSpec>): void {
    const continuingCourse =
      plan.destination === null &&
      this.host.getShipPhysics()?.isMoving === true &&
      (this.host.isPursuitSuspended?.() ?? false);
    if (!continuingCourse) this.host.beginRound?.();
    this.windowMult = 1;
    if (plan.afterburner) this.engageAfterburnerForWindow();
    if (plan.consumableId) this.activateConsumable(plan.consumableId);
    if (plan.commsAction) this.runCommsAction(plan.commsAction);
  }

  private engageAfterburnerForWindow(): void {
    const result = engageAfterburner(this.engineWear, AFTERBURNER);
    this.engineWear = result.state;
    this.windowMult = result.multiplier;
    if (result.engaged) {
      this.host.showMessage(
        t("combat.execution.afterburnerEngaged", {
          integrity: Math.round(this.engineWear.integrity * 100),
        }),
        EXEC_TINT,
      );
    } else {
      this.host.showMessage(t("combat.execution.afterburnerSpent"), WARN_TINT);
    }
  }

  private activateConsumable(id: string): void {
    const def = consumableById(id);
    const inventory = this.host.getPlayerInventory();
    if (!def || !inventory?.hasConsumable(id)) return;
    // Spend the device only once its branch's precondition holds — a missing
    // ship/physics/target must not consume it with no effect.
    switch (def.effect) {
      case "shield-restore": {
        const ship = this.host.getPlayerShip();
        if (!ship) return;
        inventory.removeConsumable(id);
        const before = ship.shields;
        ship.shields = applyShieldRestore(
          ship.shields,
          ship.maxShields,
          COMBAT_CONSUMABLE.shieldRestoreAmount,
        );
        const physics = this.host.getShipPhysics();
        if (physics) {
          this.spawnFlash(
            physics.shipX,
            physics.shipY,
            (SHIP_VISUAL_RADIUS + 4) * SHIELD_COMBAT.shieldFlashRadiusScale,
          );
        }
        this.host.showMessage(
          t("combat.execution.shieldRestored", {
            amount: Math.round(ship.shields - before),
          }),
          EXEC_TINT,
        );
        return;
      }
      case "aoe-damage": {
        const physics = this.host.getShipPhysics();
        if (!physics) return;
        inventory.removeConsumable(id);
        const center = { x: physics.shipX, y: physics.shipY };
        const hits = aoeDamageTargets(
          center,
          this.host.combatants(),
          (s) => ({ x: s.x, y: s.y }),
          COMBAT_CONSUMABLE,
        );
        for (const hit of hits) {
          this.host.landShot(hit.enemy, hit.damage, center);
        }
        this.host.showMessage(
          t("combat.execution.aoe", { count: hits.length }),
          EXEC_TINT,
        );
        return;
      }
      case "weapon-jam": {
        const target = this.host.selectedTarget() ?? this.host.combatants()[0];
        if (!target) return;
        inventory.removeConsumable(id);
        this.jams.push(
          jamTarget(target, this.clockMs, COMBAT_CONSUMABLE.weaponJamMs),
        );
        this.host.showMessage(
          t("combat.execution.jammed", { name: target.npc.name }),
          EXEC_TINT,
        );
        return;
      }
    }
  }

  private runCommsAction(action: string): void {
    switch (action) {
      case "bribe":
        this.resolveBribeAction();
        return;
      case "demand-surrender":
        this.resolveSurrenderAction();
        return;
      case "call-for-help":
        this.resolveCallForHelp();
        return;
    }
  }

  /** Bribe: pay the shakedown tribute through the bank; everyone disengages. */
  private resolveBribeAction(): void {
    const hostiles = [...this.host.combatants()];
    if (hostiles.length === 0) return;
    const bribe = resolveBribe(this.host.getPlayerCredits());
    const payee = this.host.selectedTarget() ?? hostiles[0];
    this.host.payBribe(bribe.tribute, payee.npc);
    if (bribe.disengages) {
      // Non-selected first, selected last — the same ordering pruneDisengaged
      // uses so an intermediate drop never re-pauses onto a ship that is itself
      // about to leave this same resolution.
      const selected = this.host.selectedTarget();
      for (const s of hostiles) if (s !== selected) this.departAndDisengage(s);
      if (selected) this.departAndDisengage(selected);
    }
    this.host.showMessage(
      t("combat.execution.bribed", { amount: bribe.tribute }),
      EXEC_TINT,
    );
  }

  /** Demand-surrender against the selected (or first) hostile — role/hull gated. */
  private resolveSurrenderAction(): void {
    const target = this.host.selectedTarget() ?? this.host.combatants()[0];
    if (!target) return;
    const npc = target.npc;
    const fraction = npc.maxHull > 0 ? npc.hullHP / npc.maxHull : 1;
    const verdict = resolveSurrenderDemand(npc.role, fraction, COMBAT_COMMS);
    if (!verdict.surrenders) {
      this.host.showMessage(
        t("combat.execution.surrenderRefused", { name: npc.name }),
        WARN_TINT,
      );
      return;
    }
    // Recorded Task 10 decision: a yielding ship flees while dropping its loot.
    this.host.spawnLoot(npc, target.x, target.y);
    this.departAndDisengage(target);
    this.host.showMessage(
      t("combat.execution.surrendered", { name: npc.name }),
      EXEC_TINT,
    );
  }

  /** Call-for-help: the closest eligible friendly joins and fires at the hostiles. */
  private resolveCallForHelp(): void {
    const physics = this.host.getShipPhysics();
    if (!physics) return;
    const engaged = new Set(this.host.combatants());
    const recruited = new Set(this.allies.map((a) => a.sprite));
    const ally = findCallForHelpAlly(
      { x: physics.shipX, y: physics.shipY },
      this.host.npcSprites(),
      (s) => ({ x: s.x, y: s.y }),
      (s) => s.npc.role,
      (s) =>
        !engaged.has(s) &&
        !recruited.has(s) &&
        !s.npc.hostile &&
        !s.isLeaving() &&
        !s.isGone(),
      COMBAT_COMMS,
    );
    if (!ally) {
      this.host.showMessage(t("combat.execution.allyNone"), WARN_TINT);
      return;
    }
    this.allies.push({ sprite: ally, fireTimerMs: 0 });
    this.host.showMessage(
      t("combat.execution.allyJoined", { name: ally.npc.name }),
      EXEC_TINT,
    );
  }

  private departAndDisengage(sprite: NpcShipSprite): void {
    sprite.beginDeparture();
    this.host.disengage(sprite);
  }

  // ---------------------------------------------------------------------------
  // CombatModule seams (wired through `buildCombatModuleDeps`)
  // ---------------------------------------------------------------------------

  /** True while a weapon-jam is suppressing this NPC's fire. */
  isNpcJammed(npc: NpcShipSprite): boolean {
    return this.jams.some(
      (j) => j.target === npc && isJamActive(j, this.clockMs),
    );
  }

  /**
   * A planned execute-window shot is about to resolve: a `WeaponClass.MISSILE`
   * gun launches a tracked projectile instead of the instant hit-scan. Returns
   * whether the shot was consumed (the module then skips its instant damage).
   */
  interceptPlannedShot(target: NpcShipSprite, weapon: WeaponSpec): boolean {
    if (weapon.weaponClass !== WeaponClass.MISSILE) return false;
    const physics = this.host.getShipPhysics();
    if (!physics) return false;
    const state = launchMissile({
      id: `msl_${++this.missileSeq}`,
      from: { x: physics.shipX, y: physics.shipY },
      target: { x: target.x, y: target.y },
      speedPerMs: MISSILE_COMBAT.speedPerMs,
      damage: weapon.damage,
      homing: weapon.ability === WeaponAbility.HOMING,
    });
    this.missiles.push({
      state,
      target,
      weapon,
      trail: [{ x: state.pos.x, y: state.pos.y }],
    });
    return true;
  }

  /**
   * A player hit-scan shot fired: draw it in its weapon-type style (Task 13)
   * instead of the flat legacy tracer. Returns true = handled (the module skips
   * its own `flashShot` for this shot; NPC fire keeps the legacy tracer).
   */
  onPlayerShotVfx(
    fromX: number,
    fromY: number,
    target: NpcShipSprite,
    weapon: WeaponSpec,
  ): boolean {
    this.shotFx.push({
      spec: {
        variant: selectWeaponVfx(weapon),
        from: { x: fromX, y: fromY },
        to: { x: target.x, y: target.y },
      },
      ageMs: 0,
    });
    return true;
  }

  /** A ship's shields absorbed a hit — spawn the translucent flash sphere. */
  spawnNpcShieldFlash(target: NpcShipSprite): void {
    this.spawnFlash(
      target.x,
      target.y,
      SHIP_VISUAL_RADIUS * SHIELD_COMBAT.shieldFlashRadiusScale,
    );
  }

  private spawnFlash(x: number, y: number, radius: number): void {
    this.flashes.push({ x, y, radius, ageMs: 0 });
  }

  /**
   * An NPC was killed in combat: spawn a drifting wreck inheriting the dying
   * ship's velocity/heading and schedule its staggered loot emissions. Marks the
   * NPC so the death path defers its instant loot dump to the drift.
   */
  onNpcKilled(sprite: NpcShipSprite): void {
    const speed = (sprite as { cruiseSpeed?: number }).cruiseSpeed ?? 0;
    const heading = sprite.container?.rotation ?? 0;
    const { vx, vy } = shipVelocity(heading, speed);
    const state = spawnWreck(sprite.x, sprite.y, vx, vy, heading, WRECK);
    const count = this.host.rollLootCount(sprite.npc);
    const emissionTimes = wreckLootEmissionTimes(
      count,
      WRECK.lifeMs * WRECK_LOOT_SPREAD_FRACTION,
    );
    this.wrecks.push({ state, npc: sprite.npc, emissionTimes });
    // Mark even a zero-count roll: the wreck's single pre-roll OWNS this kill's
    // drop. Skipping the mark on 0 would let the death path re-roll the loot
    // independently, inflating the effective drop rate.
    this.deferredLootNpcIds.add(sprite.npc.id);
    this.npcShieldMax.delete(sprite.npc.id);
  }

  /**
   * One-shot query the NPC death path makes: defer this kill's instant loot dump
   * (the wreck's drift emissions own it instead)? Consumes the mark.
   */
  consumeLootDeferral(npc: NpcShip): boolean {
    return this.deferredLootNpcIds.delete(npc.id);
  }

  // ---------------------------------------------------------------------------
  // Per-frame fold (ticked by the scene only while the sim is not frozen)
  // ---------------------------------------------------------------------------

  update(dtMs: number): void {
    if (!(dtMs > 0)) return;
    this.clockMs += dtMs;
    const physics = this.host.getShipPhysics();
    const executing = this.host.isExecuting();
    if (!executing) this.windowMult = 1;
    this.jams = this.jams.filter((j) => isJamActive(j, this.clockMs));

    if (executing && physics) this.applyMovementFolds(physics, dtMs);
    this.updateBanking(physics, dtMs, executing);
    this.advanceMissiles(dtMs);
    this.advanceAllies(dtMs);
    this.advanceWrecks(dtMs);

    for (const f of this.flashes) f.ageMs += dtMs;
    this.flashes = this.flashes.filter(
      (f) => shieldFlashAlpha(f.ageMs, SHIELD_COMBAT) > 0,
    );
    for (const s of this.shotFx) s.ageMs += dtMs;
    this.shotFx = this.shotFx.filter((s) => s.ageMs < SHOT_FX_MS);

    this.draw();
  }

  /** Gravity assist → `ShipPhysics` velocity; afterburner → extra forward travel. */
  private applyMovementFolds(
    physics: ExecutionShipPhysics,
    dtMs: number,
  ): void {
    if (!physics.isMoving) return;
    // Mirror ShipPhysics.update's own effective-dt (lag-spike cap × timeScale).
    const dtEff = Math.min(dtMs, 100) * physics.timeScale;
    const speed = physics.currentSpeed;
    if (speed > 0) {
      const delta = gravityAssistTotal(
        {
          pos: { x: physics.shipX, y: physics.shipY },
          vel: {
            x: Math.cos(physics.shipAngle) * speed,
            y: Math.sin(physics.shipAngle) * speed,
          },
        },
        this.host.getPlanets().map((p) => ({
          x: p.x,
          y: p.y,
          radius: p.radius,
        })),
        dtEff,
        GRAVITY_ASSIST,
      );
      const boost = Math.hypot(delta.x, delta.y);
      if (boost > 0) physics.currentSpeed += boost;
    }
    if (this.windowMult > 1) {
      const extra = (this.windowMult - 1) * physics.currentSpeed * dtEff;
      physics.shipX += Math.cos(physics.shipAngle) * extra;
      physics.shipY += Math.sin(physics.shipAngle) * extra;
    }
  }

  /** Presentation-only banking roll from the live turn rate (Task 11). */
  private updateBanking(
    physics: ExecutionShipPhysics | null,
    dtMs: number,
    executing: boolean,
  ): void {
    let target = 0;
    if (executing && physics) {
      if (this.prevShipAngle !== null) {
        const rate = shipTurnRate(this.prevShipAngle, physics.shipAngle, dtMs);
        target = bankingAngle(rate, BANKING);
      }
      this.prevShipAngle = physics.shipAngle;
    } else {
      this.prevShipAngle = null;
    }
    this.roll = approachRoll(this.roll, target, dtMs, BANKING);
    const visual = this.host.getPlayerVisual();
    if (visual?.scale) {
      // A top-down sprite reads a roll as a transverse squash toward cos(roll).
      visual.scale.y = Math.cos(this.roll);
    }
  }

  private advanceMissiles(dtMs: number): void {
    if (this.missiles.length === 0) return;
    for (const m of this.missiles) {
      const gone = m.target.container?.destroyed || m.target.isGone();
      const targetPos = gone ? null : { x: m.target.x, y: m.target.y };
      m.state = advanceMissile(m.state, targetPos, dtMs, MISSILE_COMBAT);
      m.trail.push({ x: m.state.pos.x, y: m.state.pos.y });
      if (m.state.status === "arrived") {
        m.state = resolveMissileArrival(m.state, this.rng(), MISSILE_COMBAT);
        if (m.state.status === "hit" && !gone) {
          this.host.landShot(m.target, m.state.damage, m.state.pos);
        }
      }
    }
    this.missiles = this.missiles.filter((m) => !isMissileDone(m.state));
  }

  /** Recruited allies fire at the nearest hostile within their own reach. */
  private advanceAllies(dtMs: number): void {
    if (this.allies.length === 0) return;
    if (!this.host.isCombatActive()) {
      this.allies = [];
      return;
    }
    this.allies = this.allies.filter(
      (a) => !a.sprite.container?.destroyed && !a.sprite.isGone(),
    );
    for (const ally of this.allies) {
      ally.fireTimerMs += dtMs;
      if (ally.fireTimerMs < GAME_BALANCE.combatFireIntervalMs) continue;
      const target = this.nearestCombatant(ally.sprite.x, ally.sprite.y);
      if (!target) {
        ally.fireTimerMs = GAME_BALANCE.combatFireIntervalMs; // primed
        continue;
      }
      const d = Math.hypot(target.x - ally.sprite.x, target.y - ally.sprite.y);
      if (d > npcWeaponRange(ally.sprite.npc)) {
        ally.fireTimerMs = GAME_BALANCE.combatFireIntervalMs; // primed
        continue;
      }
      ally.fireTimerMs = 0;
      const from = { x: ally.sprite.x, y: ally.sprite.y };
      this.host.landShot(target, ally.sprite.npc.damage, from);
      this.shotFx.push({
        spec: {
          variant: { kind: WeaponVfxKind.BEAM, distortion: false },
          from,
          to: { x: target.x, y: target.y },
          color: ALLY_SHOT_COLOR,
        },
        ageMs: 0,
      });
    }
  }

  private nearestCombatant(x: number, y: number): NpcShipSprite | null {
    let best: NpcShipSprite | null = null;
    let bestD = Infinity;
    for (const s of this.host.combatants()) {
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  /** Step every wreck's drift and fire its due loot emissions at the LIVE position. */
  private advanceWrecks(dtMs: number): void {
    if (this.wrecks.length === 0) return;
    for (const w of this.wrecks) {
      const prevAge = w.state.ageMs;
      w.state = advanceWreck(w.state, dtMs, WRECK);
      const due = dueLootEmissions(prevAge, w.state.ageMs, w.emissionTimes);
      for (let i = 0; i < due.length; i++) {
        this.host.spawnLoot(w.npc, w.state.x, w.state.y, 1);
      }
    }
    this.wrecks = this.wrecks.filter((w) => !isWreckDone(w.state));
  }

  // ---------------------------------------------------------------------------
  // Drawing (thin — all styles come from the Task 12/13/14 render seams)
  // ---------------------------------------------------------------------------

  private draw(): void {
    const fx = this.ensureGraphics("fx");
    if (fx) {
      const shots: WeaponVfxSpec[] = this.shotFx.map((s) => ({
        ...s.spec,
        alpha: Math.max(0, 1 - s.ageMs / SHOT_FX_MS),
      }));
      for (const m of this.missiles) {
        shots.push({
          variant: { kind: WeaponVfxKind.MISSILE_TRAIL, distortion: false },
          from: { x: m.state.launchPos.x, y: m.state.launchPos.y },
          to: { x: m.state.pos.x, y: m.state.pos.y },
          trail: missileTrailPoints(m.trail),
          alpha: 1,
        });
      }
      drawWeaponVfx(fx, shots);
      // Shield flashes share the fx layer's z-band but keep their own Graphics
      // so drawWeaponVfx's clear() doesn't erase them (and vice versa).
    }
    const flashG = this.ensureGraphics("flash");
    if (flashG) {
      const specs: ShieldFlashSpec[] = this.flashes.map((f) => ({
        x: f.x,
        y: f.y,
        radius: f.radius,
        alpha: shieldFlashAlpha(f.ageMs, SHIELD_COMBAT),
      }));
      drawShieldFlashes(flashG, specs);
    }
    const bars = this.ensureGraphics("bars");
    if (bars) drawShipStatusBars(bars, this.statusBarSpecs(), SHIELD_COMBAT);
    const wrecks = this.ensureGraphics("wrecks");
    if (wrecks) {
      drawWrecks(
        wrecks,
        this.wrecks.map((w) => ({
          x: w.state.x,
          y: w.state.y,
          angle: w.state.angle,
          alpha: wreckAlpha(w.state, WRECK),
          size: SHIP_VISUAL_RADIUS,
        })),
      );
    }
  }

  /** Floating hull/shield bars: every engaged hostile (red hull) + the player. */
  private statusBarSpecs(): ShipStatusBarSpec[] {
    if (!this.host.isCombatActive()) return [];
    const specs: ShipStatusBarSpec[] = [];
    for (const s of this.host.combatants()) {
      const npc = s.npc;
      const seenMax = Math.max(
        this.npcShieldMax.get(npc.id) ?? 0,
        npc.shields ?? 0,
      );
      if (seenMax > 0) this.npcShieldMax.set(npc.id, seenMax);
      specs.push({
        x: s.x,
        y: s.y,
        hull: npc.hullHP,
        maxHull: npc.maxHull,
        shields: npc.shields,
        maxShields: seenMax,
        hullColor: 0xff5544,
      });
    }
    const physics = this.host.getShipPhysics();
    const ship = this.host.getPlayerShip();
    if (physics && ship) {
      specs.push({
        x: physics.shipX,
        y: physics.shipY,
        hull: ship.hullHP,
        maxHull: ship.maxHull,
        shields: ship.shields,
        maxShields: ship.maxShields,
      });
    }
    return specs;
  }

  private readonly gfx = new Map<string, Graphics>();

  private ensureGraphics(key: string): Graphics | null {
    let g = this.gfx.get(key) ?? null;
    if (g && !g.destroyed) return g;
    try {
      g = new Graphics();
    } catch {
      return null; // headless callers without a working Graphics stub
    }
    g.eventMode = "none";
    g.zIndex = key === "wrecks" ? 60 : key === "bars" ? 120 : 95;
    this.host.getGameLayer().addChild(g);
    this.gfx.set(key, g);
    return g;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * The fight resolved (player death / last hostile gone): clear the per-fight
   * state. Wrecks + fading flashes deliberately keep drifting past the fight's
   * end; the engine wear resets so the NEXT engagement starts pristine.
   */
  endFight(): void {
    for (const m of this.missiles) {
      m.state = { ...m.state, status: "miss" };
    }
    this.missiles = [];
    this.jams = [];
    this.allies = [];
    this.shotFx = [];
    this.windowMult = 1;
    this.engineWear = pristineEngine();
    this.roll = 0;
    this.prevShipAngle = null;
    this.npcShieldMax.clear();
    const visual = this.host.getPlayerVisual();
    if (visual?.scale) visual.scale.y = 1;
    const bars = this.gfx.get("bars");
    if (bars && !bars.destroyed) drawShipStatusBars(bars, [], SHIELD_COMBAT);
    const fx = this.gfx.get("fx");
    if (fx && !fx.destroyed) drawWeaponVfx(fx, []);
  }

  destroy(): void {
    this.endFight();
    this.wrecks = [];
    this.flashes = [];
    this.deferredLootNpcIds.clear();
    for (const g of this.gfx.values()) {
      if (!g.destroyed) {
        g.parent?.removeChild(g);
        g.destroy();
      }
    }
    this.gfx.clear();
  }
}

/** Factory mirroring `createCombatPlanningController` — the scene builds the host
 *  from its own members at the call site. */
export function createCombatExecution(
  host: CombatExecutionHost,
): CombatExecutionController {
  return new CombatExecutionController(host);
}
