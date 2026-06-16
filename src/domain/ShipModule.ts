import type { ModuleCategory, ModuleEffect } from "@/types";

export class ShipModule {
  /** Id of an applied MicroModule; undefined means no micromodule attached yet. */
  micromoduleId?: string;
  /**
   * Artifact-upgrade count carried while the item sits unfitted in the bag, so a
   * research-upgraded item that is unequipped in the hangar and re-fitted keeps
   * its upgrade levels (mirrors the loadout slot's `upgrades`). Undefined/0 = none.
   */
  upgrades?: number;

  constructor(
    public readonly id: string,
    public readonly category: ModuleCategory,
    public readonly name: string,
    public readonly effect: ModuleEffect,
    public readonly level: number,
  ) {}
}

export class WeaponModule extends ShipModule {
  constructor(
    id: string,
    name: string,
    effect: ModuleEffect,
    level: number,
    public readonly damage: number,
    public readonly range: number,
    public readonly energyCost: number,
  ) {
    super(id, "WEAPON" as ModuleCategory, name, effect, level);
  }
}

export class ShieldModule extends ShipModule {
  constructor(
    id: string,
    name: string,
    effect: ModuleEffect,
    level: number,
    public readonly shieldBoost: number,
    public readonly rechargeRate: number,
  ) {
    super(id, "SHIELD" as ModuleCategory, name, effect, level);
  }
}

export class EngineModule extends ShipModule {
  constructor(
    id: string,
    name: string,
    effect: ModuleEffect,
    level: number,
    public readonly speedBoost: number,
    public readonly evasionBoost: number,
  ) {
    super(id, "ENGINE" as ModuleCategory, name, effect, level);
  }
}
