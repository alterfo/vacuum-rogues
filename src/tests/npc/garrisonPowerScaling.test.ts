/**
 * Overmind garrison count scales with ratcheted player power (three-year-
 * campaign Task 4). `NpcSimulator.fillGarrison` shifts the Overmind garrison
 * [min, max] range up by `overmindGarrisonPowerBonus(peakPower)` — gentle
 * early (0 extra ships while weak), hard late (up to the configured max bonus
 * at full power). Applied at spawn time every tick, so it is
 * generation-independent: existing saves pick it up as garrisons top up.
 * Pirate garrisons are NOT power-scaled — the pressure ramp is the Overmind's.
 */
import { describe, it, expect } from "vitest";
import { Galaxy } from "@/domain/Galaxy";
import { StarSystem } from "@/domain/StarSystem";
import { Overmind } from "@/domain/Overmind";
import { WarpPath } from "@/domain/WarpPath";
import { NpcSimulator, npcsPresentInSystem } from "@/systems/npc/NpcSimulator";
import { SeededRNG } from "@/utils/seededRNG";
import { StarType, NpcRole } from "@/types";
import { Faction } from "@/types/faction";
import { OVERMIND_GARRISON_POWER_MAX_BONUS } from "@/config/balance";

function makeGalaxy(): Galaxy {
  const sysA = new StarSystem(
    "sys_a",
    "Alpha",
    { q: 0, r: 0 },
    StarType.YELLOW_DWARF,
    [],
    Faction.INDEPENDENT,
    [],
  );
  const sysB = new StarSystem(
    "sys_b",
    "Beta",
    { q: 10, r: 0 },
    StarType.YELLOW_DWARF,
    [],
    Faction.INDEPENDENT,
    [],
  );
  sysA.connections.push(new WarpPath("sys_a", "sys_b", 3));
  sysB.connections.push(new WarpPath("sys_b", "sys_a", 3));
  return new Galaxy(
    "galaxy_garrison_power",
    [sysA, sysB],
    new Overmind(),
    [],
    [],
  );
}

function overmindGarrisonCount(power: number | null, seed: string): number {
  const galaxy = makeGalaxy();
  galaxy.addOvermindSystem("sys_a");
  const sim = new NpcSimulator();
  if (power !== null) sim.attachCampaignPeakPower(() => power);
  sim.ensureGarrison(galaxy, new SeededRNG(seed));
  return npcsPresentInSystem(galaxy, "sys_a").filter(
    (n) => n.faction === Faction.OVERMIND,
  ).length;
}

function pirateGarrisonCount(power: number | null, seed: string): number {
  const galaxy = makeGalaxy();
  galaxy.addPirateSystem("sys_b");
  const sim = new NpcSimulator();
  if (power !== null) sim.attachCampaignPeakPower(() => power);
  sim.ensureGarrison(galaxy, new SeededRNG(seed));
  return npcsPresentInSystem(galaxy, "sys_b").filter(
    (n) => n.role === NpcRole.PIRATE,
  ).length;
}

describe("NpcSimulator — Overmind garrison scales with ratcheted power (Task 4)", () => {
  it("weak player (power 0): the garrison range is exactly today's [5,10]", () => {
    const count = overmindGarrisonCount(0, "gp_weak");
    expect(count).toBeGreaterThanOrEqual(5);
    expect(count).toBeLessThanOrEqual(10);
    // Same seed, power source absent (legacy DI) ⇒ identical spawn.
    expect(overmindGarrisonCount(null, "gp_weak")).toBe(count);
  });

  it("maxed player (power 1): the garrison shifts up by the full bonus", () => {
    const bonus = OVERMIND_GARRISON_POWER_MAX_BONUS;
    const weak = overmindGarrisonCount(0, "gp_shift");
    const strong = overmindGarrisonCount(1, "gp_shift");
    // SeededRNG.nextInt is width-invariant, so an equal-width shifted range
    // draws exactly +bonus for the same seed.
    expect(strong).toBe(weak + bonus);
    expect(strong).toBeGreaterThanOrEqual(5 + bonus);
    expect(strong).toBeLessThanOrEqual(10 + bonus);
  });

  it("mid power below the first step (0.4) adds no ships yet — gentle early", () => {
    expect(overmindGarrisonCount(0.4, "gp_mid")).toBe(
      overmindGarrisonCount(0, "gp_mid"),
    );
  });

  it("pirate garrisons are not power-scaled", () => {
    expect(pirateGarrisonCount(1, "gp_pirate")).toBe(
      pirateGarrisonCount(0, "gp_pirate"),
    );
  });
});
