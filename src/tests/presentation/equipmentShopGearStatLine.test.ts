import { describe, it, expect } from "vitest";
import { gearStatLine } from "@/presentation/EquipmentShopScene";
import { gearById } from "@/systems/equipment/GearCatalog";

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
