import { describe, it, expect } from "vitest";
import {
  gearById,
  applyArtifactUpgrade,
  artifactUpgradeCost,
  ARTIFACT_UPGRADE_COSTS,
  type Gear,
} from "@/systems/equipment/GearCatalog";
import { GameBusinessException } from "@/exceptions/GameBusinessException";

describe("ARTIFACT_UPGRADE_COSTS", () => {
  it("first upgrade costs 2 artifacts", () => {
    expect(ARTIFACT_UPGRADE_COSTS[0]).toBe(2);
  });

  it("second upgrade costs 3 additional artifacts", () => {
    expect(ARTIFACT_UPGRADE_COSTS[1]).toBe(3);
  });
});

describe("artifactUpgradeCost", () => {
  it("returns 2 for no upgrades (level 0)", () => {
    expect(artifactUpgradeCost(0)).toBe(2);
  });

  it("returns 3 for one upgrade done (level 1)", () => {
    expect(artifactUpgradeCost(1)).toBe(3);
  });

  it("returns Infinity when already at max upgrades (level 2)", () => {
    expect(artifactUpgradeCost(2)).toBe(Infinity);
  });
});

describe("applyArtifactUpgrade", () => {
  const base = gearById("hull_corvette"); // tech 3, no upgrades

  it("upgrades tech-3 item with 2 artifacts → tech-4, upgrades=1", () => {
    const upgraded = applyArtifactUpgrade(base!, 2);
    expect(upgraded.techLevel).toBe(4);
    expect(upgraded.upgrades).toBe(1);
  });

  it("does not mutate the original gear object", () => {
    const original = gearById("hull_corvette")!;
    const originalTech = original.techLevel;
    applyArtifactUpgrade(original, 2);
    expect(original.techLevel).toBe(originalTech);
    expect(original.upgrades).toBeUndefined();
  });

  it("second upgrade costs 3 more artifacts → tech-5, upgrades=2", () => {
    const once = applyArtifactUpgrade(base!, 5); // 2 used, 3 remaining is enough
    expect(once.upgrades).toBe(1);
    const twice = applyArtifactUpgrade(once, 3);
    expect(twice.techLevel).toBe(5);
    expect(twice.upgrades).toBe(2);
  });

  it("third upgrade rejected — throws GameBusinessException with UPGRADE_MAX_REACHED", () => {
    const once = applyArtifactUpgrade(base!, 5);
    const twice = applyArtifactUpgrade(once, 3);
    expect(() => applyArtifactUpgrade(twice, 99)).toThrow(
      GameBusinessException,
    );
    try {
      applyArtifactUpgrade(twice, 99);
    } catch (e) {
      expect((e as GameBusinessException).errorCode).toBe(
        "UPGRADE_MAX_REACHED",
      );
    }
  });

  it("insufficient artifacts → throws INSUFFICIENT_RESOURCES, item unchanged", () => {
    expect(() => applyArtifactUpgrade(base!, 1)).toThrow(GameBusinessException);
    try {
      applyArtifactUpgrade(base!, 1);
    } catch (e) {
      expect((e as GameBusinessException).errorCode).toBe(
        "INSUFFICIENT_RESOURCES",
      );
    }
    expect(base!.techLevel).toBe(3);
    expect(base!.upgrades).toBeUndefined();
  });

  it("exactly 2 artifacts is sufficient for first upgrade", () => {
    const upgraded = applyArtifactUpgrade(base!, 2);
    expect(upgraded.upgrades).toBe(1);
  });

  it("works on weapon and equipment gear too", () => {
    const weapon = gearById("wpn_pulse"); // tech 2
    const upgraded = applyArtifactUpgrade(weapon!, 2);
    expect(upgraded.techLevel).toBe(3);
    expect(upgraded.upgrades).toBe(1);

    const eq = gearById("eq_tank"); // tech 1
    const upgradedEq = applyArtifactUpgrade(eq!, 2);
    expect(upgradedEq.techLevel).toBe(2);
  });

  it("preserves all other gear fields on the returned object", () => {
    const upgraded = applyArtifactUpgrade(base!, 2);
    expect(upgraded.id).toBe(base!.id);
    expect(upgraded.name).toBe(base!.name);
    expect(upgraded.basePrice).toBe(base!.basePrice);
    expect(upgraded.size).toBe(base!.size);
  });
});

describe("applyArtifactUpgrade on pre-upgraded gear", () => {
  it("gear with upgrades=1 and 3+ artifacts gets upgrades=2, techLevel+2 from base", () => {
    const base = gearById("wpn_scatter")!; // tech 3
    const alreadyUpgraded: Gear = {
      ...base,
      upgrades: 1,
      techLevel: base.techLevel + 1,
    };
    const result = applyArtifactUpgrade(alreadyUpgraded, 3);
    expect(result.techLevel).toBe(base.techLevel + 2);
    expect(result.upgrades).toBe(2);
  });
});
