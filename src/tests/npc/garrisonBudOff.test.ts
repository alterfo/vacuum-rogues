import { describe, it, expect } from "vitest";
import { Galaxy } from "@/domain/Galaxy";
import { StarSystem } from "@/domain/StarSystem";
import { Overmind } from "@/domain/Overmind";
import { WarpPath } from "@/domain/WarpPath";
import { NpcSimulator, npcsPresentInSystem } from "@/systems/npc/NpcSimulator";
import { SeededRNG } from "@/utils/seededRNG";
import { StarType, NpcState } from "@/types";
import { Faction } from "@/types/faction";

interface SimInternals {
  growGarrisons(g: Galaxy, r: SeededRNG): void;
  garrisonBaseline: Map<string, number>;
  garrisonIds: Set<string>;
  captureFleetIds: Set<string>;
}

function internals(sim: NpcSimulator): SimInternals {
  return (sim as unknown as { garrison: SimInternals }).garrison;
}

function makeSystem(id: string, name: string, q: number): StarSystem {
  return new StarSystem(
    id,
    name,
    { q, r: 0 },
    StarType.YELLOW_DWARF,
    [],
    Faction.INDEPENDENT,
    [],
  );
}

function makeGalaxy(): Galaxy {
  const sysA = makeSystem("sys_a", "Alpha", 0);
  const sysB = makeSystem("sys_b", "Beta", 10);
  sysA.connections.push(new WarpPath("sys_a", "sys_b", 3));
  sysB.connections.push(new WarpPath("sys_b", "sys_a", 3));
  return new Galaxy("galaxy_bud_off", [sysA, sysB], new Overmind(), [], []);
}

function garrisonShips(galaxy: Galaxy, systemId: string) {
  return npcsPresentInSystem(galaxy, systemId).filter((n) =>
    n.id.startsWith("garrison_"),
  );
}

function growToCap(
  sim: NpcSimulator,
  galaxy: Galaxy,
  seed: string,
): { baseline: number; cap: number } {
  sim.attachCampaignPeakPower(() => 1);
  sim.ensureGarrison(galaxy, new SeededRNG(`${seed}_est`));
  const baseline = internals(sim).garrisonBaseline.get("sys_a");
  if (baseline === undefined) throw new Error("baseline not recorded");
  const cap = Math.round(baseline * 1.5);
  for (let pass = 1; pass <= cap - baseline; pass++) {
    galaxy.gameDays = pass;
    internals(sim).growGarrisons(galaxy, new SeededRNG(`${seed}_grow_${pass}`));
  }
  expect(garrisonShips(galaxy, "sys_a")).toHaveLength(cap);
  return { baseline, cap };
}

function seedGarrison(
  sim: NpcSimulator,
  galaxy: Galaxy,
  systemId: string,
  baseline: number,
  present: number,
): void {
  sim.attachCampaignPeakPower(() => 1);
  for (let i = 0; i < present; i++) {
    const ship = sim.spawnOvermindInSystem(
      new SeededRNG(`seeded_${systemId}_${i}`),
      `garrison_ov_${systemId}_seeded_${i}`,
      systemId,
    );
    galaxy.npcShips.push(ship);
    internals(sim).garrisonIds.add(ship.id);
  }
  internals(sim).garrisonBaseline.set(systemId, baseline);
}

describe("NpcSimulator garrison bud-off (organic Overmind expansion)", () => {
  it("peels off round(baseline × 0.5) ships as a traveling capture fleet at 1.5×", () => {
    const galaxy = makeGalaxy();
    galaxy.addOvermindSystem("sys_a");
    const sim = new NpcSimulator();
    const { baseline, cap } = growToCap(sim, galaxy, "bud_basic");
    expect(internals(sim).captureFleetIds.size).toBe(0);

    galaxy.gameDays = cap - baseline + 1;
    internals(sim).growGarrisons(galaxy, new SeededRNG("bud_basic_fire"));

    const expected = Math.max(1, Math.round(baseline * 0.5));
    expect(garrisonShips(galaxy, "sys_a")).toHaveLength(cap - expected);
    expect(internals(sim).captureFleetIds.size).toBe(expected);

    const fleet = galaxy.npcShips.filter((n) =>
      internals(sim).captureFleetIds.has(n.id),
    );
    expect(fleet).toHaveLength(expected);
    for (const ship of fleet) {
      expect(ship.id.startsWith("capture_")).toBe(true);
      expect(ship.state).toBe(NpcState.TRAVELING);
      expect(ship.destinationSystemId).toBe("sys_b");
      expect(ship.daysToArrival).toBeGreaterThanOrEqual(1);
    }
    expect(galaxy.isHostileSystem("sys_b")).toBe(false);
    expect(internals(sim).garrisonBaseline.get("sys_a")).toBe(cap - expected);
  });

  it("bud-off fleet is resolved by the existing resolveCaptureFleets siege loop", () => {
    const galaxy = makeGalaxy();
    galaxy.addOvermindSystem("sys_a");
    const sim = new NpcSimulator();
    const { baseline, cap } = growToCap(sim, galaxy, "bud_siege");
    galaxy.gameDays = cap - baseline + 1;
    internals(sim).growGarrisons(galaxy, new SeededRNG("bud_siege_fire"));
    expect(internals(sim).captureFleetIds.size).toBe(
      Math.max(1, Math.round(baseline * 0.5)),
    );

    galaxy.gameDays = 1; // off every periodic trigger's interval
    for (let i = 0; i < 20 && !galaxy.isHostileSystem("sys_b"); i++) {
      sim.tick(galaxy, new SeededRNG(`bud_siege_tick_${i}`));
    }
    expect(galaxy.isHostileSystem("sys_b")).toBe(true);
  });

  it("buds exactly once per threshold crossing, then resumes growing", () => {
    const galaxy = makeGalaxy();
    galaxy.addOvermindSystem("sys_a");
    const sim = new NpcSimulator();
    const { baseline, cap } = growToCap(sim, galaxy, "bud_once");
    galaxy.gameDays = cap - baseline + 1;
    internals(sim).growGarrisons(galaxy, new SeededRNG("bud_once_fire"));

    const expected = Math.max(1, Math.round(baseline * 0.5));
    expect(internals(sim).captureFleetIds.size).toBe(expected);

    galaxy.gameDays = cap - baseline + 2;
    internals(sim).growGarrisons(galaxy, new SeededRNG("bud_once_after"));
    expect(internals(sim).captureFleetIds.size).toBe(expected);
    expect(garrisonShips(galaxy, "sys_a")).toHaveLength(cap - expected + 1);
  });

  it("floors the bud-off fleet size at 1 ship for a tiny garrison", () => {
    const galaxy = makeGalaxy();
    galaxy.addOvermindSystem("sys_a");
    const sim = new NpcSimulator();
    seedGarrison(sim, galaxy, "sys_a", 1, 2);

    galaxy.gameDays = 1;
    internals(sim).growGarrisons(galaxy, new SeededRNG("bud_tiny"));
    expect(internals(sim).captureFleetIds.size).toBe(1);
    expect(garrisonShips(galaxy, "sys_a")).toHaveLength(1);
    expect(internals(sim).garrisonBaseline.get("sys_a")).toBe(1);
  });

  it("re-anchors a stale below-floor baseline instead of letting refills fund bud-offs", () => {
    const galaxy = makeGalaxy();
    galaxy.addOvermindSystem("sys_a");
    const sim = new NpcSimulator();
    seedGarrison(sim, galaxy, "sys_a", 5, 8);
    sim.ensureGarrison(galaxy, new SeededRNG("stale_anchor_est"));
    expect(internals(sim).garrisonBaseline.get("sys_a")).toBe(7);

    galaxy.gameDays = 1;
    internals(sim).growGarrisons(galaxy, new SeededRNG("stale_anchor_grow"));
    expect(internals(sim).captureFleetIds.size).toBe(0);
    expect(garrisonShips(galaxy, "sys_a")).toHaveLength(9);
  });

  it("skips bud-off without erroring when every system is hostile", () => {
    const galaxy = makeGalaxy();
    galaxy.addOvermindSystem("sys_a");
    galaxy.addOvermindSystem("sys_b");
    const sim = new NpcSimulator();
    const { baseline, cap } = growToCap(sim, galaxy, "bud_surrounded");

    galaxy.gameDays = cap - baseline + 1;
    expect(() =>
      internals(sim).growGarrisons(galaxy, new SeededRNG("bud_surrounded_f")),
    ).not.toThrow();

    expect(internals(sim).captureFleetIds.size).toBe(0);
    expect(garrisonShips(galaxy, "sys_a")).toHaveLength(cap);
    expect(internals(sim).garrisonBaseline.get("sys_a")).toBe(baseline);
  });

  it("prefers a neutral neighbour over a distant unconnected neutral", () => {
    const galaxy = makeGalaxy();
    galaxy.systems.push(makeSystem("sys_c", "Gamma", 50));
    galaxy.addOvermindSystem("sys_a");
    const sim = new NpcSimulator();
    seedGarrison(sim, galaxy, "sys_a", 4, 6);

    galaxy.gameDays = 1;
    internals(sim).growGarrisons(galaxy, new SeededRNG("bud_neighbour"));
    const fleet = galaxy.npcShips.filter((n) =>
      internals(sim).captureFleetIds.has(n.id),
    );
    expect(fleet).toHaveLength(2);
    for (const ship of fleet) {
      expect(ship.destinationSystemId).toBe("sys_b");
    }
  });

  it("drops bud-off donors from the arrival-dwell map (no stale entries)", () => {
    const galaxy = makeGalaxy();
    galaxy.addOvermindSystem("sys_a");
    const sim = new NpcSimulator();
    const { baseline, cap } = growToCap(sim, galaxy, "bud_dwell");

    galaxy.gameDays = cap - baseline + 1;
    internals(sim).growGarrisons(galaxy, new SeededRNG("bud_dwell_fire"));
    expect(internals(sim).captureFleetIds.size).toBeGreaterThan(0);

    const dwell = (
      sim as unknown as {
        placement: { arrivalDwellCountdown: Map<string, number> };
      }
    ).placement.arrivalDwellCountdown;
    const liveIds = new Set(galaxy.npcShips.map((n) => n.id));
    for (const id of dwell.keys()) {
      expect(liveIds.has(id)).toBe(true);
    }
  });

  it("classifies a neutral neighbour behind a one-way incoming edge as adjacent", () => {
    const sysA = makeSystem("sys_a", "Alpha", 0);
    const sysB = makeSystem("sys_b", "Beta", 10);
    sysB.connections.push(new WarpPath("sys_b", "sys_a", 3)); // one-way b → a
    const galaxy = new Galaxy(
      "galaxy_oneway_bud",
      [sysA, sysB],
      new Overmind(),
      [],
      [],
    );
    const neighbours = (
      new NpcSimulator() as unknown as {
        garrison: { undirectedNeighbors(g: Galaxy, id: string): string[] };
      }
    ).garrison.undirectedNeighbors(galaxy, "sys_a");
    expect(neighbours).toEqual(["sys_b"]);
  });

  it("falls back to a distant neutral when every neighbour is hostile", () => {
    const galaxy = makeGalaxy();
    galaxy.systems.push(makeSystem("sys_c", "Gamma", 30));
    galaxy.addOvermindSystem("sys_a");
    galaxy.addOvermindSystem("sys_b"); // the only neighbour is hostile now
    const sim = new NpcSimulator();
    seedGarrison(sim, galaxy, "sys_a", 4, 6);

    galaxy.gameDays = 1;
    internals(sim).growGarrisons(galaxy, new SeededRNG("bud_distant"));
    const fleet = galaxy.npcShips.filter((n) =>
      internals(sim).captureFleetIds.has(n.id),
    );
    expect(fleet).toHaveLength(2);
    for (const ship of fleet) {
      expect(ship.destinationSystemId).toBe("sys_c");
      expect(ship.daysToArrival).toBe(3);
    }
  });
});
