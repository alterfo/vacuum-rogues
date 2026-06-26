import { describe, it, expect, vi } from "vitest";
import {
  GEAR_CATALOG,
  GearKind,
  EquipmentClass,
  type WeaponSpec,
  type EquipmentSpec,
} from "@/systems/equipment/GearCatalog";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import { weaponFireIntervalMs } from "@/presentation/flight/CombatModule";
import {
  GAME_BALANCE,
  LOCAL_DELIVERY_REWARD_MARGIN,
  ARTIFACT_DROP_CHANCE,
  ARTIFACT_DROP_COUNT_MIN,
  ARTIFACT_DROP_COUNT_MAX,
  RESOURCE_BASE_PRICES,
} from "@/config/balance";

// The cadence function lives in CombatModule, which transitively pulls PixiJS
// value-imports (CombatHud / DamageNumbers); stub PixiJS so this pure-data oracle
// boots headlessly. We only call the pure `weaponFireIntervalMs`.
vi.mock("pixi.js", async () =>
  (await import("../playtest/pixiStub")).makePixiStub(),
);

/**
 * Task 4 — the letsplay oracle's **balance-oddity** invariants (memory
 * `feedback-letsplay-oddity-hunting`): the oracle must catch balance/logic
 * *cringe*, not just crashes. These assert *relationships* (no strictly-dominated
 * gear, no dead stat, a reachable escape, bounded rewards) rather than exact
 * magnitudes, so deliberate tuning doesn't churn them — only an actual inversion
 * (a pricier item that's never worth buying, a knob that does nothing, an
 * impossible escape, a guaranteed-profit printer) reds the gate.
 *
 * Sister file `src/tests/balance/gearCurve.test.ts` locks the same no-dominance
 * idea on hulls from the curve angle; this is the oracle's own restatement plus
 * the dead-stat / escape-range / reward-bound invariants that live nowhere else.
 */

const WEAPONS = GEAR_CATALOG.filter(
  (g): g is WeaponSpec => g.kind === GearKind.WEAPON,
);
const EQUIPMENT = GEAR_CATALOG.filter(
  (g): g is EquipmentSpec => g.kind === GearKind.EQUIPMENT,
);
const ENGINES = EQUIPMENT.filter(
  (e) => e.equipmentClass === EquipmentClass.ENGINE,
);

describe("no gear is strictly dominated by a cheaper one (price-vs-value)", () => {
  it("no weapon is dominated by a cheaper weapon of the same operating profile", () => {
    // Same ability ⇒ same operating profile; a unique ability (EMP/homing/burst)
    // is its own value and never "dominated" by a plain weapon.
    function dominates(a: WeaponSpec, b: WeaponSpec): boolean {
      if (a.id === b.id || a.basePrice > b.basePrice || a.ability !== b.ability)
        return false;
      if (a.damage < b.damage || a.range < b.range) return false;
      if (a.cooldownTurns > b.cooldownTurns) return false; // a fires no slower
      return (
        a.damage > b.damage ||
        a.range > b.range ||
        a.cooldownTurns < b.cooldownTurns
      );
    }
    // Guard against a vacuous pass: if a catalog/enum refactor ever emptied the
    // filter the loop body would never run and the oracle would silently stop
    // checking. (Mirrors the asset test's PRODUCTION_PREFIXES length guard.)
    expect(WEAPONS.length).toBeGreaterThan(1);
    for (const b of WEAPONS) {
      const dom = WEAPONS.find((a) => dominates(a, b));
      expect(
        dom,
        dom ? `${b.id} is strictly dominated by cheaper ${dom.id}` : "",
      ).toBeUndefined();
    }
  });

  it("no equipment is dominated by a cheaper item of the same family", () => {
    // Within one EquipmentClass `potency` is the single comparable value (speed,
    // radar range, repair/s, …). A pricier item must out-potency a cheaper one.
    function dominates(a: EquipmentSpec, b: EquipmentSpec): boolean {
      return (
        a.id !== b.id &&
        a.equipmentClass === b.equipmentClass &&
        a.basePrice <= b.basePrice &&
        a.potency > b.potency
      );
    }
    expect(EQUIPMENT.length).toBeGreaterThan(1); // never a vacuous pass (see above)
    for (const b of EQUIPMENT) {
      const dom = EQUIPMENT.find((a) => dominates(a, b));
      expect(
        dom,
        dom
          ? `${b.id} (${b.basePrice}cr, potency ${b.potency}) is dominated by cheaper ${dom.id} (${dom.basePrice}cr, potency ${dom.potency})`
          : "",
      ).toBeUndefined();
    }
  });
});

describe("no dead stat — cooldownTurns drives fire cadence", () => {
  it("the cadence function is strictly monotonic in cooldownTurns", () => {
    // If cooldownTurns were a dead stat, a slow weapon would fire just as often
    // as a quick one — the high-`damage` beam would be a free upgrade.
    expect(weaponFireIntervalMs({ cooldownTurns: 1 })).toBeLessThan(
      weaponFireIntervalMs({ cooldownTurns: 2 }),
    );
    expect(weaponFireIntervalMs({ cooldownTurns: 2 })).toBeLessThan(
      weaponFireIntervalMs({ cooldownTurns: 3 }),
    );
  });

  it("the catalog actually uses distinct cooldowns, and they yield distinct cadences", () => {
    const cooldowns = new Set(WEAPONS.map((w) => w.cooldownTurns));
    expect(cooldowns.size).toBeGreaterThan(1); // not every weapon fires alike
    const intervals = new Set(WEAPONS.map((w) => weaponFireIntervalMs(w)));
    expect(intervals.size).toBe(cooldowns.size); // each distinct cooldown → its own cadence
  });

  it("a malformed cooldownTurns can't make a weapon fire every frame", () => {
    expect(weaponFireIntervalMs({ cooldownTurns: 0 })).toBe(
      GAME_BALANCE.combatFireIntervalMs,
    );
  });
});

describe("the player can outrun a basic NPC — a reachable escape exists", () => {
  /** Cruise speed (px/ms) the real loadout derives from installing `engineId`. */
  function cruiseSpeedWith(engineId: string): number {
    const loadout = new ShipLoadout("hull_bastion");
    expect(loadout.install(engineId)).toBe(true);
    return loadout.derivedStats().speed;
  }

  it("the best reachable engine matches or beats the basic NPC cruise speed", () => {
    const best = ENGINES.reduce((b, e) => (e.techLevel > b.techLevel ? e : b));
    const playerSpeed = cruiseSpeedWith(best.id);
    expect(playerSpeed).toBeGreaterThanOrEqual(GAME_BALANCE.npcSpeed);
  });

  it("escape stays upgrade-gated — the starter engine is slower than the NPC", () => {
    // A genuine reward for the climb: you can't simply out-cruise pursuers on the
    // tier-1 engine (the «basic NPC» tier is the slowest one, GAME_BALANCE.npcSpeed).
    const starter = ENGINES.reduce((b, e) =>
      e.techLevel < b.techLevel ? e : b,
    );
    expect(cruiseSpeedWith(starter.id)).toBeLessThan(GAME_BALANCE.npcSpeed);
  });
});

describe("rewards are bounded — not guaranteed-profit printers", () => {
  it("the local-delivery margin is tight against the worst-case market buy", () => {
    // A delivery contract makes the player BUY first; worst-case purchase cost is
    // base × 3.0 (market ceiling). The reward must clear that (never a hidden
    // loss) but carry no fat structural surplus (≤10% headroom) — so it can't be
    // farmed for free credits.
    const WORST_CASE_BUY_MARKUP = 3.0;
    expect(LOCAL_DELIVERY_REWARD_MARGIN).toBeGreaterThan(WORST_CASE_BUY_MARKUP);
    expect(LOCAL_DELIVERY_REWARD_MARGIN).toBeLessThanOrEqual(
      WORST_CASE_BUY_MARKUP * 1.1,
    );
  });

  it("the expected artifact payout per kill is a modest reward, not a fountain", () => {
    const avgCount = (ARTIFACT_DROP_COUNT_MIN + ARTIFACT_DROP_COUNT_MAX) / 2;
    const expectedValue =
      ARTIFACT_DROP_CHANCE * avgCount * RESOURCE_BASE_PRICES.ARTIFACTS;
    expect(expectedValue).toBeGreaterThan(0); // still a real reward
    expect(expectedValue).toBeLessThanOrEqual(600); // but bounded
  });
});
