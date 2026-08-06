import type { WeaponSpec } from "@/systems/equipment/GearCatalog";
import type { CombatPlanningController } from "./combatPlanning";

export interface AutoPlanPoint {
  x: number;
  y: number;
}

export function nearestAutoTarget<T extends AutoPlanPoint>(
  ship: AutoPlanPoint,
  targets: readonly T[],
): T | null {
  let best: T | null = null;
  let bestDist = Infinity;
  for (const target of targets) {
    const d = Math.hypot(target.x - ship.x, target.y - ship.y);
    if (d < bestDist) {
      bestDist = d;
      best = target;
    }
  }
  return best;
}

export function autoConfirmCombatTurn<T extends AutoPlanPoint>(
  planning: CombatPlanningController<T, WeaponSpec>,
  weapons: readonly WeaponSpec[],
  combatants: readonly T[],
  ship: AutoPlanPoint | null,
  selected?: T | null,
): boolean {
  if (!planning.isPlanning) return false;
  const sticky = selected && combatants.includes(selected) ? selected : null;
  const target =
    sticky ??
    (ship ? nearestAutoTarget(ship, combatants) : (combatants[0] ?? null));
  if (target)
    for (const weapon of weapons) planning.assignWeapon(weapon, target);
  return planning.confirm();
}

export function combatRouteClickAllowed(opts: {
  combatActive: boolean;
  autoCombat: boolean;
}): boolean {
  return opts.combatActive && opts.autoCombat;
}
