import type { NpcShip } from "@/domain/NpcShip";
import type { ShipPhysics } from "./ShipPhysics";

/** Minimal slice of NpcShipSprite needed for combat decisions. */
export interface NpcSpriteView {
  npc: NpcShip;
  x: number;
  y: number;
}

export interface FlightCombatContext {
  isTurnRunning: boolean;
  followNpcId: string | null;
  shipPhysics: ShipPhysics;
  npcSprites: ReadonlyArray<NpcSpriteView>;
  weaponRange: number;
}

export type FlightCombatDecision =
  | { action: "idle" }
  | { action: "lost" }
  | { action: "chase"; targetX: number; targetY: number }
  | { action: "launch"; npc: NpcShip };

/**
 * Stateless resolver for in-flight auto-attack logic, extracted from
 * SpaceFlightScene.updateCombat so the decision logic is testable in isolation.
 */
export class FlightCombatResolver {
  /**
   * Given the current flight state, returns what the combat loop should do this
   * frame: idle (no target), lost (target gone), chase (close on target), or
   * launch (transition to CombatScene).
   */
  decide(ctx: FlightCombatContext): FlightCombatDecision {
    if (!ctx.isTurnRunning || !ctx.followNpcId) {
      return { action: "idle" };
    }

    const sprite = ctx.npcSprites.find((s) => s.npc.id === ctx.followNpcId);
    if (!sprite) {
      return { action: "lost" };
    }

    const dist = Math.hypot(
      sprite.x - ctx.shipPhysics.shipX,
      sprite.y - ctx.shipPhysics.shipY,
    );

    if (dist > ctx.weaponRange) {
      return { action: "chase", targetX: sprite.x, targetY: sprite.y };
    }

    return { action: "launch", npc: sprite.npc };
  }
}
