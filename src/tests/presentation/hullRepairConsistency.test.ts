import { describe, it, expect } from "vitest";
import { hullStatus, repairCost } from "@/systems/equipment/hullStatus";
import { applyLoadoutHullToShip } from "@/systems/equipment/GearBridge";
import { PlayerShip } from "@/domain/PlayerShip";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import { FactionType, HullClass } from "@/types";

describe("hullStatus — display % and repair check agree on one canonical max", () => {
  it("at 71% hull reports a positive (repairable) missing — never 'perfect'", () => {
    const status = hullStatus(100, 140, 140);
    expect(status.percent).toBe(71);
    expect(status.missing).toBe(40);
    expect(status.missing).toBeGreaterThan(0);
    expect(status.isPerfect).toBe(false);
  });

  it("prefers the canonical loadout max over a stale live ship.maxHull", () => {
    const staleShipMax = 100;
    const canonicalMax = 140;
    const status = hullStatus(100, staleShipMax, canonicalMax);
    expect(status.maxHull).toBe(canonicalMax);
    expect(status.percent).toBe(71);
    expect(status.missing).toBe(40); // repairable, not "идеальное состояние"
    expect(status.isPerfect).toBe(false);
  });

  it("at full canonical hull reports perfect (nothing to repair)", () => {
    const status = hullStatus(140, 140, 140);
    expect(status.percent).toBe(100);
    expect(status.missing).toBe(0);
    expect(status.isPerfect).toBe(true);
  });

  it("falls back to the live ship max when no loadout max is given", () => {
    const status = hullStatus(50, 100);
    expect(status.maxHull).toBe(100);
    expect(status.percent).toBe(50);
    expect(status.missing).toBe(50);
  });

  it("clamps the denominator so a zero max can't divide-by-zero", () => {
    const status = hullStatus(0, 0, 0);
    expect(Number.isFinite(status.percent)).toBe(true);
  });

  it("clamps percent to 0..100 when hullHP exceeds the canonical max", () => {
    const status = hullStatus(140, 140, 100);
    expect(status.percent).toBe(100);
    expect(status.percent).toBeLessThanOrEqual(100);
    expect(status.percent).toBeGreaterThanOrEqual(0);
    expect(status.isPerfect).toBe(true);
  });
});

describe("repair flow — a defense micromodule's derived max reaches the live ship", () => {
  function makeCorvetteShip(maxHull: number): PlayerShip {
    return new PlayerShip(
      "ship1",
      "Ship",
      maxHull, // hullHP (full)
      maxHull, // maxHull
      50,
      50,
      100,
      100,
      10,
      5,
      FactionType.PROGRESSORS,
      HullClass.CORVETTE,
    );
  }

  it("a defense micromodule raises derived maxHull above a freshly-built ship's max", () => {
    const loadout = new ShipLoadout("hull_corvette");
    const baseMax = loadout.derivedStats().maxHull;

    const ship = makeCorvetteShip(baseMax);

    const applied = loadout.applyMicromodule(
      loadout.hull.id,
      "mm_hull_armor_1",
    );
    expect(applied).toBe(true);
    const boostedMax = loadout.derivedStats().maxHull;
    expect(boostedMax).toBeGreaterThan(baseMax);

    const stale = hullStatus(ship.hullHP, ship.maxHull, boostedMax);
    expect(stale.percent).toBeLessThan(100);
    expect(stale.missing).toBeGreaterThan(0);
    expect(stale.isPerfect).toBe(false);

    applyLoadoutHullToShip(ship, loadout);
    expect(ship.maxHull).toBe(boostedMax);
    ship.repair();
    const after = hullStatus(ship.hullHP, ship.maxHull, boostedMax);
    expect(after.percent).toBe(100);
    expect(after.isPerfect).toBe(true);
  });
});

describe("repairCost — the hangar's СЕРВИСНЫЙ ЦЕНТР pricing seam (Task 5)", () => {
  it("is null when the hull is already perfect — nothing to repair", () => {
    const status = hullStatus(140, 140, 140);
    expect(repairCost(status)).toBeNull();
  });

  it("bills the default planet-Верфь rate (2 cr/HP), rounded up", () => {
    const status = hullStatus(100, 140, 140); // 40 missing
    expect(repairCost(status)).toBe(80);
  });

  it("rounds a fractional bill up to the next whole credit", () => {
    const status = hullStatus(99, 140, 140); // 41 missing
    expect(repairCost(status, 1.5)).toBe(Math.ceil(41 * 1.5));
  });

  it("respects a custom rate override", () => {
    const status = hullStatus(100, 140, 140); // 40 missing
    expect(repairCost(status, 8)).toBe(320);
  });
});
