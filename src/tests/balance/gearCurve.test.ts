import { describe, it, expect } from "vitest";
import {
  GEAR_CATALOG,
  GearKind,
  gearById,
  type HullSpec,
  type WeaponSpec,
} from "@/systems/equipment/GearCatalog";
import {
  LOCAL_DELIVERY_REWARD_MARGIN,
  ARTIFACT_DROP_CHANCE,
  ARTIFACT_DROP_COUNT_MIN,
  ARTIFACT_DROP_COUNT_MAX,
  RESOURCE_BASE_PRICES,
} from "@/config/balance";
import { HULL_TRADE_IN_RATE } from "@/systems/equipment/sellHull";
import {
  BATTLE_READY_MAX_HULL,
  MILITARY_SPEND_TRADE_RESERVE,
} from "../playtest/letsplay/MemoryHeuristicPolicy";

const HULLS = GEAR_CATALOG.filter(
  (g): g is HullSpec => g.kind === GearKind.HULL,
);
const WEAPONS = GEAR_CATALOG.filter(
  (g): g is WeaponSpec => g.kind === GearKind.WEAPON,
);

function hullDominates(a: HullSpec, b: HullSpec): boolean {
  if (a.id === b.id) return false;
  if (a.basePrice > b.basePrice) return false;
  const stats: (keyof HullSpec)[] = [
    "hp",
    "cargo",
    "weaponSlots",
    "equipmentSlots",
    "massCapacity",
  ];
  let strictlyBetterSomewhere = false;
  for (const s of stats) {
    const av = a[s] as number;
    const bv = b[s] as number;
    if (av < bv) return false; // a is worse on this axis → no domination
    if (av > bv) strictlyBetterSomewhere = true;
  }
  return strictlyBetterSomewhere;
}

function weaponDominates(a: WeaponSpec, b: WeaponSpec): boolean {
  if (a.id === b.id) return false;
  if (a.basePrice > b.basePrice) return false;
  if (a.ability !== b.ability) return false;
  if (a.damage < b.damage) return false;
  if (a.range < b.range) return false;
  if (a.cooldownTurns > b.cooldownTurns) return false;
  return (
    a.damage > b.damage ||
    a.range > b.range ||
    a.cooldownTurns < b.cooldownTurns
  );
}

describe("gear curve — no dominance inversions (Task 4)", () => {
  it("no hull is strictly dominated by a cheaper-or-equal hull", () => {
    for (const b of HULLS) {
      const dominator = HULLS.find((a) => hullDominates(a, b));
      expect(
        dominator,
        dominator
          ? `${b.id} (${b.basePrice} cr) is strictly dominated by cheaper ${dominator.id} (${dominator.basePrice} cr)`
          : "",
      ).toBeUndefined();
    }
  });

  it("the cheapest hull is no longer the most HP-efficient of the lineup", () => {
    const cheapest = HULLS.reduce((min, h) =>
      h.basePrice < min.basePrice ? h : min,
    );
    const bestEfficiency = HULLS.reduce((best, h) =>
      h.hp / h.basePrice > best.hp / best.basePrice ? h : best,
    );
    expect(bestEfficiency.id).not.toBe(cheapest.id);
    expect(cheapest.hp / cheapest.basePrice).toBeLessThan(
      bestEfficiency.hp / bestEfficiency.basePrice,
    );
  });

  it("the courier is not both cheaper and roomier than the corvette", () => {
    const courier = gearById("hull_courier") as HullSpec;
    const corvette = gearById("hull_corvette") as HullSpec;
    const cheaperAndRoomier =
      courier.basePrice < corvette.basePrice && courier.cargo > corvette.cargo;
    expect(cheaperAndRoomier).toBe(false);
    expect(courier.cargo).toBeGreaterThan(corvette.cargo);
  });

  it("the combat-hull HP ladder rises strictly with price", () => {
    const ladder = [
      "hull_scout",
      "hull_corvette",
      "hull_warden",
      "hull_bastion",
    ]
      .map((id) => gearById(id) as HullSpec)
      .sort((a, b) => a.basePrice - b.basePrice);
    for (let i = 1; i < ladder.length; i++) {
      expect(
        ladder[i].hp,
        `${ladder[i].id} should out-HP the cheaper ${ladder[i - 1].id}`,
      ).toBeGreaterThan(ladder[i - 1].hp);
    }
  });

  it("no weapon is strictly dominated by a cheaper weapon of the same profile", () => {
    for (const b of WEAPONS) {
      const dominator = WEAPONS.find((a) => weaponDominates(a, b));
      expect(
        dominator,
        dominator
          ? `${b.id} is strictly dominated by cheaper ${dominator.id}`
          : "",
      ).toBeUndefined();
    }
  });
});

describe("second-hull-tier affordability wall (2026-07-25 Task 2b)", () => {
  const freighter = gearById("hull_freighter") as HullSpec;
  const corvette = gearById("hull_corvette") as HullSpec;

  it("freighter is priced at the tuned 3900cr", () => {
    expect(freighter.basePrice).toBe(3900);
    expect(freighter.hp).toBe(BATTLE_READY_MAX_HULL);
  });

  it("stays strictly above the corvette so it never dominates it", () => {
    expect(freighter.basePrice).toBeGreaterThan(corvette.basePrice);
  });

  it("keeps the corvette the best HP-per-credit hull in the lineup", () => {
    const bestEfficiency = HULLS.reduce((best, h) =>
      h.hp / h.basePrice > best.hp / best.basePrice ? h : best,
    );
    expect(bestEfficiency.id).toBe("hull_corvette");
  });

  it("lowers the net upgrade wall from the corvette to 3700cr", () => {
    const tradeIn = Math.floor(corvette.basePrice * HULL_TRADE_IN_RATE);
    const wall = freighter.basePrice - tradeIn + MILITARY_SPEND_TRADE_RESERVE;
    expect(wall).toBe(3700);
    expect(wall).toBeLessThan(4300);
  });
});

describe("money-printers tamed (Task 4)", () => {
  it("local-delivery margin is tight against the worst-case market buy", () => {
    const WORST_CASE_BUY_MARKUP = 3.0;
    expect(LOCAL_DELIVERY_REWARD_MARGIN).toBeGreaterThan(WORST_CASE_BUY_MARKUP);
    expect(LOCAL_DELIVERY_REWARD_MARGIN).toBeLessThanOrEqual(
      WORST_CASE_BUY_MARKUP * 1.1,
    );
  });

  it("expected artifact payout per Overmind kill is bounded", () => {
    const avgCount = (ARTIFACT_DROP_COUNT_MIN + ARTIFACT_DROP_COUNT_MAX) / 2;
    const expectedValue =
      ARTIFACT_DROP_CHANCE * avgCount * RESOURCE_BASE_PRICES.ARTIFACTS;
    expect(ARTIFACT_DROP_CHANCE).toBeLessThanOrEqual(0.3);
    expect(expectedValue).toBeLessThanOrEqual(600);
    expect(expectedValue).toBeGreaterThan(0);
  });
});
