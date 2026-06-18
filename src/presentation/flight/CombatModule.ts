import type { Container } from "pixi.js";
import type { ShipPhysics } from "@/systems/ShipPhysics";
import type { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import { GearKind, type WeaponSpec } from "@/systems/equipment/GearCatalog";
import { GAME_BALANCE } from "@/config/balance";
import type { NpcShipSprite } from "../NpcShipSprite";
import type { FlightModule } from "./FlightModule";
import { CombatHud } from "./CombatHud";
import { DamageNumbers } from "./DamageNumbers";
import { logger } from "@/utils/logger";

/** Player gets a one-shot retreat warning when its hull drops below this fraction of max. */
const LOW_HULL_FRACTION = 0.3;

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
   * Whether the turn is running (Play, not Pause). Combat only advances while
   * the turn runs, matching the ship/NPC movement gating. Optional so unit tests
   * can drive the timers directly; absent or true means the fight advances.
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
  /** Resolve a killed NPC: drop loot, remove the sprite + domain entry. */
  onNpcDestroyed?(sprite: NpcShipSprite): void;
  /** Transient toast feedback (kill confirmation / low-hull retreat). */
  showMessage?(text: string, color?: number): void;
}

/**
 * Real-time in-flight combat. Hostile NPCs that close inside weapon range are
 * added as combatants and fire at the player every
 * {@link GAME_BALANCE.combatFireIntervalMs}; the player's weapon auto-fires at
 * the same cadence against the {@link CombatModule.selectedTarget}. Nothing
 * freezes — ships keep moving and there is no scene transition (the turn-based
 * hex {@link CombatScene} survives only for scripted text-quest encounters).
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

  /** ms elapsed since the player's weapon last fired. */
  private playerFireTimer = 0;

  /** Guards the one-shot low-hull retreat warning per fight. */
  private lowHullWarned = false;

  /**
   * The NPC the player's weapon auto-fires at. Defaults to the first combatant;
   * the player can click another enemy sprite to switch it, or click empty space
   * to deselect.
   */
  selectedTarget: NpcShipSprite | null = null;

  /** True while at least one combatant is engaged. */
  isActive = false;

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
    if (!this.isActive) return;
    // The fight only advances while the turn is running. Pausing freezes the
    // world (the scene gates ship + NPC movement the same way), so combat must
    // not keep draining the player's hull in real time while paused. Damage
    // numbers (above) still float so a killing blow's number finishes its arc.
    if (this.deps.isTurnRunning?.() === false) return;
    this.pruneDisengaged();
    this.advancePlayerTimer(deltaTime);
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
    if (loadout && !this.hasWeapon(loadout)) return;

    this.combatants.add(npc);
    this.npcFireTimers.set(npc, 0);
    if (!this.selectedTarget) this.selectedTarget = npc;

    if (!this.isActive) {
      this.isActive = true;
      this.playerFireTimer = 0;
      this.lowHullWarned = false;
      this.hud?.open(this.selectedTarget);
    }
    logger.info(`In-flight combat: engaged ${npc.npc.id}`);
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
    this.playerFireTimer = 0;
    this.lowHullWarned = false;
    this.hud?.close();
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
    for (const npc of [...this.combatants]) {
      if (npc.container?.destroyed) {
        this.removeCombatant(npc);
        continue;
      }
      const d = this.distanceToShip(npc);
      if (d === null || d > GAME_BALANCE.combatEscapeRange)
        this.removeCombatant(npc);
    }
  }

  /** Advance every NPC's fire timer; fire its shot at the player when it elapses and the NPC is in range. */
  private advanceNpcTimers(deltaTime: number): void {
    for (const npc of this.combatants) {
      const t = (this.npcFireTimers.get(npc) ?? 0) + deltaTime;
      const d = this.distanceToShip(npc);
      if (
        t >= GAME_BALANCE.combatFireIntervalMs &&
        d !== null &&
        d <= GAME_BALANCE.weaponRange
      ) {
        this.npcFireTimers.set(npc, 0);
        this.fireNpcShot(npc);
      } else {
        this.npcFireTimers.set(npc, t);
      }
    }
  }

  /** Advance the player's fire timer; fire at the selected target when it elapses and the target is in range. */
  private advancePlayerTimer(deltaTime: number): void {
    this.playerFireTimer += deltaTime;
    if (this.playerFireTimer < GAME_BALANCE.combatFireIntervalMs) return;
    const target = this.selectedTarget;
    const weapon = this.playerWeapon();
    if (!target || !this.combatants.has(target) || !weapon) return;
    const d = this.distanceToShip(target);
    if (d === null || d > weapon.range) return;
    this.playerFireTimer = 0;
    this.firePlayerShot(target, weapon);
  }

  /** One NPC shot: reduce player hull, spawn a red number, warn once on low hull. */
  private fireNpcShot(npc: NpcShipSprite): void {
    const ship = this.deps.getPlayerShip?.() ?? null;
    if (!ship) return;
    ship.hullHP = Math.max(0, ship.hullHP - npc.npc.damage);
    const physics = this.deps.getShipPhysics();
    if (physics) {
      this.damageNumbers?.spawn(
        npc.npc.damage,
        physics.shipX,
        physics.shipY,
        false,
      );
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
  }

  /** Distance (world px) from the player ship to an NPC sprite, or null without physics. */
  private distanceToShip(target: NpcShipSprite): number | null {
    const physics = this.deps.getShipPhysics();
    if (!physics) return null;
    return Math.hypot(target.x - physics.shipX, target.y - physics.shipY);
  }

  /** The player's active weapon — the first equipped weapon in the loadout. */
  private playerWeapon(): WeaponSpec | null {
    const loadout = this.deps.getPlayerLoadout?.() ?? null;
    if (!loadout) return null;
    return (
      loadout
        .slottedWithGear()
        .map((s) => s.gear)
        .find((g): g is WeaponSpec => !!g && g.kind === GearKind.WEAPON) ?? null
    );
  }

  /** Whether the loadout has at least one weapon to fight with. */
  private hasWeapon(loadout: ShipLoadout): boolean {
    return loadout
      .slottedWithGear()
      .some((s) => s.gear?.kind === GearKind.WEAPON);
  }
}
