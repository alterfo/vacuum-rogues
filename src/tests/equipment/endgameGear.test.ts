import { describe, it, expect } from "vitest";
import {
  GEAR_CATALOG,
  GearKind,
  type HullSpec,
  type WeaponSpec,
  type EquipmentSpec,
} from "@/systems/equipment/GearCatalog";
import { generateShop } from "@/systems/equipment/ShopGenerator";

const ENDGAME_IDS = [
  "hull_dreadnought",
  "hull_liberator",
  "wpn_lance_array",
  "wpn_aft_shredder",
  "wpn_nova_driver",
  "wpn_annihilator",
  "eq_engine_vi",
  "eq_shield_fortress",
  "eq_droid_swarm",
];

function byId(id: string) {
  const gear = GEAR_CATALOG.find((g) => g.id === id);
  expect(gear, id).toBeDefined();
  return gear!;
}

describe("endgame gear band — gradual tiered progression", () => {
  it("every endgame item exists and is day-gated", () => {
    for (const id of ENDGAME_IDS) {
      const gear = byId(id);
      expect(gear.minDay ?? 0, id).toBeGreaterThanOrEqual(420);
    }
  });

  it("endgame prices dwarf the early catalog (progression, not sidegrade)", () => {
    for (const id of ENDGAME_IDS) {
      expect(byId(id).basePrice, id).toBeGreaterThanOrEqual(36000);
    }
    expect(byId("hull_liberator").basePrice).toBeGreaterThanOrEqual(200000);
    expect(byId("wpn_annihilator").basePrice).toBeGreaterThanOrEqual(200000);
  });

  it("stats grow strictly beyond the pre-endgame apex", () => {
    const hulls = GEAR_CATALOG.filter(
      (g): g is HullSpec => g.kind === GearKind.HULL,
    );
    const oldTopHp = Math.max(
      ...hulls.filter((h) => !ENDGAME_IDS.includes(h.id)).map((h) => h.hp),
    );
    expect((byId("hull_dreadnought") as HullSpec).hp).toBeGreaterThan(oldTopHp);
    expect((byId("hull_liberator") as HullSpec).hp).toBeGreaterThan(
      (byId("hull_dreadnought") as HullSpec).hp,
    );

    const weapons = GEAR_CATALOG.filter(
      (g): g is WeaponSpec => g.kind === GearKind.WEAPON,
    );
    const oldTopDmg = Math.max(
      ...weapons
        .filter((w) => !ENDGAME_IDS.includes(w.id))
        .map((w) => w.damage),
    );
    expect((byId("wpn_nova_driver") as WeaponSpec).damage).toBeGreaterThan(
      oldTopDmg,
    );
    expect((byId("wpn_annihilator") as WeaponSpec).damage).toBeGreaterThan(
      (byId("wpn_nova_driver") as WeaponSpec).damage,
    );

    const engines = GEAR_CATALOG.filter(
      (g): g is EquipmentSpec =>
        g.kind === GearKind.EQUIPMENT &&
        (g as EquipmentSpec).equipmentClass === "ENGINE",
    );
    const oldTopEngine = Math.max(
      ...engines
        .filter((e) => !ENDGAME_IDS.includes(e.id))
        .map((e) => e.potency),
    );
    expect((byId("eq_engine_vi") as EquipmentSpec).potency).toBeGreaterThan(
      oldTopEngine,
    );
  });

  it("the pursuit-escape engine outruns Overmind/pirate interceptors", () => {
    const engine = byId("eq_engine_vi") as EquipmentSpec;
    expect(0.1 * engine.potency).toBeGreaterThan(0.2);
  });

  it("a shop never stocks endgame gear before its minDay", () => {
    for (let s = 0; s < 40; s++) {
      const listings = generateShop({
        systemId: "sys",
        planetId: `p${s}`,
        seed: `seed${s}`,
        day: 300,
        maxTechLevel: 8,
      });
      for (const l of listings) {
        expect(ENDGAME_IDS.includes(l.gear.id)).toBe(false);
      }
    }
  });

  it("a late-campaign high-tech shop does stock the endgame band", () => {
    const found = new Set<string>();
    for (let s = 0; s < 120; s++) {
      const listings = generateShop({
        systemId: "sys",
        planetId: `p${s}`,
        seed: `seed${s}`,
        day: 960,
        maxTechLevel: 8,
      });
      for (const l of listings) {
        if (ENDGAME_IDS.includes(l.gear.id)) found.add(l.gear.id);
      }
    }
    expect(found.size).toBeGreaterThanOrEqual(ENDGAME_IDS.length - 2);
  });
});
