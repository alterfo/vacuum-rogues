import {
  HullClass,
  ModuleCategory,
  WeaponAbility,
  type MicroModule,
} from "@/types";
import { GameBusinessException } from "@/exceptions/GameBusinessException";
import { APEX_ENGINE_MIN_DAY, RARE_TECH_THRESHOLD } from "@/config/balance";

export enum GearKind {
  HULL = "HULL",
  WEAPON = "WEAPON",
  EQUIPMENT = "EQUIPMENT",
}

export enum WeaponClass {
  ENERGY = "ENERGY",
  FRAGMENT = "FRAGMENT",
  MISSILE = "MISSILE",
}

export enum EquipmentClass {
  ENGINE = "ENGINE",
  FUEL_TANK = "FUEL_TANK",
  RADAR = "RADAR",
  SCANNER = "SCANNER",
  REPAIR_DROID = "REPAIR_DROID",
  GRAPPLE = "GRAPPLE",
  SHIELD = "SHIELD",
  GRAV_TRACTOR = "GRAV_TRACTOR",
}

interface GearBase {
  readonly id: string;
  readonly name: string;
  readonly techLevel: number; // 1..8
  readonly size: number; // capacity units the item occupies
  readonly basePrice: number; // baseline credits before market modifiers
  readonly mass: number;
  readonly upgrades?: number; // 0-2, present only on upgraded copies
  readonly rare?: boolean;
  readonly minDay?: number;
}

export interface HullSpec extends GearBase {
  readonly kind: GearKind.HULL;
  readonly hullClass: HullClass;
  readonly hp: number; // hull points (= capacity in canon)
  readonly slots: number; // total slots (weaponSlots + equipmentSlots)
  readonly weaponSlots: number;
  readonly equipmentSlots: number;
  readonly cargo: number; // hold capacity
  readonly massCapacity: number;
  readonly micromoduleSlots?: number;
}

export const DEFAULT_HULL_MICROMODULE_SLOTS = 1;

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

export type SlotCategory = "weapon" | "engine" | "radar" | "equipment";

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
    mass: 9,
    hp: 55,
    slots: 4,
    weaponSlots: 2,
    equipmentSlots: 2,
    cargo: 20,
    massCapacity: 30,
    micromoduleSlots: 1,
  },
  {
    id: "hull_corvette",
    name: "Каркас «Корвет»",
    kind: GearKind.HULL,
    hullClass: HullClass.CORVETTE,
    techLevel: 3,
    size: 10,
    basePrice: 3000,
    mass: 14,
    hp: 140,
    slots: 5,
    weaponSlots: 2,
    equipmentSlots: 3,
    cargo: 30,
    massCapacity: 40,
    micromoduleSlots: 2,
  },
  {
    id: "hull_courier",
    name: "Каркас «Курьер»",
    kind: GearKind.HULL,
    hullClass: HullClass.TRANSPORT,
    techLevel: 3,
    size: 10,
    basePrice: 3000,
    mass: 12,
    hp: 120,
    slots: 5,
    weaponSlots: 1,
    equipmentSlots: 4,
    cargo: 45,
    massCapacity: 36,
    micromoduleSlots: 2,
  },
  {
    id: "hull_warden",
    name: "Каркас «Страж»",
    kind: GearKind.HULL,
    hullClass: HullClass.FRIGATE,
    techLevel: 5,
    size: 12,
    basePrice: 7000,
    mass: 22,
    hp: 220,
    slots: 7,
    weaponSlots: 3,
    equipmentSlots: 4,
    cargo: 35,
    massCapacity: 70,
    micromoduleSlots: 3,
  },
  {
    id: "hull_freighter",
    name: "Каркас «Грузовоз»",
    kind: GearKind.HULL,
    hullClass: HullClass.HEAVY_FREIGHTER,
    techLevel: 4,
    size: 16,
    basePrice: 3900,
    mass: 28,
    hp: 180,
    slots: 6,
    weaponSlots: 2,
    equipmentSlots: 4,
    cargo: 120,
    massCapacity: 60,
    micromoduleSlots: 3,
  },
  {
    id: "hull_cruiser",
    name: "Каркас «Крейсер»",
    kind: GearKind.HULL,
    hullClass: HullClass.CRUISER,
    techLevel: 6,
    size: 13,
    basePrice: 8800,
    mass: 30,
    hp: 280,
    slots: 8,
    weaponSlots: 3,
    equipmentSlots: 5,
    cargo: 45,
    massCapacity: 85,
    micromoduleSlots: 3,
    rare: true,
  },
  {
    id: "hull_bastion",
    name: "Каркас «Бастион»",
    kind: GearKind.HULL,
    hullClass: HullClass.DESTROYER,
    techLevel: 7,
    size: 14,
    basePrice: 12000,
    mass: 36,
    hp: 360,
    slots: 9,
    weaponSlots: 4,
    equipmentSlots: 5,
    cargo: 50,
    massCapacity: 95,
    micromoduleSlots: 4,
    rare: true,
  },
  {
    id: "hull_dreadnought",
    name: "Каркас «Дредноут»",
    kind: GearKind.HULL,
    hullClass: HullClass.DESTROYER,
    techLevel: 7,
    size: 16,
    basePrice: 68000,
    mass: 44,
    hp: 700,
    slots: 11,
    weaponSlots: 5,
    equipmentSlots: 6,
    cargo: 60,
    massCapacity: 140,
    micromoduleSlots: 4,
    rare: true,
    minDay: 540,
  },
  {
    id: "hull_liberator",
    name: "Каркас «Освободитель»",
    kind: GearKind.HULL,
    hullClass: HullClass.DESTROYER,
    techLevel: 8,
    size: 18,
    basePrice: 240000,
    mass: 52,
    hp: 1200,
    slots: 13,
    weaponSlots: 6,
    equipmentSlots: 7,
    cargo: 70,
    massCapacity: 190,
    micromoduleSlots: 5,
    rare: true,
    minDay: 900,
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
    mass: 4,
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
    mass: 9,
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
    mass: 8,
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
    mass: 6,
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
    mass: 12,
    weaponClass: WeaponClass.MISSILE,
    damage: 55,
    range: 420,
    ability: WeaponAbility.HOMING,
    cooldownTurns: 3,
    rare: true, // apex weapon — rare, high-end stock only
  },
  {
    id: "wpn_rocket",
    name: "Ракетный блок",
    kind: GearKind.WEAPON,
    techLevel: 3,
    size: 4,
    basePrice: 2500,
    mass: 6,
    weaponClass: WeaponClass.MISSILE,
    damage: 35,
    range: 320,
    ability: WeaponAbility.NONE,
    cooldownTurns: 2,
  },
  {
    id: "wpn_mining_laser",
    name: "Горнодобывающий лазер",
    kind: GearKind.WEAPON,
    techLevel: 1,
    size: 2,
    basePrice: 550,
    mass: 2,
    weaponClass: WeaponClass.ENERGY,
    damage: 8,
    range: 200,
    ability: WeaponAbility.NONE,
    cooldownTurns: 1,
  },
  {
    id: "wpn_swarm_racks",
    name: "Роевые направляющие",
    kind: GearKind.WEAPON,
    techLevel: 2,
    size: 3,
    basePrice: 1200,
    mass: 5,
    weaponClass: WeaponClass.MISSILE,
    damage: 12,
    range: 260,
    ability: WeaponAbility.BURST,
    cooldownTurns: 1,
  },
  {
    id: "wpn_flak_burst",
    name: "Картечный обвал",
    kind: GearKind.WEAPON,
    techLevel: 4,
    size: 4,
    basePrice: 4200,
    mass: 7,
    weaponClass: WeaponClass.FRAGMENT,
    damage: 24,
    range: 140,
    ability: WeaponAbility.BURST,
    cooldownTurns: 1,
  },
  {
    id: "wpn_long_lance",
    name: "Длинное копьё",
    kind: GearKind.WEAPON,
    techLevel: 5,
    size: 5,
    basePrice: 6000,
    mass: 10,
    weaponClass: WeaponClass.FRAGMENT,
    damage: 16,
    range: 375,
    ability: WeaponAbility.NONE,
    cooldownTurns: 2,
  },
  {
    id: "wpn_disruptor",
    name: "Дизраптор (редкий)",
    kind: GearKind.WEAPON,
    techLevel: 7,
    size: 6,
    basePrice: 11000,
    mass: 14,
    weaponClass: WeaponClass.ENERGY,
    damage: 40,
    range: 340,
    ability: WeaponAbility.EMP,
    cooldownTurns: 3,
  },
  {
    id: "wpn_singularity_lance",
    name: "Сингулярное копьё (редкое)",
    kind: GearKind.WEAPON,
    techLevel: 8,
    size: 7,
    basePrice: 13800,
    mass: 16,
    weaponClass: WeaponClass.MISSILE,
    damage: 55,
    range: 480,
    ability: WeaponAbility.HOMING,
    cooldownTurns: 4,
    rare: true,
  },
  {
    id: "wpn_lance_array",
    name: "Лансовая батарея",
    kind: GearKind.WEAPON,
    techLevel: 7,
    size: 5,
    basePrice: 36000,
    mass: 11,
    weaponClass: WeaponClass.ENERGY,
    damage: 70,
    range: 400,
    ability: WeaponAbility.NONE,
    cooldownTurns: 2,
    minDay: 540,
  },
  {
    id: "wpn_aft_shredder",
    name: "Кормовой шреддер",
    kind: GearKind.WEAPON,
    techLevel: 7,
    size: 5,
    basePrice: 52000,
    mass: 10,
    weaponClass: WeaponClass.FRAGMENT,
    damage: 48,
    range: 330,
    ability: WeaponAbility.BURST,
    cooldownTurns: 1,
    minDay: 600,
  },
  {
    id: "wpn_nova_driver",
    name: "Нова-драйвер",
    kind: GearKind.WEAPON,
    techLevel: 8,
    size: 6,
    basePrice: 98000,
    mass: 14,
    weaponClass: WeaponClass.FRAGMENT,
    damage: 110,
    range: 380,
    ability: WeaponAbility.NONE,
    cooldownTurns: 2,
    rare: true,
    minDay: 840,
  },
  {
    id: "wpn_annihilator",
    name: "Аннигилятор",
    kind: GearKind.WEAPON,
    techLevel: 8,
    size: 7,
    basePrice: 210000,
    mass: 18,
    weaponClass: WeaponClass.ENERGY,
    damage: 180,
    range: 420,
    ability: WeaponAbility.NONE,
    cooldownTurns: 3,
    rare: true,
    minDay: 960,
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
    mass: 6,
    equipmentClass: EquipmentClass.ENGINE,
    potency: 0.9,
  },
  {
    id: "eq_engine_ii",
    name: "Двигатель Тип-II",
    kind: GearKind.EQUIPMENT,
    techLevel: 3,
    size: 3,
    basePrice: 2200,
    mass: 7,
    equipmentClass: EquipmentClass.ENGINE,
    potency: 1.1,
  },
  {
    id: "eq_engine_iib",
    name: "Двигатель Тип-II (форсированный)",
    kind: GearKind.EQUIPMENT,
    techLevel: 4,
    size: 3,
    basePrice: 4200,
    mass: 8,
    equipmentClass: EquipmentClass.ENGINE,
    potency: 1.25,
  },
  {
    id: "eq_engine_iii",
    name: "Двигатель Тип-III",
    kind: GearKind.EQUIPMENT,
    techLevel: 5,
    size: 3,
    basePrice: 6500,
    mass: 8,
    equipmentClass: EquipmentClass.ENGINE,
    potency: 1.4,
  },
  {
    id: "eq_engine_v",
    name: "Двигатель Тип-V",
    kind: GearKind.EQUIPMENT,
    techLevel: 7,
    size: 3,
    basePrice: 13500,
    mass: 10,
    equipmentClass: EquipmentClass.ENGINE,
    potency: 1.8,
    rare: true,
    minDay: APEX_ENGINE_MIN_DAY,
  },
  {
    id: "eq_engine_light",
    name: "Двигатель Тип-L (облегчённый)",
    kind: GearKind.EQUIPMENT,
    techLevel: 2,
    size: 2,
    basePrice: 650,
    mass: 3,
    equipmentClass: EquipmentClass.ENGINE,
    potency: 0.8,
  },
  {
    id: "eq_engine_iv",
    name: "Двигатель Тип-IV (форсированный)",
    kind: GearKind.EQUIPMENT,
    techLevel: 6,
    size: 4,
    basePrice: 8800,
    mass: 13,
    equipmentClass: EquipmentClass.ENGINE,
    potency: 1.6,
  },
  {
    id: "eq_tank",
    name: "Топливный бак",
    kind: GearKind.EQUIPMENT,
    techLevel: 1,
    size: 2,
    basePrice: 500,
    mass: 3,
    equipmentClass: EquipmentClass.FUEL_TANK,
    potency: 40,
  },
  {
    id: "eq_tank_ii",
    name: "Топливный бак Тип-II",
    kind: GearKind.EQUIPMENT,
    techLevel: 3,
    size: 3,
    basePrice: 2200,
    mass: 5,
    equipmentClass: EquipmentClass.FUEL_TANK,
    potency: 90,
  },
  {
    id: "eq_tank_iii",
    name: "Топливный танк Тип-III",
    kind: GearKind.EQUIPMENT,
    techLevel: 6,
    size: 5,
    basePrice: 6200,
    mass: 10,
    equipmentClass: EquipmentClass.FUEL_TANK,
    potency: 220,
  },
  {
    id: "eq_radar",
    name: "Радар дальнего поля",
    kind: GearKind.EQUIPMENT,
    techLevel: 4,
    size: 2,
    basePrice: 2800,
    mass: 4,
    equipmentClass: EquipmentClass.RADAR,
    potency: 1400,
  },
  {
    id: "eq_radar_near",
    name: "Радар ближнего радиуса",
    kind: GearKind.EQUIPMENT,
    techLevel: 2,
    size: 2,
    basePrice: 1300,
    mass: 2,
    equipmentClass: EquipmentClass.RADAR,
    potency: 900,
  },
  {
    id: "eq_radar_far",
    name: "Радар дальнего охвата",
    kind: GearKind.EQUIPMENT,
    techLevel: 6,
    size: 3,
    basePrice: 7600,
    mass: 6,
    equipmentClass: EquipmentClass.RADAR,
    potency: 2200,
  },
  {
    id: "eq_scanner",
    name: "Сканер целей",
    kind: GearKind.EQUIPMENT,
    techLevel: 4,
    size: 2,
    basePrice: 2600,
    mass: 3,
    equipmentClass: EquipmentClass.SCANNER,
    potency: 6,
  },
  {
    id: "eq_scanner_near",
    name: "Сканер ближней дистанции",
    kind: GearKind.EQUIPMENT,
    techLevel: 2,
    size: 2,
    basePrice: 1100,
    mass: 2,
    equipmentClass: EquipmentClass.SCANNER,
    potency: 3,
  },
  {
    id: "eq_scanner_deep",
    name: "Глубинный сканер",
    kind: GearKind.EQUIPMENT,
    techLevel: 6,
    size: 4,
    basePrice: 6800,
    mass: 6,
    equipmentClass: EquipmentClass.SCANNER,
    potency: 10,
  },
  {
    id: "eq_droid",
    name: "Ремонтный дроид",
    kind: GearKind.EQUIPMENT,
    techLevel: 5,
    size: 3,
    basePrice: 6000,
    mass: 5,
    equipmentClass: EquipmentClass.REPAIR_DROID,
    potency: 3,
  },
  {
    id: "eq_droid_basic",
    name: "Ремонтный набор",
    kind: GearKind.EQUIPMENT,
    techLevel: 2,
    size: 2,
    basePrice: 1300,
    mass: 3,
    equipmentClass: EquipmentClass.REPAIR_DROID,
    potency: 1.5,
  },
  {
    id: "eq_droid_nano",
    name: "Нанодроид-регенератор",
    kind: GearKind.EQUIPMENT,
    techLevel: 7,
    size: 5,
    basePrice: 12500,
    mass: 9,
    equipmentClass: EquipmentClass.REPAIR_DROID,
    potency: 6,
  },
  {
    id: "eq_shield",
    name: "Генератор поля",
    kind: GearKind.EQUIPMENT,
    techLevel: 6,
    size: 4,
    basePrice: 7800,
    mass: 8,
    equipmentClass: EquipmentClass.SHIELD,
    potency: 80,
  },
  {
    id: "eq_shield_light",
    name: "Лёгкий дефлектор",
    kind: GearKind.EQUIPMENT,
    techLevel: 3,
    size: 3,
    basePrice: 2600,
    mass: 4,
    equipmentClass: EquipmentClass.SHIELD,
    potency: 35,
  },
  {
    id: "eq_shield_ii",
    name: "Дефлектор Тип-II",
    kind: GearKind.EQUIPMENT,
    techLevel: 4,
    size: 3,
    basePrice: 4200,
    mass: 6,
    equipmentClass: EquipmentClass.SHIELD,
    potency: 50,
  },
  {
    id: "eq_shield_iii",
    name: "Дефлектор Тип-III",
    kind: GearKind.EQUIPMENT,
    techLevel: 5,
    size: 4,
    basePrice: 6800,
    mass: 7,
    equipmentClass: EquipmentClass.SHIELD,
    potency: 65,
  },
  {
    id: "eq_shield_v",
    name: "Генератор поля Тип-V",
    kind: GearKind.EQUIPMENT,
    techLevel: 7,
    size: 5,
    basePrice: 12000,
    mass: 11,
    equipmentClass: EquipmentClass.SHIELD,
    potency: 110,
  },
  {
    id: "eq_shield_apex",
    name: "Абсолютный барьер",
    kind: GearKind.EQUIPMENT,
    techLevel: 8,
    size: 6,
    basePrice: 13800,
    mass: 14,
    equipmentClass: EquipmentClass.SHIELD,
    potency: 150,
  },
  {
    id: "eq_grapple_i",
    name: "Абордажный крюк Тип-I",
    kind: GearKind.EQUIPMENT,
    techLevel: 1,
    size: 2,
    basePrice: 700,
    mass: 3,
    equipmentClass: EquipmentClass.GRAPPLE,
    potency: 40,
  },
  {
    id: "eq_grapple_ii",
    name: "Абордажный захват Тип-II",
    kind: GearKind.EQUIPMENT,
    techLevel: 3,
    size: 3,
    basePrice: 2600,
    mass: 5,
    equipmentClass: EquipmentClass.GRAPPLE,
    potency: 90,
  },
  {
    id: "eq_grapple_iii",
    name: "Абордажный гарпун Тип-III",
    kind: GearKind.EQUIPMENT,
    techLevel: 5,
    size: 4,
    basePrice: 7200,
    mass: 8,
    equipmentClass: EquipmentClass.GRAPPLE,
    potency: 180,
  },
  {
    id: "grav_tractor_1",
    name: "Гравитяга Тип-I",
    kind: GearKind.EQUIPMENT,
    techLevel: 3,
    size: 2,
    basePrice: 2000,
    mass: 3,
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
    mass: 4,
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
    mass: 6,
    equipmentClass: EquipmentClass.GRAV_TRACTOR,
    potency: 250,
    rare: true, // apex grav-tractor — rare, high-end stock only
  },
  {
    id: "eq_engine_vi",
    name: "Двигатель Тип-VI (курьерский)",
    kind: GearKind.EQUIPMENT,
    techLevel: 8,
    size: 4,
    basePrice: 95000,
    mass: 12,
    equipmentClass: EquipmentClass.ENGINE,
    potency: 2.2,
    rare: true,
    minDay: 840,
  },
  {
    id: "eq_shield_fortress",
    name: "Крепостной барьер",
    kind: GearKind.EQUIPMENT,
    techLevel: 8,
    size: 6,
    basePrice: 88000,
    mass: 15,
    equipmentClass: EquipmentClass.SHIELD,
    potency: 300,
    rare: true,
    minDay: 810,
  },
  {
    id: "eq_droid_swarm",
    name: "Рой ремонтных дронов",
    kind: GearKind.EQUIPMENT,
    techLevel: 8,
    size: 5,
    basePrice: 120000,
    mass: 10,
    equipmentClass: EquipmentClass.REPAIR_DROID,
    potency: 12,
    rare: true,
    minDay: 900,
  },
];

export const GEAR_CATALOG: readonly Gear[] = [
  ...HULLS,
  ...WEAPONS,
  ...EQUIPMENT,
];

export const MICRO_MODULES: readonly MicroModule[] = [
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

export const HULL_MICRO_MODULES: readonly MicroModule[] = [
  {
    id: "mm_hull_armor_1",
    name: "Броневой набор ур.1",
    targetCategory: ModuleCategory.HULL,
    bonusType: "defense",
    bonusTier: 1,
  },
  {
    id: "mm_hull_armor_2",
    name: "Броневой набор ур.2",
    targetCategory: ModuleCategory.HULL,
    bonusType: "defense",
    bonusTier: 2,
  },
  {
    id: "mm_hull_armor_3",
    name: "Броневой набор ур.3",
    targetCategory: ModuleCategory.HULL,
    bonusType: "defense",
    bonusTier: 3,
  },
  {
    id: "mm_hull_hold_1",
    name: "Расширитель трюма ур.1",
    targetCategory: ModuleCategory.HULL,
    bonusType: "cargo",
    bonusTier: 1,
  },
  {
    id: "mm_hull_hold_2",
    name: "Расширитель трюма ур.2",
    targetCategory: ModuleCategory.HULL,
    bonusType: "cargo",
    bonusTier: 2,
  },
  {
    id: "mm_hull_hold_3",
    name: "Расширитель трюма ур.3",
    targetCategory: ModuleCategory.HULL,
    bonusType: "cargo",
    bonusTier: 3,
  },
  {
    id: "mm_hull_pwr_wpn_1",
    name: "Перенаправление энергии: орудия ур.1",
    targetCategory: ModuleCategory.HULL,
    bonusType: "energyWeapon",
    bonusTier: 1,
  },
  {
    id: "mm_hull_pwr_wpn_2",
    name: "Перенаправление энергии: орудия ур.2",
    targetCategory: ModuleCategory.HULL,
    bonusType: "energyWeapon",
    bonusTier: 2,
  },
  {
    id: "mm_hull_pwr_eng_1",
    name: "Перенаправление энергии: двигатель ур.1",
    targetCategory: ModuleCategory.HULL,
    bonusType: "energyEngine",
    bonusTier: 1,
  },
  {
    id: "mm_hull_pwr_eng_2",
    name: "Перенаправление энергии: двигатель ур.2",
    targetCategory: ModuleCategory.HULL,
    bonusType: "energyEngine",
    bonusTier: 2,
  },
];

export function hullMicroModuleById(id: string): MicroModule | undefined {
  return HULL_MICRO_MODULES.find((m) => m.id === id);
}

export type HullMicromoduleEffectKind =
  | "defense"
  | "cargo"
  | "weapon"
  | "engine";

export function hullMicromoduleEffectKind(
  id: string,
): HullMicromoduleEffectKind {
  const mm = hullMicroModuleById(id);
  switch (mm?.bonusType) {
    case "cargo":
      return "cargo";
    case "energyWeapon":
      return "weapon";
    case "energyEngine":
      return "engine";
    default:
      return "defense";
  }
}

export function gearById(id: string): Gear | undefined {
  return GEAR_CATALOG.find((g) => g.id === id);
}

let GEAR_ID_BY_NAME: Map<string, string> | undefined;

const LOADOUT_NAME_ALIASES: Record<string, string> = {
  "Двигатель ур.1": "eq_engine_i",
  "Двигатель ур.2": "eq_engine_iii",
  "Двигатель ур.3": "eq_engine_v",
  "Импульсная пушка": "wpn_pulse",
  "Балистическая пушка": "wpn_scatter",
  "Плазменная пушка": "wpn_beam",
  Радар: "eq_radar",
};

export function gearIdForToken(token: string): string | undefined {
  if (!token) return undefined;
  if (gearById(token)) return token; // already a catalog id
  if (!GEAR_ID_BY_NAME) {
    GEAR_ID_BY_NAME = new Map();
    for (const g of GEAR_CATALOG) {
      if (!GEAR_ID_BY_NAME.has(g.name)) GEAR_ID_BY_NAME.set(g.name, g.id);
    }
  }
  return GEAR_ID_BY_NAME.get(token) ?? LOADOUT_NAME_ALIASES[token];
}

export function isRareGear(gear: Gear): boolean {
  return gear.rare === true || gear.techLevel >= RARE_TECH_THRESHOLD;
}

export const ARTIFACT_UPGRADE_COSTS = [2, 3] as const;

export function artifactUpgradeCost(currentUpgrades: number): number {
  if (currentUpgrades >= 2) return Infinity;
  return ARTIFACT_UPGRADE_COSTS[currentUpgrades];
}

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

export function gearMarketPrice(gear: Gear, priceFactor = 1): number {
  const techMult = 1 + (gear.techLevel - 1) * 0.06; // higher tech → pricier
  const sizeMult = 1 + Math.max(0, 6 - gear.size) * 0.04; // smaller → pricier
  return Math.round(gear.basePrice * techMult * sizeMult * priceFactor);
}
