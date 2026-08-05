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

vi.mock("pixi.js", async () =>
  (await import("../playtest/pixiStub")).makePixiStub(),
);

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
    const starter = ENGINES.reduce((b, e) =>
      e.techLevel < b.techLevel ? e : b,
    );
    expect(cruiseSpeedWith(starter.id)).toBeLessThan(GAME_BALANCE.npcSpeed);
  });
});

describe("rewards are bounded — not guaranteed-profit printers", () => {
  it("the local-delivery margin is tight against the worst-case market buy", () => {
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
