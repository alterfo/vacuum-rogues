import type { Container } from "pixi.js";
import type { ShipPhysics } from "@/systems/ShipPhysics";
import type { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import { GearKind, type WeaponSpec } from "@/systems/equipment/GearCatalog";
import { GAME_BALANCE } from "@/config/balance";
import type { GameMode } from "@/types";
import { applyDamageWithMode, isHullDowned } from "@/systems/combat/godMode";
import { npcWeaponRange } from "@/systems/combat/npcWeapon";
import type { NpcShipSprite } from "../NpcShipSprite";
import type { FlightModule } from "./FlightModule";
import { CombatHud } from "./CombatHud";
import { DamageNumbers } from "./DamageNumbers";
import { logger } from "@/utils/logger";

/** Player gets a one-shot retreat warning when its hull drops below this fraction of max. */
const LOW_HULL_FRACTION = 0.3;

/**
 * A weapon's real-time auto-fire interval in ms: its catalog `cooldownTurns`
 * (1–3) scaled by the base per-turn interval
 * {@link GAME_BALANCE.combatFireIntervalMs}. So a `cooldownTurns: 1` weapon keeps
 * the old flat cadence, while a slow, high-damage weapon (`cooldownTurns: 3`)
 * fires a third as often — cadence is now a real tradeoff against per-shot
 * `damage` (the high-`damage` beam is *not* a free upgrade: its sustained DPS,
 * `damage ÷ interval`, can be lower than a quick pulse's). `cooldownTurns` is
 * clamped to ≥1 so a malformed 0 can't make a weapon fire every frame.
 */
export function weaponFireIntervalMs(weapon: {
  readonly cooldownTurns: number;
}): number {
  return Math.max(1, weapon.cooldownTurns) * GAME_BALANCE.combatFireIntervalMs;
}

/**
 * Live state the combat module reads from the host scene without depending on
 * the concrete {@link SpaceFlightScene}. The authoritative ship physics stays in
 * the scene; the module reads it through this accessor (Low Coupling / DIP).
 *
 * The HUD accessors are optional so lightweight callers (unit tests) can drive
 * the lifecycle without a rendering context; when all are present the module
 * builds a {@link CombatHud} on {@link CombatModule.initialize}.
 */
export interface CombatModuleDeps {
  /** Authoritative player ship physics (null before the ship spawns). */
  getShipPhysics(): ShipPhysics | null;
  /**
   * Whether the active-pause is freezing the world. Combat fire is gated on the
   * **active-pause only**, not the route-turn — an engaged fight ticks in real
   * time whether or not a "Ход" is running (Space-Rangers model). When this is
   * supplied it is the *sole* freeze signal and {@link isTurnRunning} is ignored.
   * Optional so lightweight callers (unit tests) can drive the timers directly.
   */
  isPaused?(): boolean;
  /**
   * Legacy turn-running signal. Only consulted when {@link isPaused} is **not**
   * supplied: a host (or test) that folds the active-pause into this accessor
   * (returning `false` while frozen) still freezes fire correctly. Production
   * wires {@link isPaused} instead, so fire is decoupled from the route-turn.
   * Absent + no `isPaused` ⇒ the fight always advances.
   */
  isTurnRunning?(): boolean;
  /** Player's canonical loadout — source of the equipped weapon. */
  getPlayerLoadout?(): ShipLoadout | null;
  /** Live UI layer the HUD overlay is mounted on. */
  getUiLayer?(): Container;
  /** Live world (game) layer the dashed range circle is drawn on. */
  getGameLayer?(): Container;
  /** Current viewport size, for anchoring the HUD overlay. */
  getScreenSize?(): { width: number; height: number };
  /** Player ship — incoming NPC fire reduces its hull each round (Task 1). */
  getPlayerShip?(): { hullHP: number; maxHull: number } | null;
  /**
   * Current difficulty mode. In GOD a lethal hit floors the player's hull above
   * 0 and "downs" the ship (no death, but it can't fire or hyperjump until
   * repaired above the floor); NORMAL/HARD are unchanged. Absent ⇒ NORMAL, so
   * lightweight callers (unit tests) need not supply it.
   */
  getGameMode?(): GameMode;
  /** Resolve a killed NPC: drop loot, remove the sprite + domain entry. */
  onNpcDestroyed?(sprite: NpcShipSprite): void;
  /**
   * Player ship hull reached 0 from incoming NPC fire → game over. Fired at
   * most once per fight (a one-shot guard inside the module), and the host
   * (`GameEngine.triggerPlayerDeath`) guards again so a stray same-frame shot
   * can't re-fire the death flow.
   */
  onPlayerDestroyed?(): void;
  /**
   * An incoming NPC shot landed on the player — the active-pause trigger. Raised
   * on every hit; the {@link CombatPauseController} debounces it down to the first
   * shot per engagement, so the module fires it unconditionally (Low Coupling).
   */
  onPlayerUnderAttack?(): void;
  /**
   * The fight ended (every combatant killed or fled, or the module was torn
   * down). The host wires this to {@link CombatPauseController.reset} so the
   * active-pause debounce re-arms — otherwise the next engagement would never
   * pause on its first incoming shot (the "incoming-attack" trigger stays
   * consumed across fights). Fired from {@link CombatModule.endCombat}.
   */
  onCombatEnded?(): void;
  /**
   * The player's *currently selected* auto-fire target was lost mid-fight — killed
   * or drifted out of range — while other combatants are still engaged. The host
   * wires this to {@link CombatPauseController.notifyTargetLost} so the game
   * re-pauses and the player picks a new target instead of silently auto-continuing
   * in real time. Only fired when a survivor remains: losing the *last* combatant
   * ends the fight ({@link endCombat}) rather than re-pausing onto an empty overlay.
   */
  onTargetLost?(sprite: NpcShipSprite): void;
  /** Transient toast feedback (kill confirmation / low-hull retreat). */
  showMessage?(text: string, color?: number): void;
}

/**
 * Real-time in-flight combat. Hostile NPCs that close inside weapon range are
 * added as combatants and fire at the player every
 * {@link GAME_BALANCE.combatFireIntervalMs}; the player's weapon auto-fires at
 * the same cadence against the {@link CombatModule.selectedTarget}. Nothing
 * freezes — ships keep moving and there is no scene transition. Combat is
 * real-time-only: the hex CombatScene was deleted, so every fight (including the
 * OVERMIND-core boss and former scripted text-quest encounters) resolves here.
 *
 * Combatants leave the set when they die (player fire) or drift beyond scanner
 * range; combat ends automatically once the set empties.
 */
export class CombatModule implements FlightModule {
  private readonly deps: CombatModuleDeps;

  /** HUD overlay + range circle (null when the host has no render context). */
  private hud: CombatHud | null = null;

  /** Floating damage numbers (null when the host has no render context). */
  private damageNumbers: DamageNumbers | null = null;

  /** Every hostile NPC currently engaged in the fight. */
  readonly combatants = new Set<NpcShipSprite>();

  /** ms elapsed since each combatant last fired at the player. */
  private readonly npcFireTimers = new Map<NpcShipSprite, number>();

  /**
   * ms elapsed since each fitted weapon last fired, keyed by the weapon's index
   * in {@link fittedWeapons}. Each weapon auto-fires on its **own**
   * {@link weaponFireIntervalMs} cadence (derived from its `cooldownTurns`), and
   * tracks its own timer so a weapon held out of range (no combatant within its
   * `range`) keeps its cadence independently of the others. Reset on engage /
   * confirm / end.
   */
  private readonly weaponFireTimers = new Map<number, number>();

  /** Guards the one-shot low-hull retreat warning per fight. */
  private lowHullWarned = false;

  /**
   * Guards the one-shot "ship downed" warning per fight (GOD mode only): once a
   * lethal hit floors the hull we tell the player exactly once that they must
   * repair before they can fire or jump again. Reset by {@link endCombat}.
   */
  private downedWarned = false;

  /**
   * Guards the one-shot player-death notification per fight: once the player's
   * hull hits 0 we surface the death exactly once, even if more NPC shots land
   * the same frame. Reset by {@link CombatModule.endCombat}.
   */
  private playerDeathReported = false;

  /**
   * The NPC the player's weapon auto-fires at. Defaults to the first combatant;
   * the player can click another enemy sprite to switch it, or click empty space
   * to deselect.
   */
  selectedTarget: NpcShipSprite | null = null;

  /** True while at least one combatant is engaged. */
  isActive = false;

  /**
   * Wall-clock ms of the last "нет оружия" hint. The garrison-aggro path calls
   * {@link addCombatant} every frame for each in-range aggressor, so a
   * weaponless player would otherwise see the toast spammed every frame; this
   * throttles it to {@link WEAPONLESS_HINT_COOLDOWN_MS}.
   */
  private weaponlessHintAtMs = 0;
  private static readonly WEAPONLESS_HINT_COOLDOWN_MS = 3000;

  constructor(deps: CombatModuleDeps) {
    this.deps = deps;
  }

  /** Build the HUD + damage-number layer if the host supplied render layers. */
  initialize(): void {
    const { getUiLayer, getGameLayer, getScreenSize } = this.deps;
    if (!getUiLayer || !getGameLayer || !getScreenSize) return;
    this.damageNumbers = new DamageNumbers(getGameLayer());
    this.hud = new CombatHud(getUiLayer(), getGameLayer(), {
      getShipPos: () => {
        const p = this.deps.getShipPhysics();
        return p ? { x: p.shipX, y: p.shipY } : null;
      },
      getScreenSize,
      getPlayerLoadout: () => this.deps.getPlayerLoadout?.() ?? null,
    });
  }

  /**
   * Per-frame: float active damage numbers, then (while a fight is on) drop
   * disengaged combatants, advance every fire timer firing shots as they elapse,
   * and end the fight once the set empties. Damage numbers advance even after
   * combat ends so a killing blow's number finishes its float.
   */
  update(deltaTime: number, _bgElapsed?: number): void {
    this.damageNumbers?.update(deltaTime);
    // Advance in-flight tracers ONLY while not frozen by the active pause: a shot
    // launched the instant before the pause must freeze mid-flight (no travel, no
    // impact) and resume on unpause, so the pause freezes the *whole* fight, not
    // just new shots. Nothing post-fight relies on this run: damage numbers float
    // independently (above), and endCombat() tears the HUD's own flashes down via
    // hud.close() — and a fight only reaches that end while already unpaused.
    if (!this.isFrozen()) this.hud?.update(deltaTime);
    if (!this.isActive) return;
    // Combat fire is gated on the active-pause ONLY — the fight ticks in real
    // time whether or not a route-"Ход" is running (decoupled from the turn).
    // Pausing freezes the world, so combat must not keep draining the player's
    // hull while paused. Damage numbers (above) still float so a killing blow's
    // number finishes its arc.
    if (this.isFrozen()) return;
    this.pruneDisengaged();
    // pruneDisengaged can drop the *selected* target (it drifted beyond escape
    // range) and synchronously raise a target-lost active-pause via onTargetLost
    // → loseTarget → enterPause. The world is frozen the instant that pause is
    // raised, so the player's auto-fire must not still land on the re-picked
    // survivor this frame — re-check the gate before it, mirroring the guard
    // before advanceNpcTimers below.
    if (this.isFrozen()) return;
    this.advancePlayerWeapons(deltaTime);
    // A killing player shot can re-pause the fight mid-frame: the selected target
    // was lost but a survivor remains → onTargetLost → active-pause. The world is
    // frozen the instant that pause is raised, so surviving NPCs must not still
    // fire this frame (re-check the same gate as the top of update()).
    if (this.isFrozen()) return;
    this.advanceNpcTimers(deltaTime);
    if (this.combatants.size === 0) {
      this.endCombat();
      return;
    }
    this.syncHud();
  }

  /**
   * Engage `npc`: add it to the combatant set (idempotent) and arm its fire
   * timer. The first combatant raises {@link isActive}, resets the player's
   * timer and opens the HUD; subsequent aggressors just join. A weaponless
   * player can't fight, so the call is a no-op (the ship stays free to flee
   * instead of being locked into a fight it can't win).
   */
  addCombatant(npc: NpcShipSprite): void {
    if (this.combatants.has(npc)) return; // idempotent — cheapest check first
    // The garrison-aggro path calls this every frame for each in-range
    // aggressor; the membership guard above means already-engaged NPCs never
    // reach the loadout rebuild below.
    const loadout = this.deps.getPlayerLoadout?.() ?? null;
    if (loadout && !this.hasWeapon(loadout)) {
      // Don't silently drop the engagement — tell the player why the fight
      // never starts so the state is legible (no auto-fire без оружия). The
      // ship stays free to flee instead of being locked into an unwinnable
      // fight.
      this.warnWeaponless();
      return;
    }

    this.combatants.add(npc);
    this.npcFireTimers.set(npc, 0);
    if (!this.selectedTarget) this.selectedTarget = npc;

    if (!this.isActive) {
      this.isActive = true;
      this.weaponFireTimers.clear();
      this.lowHullWarned = false;
      this.hud?.open(this.selectedTarget);
    }
    logger.info(`In-flight combat: engaged ${npc.npc.id}`);
  }

  /**
   * Every weapon fitted in the loadout — the selectable list the active-pause
   * overlay offers (the player picks one to fire), and the full set the real-time
   * loop ({@link advancePlayerWeapons}) auto-fires each within its own range.
   * Empty without a loadout.
   */
  fittedWeapons(): WeaponSpec[] {
    const loadout = this.deps.getPlayerLoadout?.() ?? null;
    if (!loadout) return [];
    return loadout
      .slottedWithGear()
      .map((s) => s.gear)
      .filter((g): g is WeaponSpec => !!g && g.kind === GearKind.WEAPON);
  }

  /**
   * Active-pause confirmed action: fire exactly one shot at `target` with the
   * player-chosen `weapon`, then keep `target` as the auto-fire selection so the
   * real-time fight continues against it once time resumes. Resets every weapon's
   * fire cadence so the resumed real-time auto-fire doesn't immediately double-fire.
   * A no-op outside an active fight or against a non-combatant. Unlike the auto-fire
   * loop in {@link advancePlayerWeapons}, a *deliberate* confirmed shot is not gated
   * on the weapon's range — every engaged combatant is within
   * {@link GAME_BALANCE.combatEscapeRange}, and a hand-picked shot is allowed to
   * land. Reuses {@link firePlayerShot} so the kill/loot/damage-number path is
   * identical to the real-time loop. (The real-time loop fires *all* fitted weapons;
   * this is the single deliberate shot the player aims by hand.)
   */
  confirmAttack(target: NpcShipSprite, weapon: WeaponSpec): void {
    if (!this.isActive || !this.combatants.has(target)) return;
    // A downed ship (GOD mode, hull at the floor) can't fire — even a deliberate
    // hand-picked shot is blocked until the hull is repaired above the floor.
    if (this.isPlayerDowned()) return;
    this.selectTarget(target);
    this.firePlayerShot(target, weapon);
    this.weaponFireTimers.clear();
  }

  /**
   * Set (or clear) the NPC the player's weapon auto-fires at. Clicking an enemy
   * sprite during a fight selects it; clicking empty space deselects. A no-op
   * outside an active fight.
   */
  selectTarget(sprite: NpcShipSprite | null): void {
    if (!this.isActive) return;
    // Only an engaged combatant can be targeted: clicking a passing neutral must
    // not retarget the weapon to a ship it can never hit (the fire path guards on
    // membership, so an off-set target would show its HP bar yet silently never
    // take fire). null still deselects.
    if (sprite && !this.combatants.has(sprite)) return;
    this.selectedTarget = sprite;
    this.hud?.setTarget(sprite);
  }

  /** End the current fight: drop every combatant, reset timers, close the HUD. */
  endCombat(): void {
    this.isActive = false;
    this.combatants.clear();
    this.npcFireTimers.clear();
    this.selectedTarget = null;
    this.weaponFireTimers.clear();
    this.lowHullWarned = false;
    this.downedWarned = false;
    this.playerDeathReported = false;
    this.hud?.close();
    // Re-arm the active-pause debounce so the next engagement pauses fresh on
    // its first incoming shot (idempotent — safe on a no-op end / teardown).
    this.deps.onCombatEnded?.();
  }

  destroy(): void {
    this.endCombat();
    this.damageNumbers?.clear();
    this.damageNumbers = null;
    this.hud = null;
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /**
   * Drop combatants the player has opened beyond {@link GAME_BALANCE.combatEscapeRange}
   * (a successful escape ends the fight), or whose sprite was destroyed by a
   * non-combat path (e.g. it hyperjumped out and {@link NpcShipManager} removed
   * it). Without the destroyed-sprite check a ghost combatant would linger in the
   * set and keep "firing" at the player — and, if it stayed the selected target,
   * a stray player shot would re-run the death path on an already-destroyed
   * sprite (double-free / duplicate loot).
   */
  private pruneDisengaged(): void {
    const toDrop = [...this.combatants].filter((npc) => this.shouldDrop(npc));
    // Drop the *selected* target LAST: a bulk prune that empties the set must not
    // raise a transient target-lost re-pause onto a survivor that is itself pruned
    // the same frame — that would freeze the fight on an empty overlay (a stuck
    // turn with no combatants). Removing the others first means the selected drop
    // only re-pauses when a genuine survivor remains.
    for (const npc of toDrop)
      if (npc !== this.selectedTarget) this.removeCombatant(npc);
    if (this.selectedTarget && toDrop.includes(this.selectedTarget))
      this.removeCombatant(this.selectedTarget);
  }

  /** A combatant disengages when its sprite is destroyed or opens beyond escape range. */
  private shouldDrop(npc: NpcShipSprite): boolean {
    if (npc.container?.destroyed) return true;
    const d = this.distanceToShip(npc);
    return d === null || d > GAME_BALANCE.combatEscapeRange;
  }

  /**
   * Advance every NPC's fire timer; fire its shot at the player when it elapses
   * and the NPC is within **its own weapon range** ({@link npcWeaponRange}, by
   * role) — not the single flat {@link GAME_BALANCE.weaponRange} every NPC used to
   * share. So enemies vary and a long-range player weapon can't trivially
   * out-range every foe: a patrol (340) can return fire from nearly the player's
   * best common reach.
   */
  private advanceNpcTimers(deltaTime: number): void {
    for (const npc of this.combatants) {
      // A landed NPC shot can raise the active-pause (the first incoming hit of an
      // engagement). The world is frozen the instant that pause is raised, so the
      // remaining aggressors must not still fire this frame — with several enemies
      // whose timers are aligned (all added with timer 0), the first shot pauses
      // and every survivor would otherwise drain the player's hull on the same
      // pausing frame. Re-check the same gate as the top of update() per iteration.
      if (this.isFrozen()) break;
      const t = (this.npcFireTimers.get(npc) ?? 0) + deltaTime;
      const d = this.distanceToShip(npc);
      if (
        t >= GAME_BALANCE.combatFireIntervalMs &&
        d !== null &&
        d <= npcWeaponRange(npc.npc)
      ) {
        this.npcFireTimers.set(npc, 0);
        this.fireNpcShot(npc);
      } else {
        this.npcFireTimers.set(npc, t);
      }
    }
  }

  /**
   * Advance every fitted weapon's fire timer and, as each elapses, fire it at the
   * nearest combatant **within that weapon's own range** ("в зоне поражения
   * орудия"), preferring the {@link selectedTarget} when it is in range. A weapon
   * with no combatant in range holds — its timer stays "ready" (clamped to its
   * interval) so it fires the instant a target closes, rather than re-waiting a
   * full interval. Each weapon keeps its own timer (keyed by its index in
   * {@link fittedWeapons}) **and its own cadence**: the fire interval is derived
   * per-weapon from `cooldownTurns` via {@link weaponFireIntervalMs}, so a slow,
   * high-damage weapon fires less often than a quick one (cadence is a real
   * tradeoff, not a flat rate).
   */
  private advancePlayerWeapons(deltaTime: number): void {
    // A downed ship (GOD mode, hull at the floor) can't auto-fire until repaired.
    if (this.isPlayerDowned()) return;
    const weapons = this.fittedWeapons();
    for (let i = 0; i < weapons.length; i++) {
      // A player shot can kill a target → removeCombatant → onTargetLost →
      // active-pause. The world is frozen the instant that pause is raised, so a
      // later weapon in this loop must not still fire on the pausing frame
      // (mirrors the per-iteration re-check in advanceNpcTimers).
      if (this.isFrozen()) break;
      const weapon = weapons[i];
      const interval = weaponFireIntervalMs(weapon);
      const t = (this.weaponFireTimers.get(i) ?? 0) + deltaTime;
      if (t < interval) {
        this.weaponFireTimers.set(i, t);
        continue;
      }
      const target = this.pickTargetInRange(weapon);
      if (!target) {
        // No combatant in this weapon's range — hold but stay primed.
        this.weaponFireTimers.set(i, interval);
        continue;
      }
      this.weaponFireTimers.set(i, 0);
      this.firePlayerShot(target, weapon);
    }
  }

  /**
   * The combatant `weapon` auto-fires at: the {@link selectedTarget} when it is
   * within the weapon's `range`, else the nearest other combatant inside that
   * range. Null when no combatant is reachable (the weapon holds fire).
   */
  private pickTargetInRange(weapon: WeaponSpec): NpcShipSprite | null {
    const sel = this.selectedTarget;
    if (sel && this.combatants.has(sel)) {
      const d = this.distanceToShip(sel);
      if (d !== null && d <= weapon.range) return sel;
    }
    let best: NpcShipSprite | null = null;
    let bestDist = Infinity;
    for (const npc of this.combatants) {
      const d = this.distanceToShip(npc);
      if (d === null || d > weapon.range) continue;
      if (d < bestDist) {
        bestDist = d;
        best = npc;
      }
    }
    return best;
  }

  /** One NPC shot: reduce player hull, spawn a red number, warn once on low hull. */
  private fireNpcShot(npc: NpcShipSprite): void {
    const ship = this.deps.getPlayerShip?.() ?? null;
    if (!ship) return;
    // Raise the active-pause trigger on every landed shot; the pause controller
    // debounces it to the first hit per engagement (it does not re-pause once the
    // player has resumed this fight).
    this.deps.onPlayerUnderAttack?.();
    // Route the hit through the difficulty mode: GOD floors the hull above 0 and
    // marks the ship "downed" instead of killing it; NORMAL/HARD clamp to 0 (the
    // old `Math.max(0, …)` behaviour). Absent mode ⇒ NORMAL.
    const mode = this.deps.getGameMode?.() ?? "NORMAL";
    const result = applyDamageWithMode(
      mode,
      ship.hullHP,
      npc.npc.damage,
      ship.maxHull,
    );
    ship.hullHP = result.hull;
    const physics = this.deps.getShipPhysics();
    if (physics) {
      this.damageNumbers?.spawn(
        npc.npc.damage,
        physics.shipX,
        physics.shipY,
        false,
      );
      // Per-turn fire flash from the enemy to the player ship (who shoots whom).
      this.hud?.flashShot(npc.x, npc.y, physics.shipX, physics.shipY, false);
    }
    // GOD mode: the lethal hit floored the hull above 0 and downed the ship —
    // it survives but can't fire or hyperjump until repaired. This pre-empts the
    // death/GAME_OVER path entirely (hull never reaches 0 in GOD). Warn once.
    if (result.downed) {
      if (!this.downedWarned) {
        this.downedWarned = true;
        this.deps.showMessage?.(
          "Корабль выведен из строя — нужен ремонт",
          0xff8800,
        );
      }
      return;
    }
    // Hull reached 0 → the player is destroyed. Surface it to the host exactly
    // once; the host fires the game-over flow (and guards again for idempotency).
    if (ship.hullHP <= 0) {
      if (!this.playerDeathReported) {
        this.playerDeathReported = true;
        this.deps.onPlayerDestroyed?.();
      }
      return;
    }
    if (
      ship.hullHP > 0 &&
      ship.hullHP < ship.maxHull * LOW_HULL_FRACTION &&
      !this.lowHullWarned
    ) {
      this.lowHullWarned = true;
      this.deps.showMessage?.("Корпус критический — отступайте!", 0xff4444);
    }
  }

  /** One player shot: reduce the target's hull, spawn a yellow number, handle the kill. */
  private firePlayerShot(target: NpcShipSprite, weapon: WeaponSpec): void {
    const npc = target.npc;
    npc.hullHP = Math.max(0, npc.hullHP - weapon.damage);
    this.damageNumbers?.spawn(weapon.damage, target.x, target.y, true);
    // Per-turn fire flash from the player ship to the target (who shoots whom).
    const physics = this.deps.getShipPhysics();
    if (physics) {
      this.hud?.flashShot(
        physics.shipX,
        physics.shipY,
        target.x,
        target.y,
        true,
      );
    }
    if (npc.hullHP <= 0) {
      this.deps.showMessage?.(`Цель уничтожена: ${npc.name}`, 0xffdd33);
      this.deps.onNpcDestroyed?.(target);
      this.removeCombatant(target);
    }
  }

  /** Remove a combatant and re-pick the selected target from the survivors. */
  private removeCombatant(npc: NpcShipSprite): void {
    this.combatants.delete(npc);
    this.npcFireTimers.delete(npc);
    if (this.selectedTarget === npc) {
      this.selectedTarget = this.combatants.values().next().value ?? null;
      this.hud?.setTarget(this.selectedTarget);
      // The player's chosen target was lost mid-fight. If a survivor remains the
      // engagement is still live, so raise the active-pause "target lost" trigger
      // — the host re-pauses and the player picks a new target rather than
      // auto-continuing in real time. When no combatant remains the fight is
      // ending (update() → endCombat); deliberately do NOT pause onto an empty
      // overlay in that case.
      if (this.selectedTarget) this.deps.onTargetLost?.(npc);
    }
  }

  /** Push live target/player HP into the HUD and follow the moving ship. */
  private syncHud(): void {
    if (!this.hud) return;
    const target = this.selectedTarget;
    if (target) this.hud.updateTargetHP(target.npc.hullHP, target.npc.maxHull);
    const ship = this.deps.getPlayerShip?.() ?? null;
    if (ship) this.hud.updatePlayerHP(ship.hullHP, ship.maxHull);
    this.hud.syncRangeCircle();
    // Keep an engaged-enemy reticle on every combatant (the selected target is
    // drawn distinct) so the auto-mode fight reads at a glance.
    this.hud.syncMarkers([...this.combatants], this.selectedTarget);
  }

  /** Distance (world px) from the player ship to an NPC sprite, or null without physics. */
  private distanceToShip(target: NpcShipSprite): number | null {
    const physics = this.deps.getShipPhysics();
    if (!physics) return null;
    return Math.hypot(target.x - physics.shipX, target.y - physics.shipY);
  }

  /**
   * Whether the player ship is currently "downed" — GOD mode with the hull at
   * or below the GOD floor. A downed ship can't fire (auto or confirmed). Derived
   * from the live mode + hull, so a repair above the floor re-enables fire with
   * no extra state. NORMAL/HARD (or no mode) are never downed.
   */
  private isPlayerDowned(): boolean {
    const ship = this.deps.getPlayerShip?.() ?? null;
    if (!ship) return false;
    const mode = this.deps.getGameMode?.() ?? "NORMAL";
    return isHullDowned(mode, ship.hullHP, ship.maxHull);
  }

  /**
   * Whether combat fire is currently frozen. Combat is gated on the active-pause
   * ONLY (real-time, decoupled from the route-turn): when the host wires
   * {@link CombatModuleDeps.isPaused} that is the sole freeze signal. Legacy
   * callers that fold the pause into {@link CombatModuleDeps.isTurnRunning}
   * (returning `false` while frozen) are honoured only when `isPaused` is absent.
   */
  private isFrozen(): boolean {
    if (this.deps.isPaused) return this.deps.isPaused();
    return this.deps.isTurnRunning?.() === false;
  }

  /** Whether the loadout has at least one weapon to fight with. */
  private hasWeapon(loadout: ShipLoadout): boolean {
    return loadout
      .slottedWithGear()
      .some((s) => s.gear?.kind === GearKind.WEAPON);
  }

  /**
   * Surface the weaponless-engagement hint, throttled to one toast per
   * {@link WEAPONLESS_HINT_COOLDOWN_MS} (the aggro path calls every frame).
   */
  private warnWeaponless(): void {
    const now = Date.now();
    if (
      now - this.weaponlessHintAtMs <
      CombatModule.WEAPONLESS_HINT_COOLDOWN_MS
    )
      return;
    this.weaponlessHintAtMs = now;
    this.deps.showMessage?.("Нет оружия — установите его в ангаре", 0xff4444);
  }
}
