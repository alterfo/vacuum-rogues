import type { ShipPhysics } from "@/systems/ShipPhysics";
import type { NpcShipSprite } from "../NpcShipSprite";
import type { FlightModule } from "./FlightModule";
import { logger } from "@/utils/logger";

/**
 * Live state the combat module reads from the host scene without depending on
 * the concrete {@link SpaceFlightScene}. The authoritative ship physics stays in
 * the scene; the module reads it through this accessor (Low Coupling / DIP).
 */
export interface CombatModuleDeps {
  /** Authoritative player ship physics (null before the ship spawns). */
  getShipPhysics(): ShipPhysics | null;
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

  /** The NPC sprite currently being fought (null when no fight is active). */
  activeTarget: NpcShipSprite | null = null;

  /** True while a fight is in progress — the scene freezes navigation on this. */
  isActive = false;

  constructor(deps: CombatModuleDeps) {
    this.deps = deps;
  }

  /** No persistent display objects yet — the HUD/range overlay arrive in Task 12. */
  initialize(): void {}

  /** Round resolution + HUD updates land in Tasks 12–14; the skeleton is inert. */
  update(_deltaTime: number, _bgElapsed?: number): void {}

  /**
   * Begin an in-flight fight against `npc`: store the target, raise the active
   * flag and freeze the player ship in place (movement resumes on endCombat()).
   * A no-op while a fight is already active so a second aggressor arriving in
   * range can't restart the encounter or steal the current target.
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
    logger.info(`In-flight combat started vs ${npc.npc.id}`);
  }

  /** End the current fight: clear the target and let the player move again. */
  endCombat(): void {
    this.isActive = false;
    this.activeTarget = null;
  }

  destroy(): void {
    this.endCombat();
  }
}
