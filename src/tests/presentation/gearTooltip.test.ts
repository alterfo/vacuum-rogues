import { describe, it, expect } from "vitest";
import { gearTooltipLines } from "@/presentation/ui/gearTooltip";
import {
  gearById,
  type HullSpec,
  type WeaponSpec,
} from "@/systems/equipment/GearCatalog";

describe("gearTooltipLines — full stat set per gear kind (Task 10)", () => {
  it("shows HP/slots/cargo/mass for a hull", () => {
    const hull = gearById("hull_scout") as HullSpec;
    const lines = gearTooltipLines(hull).join("\n");
    expect(lines).toContain(hull.name);
    expect(lines).toContain(`HP: ${hull.hp}`);
    expect(lines).toContain(`${hull.weaponSlots}/${hull.equipmentSlots}`);
    expect(lines).toContain(`${hull.massCapacity}`);
    expect(lines).toContain(`T${hull.techLevel}`);
  });

  it("shows damage/range/ability/cooldown for a weapon", () => {
    const beam = gearById("wpn_beam") as WeaponSpec; // EMP ability, cooldownTurns 3
    const lines = gearTooltipLines(beam).join("\n");
    expect(lines).toContain(`Урон: ${beam.damage}`);
    expect(lines).toContain(`Дальность: ${beam.range}`);
    expect(lines).toContain("ЭМИ");
    expect(lines).toContain(`Откат: ${beam.cooldownTurns}`);
  });

  it("shows class/potency for equipment", () => {
    const radar = gearById("eq_radar")!;
    const lines = gearTooltipLines(radar).join("\n");
    expect(lines).toContain("Радар");
    expect(lines).toContain("Мощность:");
  });

  it("appends the gearComparisonSuffix delta when replacing a different installed item", () => {
    const beam = gearById("wpn_beam")!;
    const pulse = gearById("wpn_pulse")!;
    const withReplace = gearTooltipLines(beam, pulse);
    const withoutReplace = gearTooltipLines(beam, null);
    expect(withReplace.length).toBe(withoutReplace.length + 1);
    expect(withReplace[withReplace.length - 1]).toContain("vs");
    expect(withReplace[withReplace.length - 1]).toContain(pulse.name);
  });

  it("omits the comparison line when replacing is the same item", () => {
    const pulse = gearById("wpn_pulse")!;
    const lines = gearTooltipLines(pulse, pulse);
    expect(lines.some((l) => l.includes("vs"))).toBe(false);
  });

  it("omits the comparison line when nothing is being replaced", () => {
    const pulse = gearById("wpn_pulse")!;
    const lines = gearTooltipLines(pulse);
    expect(lines.some((l) => l.includes("vs"))).toBe(false);
  });
});
