import { describe, it, expect } from "vitest";
import { Galaxy } from "@/domain/Galaxy";
import { StarSystem } from "@/domain/StarSystem";
import { Overmind } from "@/domain/Overmind";
import { WarpPath } from "@/domain/WarpPath";
import { NpcSimulator } from "@/systems/npc/NpcSimulator";
import { SeededRNG } from "@/utils/seededRNG";
import { StarType } from "@/types";
import type { NewsEvent } from "@/types";
import { Faction } from "@/types/faction";

/** Private NpcSimulator state driven directly, mirroring garrisonBudOff.test.ts. */
interface SimInternals {
  resolveCaptureFleets(g: Galaxy): NewsEvent[];
  recordRecentCapture(systemId: string): void;
  captureFleetIds: Set<string>;
  recentlyCaptured: string[];
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

function connect(a: StarSystem, b: StarSystem, cost = 3): void {
  a.connections.push(new WarpPath(a.id, b.id, cost));
  b.connections.push(new WarpPath(b.id, a.id, cost));
}

/**
 * sys_old (hostile) ←→ sys_f1 (friendly)   — the long-standing random front
 * sys_n   (neutral) ←→ sys_f2 (friendly)   — captured by a fleet during a test
 */
function makeGalaxy(): Galaxy {
  const sysOld = makeSystem("sys_old", "OldFront", 0);
  const sysF1 = makeSystem("sys_f1", "Staging1", 10);
  const sysN = makeSystem("sys_n", "Fresh", 30);
  const sysF2 = makeSystem("sys_f2", "Staging2", 40);
  connect(sysOld, sysF1);
  connect(sysN, sysF2);
  const galaxy = new Galaxy(
    "galaxy_recent_capture",
    [sysOld, sysF1, sysN, sysF2],
    new Overmind(),
    [],
    [],
  );
  galaxy.addOvermindSystem("sys_old");
  return galaxy;
}

/** Park a full-strength capture fleet in `systemId`, ready to seize it. */
function seedCaptureFleet(
  sim: NpcSimulator,
  galaxy: Galaxy,
  systemId: string,
  count = 3,
): void {
  for (let i = 0; i < count; i++) {
    const ship = sim.spawnOvermindInSystem(
      new SeededRNG(`cf_${systemId}_${i}`),
      `capture_test_${systemId}_${i}`,
      systemId,
    );
    galaxy.npcShips.push(ship);
    internals(sim).captureFleetIds.add(ship.id);
  }
}

describe("NpcSimulator liberation targeting of freshly-captured systems", () => {
  it("targets a fresh capture (via resolveCaptureFleets) before the random front scan", () => {
    // The queue path must ignore the RNG entirely — assert across several seeds.
    for (const seed of ["rc_a", "rc_b", "rc_c"]) {
      const galaxy = makeGalaxy();
      const sim = new NpcSimulator();
      seedCaptureFleet(sim, galaxy, "sys_n");

      const events = internals(sim).resolveCaptureFleets(galaxy);
      expect(events.some((e) => e.type === "SYSTEM_CAPTURED")).toBe(true);
      expect(galaxy.isHostileSystem("sys_n")).toBe(true);

      const campaign = sim.assembleLiberationCampaign(
        galaxy,
        new SeededRNG(seed),
      );
      expect(campaign?.targetSystemId).toBe("sys_n");
      expect(campaign?.stagingSystemId).toBe("sys_f2");
      // Selected entry is popped: the next campaign falls back to the old front.
      expect(internals(sim).recentlyCaptured).not.toContain("sys_n");
    }
  });

  it("skips a landlocked fresh capture and takes the next queued entry", () => {
    // sys_n1 (neutral) ←→ sys_n2 (neutral) ←→ sys_f (friendly): capturing both
    // leaves sys_n1 with no friendly neighbour while sys_n2 still borders sys_f.
    const sysN1 = makeSystem("sys_n1", "Deep", 0);
    const sysN2 = makeSystem("sys_n2", "Border", 10);
    const sysF = makeSystem("sys_f", "Staging", 20);
    connect(sysN1, sysN2);
    connect(sysN2, sysF);
    const galaxy = new Galaxy(
      "galaxy_landlocked",
      [sysN1, sysN2, sysF],
      new Overmind(),
      [],
      [],
    );
    const sim = new NpcSimulator();
    seedCaptureFleet(sim, galaxy, "sys_n1");
    seedCaptureFleet(sim, galaxy, "sys_n2");
    internals(sim).resolveCaptureFleets(galaxy);
    expect(internals(sim).recentlyCaptured).toEqual(["sys_n1", "sys_n2"]);

    const campaign = sim.assembleLiberationCampaign(
      galaxy,
      new SeededRNG("landlocked"),
    );
    expect(campaign?.targetSystemId).toBe("sys_n2");
    // The landlocked entry stays queued for a retry once a neighbour is freed.
    expect(internals(sim).recentlyCaptured).toContain("sys_n1");
    expect(internals(sim).recentlyCaptured).not.toContain("sys_n2");
  });

  it("falls back to the random front scan when no queued capture qualifies", () => {
    const galaxy = makeGalaxy();
    // Landlock sys_n before its capture: its only neighbour turns hostile too.
    galaxy.addOvermindSystem("sys_f2");
    const sim = new NpcSimulator();
    seedCaptureFleet(sim, galaxy, "sys_n");
    internals(sim).resolveCaptureFleets(galaxy);
    expect(internals(sim).recentlyCaptured).toEqual(["sys_n"]);

    const campaign = sim.assembleLiberationCampaign(
      galaxy,
      new SeededRNG("fallback"),
    );
    expect(campaign).not.toBeNull();
    expect(campaign?.targetSystemId).not.toBe("sys_n");
    expect(internals(sim).recentlyCaptured).toContain("sys_n");
  });

  it("drops a queued entry that is no longer hostile", () => {
    const galaxy = makeGalaxy();
    const sim = new NpcSimulator();
    seedCaptureFleet(sim, galaxy, "sys_n");
    internals(sim).resolveCaptureFleets(galaxy);
    galaxy.tryLiberate("sys_n");
    expect(galaxy.isHostileSystem("sys_n")).toBe(false);

    const campaign = sim.assembleLiberationCampaign(
      galaxy,
      new SeededRNG("liberated"),
    );
    // Only the old front remains a valid target; the stale entry is dropped.
    expect(campaign?.targetSystemId).toBe("sys_old");
    expect(internals(sim).recentlyCaptured).toEqual([]);
  });

  it("caps the recently-captured queue at 5, keeping the newest entries", () => {
    const sim = new NpcSimulator();
    for (let i = 0; i < 10; i++) {
      internals(sim).recordRecentCapture(`sys_${i}`);
    }
    expect(internals(sim).recentlyCaptured).toEqual([
      "sys_5",
      "sys_6",
      "sys_7",
      "sys_8",
      "sys_9",
    ]);
  });

  it("re-capturing a queued system moves it to the back without duplicating", () => {
    const sim = new NpcSimulator();
    internals(sim).recordRecentCapture("sys_a");
    internals(sim).recordRecentCapture("sys_b");
    internals(sim).recordRecentCapture("sys_a");
    expect(internals(sim).recentlyCaptured).toEqual(["sys_b", "sys_a"]);
  });

  it("dequeues a fresh capture whose only friendly neighbour is one-way incoming", () => {
    // ~25% of warp links are stored one-way (ensureConnectivity bridges): the
    // staging scan must treat the graph as undirected, or a fresh capture
    // behind a one-way edge silently never gets its priority retake.
    const sysN = makeSystem("sys_n", "Fresh", 0);
    const sysF2 = makeSystem("sys_f2", "Staging2", 10);
    sysF2.connections.push(new WarpPath("sys_f2", "sys_n", 3)); // one-way f2 → n
    const galaxy = new Galaxy(
      "galaxy_oneway_staging",
      [sysN, sysF2],
      new Overmind(),
      [],
      [],
    );
    galaxy.addOvermindSystem("sys_n");
    const sim = new NpcSimulator();
    internals(sim).recordRecentCapture("sys_n");

    const campaign = sim.assembleLiberationCampaign(
      galaxy,
      new SeededRNG("oneway_staging"),
    );
    expect(campaign?.targetSystemId).toBe("sys_n");
    expect(campaign?.stagingSystemId).toBe("sys_f2");
  });
});
