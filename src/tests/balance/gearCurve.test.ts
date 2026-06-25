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

// ---------------------------------------------------------------------------
// Task 4 — oddity sweep: remove gear-curve dominance inversions and tame the
// money-printers. Assert the *relationships* (no strictly-dominated pricier
// item, the cheapest hull is no longer the most cost-efficient, the courier is
// no longer cheaper-and-roomier than the corvette, delivery profit is tight
// against the worst-case market buy, combat reward is bounded) rather than exact
// magnitudes, so later tuning doesn't churn these tests.
// ---------------------------------------------------------------------------

const HULLS = GEAR_CATALOG.filter(
  (g): g is HullSpec => g.kind === GearKind.HULL,
);
const WEAPONS = GEAR_CATALOG.filter(
  (g): g is WeaponSpec => g.kind === GearKind.WEAPON,
);

/**
 * A hull `b` is *strictly dominated* by a cheaper-or-equal hull `a` when `a`
 * costs no more **and** is at least as good on every capacity stat **and**
 * strictly better on at least one — i.e. you would never rationally buy `b`.
 * A genuine role trade-off (more cargo for less HP) is NOT domination.
 */
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

/**
 * A weapon `b` is dominated by a cheaper-or-equal weapon `a` of the **same
 * operating profile** (same ability) when `a` is at least as good on damage and
 * range and fires at least as fast (≤ cooldown), strictly better somewhere. A
 * unique special ability (EMP, homing, burst) makes a weapon non-dominated even
 * if a cheaper plain weapon out-damages it.
 */
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
    // The cheapest hull's HP/cr is strictly worse than the best, so spending up
    // (scout → corvette) is a genuine value upgrade, not a downgrade.
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
    // It stays a real hauler (more cargo than the combat corvette) — the fix is
    // the price, not gutting its role.
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

describe("money-printers tamed (Task 4)", () => {
  it("local-delivery margin is tight against the worst-case market buy", () => {
    // A "Местный подряд" makes the player BUY the cargo first; the worst-case
    // purchase cost is base × 3.0 (market ceiling × best faction multiplier 1.0).
    // The reward must stay above that — a contract should never be a hidden loss
    // (locked by localDeliveryProfit.test.ts) — but no longer carry a fat
    // structural surplus, so delivery stops being a printer.
    const WORST_CASE_BUY_MARKUP = 3.0;
    expect(LOCAL_DELIVERY_REWARD_MARGIN).toBeGreaterThan(WORST_CASE_BUY_MARKUP);
    // ≤ 10% headroom over the worst case: just-profitable, not a windfall.
    expect(LOCAL_DELIVERY_REWARD_MARGIN).toBeLessThanOrEqual(
      WORST_CASE_BUY_MARKUP * 1.1,
    );
  });

  it("expected artifact payout per Overmind kill is bounded", () => {
    // Artifacts double as a sellable good; the expected credit value of a kill's
    // artifact drop must stay modest so combat is not a money-printer.
    const avgCount = (ARTIFACT_DROP_COUNT_MIN + ARTIFACT_DROP_COUNT_MAX) / 2;
    const expectedValue =
      ARTIFACT_DROP_CHANCE * avgCount * RESOURCE_BASE_PRICES.ARTIFACTS;
    expect(ARTIFACT_DROP_CHANCE).toBeLessThanOrEqual(0.3);
    expect(expectedValue).toBeLessThanOrEqual(600);
    // …but still a real reward (not zeroed out).
    expect(expectedValue).toBeGreaterThan(0);
  });
});
