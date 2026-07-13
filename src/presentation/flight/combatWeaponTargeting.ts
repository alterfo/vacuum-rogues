/**
 * Per-weapon range visualization + manual target assignment (pure, PixiJS-free).
 *
 * The planning phase of the pause-and-plan combat loop
 * (`docs/plans/20260713-tactical-pause-combat-rework.md`, Task 5) surfaces the
 * player's own fitted-weapon ranges as colored circles and lets the player hand-assign
 * each gun a target (focus-fire onto one enemy, or spread across several). This module
 * owns the pure geometry + range math + assignment logic behind that UI:
 *
 * - **{@link weaponRangeColor}** / **{@link weaponRangeCircles}** — one distinctly
 *   tinted range circle per fitted weapon, radius = the weapon's own catalog `range`
 *   (the player-side equivalent of `npcWeaponRange`'s role-scaled reach, now read from
 *   the actual fitted `GearCatalog`/`ShipLoadout` gear).
 * - **{@link targetInRange}** — whether a target sits inside a weapon's reach from the
 *   ship's current position (the flag the assignment UI colours a warning tint with).
 * - **{@link WeaponAssignmentController}** — the two-step "click a weapon, then click a
 *   target" interaction. It writes the assignment into the planned-turn draft (via the
 *   narrow {@link WeaponAssignmentSink}, satisfied by `CombatPlanningController`), so a
 *   re-assignment overwrites cleanly and every gun can point at one target or spread.
 *
 * **Out-of-range decision (Task 5, recorded):** an out-of-range assignment is **flagged,
 * not rejected.** In a pause-and-plan model the planned movement can carry a target into
 * range during the execute window, so a hard reject measured from the pre-move position
 * would wrongly forbid a legitimate lead-the-target plan. The assignment is therefore
 * accepted and returned with `inRange: false` so the UI can render it in a warning tint;
 * the execute-phase fire gate (`advancePlayerWeapons`' own range check, Task 6) stays the
 * sole authority on whether the shot actually lands.
 *
 * Kept a pure module (no PixiJS / no scene deps) so it unit-tests standalone, the same
 * discipline as `combatPlanning` / `combatTrajectory` / `combatGravity`.
 */

import type { Vec2 } from "./combatTrajectory";

/**
 * Distinct hue per fitted weapon so overlapping range circles read as separate rings.
 * A small fixed palette (cyan / amber / green / magenta / orange / violet); index wraps
 * for a loadout with more weapons than colours.
 */
export const WEAPON_RANGE_PALETTE: readonly number[] = [
  0x54d6ff, // cyan
  0xffd166, // amber
  0x8bffa3, // green
  0xff7bd5, // magenta
  0xffa552, // orange
  0xb794ff, // violet
];

/** The palette colour for the weapon at slot `index` (wraps past the palette length). */
export function weaponRangeColor(index: number): number {
  const n = WEAPON_RANGE_PALETTE.length;
  const i = ((Math.trunc(index) % n) + n) % n;
  return WEAPON_RANGE_PALETTE[i];
}

/** The minimal fitted-weapon surface the range overlay reads. */
export interface RangedWeapon {
  /** Stable id (catalog gear id) — the key the assignment draft is keyed by upstream. */
  readonly id: string;
  /** px reach in flight combat (`WeaponSpec.range`). */
  readonly range: number;
}

/** Drawable geometry for one weapon's range circle. */
export interface RangeCircle {
  /** The weapon this circle belongs to. */
  readonly weaponId: string;
  /** Circle centre (the player ship's world position). */
  readonly x: number;
  readonly y: number;
  /** Circle radius (px) — the weapon's own catalog range, never negative. */
  readonly radius: number;
  /** Distinct stroke colour for this weapon. */
  readonly color: number;
}

/**
 * Build one {@link RangeCircle} per fitted weapon, centred on the ship, radius = each
 * weapon's own catalog range and tinted distinctly by slot order. A zero/negative-range
 * weapon yields a radius-0 circle (drawn as nothing). Order matches the input order so
 * the colour is stable across redraws.
 */
export function weaponRangeCircles(
  weapons: readonly RangedWeapon[],
  center: Vec2,
): RangeCircle[] {
  return weapons.map((w, i) => ({
    weaponId: w.id,
    x: center.x,
    y: center.y,
    radius: Math.max(0, w.range),
    color: weaponRangeColor(i),
  }));
}

/**
 * Whether `target` sits within `range` px of `from` — the reach test the assignment UI
 * flags an out-of-range pick with. Boundary is inclusive; a non-positive range is never
 * in range.
 */
export function targetInRange(
  range: number,
  from: Vec2,
  target: Vec2,
): boolean {
  if (range <= 0) return false;
  const dx = target.x - from.x;
  const dy = target.y - from.y;
  return dx * dx + dy * dy <= range * range;
}

/**
 * The narrow planned-turn draft surface the assignment controller writes into —
 * satisfied by `CombatPlanningController` (its `assignWeapon`/`clearWeapon` no-op
 * outside PLANNING, so a stale assignment can't leak into an executing turn).
 */
export interface WeaponAssignmentSink<TWeapon, TTarget> {
  assignWeapon(weapon: TWeapon, target: TTarget): void;
  clearWeapon(weapon: TWeapon): void;
}

/** Result of a completed weapon→target assignment. */
export interface AssignmentResult<TWeapon, TTarget> {
  readonly weapon: TWeapon;
  readonly target: TTarget;
  /** Whether the target was within the weapon's reach at plan time (flag, not a gate). */
  readonly inRange: boolean;
}

/**
 * The two-step "click a weapon, then click a target" planning interaction. Holds the
 * pending weapon selection between the two clicks and writes the completed assignment
 * into the {@link WeaponAssignmentSink} (the planned-turn draft). Stateless about
 * geometry — the caller passes the ship + target positions so range is computed against
 * live coordinates.
 *
 * `TWeapon` carries a `range` for the in-range flag; `TTarget` is opaque (the concrete
 * `NpcShipSprite` upstream).
 */
export class WeaponAssignmentController<TWeapon extends RangedWeapon, TTarget> {
  private readonly sink: WeaponAssignmentSink<TWeapon, TTarget>;
  private pending: TWeapon | null = null;

  constructor(sink: WeaponAssignmentSink<TWeapon, TTarget>) {
    this.sink = sink;
  }

  /** The weapon awaiting a target click, or null if none is armed. */
  get selectedWeapon(): TWeapon | null {
    return this.pending;
  }

  /**
   * First click: arm `weapon` for assignment. Clicking the already-armed weapon again
   * toggles the selection off (so a mis-click is easy to undo). Returns the new pending
   * weapon (or null when toggled off).
   */
  selectWeapon(weapon: TWeapon): TWeapon | null {
    this.pending = this.pending === weapon ? null : weapon;
    return this.pending;
  }

  /**
   * Second click: assign the armed weapon to `target`, writing it into the draft
   * (overwriting any prior assignment for that weapon). The `inRange` flag is computed
   * from the ship + target positions but never blocks the assignment (see the module's
   * out-of-range decision). Clears the pending selection. Returns the assignment, or
   * null when no weapon is armed.
   */
  selectTarget(
    target: TTarget,
    from: Vec2,
    targetPos: Vec2,
  ): AssignmentResult<TWeapon, TTarget> | null {
    const weapon = this.pending;
    if (!weapon) return null;
    const inRange = targetInRange(weapon.range, from, targetPos);
    this.sink.assignWeapon(weapon, target);
    this.pending = null;
    return { weapon, target, inRange };
  }

  /** Clear a weapon's assignment (weapon holds fire / falls back — Task 6). */
  unassign(weapon: TWeapon): void {
    this.sink.clearWeapon(weapon);
    if (this.pending === weapon) this.pending = null;
  }

  /** Drop any pending weapon selection without assigning (e.g. Esc / mode exit). */
  clearSelection(): void {
    this.pending = null;
  }
}
