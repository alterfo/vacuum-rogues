/**
 * Overmind garrison count scales with ratcheted player power (three-year-
 * campaign Task 4; downward half added by the campaign win-rate architecture
 * plan, Task 2). `NpcSimulator.fillGarrison` shifts the Overmind garrison
 * [min, max] range by the net of `overmindGarrisonPowerBonus(peakPower)` (up,
 * 0 while weak, full bonus at max power) and `overmindGarrisonPowerDiscount`
 * (down, full discount while weak, 0 at max power) — gentle early (smaller
 * garrison while weak), hard late (today's range plus the upward bonus at
 * full power). Applied at spawn time every tick, so it is
 * generation-independent: existing saves pick it up as garrisons top up.
 *
 * SCOPE REVERSAL (campaign win-rate-100pct plan, Task 1, authorized by the
 * user's 2026-07-13 directive; wired in Task 3): pirate-held-system garrisons
 * are now IN SCOPE for the same downward discount — the prior "pressure ramp
 * is the Overmind's" invariant is retired because the death census flags
 * pirate garrisons as the most likely dominant remaining early-death source.
 * The upward bonus stays Overmind-only (pirates get discount only, no bonus).
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
    // Same seed, power source absent (legacy DI) ⇒ identical spawn.
    expect(overmindGarrisonCount(null, "gp_weak")).toBe(count);
  });

  it("maxed player (power 1): the garrison shifts up by the full bonus (discount is 0 at full power)", () => {
    const bonus = OVERMIND_GARRISON_POWER_MAX_BONUS;
    const discount = OVERMIND_GARRISON_POWER_MAX_DISCOUNT;
    const weak = overmindGarrisonCount(0, "gp_shift");
    const strong = overmindGarrisonCount(1, "gp_shift");
    // SeededRNG.nextInt is width-invariant, so an equal-width shifted range
    // draws exactly +(bonus + discount) for the same seed (power 0 carries
    // -discount, power 1 carries +bonus).
    expect(strong).toBe(weak + bonus + discount);
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

  it("pirate garrisons shift by the discount alone (no upward bonus — pressure ramp stays Overmind-only)", () => {
    // Pirates get no `powerBonus` (always 0), only the shared discount, so
    // the weak→strong shift for the same seed is exactly `discount`, not
    // `bonus + discount` like the Overmind-side test above.
    const discount = OVERMIND_GARRISON_POWER_MAX_DISCOUNT;
    const weak = pirateGarrisonCount(0, "gp_pirate_shape");
    const strong = pirateGarrisonCount(1, "gp_pirate_shape");
    expect(strong).toBe(weak + discount);
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
    // win-rate-100pct plan, Task 2: GOD already floors hull above 0, so the
    // discount has no survivability upside there, only the downside of
    // starving combat-loot income (the prior plan's Task 2 regression this
    // exemption targets — see sessionCompetence.test.ts's GOD milestone probe).
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
