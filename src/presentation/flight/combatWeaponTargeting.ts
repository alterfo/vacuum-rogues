import type { Vec2 } from "./combatTrajectory";

export const WEAPON_RANGE_PALETTE: readonly number[] = [
  0x54d6ff, // cyan
  0xffd166, // amber
  0x8bffa3, // green
  0xff7bd5, // magenta
  0xffa552, // orange
  0xb794ff, // violet
];

export function weaponRangeColor(index: number): number {
  const n = WEAPON_RANGE_PALETTE.length;
  const i = ((Math.trunc(index) % n) + n) % n;
  return WEAPON_RANGE_PALETTE[i];
}

export interface RangedWeapon {
  readonly id: string;
  readonly range: number;
}

export interface RangeCircle {
  readonly weaponId: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly color: number;
}

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

export interface WeaponAssignmentSink<TWeapon, TTarget> {
  assignWeapon(weapon: TWeapon, target: TTarget): void;
  clearWeapon(weapon: TWeapon): void;
}

export interface AssignmentResult<TWeapon, TTarget> {
  readonly weapon: TWeapon;
  readonly target: TTarget;
  readonly inRange: boolean;
}

export class WeaponAssignmentController<TWeapon extends RangedWeapon, TTarget> {
  private readonly sink: WeaponAssignmentSink<TWeapon, TTarget>;
  private pending: TWeapon | null = null;

  constructor(sink: WeaponAssignmentSink<TWeapon, TTarget>) {
    this.sink = sink;
  }

  get selectedWeapon(): TWeapon | null {
    return this.pending;
  }

  selectWeapon(weapon: TWeapon): TWeapon | null {
    this.pending = this.pending === weapon ? null : weapon;
    return this.pending;
  }

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

  unassign(weapon: TWeapon): void {
    this.sink.clearWeapon(weapon);
    if (this.pending === weapon) this.pending = null;
  }

  clearSelection(): void {
    this.pending = null;
  }
}
