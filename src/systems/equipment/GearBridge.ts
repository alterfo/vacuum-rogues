import { ShipModule } from "@/domain/ShipModule";
import { HULL_CLASS_SPECS, type HullClass, type ModuleCategory } from "@/types";
import type { Player } from "@/domain/Player";
import type { PlayerShip } from "@/domain/PlayerShip";
import type { ShipLoadout } from "./ShipLoadout";
import { GearKind, type Gear } from "./GearCatalog";

/** Convert a catalog Gear item to the ShipModule stored in inventory. */
export function gearToModule(gear: Gear): ShipModule {
  return new ShipModule(
    gear.id,
    gear.kind as unknown as ModuleCategory,
    gear.name,
    { type: gear.kind.toLowerCase(), value: gear.techLevel * 10 },
    gear.techLevel,
  );
}

/**
 * Keep the legacy `player.ship` in step with a newly installed hull.
 *
 * GearCatalog/ShipLoadout is canonical for derived stats, but `PlayerShip`
 * still backs two things the loadout doesn't: `cargoCapacity` (a getter off
 * `hullClass`, read by the trade UI and NPC cargo logic) and `maxHull` (read by
 * combat). Both hull shops change only ONE of the two representations, so
 * buying a bigger hull used to leave the cargo hold (and ship stats) on the old
 * hull's numbers — the "купил корпус, инвентарь не поменялся" bug. Both shops
 * now call this so the two representations never drift apart.
 */
export function syncShipToHullClass(
  player: Player,
  hullClass: HullClass,
): void {
  player.ship.hullClass = hullClass;
  const spec = HULL_CLASS_SPECS[hullClass];
  player.ship.maxHull = spec.maxHp;
  player.ship.hullHP = Math.min(player.ship.hullHP, spec.maxHp);
}

/**
 * Authoritative cargo capacity for the player's ship.
 *
 * `ShipLoadout` is the single source of truth for derived stats, so the hold
 * size is the loadout hull's `cargo` (via `derivedStats().cargo`). The legacy
 * `ship.cargoCapacity` getter is only a fallback for the (transient) window
 * before a loadout exists — once Task 5 drops that getter this fallback goes
 * with it. Both the trade UI and the NPC cargo logic read through here so they
 * never diverge from the loadout again.
 */
export function cargoCapacityOf(
  loadout: ShipLoadout | null | undefined,
  ship: PlayerShip,
): number {
  return loadout ? loadout.derivedStats().cargo : ship.cargoCapacity;
}

/** Russian display label per gear kind. */
export const KIND_LABEL: Record<GearKind, string> = {
  [GearKind.HULL]: "Корпус",
  [GearKind.WEAPON]: "Оружие",
  [GearKind.EQUIPMENT]: "Снаряжение",
};

/** Badge colour per gear kind. */
export const KIND_COLOR: Record<GearKind, number> = {
  [GearKind.HULL]: 0x88ccff,
  [GearKind.WEAPON]: 0xff8888,
  [GearKind.EQUIPMENT]: 0x88ffcc,
};
