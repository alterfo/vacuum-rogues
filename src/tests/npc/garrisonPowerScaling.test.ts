import { describe, it, expect } from "vitest";
import { Galaxy } from "@/domain/Galaxy";
import { StarSystem } from "@/domain/StarSystem";
import { Overmind } from "@/domain/Overmind";
import { WarpPath } from "@/domain/WarpPath";
import { NpcSimulator, npcsPresentInSystem } from "@/systems/npc/NpcSimulator";
import { SeededRNG } from "@/utils/seededRNG";
import { StarType, NpcRole } from "@/types";
import { Faction } from "@/types/faction";
import {
  OVERMIND_GARRISON_POWER_MAX_BONUS,
  OVERMIND_GARRISON_POWER_MAX_DISCOUNT,
} from "@/config/balance";

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

describe("NpcSimulator — Overmind garrison scales with ratcheted power (Task 4 + win-rate architecture Task 2)", () => {
  it("weak player (power 0): the garrison is discounted below today's fixed [5,10]", () => {
    const discount = OVERMIND_GARRISON_POWER_MAX_DISCOUNT;
    const count = overmindGarrisonCount(0, "gp_weak");
    expect(count).toBeGreaterThanOrEqual(Math.max(1, 5 - discount));
    expect(count).toBeLessThanOrEqual(10 - discount);
    expect(overmindGarrisonCount(null, "gp_weak")).toBe(count);
  });

  it("maxed player (power 1): the garrison lands in the bonus-shifted band, above the discounted weak band", () => {
    const bonus = OVERMIND_GARRISON_POWER_MAX_BONUS;
    const weak = overmindGarrisonCount(0, "gp_shift");
    const strong = overmindGarrisonCount(1, "gp_shift");
    expect(strong).toBeGreaterThan(weak);
    expect(strong).toBeGreaterThanOrEqual(5 + bonus);
    expect(strong).toBeLessThanOrEqual(10 + bonus);
  });

  it("never discounts a held system's minimum below a genuinely-held floor", () => {
    const count = overmindGarrisonCount(0, "gp_floor");
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it("garrison size is monotone non-decreasing as power grows from 0 to 1", () => {
    let prev = overmindGarrisonCount(0, "gp_mono");
    for (const p of [0.1, 0.3, 0.4, 0.5, 0.7, 0.9, 1]) {
      const count = overmindGarrisonCount(p, "gp_mono");
      expect(count).toBeGreaterThanOrEqual(prev);
      prev = count;
    }
  });

  it("pirate garrisons recover to the undiscounted band at full power (no upward bonus — pressure ramp stays Overmind-only)", () => {
    const weak = pirateGarrisonCount(0, "gp_pirate_shape");
    const strong = pirateGarrisonCount(1, "gp_pirate_shape");
    expect(strong).toBeGreaterThan(weak);
    expect(strong).toBeGreaterThanOrEqual(5);
    expect(strong).toBeLessThanOrEqual(10);
  });

  it("pirate garrison size is monotone non-decreasing as power grows from 0 to 1", () => {
    let prev = pirateGarrisonCount(0, "gp_pirate_mono");
    for (const p of [0.1, 0.3, 0.4, 0.5, 0.7, 0.9, 1]) {
      const count = pirateGarrisonCount(p, "gp_pirate_mono");
      expect(count).toBeGreaterThanOrEqual(prev);
      prev = count;
    }
  });

  it("pirate garrisons ARE now power-scaled by the downward discount (Task 3 reversal): weak player faces a smaller pirate garrison", () => {
    const discount = OVERMIND_GARRISON_POWER_MAX_DISCOUNT;
    const weak = pirateGarrisonCount(0, "gp_pirate_discount");
    expect(weak).toBeGreaterThanOrEqual(Math.max(1, 5 - discount));
    expect(weak).toBeLessThanOrEqual(10 - discount);
  });

  it("maxed player: pirate garrison is at today's undiscounted [5,10] range (discount is 0 at full power)", () => {
    const strong = pirateGarrisonCount(1, "gp_pirate_maxed");
    expect(strong).toBeGreaterThanOrEqual(5);
    expect(strong).toBeLessThanOrEqual(10);
  });

  it("GOD mode exempts pirate garrisons from the discount too (same GOD-hull-floor rationale)", () => {
    const galaxy = makeGalaxy();
    galaxy.addPirateSystem("sys_b");
    const sim = new NpcSimulator();
    sim.setGameMode("GOD");
    sim.attachCampaignPeakPower(() => 0);
    sim.ensureGarrison(galaxy, new SeededRNG("gp_god_pirate_weak"));
    const count = npcsPresentInSystem(galaxy, "sys_b").filter(
      (n) => n.role === NpcRole.PIRATE,
    ).length;
    expect(count).toBeGreaterThanOrEqual(5);
    expect(count).toBeLessThanOrEqual(10);
  });

  it("GOD mode is exempt from the discount — a powerless GOD player faces today's undiscounted [5,10] Overmind garrison", () => {
    const galaxy = makeGalaxy();
    galaxy.addOvermindSystem("sys_a");
    const sim = new NpcSimulator();
    sim.setGameMode("GOD");
    sim.attachCampaignPeakPower(() => 0);
    sim.ensureGarrison(galaxy, new SeededRNG("gp_god_weak"));
    const count = npcsPresentInSystem(galaxy, "sys_a").filter(
      (n) => n.faction === Faction.OVERMIND,
    ).length;
    expect(count).toBeGreaterThanOrEqual(5);
    expect(count).toBeLessThanOrEqual(10);
  });
});
