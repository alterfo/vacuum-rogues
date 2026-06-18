/**
 * Ship gear catalog (EPIC-007, US-070..074): the static set of hulls, weapons
 * and standard equipment the game can sell, with our own names (no proprietary
 * terms). Parameters follow canon §11.3 — items have a tech level (T1–T8) and a
 * size; smaller + higher-tech is dearer (priced via {@link gearMarketPrice}).
 *
 * Pure data + helpers (no PixiJS/DOM/persistence). Player-installed gear, slots
 * and stat recomputation come later in EPIC-007; this is the searchable
 * "what exists" catalog that the shop generator and info center (EPIC-009) use.
 */
import {
  HullClass,
  ModuleCategory,
  WeaponAbility,
  type MicroModule,
} from "@/types";
import { GameBusinessException } from "@/exceptions/GameBusinessException";

export enum GearKind {
  HULL = "HULL",
  WEAPON = "WEAPON",
  EQUIPMENT = "EQUIPMENT",
}

/** Weapon operating principle (canon §11.3): energy / fragment / missile. */
export enum WeaponClass {
  ENERGY = "ENERGY",
  FRAGMENT = "FRAGMENT",
  MISSILE = "MISSILE",
}

/** Standard equipment families that occupy a ship slot. */
export enum EquipmentClass {
  ENGINE = "ENGINE",
  FUEL_TANK = "FUEL_TANK",
  RADAR = "RADAR",
  SCANNER = "SCANNER",
  REPAIR_DROID = "REPAIR_DROID",
  GRAPPLE = "GRAPPLE",
  SHIELD = "SHIELD",
  /** Gravity tractor: auto-pickup of nearby space loot. `potency` = pickup range in px. */
  GRAV_TRACTOR = "GRAV_TRACTOR",
}

interface GearBase {
  readonly id: string;
  readonly name: string;
  readonly techLevel: number; // 1..8
  readonly size: number; // capacity units the item occupies
  readonly basePrice: number; // baseline credits before market modifiers
  readonly upgrades?: number; // 0-2, present only on upgraded copies
}

export interface HullSpec extends GearBase {
  readonly kind: GearKind.HULL;
  readonly hullClass: HullClass;
  readonly hp: number; // hull points (= capacity in canon)
  readonly slots: number; // total slots (weaponSlots + equipmentSlots)
  readonly weaponSlots: number;
  readonly equipmentSlots: number;
  readonly cargo: number; // hold capacity
}

export interface WeaponSpec extends GearBase {
  readonly kind: GearKind.WEAPON;
  readonly weaponClass: WeaponClass;
  readonly damage: number; // per shot / per second
  readonly range: number; // px reach in flight combat
  readonly ability: WeaponAbility;
  readonly cooldownTurns: number; // turns before weapon can fire again
}

export interface EquipmentSpec extends GearBase {
  readonly kind: GearKind.EQUIPMENT;
  readonly equipmentClass: EquipmentClass;
  readonly potency: number; // generic strength (speed, radar range, repair/s, …)
}

export type Gear = HullSpec | WeaponSpec | EquipmentSpec;

/** The four canon slot banks a piece of gear can occupy (SR-canon §11.3). */
export type SlotCategory = "weapon" | "engine" | "radar" | "equipment";

/**
 * Which categorized slot bank this gear occupies. Weapons fill the weapon bank;
 * the engine takes its single "Система движения" slot; the radar takes its
 * single "Система отслеживания" slot; every other equipment family (fuel tank,
 * shield, repair droid, scanner, grav-tractor, grapple) shares the "additional
 * equipment" bank. A hull is the ship itself, not a slottable item, so it has no
 * category.
 */
export function slotCategoryFor(gear: Gear): SlotCategory | undefined {
  if (gear.kind === GearKind.HULL) return undefined;
  if (gear.kind === GearKind.WEAPON) return "weapon";
  switch ((gear as EquipmentSpec).equipmentClass) {
    case EquipmentClass.ENGINE:
      return "engine";
    case EquipmentClass.RADAR:
      return "radar";
    default:
      return "equipment";
  }
}

const HULLS: HullSpec[] = [
  {
    id: "hull_scout",
    name: "Каркас «Разведчик»",
    kind: GearKind.HULL,
    hullClass: HullClass.LIGHT_FIGHTER,
    techLevel: 2,
    size: 8,
    basePrice: 1200,
    hp: 90,
    slots: 4,
    weaponSlots: 2,
    equipmentSlots: 2,
    cargo: 20,
  },
  {
    id: "hull_corvette",
    name: "Каркас «Корвет»",
    kind: GearKind.HULL,
    hullClass: HullClass.CORVETTE,
    techLevel: 3,
    size: 10,
    basePrice: 3000,
    hp: 140,
    slots: 5,
    weaponSlots: 2,
    equipmentSlots: 3,
    cargo: 30,
  },
  {
    id: "hull_courier",
    name: "Каркас «Курьер»",
    kind: GearKind.HULL,
    hullClass: HullClass.TRANSPORT,
    techLevel: 3,
    size: 10,
    basePrice: 2500,
    hp: 120,
    slots: 5,
    weaponSlots: 1,
    equipmentSlots: 4,
    cargo: 45,
  },
  {
    id: "hull_warden",
    name: "Каркас «Страж»",
    kind: GearKind.HULL,
    hullClass: HullClass.FRIGATE,
    techLevel: 5,
    size: 12,
    basePrice: 7000,
    hp: 220,
    slots: 7,
    weaponSlots: 3,
    equipmentSlots: 4,
    cargo: 35,
  },
  {
    id: "hull_freighter",
    name: "Каркас «Грузовоз»",
    kind: GearKind.HULL,
    hullClass: HullClass.HEAVY_FREIGHTER,
    techLevel: 4,
    size: 16,
    basePrice: 4500,
    hp: 180,
    slots: 6,
    weaponSlots: 2,
    equipmentSlots: 4,
    cargo: 120,
  },
  {
    id: "hull_bastion",
    name: "Каркас «Бастион»",
    kind: GearKind.HULL,
    hullClass: HullClass.DESTROYER,
    techLevel: 7,
    size: 14,
    basePrice: 12000,
    hp: 360,
    slots: 9,
    weaponSlots: 4,
    equipmentSlots: 5,
    cargo: 50,
  },
];

const WEAPONS: WeaponSpec[] = [
  {
    id: "wpn_pulse",
    name: "Импульсный лазер",
    kind: GearKind.WEAPON,
    techLevel: 2,
    size: 3,
    basePrice: 800,
    weaponClass: WeaponClass.ENERGY,
    damage: 14,
    range: 240,
    ability: WeaponAbility.NONE,
    cooldownTurns: 1,
  },
  {
    id: "wpn_beam",
    name: "Лучевой эмиттер (ЭМИ)",
    kind: GearKind.WEAPON,
    techLevel: 5,
    size: 4,
    basePrice: 7500,
    weaponClass: WeaponClass.ENERGY,
    damage: 30,
    range: 300,
    ability: WeaponAbility.EMP,
    cooldownTurns: 3,
  },
  {
    id: "wpn_railgun",
    name: "Рельсотрон",
    kind: GearKind.WEAPON,
    techLevel: 4,
    size: 5,
    basePrice: 3800,
    weaponClass: WeaponClass.FRAGMENT,
    damage: 26,
    range: 360,
    ability: WeaponAbility.NONE,
    cooldownTurns: 1,
  },
  {
    id: "wpn_scatter",
    name: "Картечница (Шквал)",
    kind: GearKind.WEAPON,
    techLevel: 3,
    size: 4,
    basePrice: 2200,
    weaponClass: WeaponClass.FRAGMENT,
    damage: 22,
    range: 180,
    ability: WeaponAbility.BURST,
    cooldownTurns: 2,
  },
  {
    id: "wpn_torpedo",
    name: "Самонаводящаяся торпеда",
    kind: GearKind.WEAPON,
    techLevel: 6,
    size: 6,
    basePrice: 8500,
    weaponClass: WeaponClass.MISSILE,
    damage: 55,
    range: 420,
    ability: WeaponAbility.HOMING,
    cooldownTurns: 3,
  },
  {
    id: "wpn_rocket",
    name: "Ракетный блок",
    kind: GearKind.WEAPON,
    techLevel: 3,
    size: 4,
    basePrice: 2500,
    weaponClass: WeaponClass.MISSILE,
    damage: 35,
    range: 320,
    ability: WeaponAbility.NONE,
    cooldownTurns: 2,
  },
];

const EQUIPMENT: EquipmentSpec[] = [
  {
    id: "eq_engine_i",
    name: "Двигатель Тип-I",
    kind: GearKind.EQUIPMENT,
    techLevel: 2,
    size: 3,
    basePrice: 900,
    equipmentClass: EquipmentClass.ENGINE,
    potency: 0.9,
  },
  {
    id: "eq_engine_iii",
    name: "Двигатель Тип-III",
    kind: GearKind.EQUIPMENT,
    techLevel: 5,
    size: 3,
    basePrice: 6500,
    equipmentClass: EquipmentClass.ENGINE,
    potency: 1.4,
  },
  {
    id: "eq_tank",
    name: "Топливный бак",
    kind: GearKind.EQUIPMENT,
    techLevel: 1,
    size: 2,
    basePrice: 500,
    equipmentClass: EquipmentClass.FUEL_TANK,
    potency: 40,
  },
  {
    id: "eq_radar",
    name: "Радар дальнего поля",
    kind: GearKind.EQUIPMENT,
    techLevel: 4,
    size: 2,
    basePrice: 2800,
    equipmentClass: EquipmentClass.RADAR,
    potency: 1400,
  },
  {
    id: "eq_scanner",
    name: "Сканер целей",
    kind: GearKind.EQUIPMENT,
    techLevel: 4,
    size: 2,
    basePrice: 2600,
    equipmentClass: EquipmentClass.SCANNER,
    potency: 6,
  },
  {
    id: "eq_droid",
    name: "Ремонтный дроид",
    kind: GearKind.EQUIPMENT,
    techLevel: 5,
    size: 3,
    basePrice: 6000,
    equipmentClass: EquipmentClass.REPAIR_DROID,
    potency: 3,
  },
  {
    id: "eq_shield",
    name: "Генератор поля",
    kind: GearKind.EQUIPMENT,
    techLevel: 6,
    size: 4,
    basePrice: 7800,
    equipmentClass: EquipmentClass.SHIELD,
    potency: 80,
  },
  // Gravity tractors (Task 10): potency encodes the auto-pickup range in px.
  // Tech levels track the economy price bands (economyBalance.test.ts); they do
  // not affect range, which is the potency field.
  {
    id: "grav_tractor_1",
    name: "Гравитяга Тип-I",
    kind: GearKind.EQUIPMENT,
    techLevel: 3,
    size: 2,
    basePrice: 2000,
    equipmentClass: EquipmentClass.GRAV_TRACTOR,
    potency: 80,
  },
  {
    id: "grav_tractor_2",
    name: "Гравитяга Тип-II",
    kind: GearKind.EQUIPMENT,
    techLevel: 4,
    size: 2,
    basePrice: 5000,
    equipmentClass: EquipmentClass.GRAV_TRACTOR,
    potency: 150,
  },
  {
    id: "grav_tractor_3",
    name: "Гравитяга Тип-III",
    kind: GearKind.EQUIPMENT,
    techLevel: 7,
    size: 3,
    basePrice: 12000,
    equipmentClass: EquipmentClass.GRAV_TRACTOR,
    potency: 250,
  },
];

/** The full catalog (read-only). */
export const GEAR_CATALOG: readonly Gear[] = [
  ...HULLS,
  ...WEAPONS,
  ...EQUIPMENT,
];

/** 12 micromodule definitions: 4 categories × 3 tiers. Sold at CRAFT_CENTER stations. */
export const MICRO_MODULES: readonly MicroModule[] = [
  // ENGINE — boosts derived speed
  {
    id: "mm_eng_1",
    name: "Форсаж ур.1",
    targetCategory: ModuleCategory.ENGINE,
    bonusType: "speed",
    bonusTier: 1,
  },
  {
    id: "mm_eng_2",
    name: "Форсаж ур.2",
    targetCategory: ModuleCategory.ENGINE,
    bonusType: "speed",
    bonusTier: 2,
  },
  {
    id: "mm_eng_3",
    name: "Форсаж ур.3",
    targetCategory: ModuleCategory.ENGINE,
    bonusType: "speed",
    bonusTier: 3,
  },
  // WEAPON — boosts weapon damage
  {
    id: "mm_wpn_1",
    name: "Усилитель урона ур.1",
    targetCategory: ModuleCategory.WEAPON,
    bonusType: "damage",
    bonusTier: 1,
  },
  {
    id: "mm_wpn_2",
    name: "Усилитель урона ур.2",
    targetCategory: ModuleCategory.WEAPON,
    bonusType: "damage",
    bonusTier: 2,
  },
  {
    id: "mm_wpn_3",
    name: "Усилитель урона ур.3",
    targetCategory: ModuleCategory.WEAPON,
    bonusType: "damage",
    bonusTier: 3,
  },
  // SHIELD — boosts shield HP
  {
    id: "mm_shld_1",
    name: "Усиление щита ур.1",
    targetCategory: ModuleCategory.SHIELD,
    bonusType: "shieldHp",
    bonusTier: 1,
  },
  {
    id: "mm_shld_2",
    name: "Усиление щита ур.2",
    targetCategory: ModuleCategory.SHIELD,
    bonusType: "shieldHp",
    bonusTier: 2,
  },
  {
    id: "mm_shld_3",
    name: "Усиление щита ур.3",
    targetCategory: ModuleCategory.SHIELD,
    bonusType: "shieldHp",
    bonusTier: 3,
  },
  // EQUIPMENT — boosts generic equipment potency (radar, droid, etc.)
  {
    id: "mm_eq_1",
    name: "Оптимизатор ур.1",
    targetCategory: ModuleCategory.EQUIPMENT,
    bonusType: "potency",
    bonusTier: 1,
  },
  {
    id: "mm_eq_2",
    name: "Оптимизатор ур.2",
    targetCategory: ModuleCategory.EQUIPMENT,
    bonusType: "potency",
    bonusTier: 2,
  },
  {
    id: "mm_eq_3",
    name: "Оптимизатор ур.3",
    targetCategory: ModuleCategory.EQUIPMENT,
    bonusType: "potency",
    bonusTier: 3,
  },
];

export function microModuleById(id: string): MicroModule | undefined {
  return MICRO_MODULES.find((m) => m.id === id);
}

/** Lookup by id. */
export function gearById(id: string): Gear | undefined {
  return GEAR_CATALOG.find((g) => g.id === id);
}

/**
 * Artifact cost per upgrade tier: first upgrade costs 2, second costs 3 more (5 total).
 * Max upgrades per item: 2. Values indexed by currentUpgrades (0 or 1).
 */
export const ARTIFACT_UPGRADE_COSTS = [2, 3] as const;

/** Returns the artifact cost for the next upgrade, or Infinity if already maxed. */
export function artifactUpgradeCost(currentUpgrades: number): number {
  if (currentUpgrades >= 2) return Infinity;
  return ARTIFACT_UPGRADE_COSTS[currentUpgrades];
}

/**
 * Apply one artifact upgrade to a gear piece.
 * Validates cost and upgrade cap; throws GameBusinessException on failure.
 * Returns a new gear object (does NOT mutate the catalog).
 */
export function applyArtifactUpgrade(
  gear: Gear,
  availableArtifacts: number,
): Gear {
  const current = gear.upgrades ?? 0;
  if (current >= 2) {
    throw new GameBusinessException(
      "UPGRADE_MAX_REACHED",
      `${gear.name} is already at maximum upgrade level (+2).`,
      { gearId: gear.id },
    );
  }
  const cost = ARTIFACT_UPGRADE_COSTS[current];
  if (availableArtifacts < cost) {
    throw new GameBusinessException(
      "INSUFFICIENT_RESOURCES",
      `Need ${cost} artifacts to upgrade ${gear.name}; only ${availableArtifacts} available.`,
      { gearId: gear.id, cost, available: availableArtifacts },
    );
  }
  return { ...gear, upgrades: current + 1, techLevel: gear.techLevel + 1 };
}

/**
 * Market price for an item: rises with tech level and falls with size (compact,
 * high-tech gear is dearer — canon §11.3). `priceFactor` lets a shop apply a
 * faction/economy modifier; deterministic given the same factor.
 */
export function gearMarketPrice(gear: Gear, priceFactor = 1): number {
  const techMult = 1 + (gear.techLevel - 1) * 0.06; // higher tech → pricier
  const sizeMult = 1 + Math.max(0, 6 - gear.size) * 0.04; // smaller → pricier
  return Math.round(gear.basePrice * techMult * sizeMult * priceFactor);
}
