import { describe, it, expect } from "vitest";
import {
  applyPickup,
  chipValue,
  rollCapsuleDrop,
  rollRandomDrop,
  weaponOfPickup,
} from "@/systems/blackHoleArcade/arcadePickups";
import {
  ARCADE_PICKUP_KINDS,
  type ArcadePlayer,
} from "@/systems/blackHoleArcade/arcadeTypes";
import { createArcadeRun } from "@/systems/blackHoleArcade/arcadeState";
import * as cfg from "@/systems/blackHoleArcade/arcadeConfig";

function player(over: Partial<ArcadePlayer> = {}): ArcadePlayer {
  return { ...createArcadeRun().player, ...over };
}

describe("arcade pickups", () => {
  it("offers sixteen kinds", () => {
    expect(ARCADE_PICKUP_KINDS).toHaveLength(16);
  });

  it("a different weapon colour swaps the gun and keeps the power level; the same colour levels it up", () => {
    const p = player({ weapon: "vulcan", weaponLevel: 3 });
    applyPickup(p, "weapon_laser", 1);
    expect(p.weapon).toBe("laser");
    expect(p.weaponLevel).toBe(3);
    applyPickup(p, "weapon_laser", 1);
    expect(p.weaponLevel).toBe(4);
    applyPickup(p, "power", 1);
    applyPickup(p, "power", 1);
    expect(p.weaponLevel).toBe(cfg.ARCADE_WEAPON_MAX_LEVEL);
  });

  it("every weapon pickup maps to a weapon, and no other kind does", () => {
    const mapped = ARCADE_PICKUP_KINDS.filter((k) => weaponOfPickup(k));
    expect(mapped).toHaveLength(6);
  });

  it("a power orb at max level is worth score instead", () => {
    const p = player({ weaponLevel: 5 });
    expect(applyPickup(p, "power", 1).score).toBeGreaterThan(
      applyPickup(player({ weaponLevel: 1 }), "power", 1).score,
    );
  });

  it("repairs heal but never exceed max hull", () => {
    const p = player({ hull: 40, maxHull: 100 });
    applyPickup(p, "repair_small", 1);
    expect(p.hull).toBe(65);
    applyPickup(p, "repair_full", 1);
    expect(p.hull).toBe(100);
    applyPickup(p, "repair_small", 1);
    expect(p.hull).toBe(100);
  });

  it("plating raises max hull and heals a little, up to the cap", () => {
    const p = player({ hull: 100, maxHull: 100 });
    applyPickup(p, "plating", 1);
    expect(p.maxHull).toBe(120);
    expect(p.hull).toBe(120);
    for (let i = 0; i < 40; i++) applyPickup(p, "plating", 1);
    expect(p.maxHull).toBe(cfg.ARCADE_HULL_CAP);
  });

  it("armor coats stack to the cap", () => {
    const p = player();
    for (let i = 0; i < 30; i++) applyPickup(p, "armor_coat", 1);
    expect(p.armor).toBeCloseTo(cfg.ARCADE_ARMOR_CAP, 5);
  });

  it("shield pickups raise capacity, refill, and cap out", () => {
    const p = player();
    applyPickup(p, "shield", 1);
    expect(p.shieldMax).toBe(cfg.ARCADE_SHIELD_PICKUP);
    expect(p.shield).toBe(p.shieldMax);
    p.shield = 3;
    applyPickup(p, "shield", 1);
    expect(p.shield).toBe(p.shieldMax);
    for (let i = 0; i < 20; i++) applyPickup(p, "shield", 1);
    expect(p.shieldMax).toBe(cfg.ARCADE_SHIELD_CAP);
  });

  it("bombs and wingmen cap; magnet sets a timer; chips pay by level", () => {
    const p = player({ bombs: 0, drones: 0 });
    for (let i = 0; i < 9; i++) {
      applyPickup(p, "bomb", 1);
      applyPickup(p, "wingman", 1);
    }
    expect(p.bombs).toBe(cfg.ARCADE_BOMB_CAP);
    expect(p.drones).toBe(cfg.ARCADE_DRONE_CAP);
    applyPickup(p, "magnet", 1);
    expect(p.magnetMs).toBe(cfg.ARCADE_MAGNET_MS);
    expect(applyPickup(p, "chip", 10).chipCredits).toBe(chipValue(10));
    expect(chipValue(40)).toBeGreaterThan(chipValue(1));
  });

  it("random drops cover every kind; capsules favour weapons and power", () => {
    const rng = { rngState: 11 };
    const seen = new Set<string>();
    for (let i = 0; i < 4000; i++) seen.add(rollRandomDrop(rng));
    expect(seen.size).toBe(16);

    let useful = 0;
    for (let i = 0; i < 1000; i++) {
      const k = rollCapsuleDrop(rng);
      if (k.startsWith("weapon_") || k === "power") useful++;
    }
    expect(useful).toBeGreaterThan(600);
  });
});
