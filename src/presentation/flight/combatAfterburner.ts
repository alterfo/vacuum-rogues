/**
 * Afterburner — planning-phase speed boost with gradual engine wear. Pure, PixiJS-free.
 *
 * Task 8 of the pause-and-plan combat rework
 * (`docs/plans/20260713-tactical-pause-combat-rework.md`). An afterburner toggled during
 * PLANNING (the {@link import("./combatPlanning").PlannedTurn.afterburner} flag) multiplies the
 * ship's speed for the *following* execute window, but **gradually wears the engine** — the
 * spec's "постепенно разрушает мотор" / "gradually damages the engine": each burn permanently
 * lowers the engine's integrity, which in turn weakens the boost a later burn can still deliver,
 * until a fully-worn engine can no longer afterburn at all.
 *
 * **Degradation model (recorded, Task 8 decision) — session-scoped cumulative wear, NO save
 * persistence.** This is the *smallest* model that satisfies the spec (the plan explicitly asks
 * for the smallest of: per-fight cumulative wear / capped uses per fight / a persistent
 * cross-fight engine-health field):
 * - wear accumulates across the burns of a **single fight** and resets to pristine
 *   ({@link pristineEngine}) at the next engagement, so there is **no `SaveState`/schema impact**
 *   — consistent with every sibling task in this rework staying persistence-neutral (transient
 *   execute-window state), and it avoids opening a cross-fight repair/economy loop the spec
 *   never asks for (where would you fix the engine?). A persistent cross-fight engine-health
 *   field is recorded as a Post-Completion stretch, not v1.
 * - it subsumes the "capped uses per fight" option for free: with a fixed `wearPerBurn` and an
 *   engage floor, the number of burns before the engine is spent is fixed
 *   ({@link afterburnerBurnBudget}).
 * - a fully-degraded engine (integrity at/below `minIntegrityToEngage`) **can no longer
 *   afterburn** (`engaged: false`, multiplier reverts to 1) rather than applying a speed penalty
 *   — the "record which" choice from the plan.
 *
 * Kept a pure module (no PixiJS / no scene / no domain deps) unit-tested standalone — the same
 * discipline as `combatPlanning` / `combatTrajectory` / `combatGravity` / `combatMissile`. Live
 * tuning comes from `AFTERBURNER` in `balance.ts`; the scene passes it in so tune-in-one-place
 * holds. The module is **stateless math** over an {@link EngineWearState} the host carries for
 * the duration of the fight — the caller applies the returned multiplier for exactly one execute
 * window and reverts on the next planning phase (the per-turn afterburner flag resets in the
 * fresh draft), so "applied for one window then reverts" is the planning loop's contract, not a
 * timer here.
 */

/** Tuning for the afterburner boost + engine wear; mirrors `AFTERBURNER` in `balance.ts`. */
export interface AfterburnerConfig {
  /** Peak speed multiplier at pristine integrity — the boost tapers as the engine wears. */
  speedMultiplier: number;
  /** Engine integrity (0..1) permanently lost per afterburner engagement this fight. */
  wearPerBurn: number;
  /** Below this remaining integrity the afterburner can no longer engage (no boost). */
  minIntegrityToEngage: number;
}

/** Module-local default, mirroring `AFTERBURNER` so this file stays import-light for tests. */
export const DEFAULT_AFTERBURNER: AfterburnerConfig = {
  speedMultiplier: 2.2,
  wearPerBurn: 0.12,
  minIntegrityToEngage: 0.05,
};

/**
 * The session-scoped engine-wear state the host carries for the duration of one fight.
 * `integrity` runs `1` (pristine) → `0` (spent). Reset to {@link pristineEngine} at the start
 * of each new engagement — it is never persisted.
 */
export interface EngineWearState {
  /** Remaining engine integrity, 0 (spent) .. 1 (pristine). */
  readonly integrity: number;
}

/** The outcome of an afterburner engagement attempt. */
export interface AfterburnerResult {
  /** Engine-wear state after the attempt (unchanged if the engine was too worn to engage). */
  readonly state: EngineWearState;
  /** Speed multiplier to apply for the coming execute window (1 = no boost / reverted). */
  readonly multiplier: number;
  /** Whether the afterburner actually engaged (false ⇒ engine too worn, no boost, no wear). */
  readonly engaged: boolean;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** A fresh, pristine engine — the state at the start of every fight (never persisted). */
export function pristineEngine(): EngineWearState {
  return { integrity: 1 };
}

/**
 * Whether the afterburner can still engage at this integrity — true while integrity is strictly
 * above `minIntegrityToEngage`. Once at/below the floor the engine is spent (no more burns).
 */
export function canAfterburn(
  state: EngineWearState,
  config: AfterburnerConfig = DEFAULT_AFTERBURNER,
): boolean {
  return state.integrity > Math.max(0, config.minIntegrityToEngage);
}

/**
 * The speed multiplier a burn at the given `integrity` would deliver — the pure boost-taper
 * curve: `speedMultiplier` at pristine (integrity 1), tapering linearly toward `1` (no boost)
 * as the engine wears, and exactly `1` once the engine is too worn to engage
 * ({@link canAfterburn} false). Never below 1.
 */
export function afterburnerMultiplier(
  integrity: number,
  config: AfterburnerConfig = DEFAULT_AFTERBURNER,
): number {
  if (integrity <= Math.max(0, config.minIntegrityToEngage)) return 1;
  const boost = Math.max(0, config.speedMultiplier - 1) * clamp01(integrity);
  return 1 + boost;
}

/**
 * Engage the afterburner for the coming execute window, given the engine's current wear state.
 *
 * If the engine is spent ({@link canAfterburn} false) this is a clean no-op — the state is
 * returned unchanged, `multiplier` is `1` (revert to normal speed) and `engaged` is `false`, so
 * the ship simply doesn't afterburn this window (no penalty). Otherwise the boost delivered is
 * computed from the **pre-wear** integrity ({@link afterburnerMultiplier}) and the engine's
 * integrity is permanently reduced by `wearPerBurn` (floored at 0) for the rest of the fight.
 */
export function engageAfterburner(
  state: EngineWearState,
  config: AfterburnerConfig = DEFAULT_AFTERBURNER,
): AfterburnerResult {
  if (!canAfterburn(state, config)) {
    return { state, multiplier: 1, engaged: false };
  }
  const multiplier = afterburnerMultiplier(state.integrity, config);
  const integrity = Math.max(
    0,
    state.integrity - Math.max(0, config.wearPerBurn),
  );
  return { state: { integrity }, multiplier, engaged: true };
}

/**
 * How many afterburner burns a pristine engine can deliver in one fight before it is too worn
 * to engage — the natural "capped uses per fight" the wear model yields for free. A
 * non-positive `wearPerBurn` means unlimited burns (`Infinity`).
 */
export function afterburnerBurnBudget(
  config: AfterburnerConfig = DEFAULT_AFTERBURNER,
): number {
  const wear = Math.max(0, config.wearPerBurn);
  if (wear <= 0) return Infinity;
  const usable = 1 - Math.max(0, config.minIntegrityToEngage);
  return Math.floor(usable / wear) + 1;
}
