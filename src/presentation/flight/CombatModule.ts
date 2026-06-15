import type { Container } from "pixi.js";
import type { ShipPhysics } from "@/systems/ShipPhysics";
import type { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import type { NpcShipSprite } from "../NpcShipSprite";
import type { FlightModule } from "./FlightModule";
import { CombatHud } from "./CombatHud";
import { DamageNumbers } from "./DamageNumbers";
import { logger } from "@/utils/logger";

/**
 * Resolve one in-flight combat round: both sides take damage simultaneously,
 * computed from the pre-round HP so neither side's death pre-empts the other's
 * hit. HP is floored at 0. Pure + side-effect-free for unit testing (Task 13).
 */
export function resolveCombatRound(
  playerDmg: number,
  npcDmg: number,
  playerHP: number,
  npcHP: number,
): { newPlayerHP: number; newNpcHP: number } {
  return {
    newPlayerHP: Math.max(0, playerHP - npcDmg),
    newNpcHP: Math.max(0, npcHP - playerDmg),
  };
}

/** Player auto-retreats when its hull drops below this fraction of max. */
const LOW_HULL_FRACTION = 0.3;

/**
 * Live state the combat module reads from the host scene without depending on
 * the concrete {@link SpaceFlightScene}. The authoritative ship physics stays in
 * the scene; the module reads it through this accessor (Low Coupling / DIP).
 *
 * The HUD accessors are optional so lightweight callers (skeleton unit tests)
 * can drive the lifecycle without a rendering context; when all are present the
 * module builds a {@link CombatHud} on {@link initialize}.
 */
export interface CombatModuleDeps {
  /** Authoritative player ship physics (null before the ship spawns). */
  getShipPhysics(): ShipPhysics | null;
  /** Player's canonical loadout — source of the equipped weapons for the HUD. */
  getPlayerLoadout?(): ShipLoadout | null;
  /** Live UI layer the weapon panel is mounted on. */
  getUiLayer?(): Container;
  /** Live world (game) layer the dashed range circle is drawn on. */
  getGameLayer?(): Container;
  /** Current viewport size, for anchoring the weapon panel. */
  getScreenSize?(): { width: number; height: number };
  /** Player ship — each resolved round applies damage to its hull (Task 13). */
  getPlayerShip?(): { hullHP: number; maxHull: number } | null;
  /** Resolve a killed NPC: drop loot, remove the sprite + domain entry (Task 13). */
  onNpcDestroyed?(sprite: NpcShipSprite): void;
  /** Transient toast feedback (kill confirmation / low-hull retreat). */
  showMessage?(text: string, color?: number): void;
}

/**
 * In-flight combat (Tasks 11–14). NPC encounters resolve here, inside the flight
 * scene, instead of transitioning to the turn-based hex {@link CombatScene}
 * (which is now reserved for scripted text-quest encounters).
 *
 * Task 11 is the skeleton: it tracks the active target, exposes the active flag
 * the scene reads to freeze navigation, and freezes/unfreezes the player ship on
 * combat start/end. The weapon-selection HUD, range overlay, target picking and
 * damage resolution land in Tasks 12–14, building on this lifecycle.
 */
export class CombatModule implements FlightModule {
  private readonly deps: CombatModuleDeps;

  /** Weapon panel + range overlay (null when the host has no render context). */
  private hud: CombatHud | null = null;

  /** Floating damage numbers (null when the host has no render context). */
  private damageNumbers: DamageNumbers | null = null;

  /** The NPC sprite that started the fight (null when no fight is active). */
  activeTarget: NpcShipSprite | null = null;

  /**
   * The NPC the next "Атаковать" resolves against. Defaults to the aggressor on
   * combat start; the player can click another enemy sprite to switch it, or
   * click empty space to deselect (Task 13).
   */
  selectedTarget: NpcShipSprite | null = null;

  /** True while a fight is in progress — the scene freezes navigation on this. */
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
    });
    this.hud.onRetreat = () => this.endCombat();
    this.hud.onAttack = () => this.resolveRound();
  }

  /**
   * Per-frame: float any active damage numbers, and arm the HUD's "Атаковать"
   * button only while a target is selected AND within the weapon's range. Damage
   * numbers advance even after combat ends so the killing blow's number finishes.
   */
  update(deltaTime: number, _bgElapsed?: number): void {
    this.damageNumbers?.update(deltaTime);
    if (!this.isActive || !this.hud) return;
    this.hud.setAttackEnabled(this.targetInRange());
  }

  /**
   * Begin an in-flight fight against `npc`: store the target, raise the active
   * flag, freeze the player ship in place (movement resumes on endCombat()) and
   * open the weapon HUD (default-selecting the first weapon). A no-op while a
   * fight is already active so a second aggressor arriving in range can't restart
   * the encounter or steal the current target.
   */
  startCombat(npc: NpcShipSprite): void {
    if (this.isActive) return;
    this.isActive = true;
    this.activeTarget = npc;
    this.selectedTarget = npc; // aim at the aggressor by default
    const physics = this.deps.getShipPhysics();
    if (physics) {
      physics.setTarget(physics.shipX, physics.shipY);
      physics.isMoving = false;
      physics.currentSpeed = 0;
    }
    this.hud?.open(this.deps.getPlayerLoadout?.() ?? null);
    logger.info(`In-flight combat started vs ${npc.npc.id}`);
  }

  /**
   * Set (or clear) the NPC the next round resolves against. Clicking an enemy
   * sprite during a fight selects it; clicking empty space deselects (Task 13).
   * A no-op outside an active fight.
   */
  selectTarget(sprite: NpcShipSprite | null): void {
    if (!this.isActive) return;
    this.selectedTarget = sprite;
  }

  /** End the current fight: clear the target, close the HUD and let the player move again. */
  endCombat(): void {
    this.isActive = false;
    this.activeTarget = null;
    this.selectedTarget = null;
    this.hud?.close();
  }

  destroy(): void {
    this.endCombat();
    this.damageNumbers?.clear();
    this.damageNumbers = null;
    this.hud = null;
  }

  /**
   * Resolve one combat round: the player's selected weapon and the target NPC
   * deal damage to each other simultaneously, then floating numbers are spawned
   * (yellow at the NPC, red at the player ship). If the NPC dies, its loot drops
   * and combat ends; if the player's hull falls below {@link LOW_HULL_FRACTION},
   * combat auto-ends with a warning and the NPC stays in the system. Only fires
   * while a target is selected and within the weapon's range.
   */
  private resolveRound(): void {
    const target = this.selectedTarget;
    const ship = this.deps.getPlayerShip?.() ?? null;
    const weapon = this.hud?.selectedWeapon ?? null;
    if (!target || !ship || !weapon || !this.targetInRange()) return;

    const npc = target.npc;
    const { newPlayerHP, newNpcHP } = resolveCombatRound(
      weapon.damage,
      npc.damage,
      ship.hullHP,
      npc.hullHP,
    );
    ship.hullHP = newPlayerHP;
    npc.hullHP = newNpcHP;

    this.damageNumbers?.spawn(weapon.damage, target.x, target.y, true);
    const physics = this.deps.getShipPhysics();
    if (physics) {
      this.damageNumbers?.spawn(
        npc.damage,
        physics.shipX,
        physics.shipY,
        false,
      );
    }

    if (npc.hullHP <= 0) {
      this.deps.showMessage?.(`Цель уничтожена: ${npc.name}`, 0xffdd33);
      this.deps.onNpcDestroyed?.(target);
      this.endCombat();
      return;
    }
    if (ship.hullHP < ship.maxHull * LOW_HULL_FRACTION) {
      this.deps.showMessage?.("Корпус критический — отступаем!", 0xff4444);
      this.endCombat();
    }
  }

  /** Whether the selected target sits within the selected weapon's range circle. */
  private targetInRange(): boolean {
    const target = this.selectedTarget;
    const physics = this.deps.getShipPhysics();
    if (!target || !physics || !this.hud?.selectedWeaponId) return false;
    const dx = target.x - physics.shipX;
    const dy = target.y - physics.shipY;
    return Math.hypot(dx, dy) <= this.hud.rangeRadius;
  }
}
