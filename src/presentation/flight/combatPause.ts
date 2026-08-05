export type PauseReason = "incoming-attack" | "target-lost";

export interface PauseAttackAction<TTarget, TWeapon> {
  readonly target: TTarget;
  readonly weapon: TWeapon;
}

export interface CombatPauseDeps<TTarget, TWeapon> {
  onPause?(reason: PauseReason): void;
  onResume?(): void;
  onConfirm?(action: PauseAttackAction<TTarget, TWeapon>): void;
}

export class CombatPauseController<TTarget, TWeapon> {
  private readonly deps: CombatPauseDeps<TTarget, TWeapon>;

  private _paused = false;
  private _target: TTarget | null = null;
  private _weapon: TWeapon | null = null;

  private incomingConsumed = false;

  constructor(deps: CombatPauseDeps<TTarget, TWeapon> = {}) {
    this.deps = deps;
  }

  get paused(): boolean {
    return this._paused;
  }

  get selectedTarget(): TTarget | null {
    return this._target;
  }

  get selectedWeapon(): TWeapon | null {
    return this._weapon;
  }

  requestPause(reason: PauseReason): boolean {
    if (reason === "incoming-attack" && this.incomingConsumed) return false;
    if (reason === "incoming-attack") this.incomingConsumed = true;
    return this.enterPause(reason);
  }

  notifyTargetLost(target: TTarget): boolean {
    if (target !== this._target) return false;
    this._target = null;
    return this.enterPause("target-lost");
  }

  loseTarget(target: TTarget): boolean {
    this.selectTarget(target);
    return this.notifyTargetLost(target);
  }

  selectTarget(target: TTarget | null): void {
    this._target = target;
  }

  selectWeapon(weapon: TWeapon | null): void {
    this._weapon = weapon;
  }

  confirm(): PauseAttackAction<TTarget, TWeapon> | null {
    if (!this._paused || this._target === null || this._weapon === null)
      return null;
    const action: PauseAttackAction<TTarget, TWeapon> = {
      target: this._target,
      weapon: this._weapon,
    };
    this.leavePause();
    this.deps.onConfirm?.(action);
    return action;
  }

  resume(): void {
    if (!this._paused) return;
    this.leavePause();
  }

  repause(): boolean {
    return this.enterPause("incoming-attack");
  }

  reset(): void {
    this._target = null;
    this._weapon = null;
    this.incomingConsumed = false;
  }

  private enterPause(reason: PauseReason): boolean {
    if (this._paused) return false;
    this._paused = true;
    this.deps.onPause?.(reason);
    return true;
  }

  private leavePause(): void {
    this._paused = false;
    this.deps.onResume?.();
  }
}
