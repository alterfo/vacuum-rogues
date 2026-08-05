export interface PlanningCombatantView {
  readonly npc: { readonly id: string };
  readonly x: number;
  readonly y: number;
}

export interface PlanningWeaponView {
  readonly weaponClass?: string;
}

export interface PlanningSceneView {
  combatPlanning?: {
    readonly isPlanning: boolean;
    assignWeapon(weapon: unknown, target: unknown): void;
    setDestination(dest: { x: number; y: number } | null): void;
    setAfterburner?(on: boolean): void;
    setConsumable?(id: string | null): void;
    setComms?(action: string | null): void;
    confirm(): boolean;
  } | null;
  combatModule?: {
    fittedWeapons?(): PlanningWeaponView[];
    combatants?: Iterable<PlanningCombatantView>;
    selectedTarget?: PlanningCombatantView | null;
  } | null;
  shipPhysics?: { shipX: number; shipY: number } | null;
}

export interface ConfirmPlanningOptions {
  preferredTargetId?: string;
  assignWeapons?: boolean;
  closeOnTarget?: boolean;
  weaponClassAwareTargeting?: boolean;
  afterburner?: boolean;
  consumableId?: string | null;
  commsAction?: string | null;
}

export function confirmPlanningIfOpen(
  sceneLike: unknown,
  opts: ConfirmPlanningOptions = {},
): boolean {
  const scene = sceneLike as PlanningSceneView | null | undefined;
  const planning = scene?.combatPlanning;
  if (!planning?.isPlanning || typeof planning.confirm !== "function") {
    return false;
  }

  const combat = scene?.combatModule;
  const combatants = [...(combat?.combatants ?? [])];
  const target = pickTarget(combatants, scene, opts.preferredTargetId);

  if (target && (opts.assignWeapons ?? true)) {
    const farthest =
      opts.weaponClassAwareTargeting && combatants.length >= 2
        ? pickFarthest(combatants, scene)
        : null;
    for (const weapon of combat?.fittedWeapons?.() ?? []) {
      const isMissile = weapon?.weaponClass === "MISSILE";
      const weaponTarget = isMissile && farthest ? farthest : target;
      planning.assignWeapon(weapon, weaponTarget);
    }
  }
  if (target && opts.closeOnTarget) {
    planning.setDestination({ x: target.x, y: target.y });
  }
  if (opts.afterburner !== undefined) {
    planning.setAfterburner?.(opts.afterburner);
  }
  if (opts.consumableId !== undefined) {
    planning.setConsumable?.(opts.consumableId);
  }
  if (opts.commsAction !== undefined) {
    planning.setComms?.(opts.commsAction);
  }
  planning.confirm();
  return true;
}

function pickFarthest(
  combatants: PlanningCombatantView[],
  scene: PlanningSceneView | null | undefined,
): PlanningCombatantView | null {
  const physics = scene?.shipPhysics;
  if (!physics) return null;
  let best: PlanningCombatantView | null = null;
  let bestDist = -Infinity;
  for (const c of combatants) {
    const d = Math.hypot(c.x - physics.shipX, c.y - physics.shipY);
    if (d > bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

function pickTarget(
  combatants: PlanningCombatantView[],
  scene: PlanningSceneView | null | undefined,
  preferredTargetId: string | undefined,
): PlanningCombatantView | null {
  if (preferredTargetId) {
    const preferred = combatants.find((c) => c.npc.id === preferredTargetId);
    if (preferred) return preferred;
  }
  const selected = scene?.combatModule?.selectedTarget;
  if (selected && combatants.includes(selected)) return selected;

  const physics = scene?.shipPhysics;
  if (physics) {
    let best: PlanningCombatantView | null = null;
    let bestDist = Infinity;
    for (const c of combatants) {
      const d = Math.hypot(c.x - physics.shipX, c.y - physics.shipY);
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
    if (best) return best;
  }
  return combatants[0] ?? null;
}
