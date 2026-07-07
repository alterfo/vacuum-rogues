/**
 * Active-pause combat controller (pure, PixiJS-free).
 *
 * In-flight combat resolves in real time ({@link CombatModule}). This controller
 * adds a Space-Rangers / FTL-style *active pause*: an incoming attack freezes the
 * turn and the player deliberately picks a **target** and a **weapon**; confirming
 * the action fires exactly one shot and resumes time, while an explicit resume
 * lets time continue without firing. The game **also re-pauses when the current
 * target is lost** (destroyed or drifted out of range) so the player chooses a new
 * target instead of drifting in real time.
 *
 * The controller is intentionally a pure state machine over generic target/weapon
 * handles so it unit-tests without a rendering context; the flight scene wires the
 * real {@link NpcShipSprite} / {@link WeaponSpec} types and the freeze-time + overlay
 * side effects through {@link CombatPauseDeps} (Low Coupling / DIP).
 */

/** Why the controller raised the pause — surfaced to the host for overlay/messaging. */
export type PauseReason = "incoming-attack" | "target-lost";

/** A confirmed, ready-to-fire selection emitted by {@link CombatPauseController.confirm}. */
export interface PauseAttackAction<TTarget, TWeapon> {
  readonly target: TTarget;
  readonly weapon: TWeapon;
}

/**
 * Host side effects. All optional so the controller drives standalone in tests;
 * the scene supplies them to freeze time, open the overlay and route the shot.
 */
export interface CombatPauseDeps<TTarget, TWeapon> {
  /** Paused flipped true → freeze the turn and open the target/weapon overlay. */
  onPause?(reason: PauseReason): void;
  /** Paused flipped false → resume the turn and close the overlay. */
  onResume?(): void;
  /** A confirmed action fired — wire this to the real attack-resolution path. */
  onConfirm?(action: PauseAttackAction<TTarget, TWeapon>): void;
}

/**
 * Pure active-pause state machine. `TTarget`/`TWeapon` are opaque handles (the
 * scene binds `NpcShipSprite` / `WeaponSpec`); the controller never inspects them
 * beyond identity, so it stays free of presentation/domain deps.
 */
export class CombatPauseController<TTarget, TWeapon> {
  private readonly deps: CombatPauseDeps<TTarget, TWeapon>;

  private _paused = false;
  private _target: TTarget | null = null;
  private _weapon: TWeapon | null = null;

  /**
   * Debounce for the incoming-attack trigger: an NPC fires every frame, but the
   * game pauses only on the **first** incoming shot per engagement. Once consumed
   * (paused for "incoming-attack" then resumed), further incoming shots do not
   * re-pause until {@link reset} ends the engagement. Target-lost re-pauses are a
   * separate, per-loss trigger and are not gated by this flag.
   */
  private incomingConsumed = false;

  constructor(deps: CombatPauseDeps<TTarget, TWeapon> = {}) {
    this.deps = deps;
  }

  /** True while the overlay is open and simulation time should be frozen. */
  get paused(): boolean {
    return this._paused;
  }

  /** The target the player has selected for the next confirmed action. */
  get selectedTarget(): TTarget | null {
    return this._target;
  }

  /** The weapon the player has selected for the next confirmed action. */
  get selectedWeapon(): TWeapon | null {
    return this._weapon;
  }

  /**
   * Incoming attack at the player. Pauses on the first shot per engagement
   * (debounced — see {@link incomingConsumed}); a no-op once already consumed or
   * already paused. Returns whether this call flipped to paused.
   */
  requestPause(reason: PauseReason): boolean {
    if (reason === "incoming-attack" && this.incomingConsumed) return false;
    if (reason === "incoming-attack") this.incomingConsumed = true;
    return this.enterPause(reason);
  }

  /**
   * The selected target was lost — destroyed by the player or drifted out of
   * range. If it was the *current* selection, clear it and re-pause so the player
   * picks a new target (the engagement is otherwise still live, in real time).
   * A loss of any other (non-selected) combatant is ignored. Returns whether this
   * call re-paused.
   */
  notifyTargetLost(target: TTarget): boolean {
    if (target !== this._target) return false;
    this._target = null;
    return this.enterPause("target-lost");
  }

  /**
   * Host adapter for "the combat module's current auto-fire target was lost": adopt
   * it as the selection, then {@link notifyTargetLost} to re-pause. The module has
   * already decided this was the *current* target (it only reports the selected one),
   * so we sync the controller's selection first — it can drift from the module's
   * between pauses (e.g. a survivor re-pick after a confirmed kill), and a stale
   * selection would otherwise swallow the re-pause. Returns whether it re-paused.
   */
  loseTarget(target: TTarget): boolean {
    this.selectTarget(target);
    return this.notifyTargetLost(target);
  }

  /** Choose the target for the next confirmed action (null deselects). */
  selectTarget(target: TTarget | null): void {
    this._target = target;
  }

  /** Choose the weapon for the next confirmed action (null deselects). */
  selectWeapon(weapon: TWeapon | null): void {
    this._weapon = weapon;
  }

  /**
   * Confirm the current selection: emit exactly one attack and resume time.
   * A no-op (returns null, stays paused) when not paused, or when no target /
   * weapon is selected — so a weaponless or target-less player can't fire and the
   * overlay stays open to surface a message. Returns the emitted action or null.
   */
  confirm(): PauseAttackAction<TTarget, TWeapon> | null {
    if (!this._paused || this._target === null || this._weapon === null)
      return null;
    const action: PauseAttackAction<TTarget, TWeapon> = {
      target: this._target,
      weapon: this._weapon,
    };
    // Resume *before* firing. The confirmed shot can synchronously lose its own
    // target — a kill that leaves a survivor re-pauses via {@link notifyTargetLost}
    // → {@link enterPause}. If we fired while still paused, that re-pause would hit
    // the already-paused guard in `enterPause` and be swallowed, then `leavePause`
    // would drop the player back into real time against the survivors. Leaving the
    // pause first lets the target-lost re-pause take effect (overlay re-opens onto
    // a fresh target); a non-killing confirm just stays resumed.
    this.leavePause();
    this.deps.onConfirm?.(action);
    return action;
  }

  /** Explicitly resume without firing (the player declines to act this pause). */
  resume(): void {
    if (!this._paused) return;
    this.leavePause();
  }

  /**
   * Force a fresh reaction-window pause (campaign Task 9 (v)): a combat **round**
   * completed — a round's worth of hull was lost — so re-open the target/weapon
   * overlay even though the incoming-attack debounce was already consumed this
   * engagement. Enters the pause directly (bypassing the debounce check
   * `requestPause` applies); leaves the debounce untouched — it must stay
   * consumed for the rest of the engagement, else the very next incoming shot
   * of the new round would re-trigger `requestPause` on its own and collapse
   * every round after the first into a single-shot pause instead of letting
   * damage accumulate to the round budget. A no-op if already paused. Returns
   * whether it flipped to paused.
   */
  repause(): boolean {
    return this.enterPause("incoming-attack");
  }

  /**
   * Engagement ended (combat over): drop the selection and re-arm the
   * incoming-attack debounce so the next fight pauses on its first shot again.
   * Leaves the paused flag untouched — the host resumes time on combat end.
   */
  reset(): void {
    this._target = null;
    this._weapon = null;
    this.incomingConsumed = false;
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /** Flip to paused if not already; fire onPause. Returns whether it flipped. */
  private enterPause(reason: PauseReason): boolean {
    if (this._paused) return false;
    this._paused = true;
    this.deps.onPause?.(reason);
    return true;
  }

  /** Flip to running; fire onResume. */
  private leavePause(): void {
    this._paused = false;
    this.deps.onResume?.();
  }
}
