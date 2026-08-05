export type CombatPhase = "idle" | "planning" | "executing";

export interface PlannedTurn<TTarget, TWeapon> {
  destination: { x: number; y: number } | null;
  readonly weaponTargets: Map<TWeapon, TTarget>;
  afterburner: boolean;
  consumableId: string | null;
  commsAction: string | null;
}

export interface CombatPlanningDeps<TTarget, TWeapon> {
  roundMs?: number;
  onEnterPlanning?(): void;
  onConfirm?(plan: PlannedTurn<TTarget, TWeapon>): void;
  onEnterExecuting?(): void;
  onCombatEnd?(): void;
}

export const DEFAULT_ROUND_MS = 3000;

function freshPlan<TTarget, TWeapon>(): PlannedTurn<TTarget, TWeapon> {
  return {
    destination: null,
    weaponTargets: new Map<TWeapon, TTarget>(),
    afterburner: false,
    consumableId: null,
    commsAction: null,
  };
}

export class CombatPlanningController<TTarget, TWeapon> {
  private readonly deps: CombatPlanningDeps<TTarget, TWeapon>;

  private _phase: CombatPhase = "idle";
  private _plan: PlannedTurn<TTarget, TWeapon> = freshPlan<TTarget, TWeapon>();
  private executeElapsedMs = 0;

  constructor(deps: CombatPlanningDeps<TTarget, TWeapon> = {}) {
    this.deps = deps;
  }

  get phase(): CombatPhase {
    return this._phase;
  }

  get isPlanning(): boolean {
    return this._phase === "planning";
  }

  get isExecuting(): boolean {
    return this._phase === "executing";
  }

  get plan(): PlannedTurn<TTarget, TWeapon> {
    return this._plan;
  }

  private roundMs(): number {
    const r = this.deps.roundMs ?? DEFAULT_ROUND_MS;
    return r > 0 ? r : DEFAULT_ROUND_MS;
  }

  beginCombat(): boolean {
    if (this._phase !== "idle") return false;
    this.openPlanning();
    return true;
  }

  confirm(): boolean {
    if (this._phase !== "planning") return false;
    this._phase = "executing";
    this.executeElapsedMs = 0;
    this.deps.onConfirm?.(this._plan);
    this.deps.onEnterExecuting?.();
    return true;
  }

  tickExecute(dtMs: number): boolean {
    if (this._phase !== "executing") return false;
    this.executeElapsedMs += Math.max(0, dtMs);
    if (this.executeElapsedMs < this.roundMs()) return false;
    this.openPlanning();
    return true;
  }

  executeProgress(): number {
    if (this._phase !== "executing") return 0;
    return Math.min(1, this.executeElapsedMs / this.roundMs());
  }

  endCombat(): boolean {
    if (this._phase === "idle") return false;
    this._phase = "idle";
    this.executeElapsedMs = 0;
    this._plan = freshPlan<TTarget, TWeapon>();
    this.deps.onCombatEnd?.();
    return true;
  }

  setDestination(dest: { x: number; y: number } | null): void {
    if (this._phase !== "planning") return;
    this._plan.destination = dest;
  }

  assignWeapon(weapon: TWeapon, target: TTarget): void {
    if (this._phase !== "planning") return;
    this._plan.weaponTargets.set(weapon, target);
  }

  clearWeapon(weapon: TWeapon): void {
    if (this._phase !== "planning") return;
    this._plan.weaponTargets.delete(weapon);
  }

  setAfterburner(on: boolean): void {
    if (this._phase !== "planning") return;
    this._plan.afterburner = on;
  }

  setConsumable(id: string | null): void {
    if (this._phase !== "planning") return;
    this._plan.consumableId = id;
  }

  setComms(action: string | null): void {
    if (this._phase !== "planning") return;
    this._plan.commsAction = action;
  }

  private openPlanning(): void {
    this._phase = "planning";
    this.executeElapsedMs = 0;
    this._plan = freshPlan<TTarget, TWeapon>();
    this.deps.onEnterPlanning?.();
  }
}
