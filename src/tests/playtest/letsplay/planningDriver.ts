/**
 * Headless driver for the tactical pause-and-plan combat loop (Task 15,
 * `docs/plans/20260713-tactical-pause-combat-rework.md`).
 *
 * Since Task 14.5 wired the planning loop live, engaging combat freezes the
 * whole sim in PLANNING (`combatPlanning.isPlanning` folds into the
 * `CombatModule.isPaused` closure) until the player fills a {@link PlannedTurn}
 * draft and confirms («Ход»). The superseded reactive `combatPause` is no
 * longer what freezes a fight, so the old per-tick `combatPause.resume()`
 * discipline in the letsplay drivers stopped resolving combat — the ship sat
 * frozen in PLANNING forever (no weapon ever assigned, no confirm).
 *
 * {@link confirmPlanningIfOpen} is the headless equivalent of the player's
 * assign-and-confirm: pick a target (explicit id → current selection → nearest
 * combatant), assign **every** fitted weapon to it, optionally steer at it for
 * the coming execute window, and confirm the draft. Callers run it before each
 * tick — a no-op outside PLANNING — exactly like the old resume discipline:
 *
 * - `PlayerAgent.driveAttack` — weapons on the chased target, close on it.
 * - `PlayerAgent.waitOneDay` / `completeWarp` / `flyForward` — weapons on the
 *   nearest combatant (fight back), destination untouched (a null destination
 *   leaves the current course, so a warp-edge or fly-forward route keeps
 *   flying through the execute window).
 * - live autopilot `attack()` / `flee()` / `warp()` heads — same shapes over
 *   the rendered scene.
 *
 * Dev-only: lives under `src/tests/`, imported by no production module
 * (enforced by `letsplayDevOnly.test.ts`).
 */

/** The slice of a combatant sprite the driver reads (identity + position). */
export interface PlanningCombatantView {
  readonly npc: { readonly id: string };
  readonly x: number;
  readonly y: number;
}

/** The slice of a fitted weapon the driver reads for class-aware targeting. */
export interface PlanningWeaponView {
  readonly weaponClass?: string;
}

/** Structural view over the live/headless `SpaceFlightScene` planning seams. */
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
  /** Assign weapons to this NPC id first (→ current selection → nearest). */
  preferredTargetId?: string;
  /**
   * Assign every fitted weapon to the picked target (default true — an
   * unassigned weapon holds fire under the empty-draft rule, so a driver that
   * wants the fight to resolve must assign). `false` = deliberate hold fire
   * (the flee shape: confirm and run without shooting).
   */
  assignWeapons?: boolean;
  /**
   * Steer at the picked target for the coming execute window (default false —
   * a null destination leaves the current course untouched, so an in-progress
   * warp-edge/fly-forward route keeps flying).
   */
  closeOnTarget?: boolean;
  /**
   * Route MISSILE-class weapons at the FARTHEST combatant instead of the
   * picked (nearest/preferred) target, when ≥2 combatants are present
   * (default false — every other caller keeps the pre-existing "all weapons
   * on one target" behavior byte-for-byte). Missiles track/reach at range, so
   * a multi-hostile fight is better served splitting fire than piling every
   * gun onto the same ship the beams/fragments already have covered — added
   * for the dev-only autopilot's combat-variant coverage
   * (`docs/plans/20260719-autopilot-combat-coverage-and-campaign-pacing.md`
   * Task 7), off by default so nothing else changes.
   */
  weaponClassAwareTargeting?: boolean;
  /** Toggle the afterburner for the coming execute window (default: untouched). */
  afterburner?: boolean;
  /** Activate this owned consumable this turn, or explicitly clear it with `null` (default: untouched). */
  consumableId?: string | null;
  /** Run this comms action this turn, or explicitly clear it with `null` (default: untouched). */
  commsAction?: string | null;
}

/**
 * If the tactical PLANNING freeze is open on `sceneLike`, fill the draft and
 * confirm it. Returns whether a plan was confirmed (false outside PLANNING or
 * when the seam is absent — partial test stubs stay safe).
 */
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

/** The combatant farthest from the ship — the missile-routing target. */
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

/** Explicit id → live selection (still a combatant) → nearest to the ship. */
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
