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
import { APEX_ENGINE_MIN_DAY, RARE_TECH_THRESHOLD } from "@/config/balance";

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
  /** Boarding grapple: locks onto a disabled hull for capture. `potency` = capture strength. */
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
  /**
   * Mass the item adds to the ship's load (SR-canon МАССА/СВОБОДНО). Installed
   * gear sums against the hull's {@link HullSpec.massCapacity}; a hull's own
   * `mass` is its frame weight and is *not* counted (the hull is the ship, not a
   * slotted item — see {@link ShipLoadout.derivedStats}).
   */
  readonly mass: number;
  readonly upgrades?: number; // 0-2, present only on upgraded copies
  /**
   * Marks the **rare, high-end top tier** (see {@link isRareGear}): the apex
   * hull/engine/weapon a long credit climb earns. Rare gear sits at the ceiling
   * of the endgame price band and is stocked far less often than common gear —
   * only the richest, high-end markets field it ({@link ShopGenerator}). Optional:
   * absent ⇒ common (the implicit default for every mid/low-tech item).
   */
  readonly rare?: boolean;
  /**
   * Earliest in-game day this item may be stocked by any shop
   * ({@link ShopGenerator}) — a calendar gate on top of the tech-level and
   * stock-chance filters. Optional: absent ⇒ available whenever tech allows
   * (the implicit default for every item except the apex engine, which sets
   * `APEX_ENGINE_MIN_DAY` so its 2× cruise speed stays a ~year-3 payoff).
   */
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
  /** Total mass budget (МАССА): Σ installed gear mass must not exceed this. */
  readonly massCapacity: number;
  /**
   * Number of hull micromodule slots (1–4): bounds `ShipLoadout.hullMicromoduleIds`.
   * Bigger hulls carry more. Optional so synthetic test hulls validate; every
   * catalog hull sets it explicitly and `ShipLoadout` falls back to
   * {@link DEFAULT_HULL_MICROMODULE_SLOTS} for any hull that omits it.
   */
  readonly micromoduleSlots?: number;
}

/** Hull micromodule slot count assumed for a hull that omits `micromoduleSlots`. */
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
    mass: 9,
    // Light fighter — fragile by design (oddity sweep, Task 4). The cheapest hull
    // used to be the most HP-efficient of the lineup (90 HP ÷ 1200 = 0.075 HP/cr,
    // beating every pricier hull) — a value inversion that punished spending up.
    // Trimmed so the workhorse «Корвет» (140 ÷ 3000 ≈ 0.047) is now the best
    // HP-per-credit and the scout is a genuinely weaker budget stepping-stone.
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
    // Priced level with the «Корвет» (oddity sweep, Task 4): the courier used to
    // be *cheaper* (2500 < 3000) **and** roomier (cargo 45 > 30) than the corvette
    // — a strict price+cargo advantage. At an equal 3000 it is now a genuine role
    // *choice* against the corvette, not a dominant pick: more cargo + equipment
    // slots (the hauler) traded against the corvette's HP + second weapon slot
    // (the fighter). (Both stay in the locked tech-3/4 price band 2000–5000 and the
    // mid-hull median stays 3000, so the apex «Бастион» 12000 holds its ≥4× gap.)
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
    basePrice: 4500,
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
    // The apex hull: ≥4× the mid-tier «Корвет» (3000) and the steepest step in
    // the curve. Rare — only the wealthiest field it (see `isRareGear`).
    rare: true,
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
    // Apex engine: the rare, very-expensive top tier. Its tech-7 cruise speed
    // (0.066 + 7×0.022 = 0.22 px/ms, exactly 2× the starter's 0.11) still
    // out-runs the interceptor tier (`npcSpeed` 0.2), though the margin is now
    // thin (10%) — flagged for a balance follow-up if escapes feel too slow.
    // Priced at the ceiling of the tech-7/8 band (≤ 14000), stocked only by
    // high-end markets, and calendar-gated (`minDay`) to a ~year-3 payoff.
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
    // Light budget engine (Task 2 gear-variety wave): same tech tier as
    // eq_engine_i (identical derived speed — engine speed is tech-driven, not
    // potency-driven), but far cheaper and half the mass. A genuine tradeoff
    // on the mass-budget axis for tight scout/corvette fits, not a stat clone.
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
    // A second, un-gated rare tier below the calendar-locked apex — a rare
    // T7 alternative players can field well before APEX_ENGINE_MIN_DAY, at a
    // heavier-mass/cheaper-than-apex tradeoff.
    id: "eq_engine_iv",
    name: "Двигатель Тип-IV (форсированный)",
    kind: GearKind.EQUIPMENT,
    techLevel: 7,
    size: 4,
    basePrice: 10800,
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
    // Heavy long-haul tank: much more fuel, but the mass cost is steep — a
    // real tradeoff against the light hulls' tight mass budgets.
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
  // Boarding grapples (Task 2 gear-variety wave): the missing GRAPPLE family —
  // potency encodes capture strength/range for a future boarding consumer.
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

/**
 * Hull micromodules (install/micromodule overhaul Task 4): a distinct family fitted
 * into a hull's own micromodule slots (`HullSpec.micromoduleSlots`), not onto a piece
 * of gear. Kept **separate** from {@link MICRO_MODULES} (the 4-category gear modules)
 * so each catalog stays single-purpose. The {@link MicroModule.bonusType} picks the
 * effect; {@link ShipLoadout.derivedStats} turns it into a global multiplier:
 * - `defense`      → maxHull (boost defense)
 * - `cargo`        → hold capacity (boost cargo)
 * - `energyWeapon` → total weapon damage (redirect energy to weapons)
 * - `energyEngine` → engine speed (redirect energy to the engine — "engine-targeted")
 *
 * The magnitude is the same tiered bonus as any micromodule (tier 1 strongest), so a
 * hull module reuses `micromoduleBonus(bonusTier)` in the loadout. Sold at CRAFT_CENTER
 * stations alongside {@link MICRO_MODULES}.
 */
export const HULL_MICRO_MODULES: readonly MicroModule[] = [
  // DEFENSE — boosts derived maxHull
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
  // CARGO — boosts hold capacity
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
  // ENERGY → WEAPON — redirect reactor output to weapon damage
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
  // ENERGY → ENGINE — redirect reactor output to engine speed (engine-targeted)
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

/** Lookup a hull micromodule by id (the {@link HULL_MICRO_MODULES} family). */
export function hullMicroModuleById(id: string): MicroModule | undefined {
  return HULL_MICRO_MODULES.find((m) => m.id === id);
}

/** Which derived ship stat a hull micromodule's multiplier lands on. */
export type HullMicromoduleEffectKind =
  | "defense"
  | "cargo"
  | "weapon"
  | "engine";

/**
 * Classify a hull-slot micromodule by the derived stat it boosts. A non-hull or
 * unknown id fitted in a hull slot falls back to `"defense"` (maxHull) — the
 * pre-Task-4 behaviour, where *any* micromodule on the hull simply scaled its HP —
 * so legacy saves and generic amplifiers keep working unchanged.
 */
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

/** Lookup by id. */
export function gearById(id: string): Gear | undefined {
  return GEAR_CATALOG.find((g) => g.id === id);
}

/** Lazily-built display-name → gear-id index (first id wins on a collision). */
let GEAR_ID_BY_NAME: Map<string, string> | undefined;

/**
 * Aliases for the **legacy NPC `loadoutSummary` display strings** (`ROLE_LOADOUT`
 * in `NpcSimulator`) that don't match a catalog gear name verbatim. These are the
 * human-readable labels shown by the contact scan — kept stable for the scan UI —
 * so combat loot drops carrying them still resolve to the right catalog gear
 * instead of falling through to metal salvage. Engine tiers map ур.1/2/3 →
 * Тип-I/III/V (the only three engine tiers). Keep every `ROLE_LOADOUT` token
 * resolvable (guarded by `lootTokenResolution.test.ts`).
 */
const LOADOUT_NAME_ALIASES: Record<string, string> = {
  "Двигатель ур.1": "eq_engine_i",
  "Двигатель ур.2": "eq_engine_iii",
  "Двигатель ур.3": "eq_engine_v",
  "Импульсная пушка": "wpn_pulse",
  "Балистическая пушка": "wpn_scatter",
  // OVERMIND hive craft scan label — resolves to the energy beam emitter.
  "Плазменная пушка": "wpn_beam",
  Радар: "eq_radar",
};

/**
 * Resolve a loot/drop token to a catalog gear id, or `undefined` when it is not
 * recognisable gear (e.g. the junk-salvage fallbacks `salvaged_plating` /
 * `spare_capacitor` / `scrap_thruster` in `DEFAULT_LOOT_MODULES`, intentionally
 * non-gear so they salvage to metal).
 *
 * Accepts a catalog gear **id** (a real drop like `eq_tank` / `grav_tractor_1`),
 * a gear **display name** (NPC `loadoutSummary` entries are human-readable names
 * like «Топливный бак»), or a legacy `ROLE_LOADOUT` label that diverges from the
 * catalog name ({@link LOADOUT_NAME_ALIASES}, e.g. «Импульсная пушка» → the
 * pulse laser). This lets combat loot land the actual gear in the player's
 * inventory instead of being salvaged to metal.
 */
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

/**
 * Whether a piece of gear is the **rare, high-end top tier** — the apex
 * hull/engine/weapon a long credit climb earns. True when the item carries the
 * explicit `rare: true` flag *or* sits at/above {@link RARE_TECH_THRESHOLD}, so a
 * new high-tech item is rare by default without needing the flag. Rare gear is
 * stocked far less often ({@link ShopGenerator}) — only the wealthiest markets
 * field it — which is how "homogeneous-but-expensive" tech keeps the top tier
 * scarce instead of randomly outclassing the player.
 */
export function isRareGear(gear: Gear): boolean {
  return gear.rare === true || gear.techLevel >= RARE_TECH_THRESHOLD;
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
