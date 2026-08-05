import { describe, it, expect } from "vitest";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import {
  evaluateMicromoduleDrop,
  applyMicromoduleDrop,
  micromoduleDropHint,
  type MicromoduleDropOutcome,
} from "@/systems/equipment/GearBridge";

const WEAPON = "wpn_pulse";
const ENGINE = "eq_engine_i";
const MM_WEAPON = "mm_wpn_1"; // WEAPON-category gear micromodule
const MM_ENGINE = "mm_eng_1"; // ENGINE-category gear micromodule
const MM_HULL_ARMOR = "mm_hull_armor_1"; // HULL defense micromodule
const MM_HULL_HOLD = "mm_hull_hold_1"; // HULL cargo micromodule

function corvetteWithWeaponAndEngine(): ShipLoadout {
  const loadout = new ShipLoadout("hull_corvette");
  expect(loadout.install(WEAPON)).toBe(true); // slot 0 = weapon
  expect(loadout.install(ENGINE)).toBe(true); // slot 1 = engine
  return loadout;
}

describe("evaluateMicromoduleDrop — gear slots", () => {
  it("accepts a weapon micromodule dropped on a weapon slot", () => {
    const loadout = corvetteWithWeaponAndEngine();
    expect(
      evaluateMicromoduleDrop(
        loadout,
        { kind: "gear", slotIndex: 0 },
        MM_WEAPON,
      ),
    ).toBe("ok");
  });

  it("rejects a wrong-category module on a gear slot (engine module on a weapon)", () => {
    const loadout = corvetteWithWeaponAndEngine();
    expect(
      evaluateMicromoduleDrop(
        loadout,
        { kind: "gear", slotIndex: 0 },
        MM_ENGINE,
      ),
    ).toBe("wrong-category");
  });

  it("rejects a hull module dropped on a gear slot", () => {
    const loadout = corvetteWithWeaponAndEngine();
    expect(
      evaluateMicromoduleDrop(
        loadout,
        { kind: "gear", slotIndex: 0 },
        MM_HULL_ARMOR,
      ),
    ).toBe("wrong-category");
  });

  it("rejects a second micromodule on an already-modded slot (one per item)", () => {
    const loadout = corvetteWithWeaponAndEngine();
    expect(loadout.applyMicromoduleAt(0, MM_WEAPON)).toBe(true);
    expect(
      evaluateMicromoduleDrop(
        loadout,
        { kind: "gear", slotIndex: 0 },
        MM_WEAPON,
      ),
    ).toBe("occupied");
  });

  it("rejects a drop on an empty/invalid slot index", () => {
    const loadout = corvetteWithWeaponAndEngine();
    expect(
      evaluateMicromoduleDrop(
        loadout,
        { kind: "gear", slotIndex: 9 },
        MM_WEAPON,
      ),
    ).toBe("no-target");
  });

  it("rejects an unknown micromodule id", () => {
    const loadout = corvetteWithWeaponAndEngine();
    expect(
      evaluateMicromoduleDrop(
        loadout,
        { kind: "gear", slotIndex: 0 },
        "mm_does_not_exist",
      ),
    ).toBe("unknown");
  });
});

describe("evaluateMicromoduleDrop — hull bank", () => {
  it("accepts a hull module dropped on the hull while a slot is free", () => {
    const loadout = new ShipLoadout("hull_corvette");
    expect(
      evaluateMicromoduleDrop(loadout, { kind: "hull" }, MM_HULL_ARMOR),
    ).toBe("ok");
  });

  it("rejects a gear (weapon) module dropped on the hull", () => {
    const loadout = new ShipLoadout("hull_corvette");
    expect(evaluateMicromoduleDrop(loadout, { kind: "hull" }, MM_WEAPON)).toBe(
      "wrong-category",
    );
  });

  it("rejects a hull drop once every hull slot is filled", () => {
    const loadout = new ShipLoadout("hull_corvette"); // 2 hull slots
    expect(loadout.applyMicromodule("hull_corvette", MM_HULL_ARMOR)).toBe(true);
    expect(loadout.applyMicromodule("hull_corvette", MM_HULL_HOLD)).toBe(true);
    expect(loadout.hullMicromodules().length).toBe(2);
    expect(
      evaluateMicromoduleDrop(loadout, { kind: "hull" }, MM_HULL_ARMOR),
    ).toBe("hull-full");
  });
});

describe("applyMicromoduleDrop — mutates only on ok", () => {
  it("applies a weapon micromodule and raises weapon damage", () => {
    const loadout = corvetteWithWeaponAndEngine();
    const before = loadout.derivedStats().weaponDamage;
    expect(
      applyMicromoduleDrop(loadout, { kind: "gear", slotIndex: 0 }, MM_WEAPON),
    ).toBe("ok");
    expect(loadout.installedSlots()[0].micromoduleId).toBe(MM_WEAPON);
    expect(loadout.derivedStats().weaponDamage).toBeGreaterThan(before);
  });

  it("applies a hull defense module and raises maxHull", () => {
    const loadout = new ShipLoadout("hull_corvette");
    const before = loadout.derivedStats().maxHull;
    expect(applyMicromoduleDrop(loadout, { kind: "hull" }, MM_HULL_ARMOR)).toBe(
      "ok",
    );
    expect(loadout.hullMicromodules()).toContain(MM_HULL_ARMOR);
    expect(loadout.derivedStats().maxHull).toBeGreaterThan(before);
  });

  it("leaves the loadout untouched on a rejected drop", () => {
    const loadout = corvetteWithWeaponAndEngine();
    expect(
      applyMicromoduleDrop(loadout, { kind: "gear", slotIndex: 0 }, MM_ENGINE),
    ).toBe("wrong-category");
    expect(loadout.installedSlots()[0].micromoduleId).toBeUndefined();
  });
});

describe("micromoduleDropHint", () => {
  it("returns a non-empty Russian hint for every outcome", () => {
    const outcomes: MicromoduleDropOutcome[] = [
      "ok",
      "unknown",
      "no-target",
      "wrong-category",
      "occupied",
      "hull-full",
      "incompatible",
    ];
    for (const o of outcomes) {
      expect(micromoduleDropHint(o).length).toBeGreaterThan(0);
    }
    const rejectHints = outcomes
      .filter((o) => o !== "ok")
      .map((o) => micromoduleDropHint(o));
    expect(new Set(rejectHints).size).toBe(rejectHints.length);
  });
});
