import { describe, it, expect } from "vitest";
import {
  COMBAT_CONSUMABLES,
  COMBAT_CONSUMABLE_CATEGORY_KEY,
  DEFAULT_COMBAT_CONSUMABLE,
  consumableById,
  hasConsumable,
  consumeOne,
  applyShieldRestore,
  aoeDamageTargets,
  jamTarget,
  isJamActive,
} from "@/presentation/flight/combatConsumable";
import { COMBAT_CONSUMABLE } from "@/config/balance";
import { ru } from "@/i18n/ru";
import { en } from "@/i18n/en";
import { Inventory } from "@/domain/Inventory";

const CFG = DEFAULT_COMBAT_CONSUMABLE;

describe("COMBAT_CONSUMABLE config parity (single source of truth)", () => {
  it("balance.ts COMBAT_CONSUMABLE mirrors the module default", () => {
    expect(DEFAULT_COMBAT_CONSUMABLE).toEqual({
      shieldRestoreAmount: COMBAT_CONSUMABLE.shieldRestoreAmount,
      aoeDamage: COMBAT_CONSUMABLE.aoeDamage,
      aoeRadius: COMBAT_CONSUMABLE.aoeRadius,
      weaponJamMs: COMBAT_CONSUMABLE.weaponJamMs,
    });
  });
});

describe("consumable catalog + i18n (Task 9)", () => {
  it("has one device per effect kind, ids unique", () => {
    const effects = COMBAT_CONSUMABLES.map((c) => c.effect);
    expect(new Set(effects)).toEqual(
      new Set(["shield-restore", "aoe-damage", "weapon-jam"]),
    );
    const ids = COMBAT_CONSUMABLES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every name/desc key + the category key exist in BOTH ru and en", () => {
    const keys = [
      COMBAT_CONSUMABLE_CATEGORY_KEY,
      ...COMBAT_CONSUMABLES.flatMap((c) => [c.nameKey, c.descKey]),
    ];
    for (const k of keys) {
      expect(ru, `ru missing ${k}`).toHaveProperty([k]);
      expect(en, `en missing ${k}`).toHaveProperty([k]);
    }
  });

  it("category is disambiguated from the ARTIFACTS crafting currency", () => {
    expect(ru[COMBAT_CONSUMABLE_CATEGORY_KEY]).toBe("Тактическое устройство");
    expect(en[COMBAT_CONSUMABLE_CATEGORY_KEY]).toBe("Tactical Device");
  });

  it("consumableById resolves a known id and null otherwise", () => {
    expect(consumableById("con_shield_cell")?.effect).toBe("shield-restore");
    expect(consumableById("con_pulse_bomb")?.effect).toBe("aoe-damage");
    expect(consumableById("con_jammer")?.effect).toBe("weapon-jam");
    expect(consumableById("nope")).toBeNull();
    expect(consumableById(null)).toBeNull();
    expect(consumableById(undefined)).toBeNull();
  });
});

describe("owned-inventory helpers (pure array ops)", () => {
  it("hasConsumable reports presence", () => {
    expect(hasConsumable(["con_jammer", "con_jammer"], "con_jammer")).toBe(
      true,
    );
    expect(hasConsumable([], "con_jammer")).toBe(false);
  });

  it("consumeOne removes exactly one copy, non-mutating", () => {
    const before = ["con_jammer", "con_shield_cell", "con_jammer"];
    const after = consumeOne(before, "con_jammer");
    expect(after).toEqual(["con_shield_cell", "con_jammer"]);
    expect(before).toEqual(["con_jammer", "con_shield_cell", "con_jammer"]); // input untouched
  });

  it("consumeOne on an absent id returns an equal-length copy", () => {
    const before = ["con_shield_cell"];
    const after = consumeOne(before, "con_jammer");
    expect(after).toEqual(before);
    expect(after).not.toBe(before);
  });
});

describe("Inventory persisted consumable inventory (Task 9)", () => {
  it("add/has/remove round-trip through the domain", () => {
    const inv = new Inventory();
    expect(inv.ownedConsumableIds).toEqual([]);
    inv.addConsumable("con_jammer");
    inv.addConsumable("con_jammer");
    expect(inv.hasConsumable("con_jammer")).toBe(true);
    expect(inv.removeConsumable("con_jammer")).toBe(true);
    expect(inv.ownedConsumableIds).toEqual(["con_jammer"]);
    expect(inv.removeConsumable("con_shield_cell")).toBe(false);
  });

  it("accessors tolerate an old save's absent field (setPrototypeOf load path)", () => {
    const inv = Object.setPrototypeOf(
      { modules: [], micromodules: [], resources: [], cosmetics: [] },
      Inventory.prototype,
    ) as Inventory;
    expect(inv.hasConsumable("con_jammer")).toBe(false);
    inv.addConsumable("con_jammer");
    expect(inv.ownedConsumableIds).toEqual(["con_jammer"]);
  });
});

describe("applyShieldRestore — shield-restore effect", () => {
  it("restores by the config amount, clamped to max", () => {
    expect(applyShieldRestore(20, 200, CFG.shieldRestoreAmount)).toBe(
      20 + CFG.shieldRestoreAmount,
    );
    expect(applyShieldRestore(150, 200, CFG.shieldRestoreAmount)).toBe(200); // clamp
  });

  it("never reduces below the current value", () => {
    expect(applyShieldRestore(180, 200, 0)).toBe(180);
    expect(applyShieldRestore(180, 200, -50)).toBe(180); // no drain
  });

  it("a full shield is a no-op", () => {
    expect(applyShieldRestore(200, 200, CFG.shieldRestoreAmount)).toBe(200);
  });

  it("guards non-finite / negative inputs", () => {
    expect(applyShieldRestore(NaN, 200, 50)).toBe(50);
    expect(applyShieldRestore(10, NaN, 50)).toBe(0); // max 0 clamps everything
    expect(applyShieldRestore(-10, 200, 50)).toBe(50);
  });

  it("defaults the amount from the module config", () => {
    expect(applyShieldRestore(0, 500)).toBe(CFG.shieldRestoreAmount);
  });
});

describe("aoeDamageTargets — AoE hits every enemy in radius (not just one)", () => {
  interface Enemy {
    id: string;
    x: number;
    y: number;
  }
  const posOf = (e: Enemy) => ({ x: e.x, y: e.y });

  it("damages every enemy within the blast radius", () => {
    const center = { x: 0, y: 0 };
    const enemies: Enemy[] = [
      { id: "near1", x: 50, y: 0 },
      { id: "near2", x: 0, y: 100 },
      { id: "far", x: 1000, y: 0 },
    ];
    const hits = aoeDamageTargets(center, enemies, posOf, CFG);
    expect(hits.map((h) => h.enemy.id).sort()).toEqual(["near1", "near2"]);
    for (const h of hits) expect(h.damage).toBe(CFG.aoeDamage);
    expect(hits.length).toBeGreaterThan(1);
  });

  it("includes an enemy exactly on the radius boundary (inclusive)", () => {
    const center = { x: 0, y: 0 };
    const onEdge: Enemy = { id: "edge", x: CFG.aoeRadius, y: 0 };
    const hits = aoeDamageTargets(center, [onEdge], posOf, CFG);
    expect(hits).toHaveLength(1);
  });

  it("empty enemy list → no hits", () => {
    expect(aoeDamageTargets({ x: 0, y: 0 }, [], posOf, CFG)).toEqual([]);
  });
});

describe("jamTarget / isJamActive — weapon-jam effect", () => {
  it("suppresses fire for the config duration then expires cleanly", () => {
    const jam = jamTarget("npc1", 1000, CFG.weaponJamMs);
    expect(jam.target).toBe("npc1");
    expect(jam.expiresAtMs).toBe(1000 + CFG.weaponJamMs);

    expect(isJamActive(jam, 1000)).toBe(true); // at launch
    expect(isJamActive(jam, 1000 + CFG.weaponJamMs - 1)).toBe(true); // just before end
    expect(isJamActive(jam, 1000 + CFG.weaponJamMs)).toBe(false); // exactly at expiry
    expect(isJamActive(jam, 1000 + CFG.weaponJamMs + 1000)).toBe(false); // well after
  });

  it("a non-positive duration is an already-expired no-op", () => {
    const jam = jamTarget("npc1", 500, 0);
    expect(isJamActive(jam, 500)).toBe(false);
  });

  it("defaults the duration from the module config", () => {
    const jam = jamTarget("npc1", 0);
    expect(jam.expiresAtMs).toBe(CFG.weaponJamMs);
  });
});
