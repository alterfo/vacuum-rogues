import { describe, it, expect } from "vitest";
import { Galaxy } from "@/domain/Galaxy";
import { StarSystem } from "@/domain/StarSystem";
import { Overmind } from "@/domain/Overmind";
import { WarpPath } from "@/domain/WarpPath";
import { NpcSimulator, npcsPresentInSystem } from "@/systems/npc/NpcSimulator";
import { SeededRNG } from "@/utils/seededRNG";
import { StarType, NpcState } from "@/types";
import { Faction } from "@/types/faction";
import { OVERMIND_GARRISON_POWER_MAX_DISCOUNT } from "@/config/balance";

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

function garrisonShips(galaxy: Galaxy, systemId: string) {
  return npcsPresentInSystem(galaxy, systemId).filter((n) =>
    n.id.startsWith("garrison_"),
  );
}

interface GarrisonInternals {
  growGarrisons(g: Galaxy, r: SeededRNG): void;
  garrisonBaseline: Map<string, number>;
  captureFleetIds: Set<string>;
}

function garrisonOf(sim: NpcSimulator): GarrisonInternals {
  return (sim as unknown as { garrison: GarrisonInternals }).garrison;
}

const GROWTH_DAYS = [10, 20, 40, 70, 80, 110];

describe("NpcSimulator garrison growth (Overmind organic expansion)", () => {
  it("records the baseline garrison size when a garrison is first established", () => {
    const galaxy = makeGalaxy();
    galaxy.addOvermindSystem("sys_a");

    const sim = new NpcSimulator();
    sim.attachCampaignPeakPower(() => 1);
    sim.ensureGarrison(galaxy, new SeededRNG("growth_baseline_seed"));

    const established = garrisonShips(galaxy, "sys_a").length;
    expect(established).toBeGreaterThanOrEqual(5);
    const baseline = garrisonOf(sim).garrisonBaseline.get("sys_a");
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

    const sim = new NpcSimulator();
    sim.attachCampaignPeakPower(() => 1);
    sim.ensureGarrison(galaxy, new SeededRNG("cap_seed"));
    const baseline = garrisonShips(galaxy, "sys_a").length;
    const cap = Math.round(baseline * 1.5);
    const garrisonInternals = garrisonOf(sim);
    const grow = garrisonInternals.growGarrisons.bind(garrisonInternals);

    for (let pass = 1; pass <= cap - baseline; pass++) {
      grow(galaxy, new SeededRNG(`cap_grow_${pass}`));
      expect(garrisonShips(galaxy, "sys_a")).toHaveLength(baseline + pass);
    }
    expect(garrisonShips(galaxy, "sys_a")).toHaveLength(cap);
  });

  it("does not grow while the campaign ratchet is below the adaptive activation", () => {
    const galaxy = makeGalaxy();
    galaxy.addOvermindSystem("sys_a");

    const sim = new NpcSimulator();
    sim.ensureGarrison(galaxy, new SeededRNG("weak_seed"));
    const established = garrisonShips(galaxy, "sys_a").length;

    const garrisonInternals = garrisonOf(sim);
    const grow = garrisonInternals.growGarrisons.bind(garrisonInternals);
    grow(galaxy, new SeededRNG("weak_grow_1"));
    grow(galaxy, new SeededRNG("weak_grow_2"));
    expect(garrisonShips(galaxy, "sys_a")).toHaveLength(established);

    sim.attachCampaignPeakPower(() => 0.49);
    grow(galaxy, new SeededRNG("weak_grow_3"));
    expect(garrisonShips(galaxy, "sys_a")).toHaveLength(established);
  });

  it("defers growth and bud-off for the player's current system", () => {
    const galaxy = makeGalaxy();
    galaxy.addOvermindSystem("sys_a");

    const sim = new NpcSimulator();
    sim.attachCampaignPeakPower(() => 1);
    galaxy.gameDays = 1;
    sim.tick(galaxy, new SeededRNG("skip_tick_0"), "sys_a");
    const established = garrisonShips(galaxy, "sys_a").length;

    galaxy.gameDays = 10;
    sim.tick(galaxy, new SeededRNG("skip_tick_1"), "sys_a");
    expect(garrisonShips(galaxy, "sys_a")).toHaveLength(established);

    galaxy.gameDays = 20;
    sim.tick(galaxy, new SeededRNG("skip_tick_2"), "sys_b");
    expect(garrisonShips(galaxy, "sys_a")).toHaveLength(established + 1);
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

  it("clamps a reload-re-recorded baseline to the scaled max (no cross-session ratchet)", () => {
    const galaxy = makeGalaxy();
    galaxy.addOvermindSystem("sys_a");

    const seeder = new NpcSimulator();
    for (let i = 0; i < 15; i++) {
      const ship = seeder.spawnOvermindInSystem(
        new SeededRNG(`ratchet_${i}`),
        `garrison_ov_sys_a_saved_${i}`,
        "sys_a",
      );
      galaxy.npcShips.push(ship);
    }

    const sim = new NpcSimulator();
    sim.ensureGarrison(galaxy, new SeededRNG("ratchet_est"));
    const baseline = garrisonOf(sim).garrisonBaseline.get("sys_a");
    expect(baseline).toBe(10 - OVERMIND_GARRISON_POWER_MAX_DISCOUNT);
  });

  it("ignores wandering visitors when checking the growth cap (members only)", () => {
    const galaxy = makeGalaxy();
    galaxy.addOvermindSystem("sys_a");

    const sim = new NpcSimulator();
    sim.attachCampaignPeakPower(() => 1);
    sim.ensureGarrison(galaxy, new SeededRNG("visitor_seed"));
    const baseline = garrisonShips(galaxy, "sys_a").length;
    const cap = Math.round(baseline * 1.5);

    for (let i = 0; i < cap; i++) {
      const visitor = sim.spawnOvermindInSystem(
        new SeededRNG(`vis_${i}`),
        `wanderer_${i}`,
        "sys_a",
      );
      galaxy.npcShips.push(visitor);
    }

    const garrisonInternals = garrisonOf(sim);
    galaxy.gameDays = 1;
    garrisonInternals.growGarrisons(galaxy, new SeededRNG("visitor_grow"));

    expect(garrisonInternals.captureFleetIds.size).toBe(0);
    expect(garrisonShips(galaxy, "sys_a")).toHaveLength(baseline + 1);
  });

  it("does not resurrect a cleared garrison one ship at a time", () => {
    const galaxy = makeGalaxy();
    galaxy.addOvermindSystem("sys_a");

    const sim = new NpcSimulator();
    sim.attachCampaignPeakPower(() => 1);
    sim.ensureGarrison(galaxy, new SeededRNG("cleared_seed"));
    expect(garrisonShips(galaxy, "sys_a").length).toBeGreaterThanOrEqual(5);

    for (const ship of galaxy.npcShips) {
      ship.state = NpcState.DEAD;
    }

    garrisonOf(sim).growGarrisons(galaxy, new SeededRNG("cleared_growth"));
    expect(garrisonShips(galaxy, "sys_a")).toHaveLength(0);
  });
});
