import type { Container } from "pixi.js";
import type { ShipPhysics } from "@/systems/ShipPhysics";
import type { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import type { NpcShipSprite } from "../NpcShipSprite";
import type { FlightModule } from "./FlightModule";
import { CombatHud } from "./CombatHud";
import { logger } from "@/utils/logger";

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

  /** The NPC sprite currently being fought (null when no fight is active). */
  activeTarget: NpcShipSprite | null = null;

  /** True while a fight is in progress — the scene freezes navigation on this. */
  isActive = false;

  constructor(deps: CombatModuleDeps) {
    this.deps = deps;
  }

  /** Build the HUD if the host supplied the render layers (Task 12). */
  initialize(): void {
    const { getUiLayer, getGameLayer, getScreenSize } = this.deps;
    if (!getUiLayer || !getGameLayer || !getScreenSize) return;
    this.hud = new CombatHud(getUiLayer(), getGameLayer(), {
      getShipPos: () => {
        const p = this.deps.getShipPhysics();
        return p ? { x: p.shipX, y: p.shipY } : null;
      },
      getScreenSize,
    });
    this.hud.onRetreat = () => this.endCombat();
  }

  /**
   * Per-frame: arm the HUD's "Атаковать" button only while the active target is
   * within the selected weapon's range. Round resolution lands in Task 13.
   */
  update(_deltaTime: number, _bgElapsed?: number): void {
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
    const physics = this.deps.getShipPhysics();
    if (physics) {
      physics.setTarget(physics.shipX, physics.shipY);
      physics.isMoving = false;
      physics.currentSpeed = 0;
    }
    this.hud?.open(this.deps.getPlayerLoadout?.() ?? null);
    logger.info(`In-flight combat started vs ${npc.npc.id}`);
  }

  /** End the current fight: clear the target, close the HUD and let the player move again. */
  endCombat(): void {
    this.isActive = false;
    this.activeTarget = null;
    this.hud?.close();
  }

  destroy(): void {
    this.endCombat();
    this.hud = null;
  }

  /** Whether the active target sits within the selected weapon's range circle. */
  private targetInRange(): boolean {
    const target = this.activeTarget;
    const physics = this.deps.getShipPhysics();
    if (!target || !physics || !this.hud?.selectedWeaponId) return false;
    const dx = target.x - physics.shipX;
    const dy = target.y - physics.shipY;
    return Math.hypot(dx, dy) <= this.hud.rangeRadius;
  }
}
