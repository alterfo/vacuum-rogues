import { describe, it, expect } from "vitest";
import { Galaxy } from "@/domain/Galaxy";
import { StarSystem } from "@/domain/StarSystem";
import { Overmind } from "@/domain/Overmind";
import { WarpPath } from "@/domain/WarpPath";
import { NpcSimulator, npcsPresentInSystem } from "@/systems/npc/NpcSimulator";
import { SeededRNG } from "@/utils/seededRNG";
import { StarType, NpcState } from "@/types";
import { Faction } from "@/types/faction";

/** Private NpcSimulator state driven directly, mirroring garrisonGrowth.test.ts. */
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

/** sys_a (will be Overmind) ←→ sys_b (neutral), warp cost 3. */
function makeGalaxy(): Galaxy {
  const sysA = makeSystem("sys_a", "Alpha", 0);
  const sysB = makeSystem("sys_b", "Beta", 10);
  sysA.connections.push(new WarpPath("sys_a", "sys_b", 3));
  sysB.connections.push(new WarpPath("sys_b", "sys_a", 3));
  return new Galaxy("galaxy_bud_off", [sysA, sysB], new Overmind(), [], []);
}

/** Live standing-garrison ships (garrison_ prefixed) present in a system. */
function garrisonShips(galaxy: Galaxy, systemId: string) {
  return npcsPresentInSystem(galaxy, systemId).filter((n) =>
    n.id.startsWith("garrison_"),
  );
}

/**
 * Establish sys_a's garrison and drive growth passes until it sits exactly at
 * the bud-off cap round(baseline × 1.5). gameDays is bumped per pass so each
 * growth ship gets a unique id. Returns the recorded baseline and the cap.
 */
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

/**
 * Hand-build a garrison of `present` ships with a recorded `baseline` in
 * `systemId` — lets a test pin exact bud-off arithmetic without the random
 * [GARRISON_MIN, GARRISON_MAX] establishment draw.
 */
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

    // Crossing the threshold: the next growth pass buds off instead of growing.
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
      // capture_ prefix keeps reconcileTransientState's save/load rebuild correct.
      expect(ship.id.startsWith("capture_")).toBe(true);
      expect(ship.state).toBe(NpcState.TRAVELING);
      expect(ship.destinationSystemId).toBe("sys_b");
      expect(ship.daysToArrival).toBeGreaterThanOrEqual(1);
    }
    // A journey, not an instant flip: the target is still neutral right now.
    expect(galaxy.isHostileSystem("sys_b")).toBe(false);
    // Baseline resets to the post-bud-off size so the grow→bud cycle repeats.
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

    // No new resolution logic: normal ticks travel the fleet to sys_b and the
    // existing capture-fleet siege loop seizes it (same as captureEvent.test.ts).
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

    // The very next pass must NOT launch a second fleet — the reset baseline
    // puts the shrunken garrison back under its (new) cap, so it grows again.
    galaxy.gameDays = cap - baseline + 2;
    internals(sim).growGarrisons(galaxy, new SeededRNG("bud_once_after"));
    expect(internals(sim).captureFleetIds.size).toBe(expected);
    expect(garrisonShips(galaxy, "sys_a")).toHaveLength(cap - expected + 1);
  });

  it("floors the bud-off fleet size at 1 ship for a tiny garrison", () => {
    const galaxy = makeGalaxy();
    galaxy.addOvermindSystem("sys_a");
    const sim = new NpcSimulator();
    // baseline 1 → cap round(1.5) = 2; excess round(0.5) floors to 1 ship.
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
    // A weaker-era garrison: baseline 5 was recorded before the campaign
    // ratchet lifted the replenishment floor to 7 (power bonus 2). Its bud cap
    // round(5 × 1.5) = 8 sits inside the refill band [7, 12], so without
    // re-anchoring every growth tick would bud off a 3-ship fleet whose cost
    // the next day's free top-up refunds — a perpetual subsidized fleet
    // factory that never grows organically.
    seedGarrison(sim, galaxy, "sys_a", 5, 8);
    sim.ensureGarrison(galaxy, new SeededRNG("stale_anchor_est"));
    expect(internals(sim).garrisonBaseline.get("sys_a")).toBe(7);

    // With the repaired baseline the growth pass grows organically
    // (8 < cap round(7 × 1.5) = 11) instead of stripping defenders into a
    // subsidized capture fleet.
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

    // Nothing launched, garrison intact, baseline untouched (retry next interval).
    expect(internals(sim).captureFleetIds.size).toBe(0);
    expect(garrisonShips(galaxy, "sys_a")).toHaveLength(cap);
    expect(internals(sim).garrisonBaseline.get("sys_a")).toBe(baseline);
  });

  it("prefers a neutral neighbour over a distant unconnected neutral", () => {
    const galaxy = makeGalaxy();
    // sys_c: neutral, far away, no warp connection to sys_a.
    galaxy.systems.push(makeSystem("sys_c", "Gamma", 50));
    galaxy.addOvermindSystem("sys_a");
    const sim = new NpcSimulator();
    // baseline 4 → cap 6; seed straight at the cap so one pass buds 2 ships.
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

    // Despawned donors must not leak dwell-countdown entries: every key in the
    // map corresponds to a ship that still exists.
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
    // ~25% of warp links are one-way (ensureConnectivity bridges): sys_b links
    // to sys_a but not vice versa. The undirected scan must still see sys_b.
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
      // Unconnected hop travels by coordinate distance (30 / 10 = 3 days).
      expect(ship.daysToArrival).toBe(3);
    }
  });
});
