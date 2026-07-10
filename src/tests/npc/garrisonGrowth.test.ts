import { describe, it, expect } from "vitest";
import { Galaxy } from "@/domain/Galaxy";
import { StarSystem } from "@/domain/StarSystem";
import { Overmind } from "@/domain/Overmind";
import { WarpPath } from "@/domain/WarpPath";
import { NpcSimulator, npcsPresentInSystem } from "@/systems/npc/NpcSimulator";
import { SeededRNG } from "@/utils/seededRNG";
import { StarType, NpcState } from "@/types";
import { Faction } from "@/types/faction";

/** Two-system galaxy: sys_a (will be captured) ←→ sys_b (friendly). */
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
    "galaxy_garrison_growth",
    [sysA, sysB],
    new Overmind(),
    [],
    [],
  );
}

/** Live standing-garrison ships (garrison_ prefixed) present in a system. */
function garrisonShips(galaxy: Galaxy, systemId: string) {
  return npcsPresentInSystem(galaxy, systemId).filter((n) =>
    n.id.startsWith("garrison_"),
  );
}

/**
 * Growth ticks fire on gameDays multiples of GARRISON_GROWTH_INTERVAL_DAYS (10)
 * — these values avoid the unrelated 30-day convoy, 50-day liberation and
 * 60-day capture-fleet triggers so counts stay noise-free.
 */
const GROWTH_DAYS = [10, 20, 40, 70, 80, 110];

describe("NpcSimulator garrison growth (Overmind organic expansion)", () => {
  it("records the baseline garrison size when a garrison is first established", () => {
    const galaxy = makeGalaxy();
    galaxy.addOvermindSystem("sys_a");

    // Establish directly (no tick) so the galaxy holds ONLY garrison ships:
    // the recorded baseline must equal exactly what was just established.
    const sim = new NpcSimulator();
    sim.attachCampaignPeakPower(() => 1);
    sim.ensureGarrison(galaxy, new SeededRNG("growth_baseline_seed"));

    const established = garrisonShips(galaxy, "sys_a").length;
    expect(established).toBeGreaterThanOrEqual(5);
    const baseline = (
      sim as unknown as { garrisonBaseline: Map<string, number> }
    ).garrisonBaseline.get("sys_a");
    expect(baseline).toBe(established);
  });

  it("grows an established garrison by exactly 1 ship per growth interval", () => {
    const galaxy = makeGalaxy();
    galaxy.addOvermindSystem("sys_a");

    const sim = new NpcSimulator();
    sim.attachCampaignPeakPower(() => 1);
    galaxy.gameDays = 1;
    sim.tick(galaxy, new SeededRNG("growth_tick_0"));
    const established = garrisonShips(galaxy, "sys_a").length;

    galaxy.gameDays = 10;
    sim.tick(galaxy, new SeededRNG("growth_tick_1"));
    expect(garrisonShips(galaxy, "sys_a")).toHaveLength(established + 1);
  });

  it("does not grow on a day that is not a growth-interval multiple", () => {
    const galaxy = makeGalaxy();
    galaxy.addOvermindSystem("sys_a");

    const sim = new NpcSimulator();
    sim.attachCampaignPeakPower(() => 1);
    galaxy.gameDays = 1;
    sim.tick(galaxy, new SeededRNG("nogrowth_tick_0"));
    const established = garrisonShips(galaxy, "sys_a").length;

    galaxy.gameDays = 11;
    sim.tick(galaxy, new SeededRNG("nogrowth_tick_1"));
    expect(garrisonShips(galaxy, "sys_a")).toHaveLength(established);
  });

  it("grows by exactly 1 per pass and never exceeds round(baseline × 1.5)", () => {
    const galaxy = makeGalaxy();
    galaxy.addOvermindSystem("sys_a");

    // Establish directly and drive growth passes directly: a garrison-only
    // galaxy keeps the counts exact (a wandering pirate in sys_a would inflate
    // the present-count the growth cap is checked against). The tick wiring
    // (interval gating) is covered by the grows-by-1 / non-interval tests.
    const sim = new NpcSimulator();
    sim.attachCampaignPeakPower(() => 1);
    sim.ensureGarrison(galaxy, new SeededRNG("cap_seed"));
    const baseline = garrisonShips(galaxy, "sys_a").length;
    const cap = Math.round(baseline * 1.5);
    const grow = (
      sim as unknown as { growGarrisons(g: Galaxy, r: SeededRNG): void }
    ).growGarrisons.bind(sim);

    // Each pass below the cap adds exactly 1 and growth never pushes the
    // count past the cap. What happens ON reaching the cap — the excess buds
    // off as a traveling capture fleet — is covered by garrisonBudOff.test.ts.
    for (let pass = 1; pass <= cap - baseline; pass++) {
      grow(galaxy, new SeededRNG(`cap_grow_${pass}`));
      expect(garrisonShips(galaxy, "sys_a")).toHaveLength(baseline + pass);
    }
    expect(garrisonShips(galaxy, "sys_a")).toHaveLength(cap);
  });

  it("does not grow while the campaign ratchet is below the adaptive activation", () => {
    const galaxy = makeGalaxy();
    galaxy.addOvermindSystem("sys_a");

    // No power source wired (⇒ 0, like every weak-era run): growth must stay
    // dormant so early-game garrisons hold at their static baseline and the
    // seeded campaign pacing (first liberation by P2) is undisturbed.
    const sim = new NpcSimulator();
    sim.ensureGarrison(galaxy, new SeededRNG("weak_seed"));
    const established = garrisonShips(galaxy, "sys_a").length;

    const grow = (
      sim as unknown as { growGarrisons(g: Galaxy, r: SeededRNG): void }
    ).growGarrisons.bind(sim);
    grow(galaxy, new SeededRNG("weak_grow_1"));
    grow(galaxy, new SeededRNG("weak_grow_2"));
    expect(garrisonShips(galaxy, "sys_a")).toHaveLength(established);

    // A ratchet just below the activation band (bonus still floors to 0)
    // keeps growth dormant too.
    sim.attachCampaignPeakPower(() => 0.49);
    grow(galaxy, new SeededRNG("weak_grow_3"));
    expect(garrisonShips(galaxy, "sys_a")).toHaveLength(established);
  });

  it("does not grow pirate garrisons (growth is Overmind-only)", () => {
    const galaxy = makeGalaxy();
    galaxy.addPirateSystem("sys_a");

    const sim = new NpcSimulator();
    sim.attachCampaignPeakPower(() => 1);
    galaxy.gameDays = 1;
    sim.tick(galaxy, new SeededRNG("pirate_tick_0"));
    const established = garrisonShips(galaxy, "sys_a").length;
    expect(established).toBeGreaterThanOrEqual(5);

    for (const day of GROWTH_DAYS) {
      galaxy.gameDays = day;
      sim.tick(galaxy, new SeededRNG(`pirate_tick_${day}`));
    }
    expect(garrisonShips(galaxy, "sys_a")).toHaveLength(established);
  });

  it("does not resurrect a cleared garrison one ship at a time", () => {
    const galaxy = makeGalaxy();
    galaxy.addOvermindSystem("sys_a");

    // Establish directly (no tick) so the galaxy holds ONLY garrison ships —
    // a wandering pirate co-located in sys_a would otherwise re-trigger the
    // ordinary fillGarrison top-up path this test is not about.
    const sim = new NpcSimulator();
    sim.attachCampaignPeakPower(() => 1);
    sim.ensureGarrison(galaxy, new SeededRNG("cleared_seed"));
    expect(garrisonShips(galaxy, "sys_a").length).toBeGreaterThanOrEqual(5);

    // Player/rangers wipe the standing garrison.
    for (const ship of galaxy.npcShips) {
      ship.state = NpcState.DEAD;
    }

    // A growth pass must leave the cleared system empty (the
    // liberation-detection countdown owns it now), exactly like fillGarrison.
    (
      sim as unknown as {
        growGarrisons(g: Galaxy, r: SeededRNG): void;
      }
    ).growGarrisons(galaxy, new SeededRNG("cleared_growth"));
    expect(garrisonShips(galaxy, "sys_a")).toHaveLength(0);
  });
});
