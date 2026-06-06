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
import { HullClass } from "@/types";

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
}

interface GearBase {
  readonly id: string;
  readonly name: string;
  readonly techLevel: number; // 1..8
  readonly size: number; // capacity units the item occupies
  readonly basePrice: number; // baseline credits before market modifiers
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
}

export interface EquipmentSpec extends GearBase {
  readonly kind: GearKind.EQUIPMENT;
  readonly equipmentClass: EquipmentClass;
  readonly potency: number; // generic strength (speed, radar range, repair/s, …)
}

export type Gear = HullSpec | WeaponSpec | EquipmentSpec;

const HULLS: HullSpec[] = [
  {
    id: "hull_scout",
    name: "Каркас «Разведчик»",
    kind: GearKind.HULL,
    hullClass: HullClass.LIGHT_FIGHTER,
    techLevel: 2,
    size: 8,
    basePrice: 4000,
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
    basePrice: 9500,
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
    basePrice: 7000,
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
    basePrice: 16000,
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
    basePrice: 14000,
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
    basePrice: 38000,
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
    basePrice: 2200,
    weaponClass: WeaponClass.ENERGY,
    damage: 14,
    range: 240,
  },
  {
    id: "wpn_beam",
    name: "Лучевой эмиттер",
    kind: GearKind.WEAPON,
    techLevel: 5,
    size: 4,
    basePrice: 9000,
    weaponClass: WeaponClass.ENERGY,
    damage: 30,
    range: 300,
  },
  {
    id: "wpn_railgun",
    name: "Рельсотрон",
    kind: GearKind.WEAPON,
    techLevel: 4,
    size: 5,
    basePrice: 7000,
    weaponClass: WeaponClass.FRAGMENT,
    damage: 26,
    range: 360,
  },
  {
    id: "wpn_scatter",
    name: "Картечница",
    kind: GearKind.WEAPON,
    techLevel: 3,
    size: 4,
    basePrice: 4200,
    weaponClass: WeaponClass.FRAGMENT,
    damage: 22,
    range: 180,
  },
  {
    id: "wpn_torpedo",
    name: "Торпедный модуль",
    kind: GearKind.WEAPON,
    techLevel: 6,
    size: 6,
    basePrice: 15000,
    weaponClass: WeaponClass.MISSILE,
    damage: 55,
    range: 420,
  },
];

const EQUIPMENT: EquipmentSpec[] = [
  {
    id: "eq_engine_i",
    name: "Двигатель Тип-I",
    kind: GearKind.EQUIPMENT,
    techLevel: 2,
    size: 3,
    basePrice: 2500,
    equipmentClass: EquipmentClass.ENGINE,
    potency: 0.9,
  },
  {
    id: "eq_engine_iii",
    name: "Двигатель Тип-III",
    kind: GearKind.EQUIPMENT,
    techLevel: 5,
    size: 3,
    basePrice: 9000,
    equipmentClass: EquipmentClass.ENGINE,
    potency: 1.4,
  },
  {
    id: "eq_tank",
    name: "Топливный бак",
    kind: GearKind.EQUIPMENT,
    techLevel: 1,
    size: 2,
    basePrice: 900,
    equipmentClass: EquipmentClass.FUEL_TANK,
    potency: 40,
  },
  {
    id: "eq_radar",
    name: "Радар дальнего поля",
    kind: GearKind.EQUIPMENT,
    techLevel: 4,
    size: 2,
    basePrice: 5200,
    equipmentClass: EquipmentClass.RADAR,
    potency: 1400,
  },
  {
    id: "eq_scanner",
    name: "Сканер целей",
    kind: GearKind.EQUIPMENT,
    techLevel: 4,
    size: 2,
    basePrice: 4800,
    equipmentClass: EquipmentClass.SCANNER,
    potency: 6,
  },
  {
    id: "eq_droid",
    name: "Ремонтный дроид",
    kind: GearKind.EQUIPMENT,
    techLevel: 5,
    size: 3,
    basePrice: 8000,
    equipmentClass: EquipmentClass.REPAIR_DROID,
    potency: 3,
  },
  {
    id: "eq_shield",
    name: "Генератор поля",
    kind: GearKind.EQUIPMENT,
    techLevel: 6,
    size: 4,
    basePrice: 12000,
    equipmentClass: EquipmentClass.SHIELD,
    potency: 80,
  },
];

/** The full catalog (read-only). */
export const GEAR_CATALOG: readonly Gear[] = [
  ...HULLS,
  ...WEAPONS,
  ...EQUIPMENT,
];

/** Lookup by id. */
export function gearById(id: string): Gear | undefined {
  return GEAR_CATALOG.find((g) => g.id === id);
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
