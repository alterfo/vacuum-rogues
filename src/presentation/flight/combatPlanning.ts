/**
 * Tactical pause-and-plan combat state machine (pure, PixiJS-free).
 *
 * This is the new in-flight combat interaction model
 * (`docs/plans/20260713-tactical-pause-combat-rework.md`, Task 2). It **supersedes**
 * the reactive single-shot active-pause (`combatPause.ts` / {@link CombatPauseController}):
 * the "freeze on the first incoming hit → pick one target+weapon → fire exactly one shot
 * → resume auto-pursuit" flow is not kept as a parallel fallback. Instead combat resolves
 * as alternating **planning** and **executing** phases (Task 1's recorded loop shape):
 *
 * - **idle → planning**: the frame combat opens (first mutually-hostile combatant) freezes
 *   the sim and opens PLANNING with a fresh empty draft.
 * - **planning**: the player fills a single {@link PlannedTurn} draft — a movement
 *   destination, per-weapon target assignments, an afterburner flag, ≤1 consumable, ≤1
 *   comms action — all optional. An **empty draft is legal** ("hold position, hold fire"),
 *   so an incomplete plan never blocks confirm.
 * - **planning → executing**: an explicit confirm ("Ход", the existing turn-confirm) ends
 *   planning and starts a fixed-duration real-time EXECUTING window (`COMBAT_ROUND_MS`).
 * - **executing → planning**: when the round timer elapses the window ends and PLANNING
 *   re-opens (round-based loop) while ≥1 hostile remains. Impacts / arrivals / incoming
 *   hits during the window are resolved by the host in real time but do **NOT** end the
 *   window early — the round timer is the *single deterministic* terminator (Task 1).
 * - **any → idle**: the ONLY events that end a fight early are terminal — **player death**
 *   or the **last hostile destroyed** — surfaced by the host calling {@link endCombat}.
 *
 * The controller stays a pure state machine over opaque target/weapon handles (the scene
 * binds the real `NpcShipSprite` / `WeaponSpec` types) so it unit-tests without a rendering
 * context — the same discipline as {@link CombatPauseController} / `combatRounds`. The
 * flight scene wires freeze-time + overlay side effects through {@link CombatPlanningDeps}.
 * It deliberately does NOT know hostile counts: "re-open planning **while ≥1 hostile
 * remains**" is enforced by the host calling {@link endCombat} when the last hostile dies.
 */

/** The three phases of a tactical fight. */
export type CombatPhase = "idle" | "planning" | "executing";

/**
 * The single per-turn plan the player fills during PLANNING and the execute phase reads.
 * All fields optional/empty by default — a fresh draft means "hold position, hold fire".
 * `TTarget`/`TWeapon` are opaque handles the controller never inspects beyond identity.
 */
export interface PlannedTurn<TTarget, TWeapon> {
  /** One movement waypoint (world coords) handed to `ShipPhysics.setPath` (Task 3). Null = hold position. */
  destination: { x: number; y: number } | null;
  /** Per-weapon manual target assignment (Task 5/6). A weapon absent from the map = unassigned. */
  readonly weaponTargets: Map<TWeapon, TTarget>;
  /** Afterburner engaged for the coming execute window (Task 8). */
  afterburner: boolean;
  /** ≤1 combat consumable to activate this turn (Task 9). Null = none. */
  consumableId: string | null;
  /** ≤1 comms action to run this turn (Task 10). Null = none. */
  commsAction: string | null;
}

/**
 * Host side effects. All optional so the controller drives standalone in tests; the scene
 * supplies them to freeze time, open the planning overlay and run the confirmed turn.
 */
export interface CombatPlanningDeps<TTarget, TWeapon> {
  /**
   * Fixed execute-window duration in ms — the scene passes `COMBAT_ROUND_MS` (balance.ts).
   * Absent ⇒ {@link DEFAULT_ROUND_MS}, so lightweight callers/tests need not supply it.
   */
  roundMs?: number;
  /** Entered PLANNING → freeze the sim and open the planning overlay. */
  onEnterPlanning?(): void;
  /**
   * Draft confirmed → about to execute. Receives the frozen draft to hand to the
   * execute-phase path (movement `setPath`, per-weapon targeting, afterburner, …).
   */
  onConfirm?(plan: PlannedTurn<TTarget, TWeapon>): void;
  /** Entered EXECUTING → resume real-time and run the planned turn for one window. */
  onEnterExecuting?(): void;
  /** Combat ended (terminal — player death or last hostile destroyed) → resolve/tear down the turn. */
  onCombatEnd?(): void;
}

/**
 * Fallback execute-window duration (ms) when {@link CombatPlanningDeps.roundMs} is absent.
 * Mirrors `COMBAT_ROUND_MS` in `balance.ts` (the canonical value the scene passes); kept as
 * a plain local default so this module stays import-free and unit-tests standalone.
 */
export const DEFAULT_ROUND_MS = 3000;

/** A fresh empty planned turn (hold position, hold fire, nothing assigned). */
function freshPlan<TTarget, TWeapon>(): PlannedTurn<TTarget, TWeapon> {
  return {
    destination: null,
    weaponTargets: new Map<TWeapon, TTarget>(),
    afterburner: false,
    consumableId: null,
    commsAction: null,
  };
}

/**
 * Pure pause-and-plan state machine. `TTarget`/`TWeapon` are opaque handles (the scene
 * binds `NpcShipSprite` / `WeaponSpec`); the controller only compares them by identity, so
 * it stays free of presentation/domain deps.
 */
export class CombatPlanningController<TTarget, TWeapon> {
  private readonly deps: CombatPlanningDeps<TTarget, TWeapon>;

  private _phase: CombatPhase = "idle";
  private _plan: PlannedTurn<TTarget, TWeapon> = freshPlan<TTarget, TWeapon>();
  /** Real-time ms elapsed in the current execute window (0 outside EXECUTING). */
  private executeElapsedMs = 0;

  constructor(deps: CombatPlanningDeps<TTarget, TWeapon> = {}) {
    this.deps = deps;
  }

  /** Current phase. */
  get phase(): CombatPhase {
    return this._phase;
  }

  /**
   * True while the sim should be frozen for planning — the freeze signal the host folds
   * into `CombatModule`'s `isPaused` closure (per `flight/CLAUDE.md`: fold new freeze
   * conditions into `isPaused`, never into `isFrozen()` itself).
   */
  get isPlanning(): boolean {
    return this._phase === "planning";
  }

  /** True while the real-time execute window is running. */
  get isExecuting(): boolean {
    return this._phase === "executing";
  }

  /** The live draft the planning UI mutates and the execute phase reads. */
  get plan(): PlannedTurn<TTarget, TWeapon> {
    return this._plan;
  }

  private roundMs(): number {
    const r = this.deps.roundMs ?? DEFAULT_ROUND_MS;
    return r > 0 ? r : DEFAULT_ROUND_MS;
  }

  /**
   * Combat opened (first mutually-hostile combatant): idle → planning with a fresh empty
   * draft; fires `onEnterPlanning`. A no-op once a fight is already underway (planning or
   * executing) so a second opening combatant never resets the draft mid-turn. Returns
   * whether it opened planning.
   */
  beginCombat(): boolean {
    if (this._phase !== "idle") return false;
    this.openPlanning();
    return true;
  }

  /**
   * Confirm the planned turn ("Ход"): planning → executing; fires `onConfirm(draft)` then
   * `onEnterExecuting`. An **empty/incomplete draft is legal** (hold position, hold fire) —
   * it never blocks confirm. A no-op unless currently planning (so a confirm from idle or
   * a double-confirm mid-execute is rejected). Returns whether it started executing.
   */
  confirm(): boolean {
    if (this._phase !== "planning") return false;
    this._phase = "executing";
    this.executeElapsedMs = 0;
    this.deps.onConfirm?.(this._plan);
    this.deps.onEnterExecuting?.();
    return true;
  }

  /**
   * Advance the execute window by `dtMs` real-time ms. When the fixed round timer elapses
   * the window ends and PLANNING re-opens with a fresh draft (the round-based loop). A
   * no-op unless executing. Returns whether the round completed (flipped back to planning).
   *
   * Impacts / arrivals / incoming hits during the window are the host's to resolve in real
   * time and do NOT shorten the window (Task 1: the round timer is the single terminator).
   * If the last hostile died or the player was killed mid-window, the host calls
   * {@link endCombat} — which lands in `idle`, so a subsequent `tickExecute` no-ops.
   */
  tickExecute(dtMs: number): boolean {
    if (this._phase !== "executing") return false;
    this.executeElapsedMs += Math.max(0, dtMs);
    if (this.executeElapsedMs < this.roundMs()) return false;
    this.openPlanning();
    return true;
  }

  /** Fraction of the current execute window elapsed, clamped `[0,1]`; 0 when not executing. */
  executeProgress(): number {
    if (this._phase !== "executing") return 0;
    return Math.min(1, this.executeElapsedMs / this.roundMs());
  }

  /**
   * Terminal end of the whole fight — the ONLY thing that ends combat early, from any phase
   * → idle. Fired by the host on **player death** or **the last hostile destroyed**. Clears
   * the draft and fires `onCombatEnd`. A no-op if already idle. Returns whether it ended a fight.
   */
  endCombat(): boolean {
    if (this._phase === "idle") return false;
    this._phase = "idle";
    this.executeElapsedMs = 0;
    this._plan = freshPlan<TTarget, TWeapon>();
    this.deps.onCombatEnd?.();
    return true;
  }

  // ---------------------------------------------------------------------------
  // Draft mutation — the planning UI (Tasks 3/5/6/8/9/10) drives these; each is a
  // no-op outside PLANNING so the confirmed draft can't be edited mid-execute.
  // ---------------------------------------------------------------------------

  /** Set the movement waypoint for the coming execute window (null = hold position). */
  setDestination(dest: { x: number; y: number } | null): void {
    if (this._phase !== "planning") return;
    this._plan.destination = dest;
  }

  /** Assign a weapon to a target (overwrites any prior assignment for that weapon). */
  assignWeapon(weapon: TWeapon, target: TTarget): void {
    if (this._phase !== "planning") return;
    this._plan.weaponTargets.set(weapon, target);
  }

  /** Clear a weapon's target assignment (weapon holds fire / falls back). */
  clearWeapon(weapon: TWeapon): void {
    if (this._phase !== "planning") return;
    this._plan.weaponTargets.delete(weapon);
  }

  /** Toggle the afterburner flag for the coming execute window. */
  setAfterburner(on: boolean): void {
    if (this._phase !== "planning") return;
    this._plan.afterburner = on;
  }

  /** Set the ≤1 consumable to activate this turn (null = none). */
  setConsumable(id: string | null): void {
    if (this._phase !== "planning") return;
    this._plan.consumableId = id;
  }

  /** Set the ≤1 comms action to run this turn (null = none). */
  setComms(action: string | null): void {
    if (this._phase !== "planning") return;
    this._plan.commsAction = action;
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /** Enter PLANNING with a fresh empty draft; fire onEnterPlanning. */
  private openPlanning(): void {
    this._phase = "planning";
    this.executeElapsedMs = 0;
    this._plan = freshPlan<TTarget, TWeapon>();
    this.deps.onEnterPlanning?.();
  }
}
