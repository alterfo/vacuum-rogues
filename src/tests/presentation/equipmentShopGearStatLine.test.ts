import { describe, it, expect } from "vitest";
import { gearStatLine } from "@/presentation/EquipmentShopScene";
import { gearById } from "@/systems/equipment/GearCatalog";

/**
 * Second review pass (gear-variety-and-hangar): `ShipLoadout.derivedStats()`
 * computes engine speed purely from `techLevel` — an engine's `potency` is
 * never read (unlike every other equipment class, where potency IS what
 * `derivedStats` consumes). `gearStatLine` used to show a bare
 * "Мощность: <potency>" line — and the shop's replacement-delta compared raw
 * potency — for every equipment item including engines, which misleadingly
 * implied a lower-potency same-tier engine (a genuine mass/price tradeoff,
 * `eq_engine_i` vs `eq_engine_light`, both T2) was slower, when their actual
 * derived speed is identical.
 */
describe("gearStatLine — engine stat line doesn't imply a potency-driven speed difference", () => {
  it("shows tech level + mass for an engine, not a potency 'Мощность' figure", () => {
    const engine = gearById("eq_engine_i")!;
    const line = gearStatLine(engine);
    expect(line).not.toContain("Мощность");
    expect(line).toContain("Тех.ур.: 2");
    expect(line).toContain("Масса: 6");
  });

  it("still shows Мощность for a non-engine equipment class (potency genuinely matters there)", () => {
    const radar = gearById("eq_radar")!;
    expect(gearStatLine(radar)).toContain("Мощность:");
  });

  it("two same-tier engines with different potency both report the tech level that actually drives speed", () => {
    const a = gearById("eq_engine_i")!;
    const b = gearById("eq_engine_light")!;
    expect(a.techLevel).toBe(b.techLevel);
    expect((a as { potency?: number }).potency).not.toBe(
      (b as { potency?: number }).potency,
    );
    expect(gearStatLine(a)).toContain("Тех.ур.: 2");
    expect(gearStatLine(b)).toContain("Тех.ур.: 2");
  });
});
