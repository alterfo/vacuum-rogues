import { describe, it, expect } from "vitest";
import { hullStatus } from "@/systems/equipment/hullStatus";
import { applyLoadoutHullToShip } from "@/systems/equipment/GearBridge";
import { PlayerShip } from "@/domain/PlayerShip";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import { FactionType, HullClass } from "@/types";

/**
 * Regression for the 2026-06-27 playtest bug: the planet menu showed hull at 71%
 * while pressing Верфь (repair) reported «Корпус уже в идеальном состоянии».
 *
 * Root cause: the hull-% display and the repair "missing/perfect" check read two
 * *different* max-hull values — the live `PlayerShip.maxHull` projection had gone
 * stale (it is only refreshed on hull swaps / load) while the canonical
 * `playerLoadout.derivedStats().maxHull` had grown (e.g. a defense micromodule).
 * Both must read the same canonical value via {@link hullStatus}.
 */
describe("hullStatus — display % and repair check agree on one canonical max", () => {
  it("at 71% hull reports a positive (repairable) missing — never 'perfect'", () => {
    // hullHP 100 against a canonical max of 140 ⇒ ~71%.
    const status = hullStatus(
      100,
      /* shipMaxHull */ 140,
      /* loadoutMaxHull */ 140,
    );
    expect(status.percent).toBe(71);
    expect(status.missing).toBe(40);
    expect(status.missing).toBeGreaterThan(0);
    expect(status.isPerfect).toBe(false);
  });

  it("prefers the canonical loadout max over a stale live ship.maxHull", () => {
    // The display once showed 71% off the canonical max while the repair used a
    // stale live max of 100 (missing 0 ⇒ 'perfect'). hullStatus keeps both honest:
    // the same canonical max drives the percent AND the missing.
    const staleShipMax = 100;
    const canonicalMax = 140;
    const status = hullStatus(100, staleShipMax, canonicalMax);
    // Display view and repair view are derived from the SAME max ⇒ they agree.
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

    // A live ship built at the base max, full hull — this is the "stale" projection
    // that pre-dates the micromodule.
    const ship = makeCorvetteShip(baseMax);

    const applied = loadout.applyMicromodule(
      loadout.hull.id,
      "mm_hull_armor_1",
    );
    expect(applied).toBe(true);
    const boostedMax = loadout.derivedStats().maxHull;
    expect(boostedMax).toBeGreaterThan(baseMax);

    // Before any re-sync the live ship max lags the canonical max — the bug window.
    // hullStatus reads the canonical max, so the display shows < 100% (not full).
    const stale = hullStatus(ship.hullHP, ship.maxHull, boostedMax);
    expect(stale.percent).toBeLessThan(100);
    expect(stale.missing).toBeGreaterThan(0);
    expect(stale.isPerfect).toBe(false);

    // The Верфь flow syncs the live ship to the loadout, then repairs to the
    // canonical max — afterwards display and repair both read 100%.
    applyLoadoutHullToShip(ship, loadout);
    expect(ship.maxHull).toBe(boostedMax);
    ship.repair();
    const after = hullStatus(ship.hullHP, ship.maxHull, boostedMax);
    expect(after.percent).toBe(100);
    expect(after.isPerfect).toBe(true);
  });
});
