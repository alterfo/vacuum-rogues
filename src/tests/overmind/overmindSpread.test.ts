import { describe, it, expect } from "vitest";
import {
  advanceOvermind,
  initialOvermindSpreadState,
  DEFAULT_OVERMIND_SPREAD_CONFIG,
  type OvermindSpreadConfig,
  type SpreadGalaxyView,
} from "@/systems/overmind/overmindSpread";

/** Build a linear chain of N systems: s0–s1–...–s(N-1) (bidirectional links). */
function chain(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `s${i}`,
    connections: [
      ...(i > 0 ? [{ toSystemId: `s${i - 1}` }] : []),
      ...(i < n - 1 ? [{ toSystemId: `s${i + 1}` }] : []),
    ],
  }));
}

/** Mutable galaxy view so the test can apply captures + simulate liberation. */
function makeGalaxy(
  systemCount: number,
  overmindSystems: string[],
  coreId = "",
): SpreadGalaxyView & { overmindSystems: string[] } {
  return {
    id: "seed-galaxy",
    systems: chain(systemCount),
    overmindSystems: [...overmindSystems],
    overmindCoreSystemId: coreId,
  };
}

const FAST: OvermindSpreadConfig = {
  graceDays: 3,
  spreadIntervalDays: 3,
  capturesPerTick: 1,
  lossShare: 0.5,
  containedShare: 0.2,
  minSystemsForLoss: 8,
};

describe("advanceOvermind", () => {
  it("starts dormant during the grace period (no captures)", () => {
    const galaxy = makeGalaxy(10, ["s5"]);
    let state = initialOvermindSpreadState();

    const r0 = advanceOvermind(state, galaxy, 0, FAST);
    expect(r0.captured).toHaveLength(0);
    expect(r0.state.status).toBe("dormant");
    expect(r0.state.dayZero).toBe(0);

    // Day 2 is still inside the grace window (dayZero 0 + graceDays 3).
    state = r0.state;
    const r2 = advanceOvermind(state, galaxy, 2, FAST);
    expect(r2.captured).toHaveLength(0);
    expect(r2.state.status).toBe("dormant");
  });

  it("spreads and advances the front over days past the grace period", () => {
    const galaxy = makeGalaxy(12, ["s6"]);
    let state = advanceOvermind(
      initialOvermindSpreadState(),
      galaxy,
      0,
      FAST,
    ).state;

    const beforeCount = galaxy.overmindSystems.length;
    // Advance on spread-cadence days well past grace.
    for (const day of [3, 6, 9, 12]) {
      const r = advanceOvermind(state, galaxy, day, FAST);
      // Apply the returned captures to the live galaxy (what the EOD batch does).
      for (const id of r.captured) {
        if (!galaxy.overmindSystems.includes(id))
          galaxy.overmindSystems.push(id);
      }
      state = r.state;
    }

    expect(galaxy.overmindSystems.length).toBeGreaterThan(beforeCount);
    expect(state.status).toBe("advancing");
    expect(state.threat).toBeGreaterThan(0);
  });

  it("is deterministic by (seed, day): same inputs → same captures", () => {
    const g1 = makeGalaxy(12, ["s6"]);
    const g2 = makeGalaxy(12, ["s6"]);
    // Establish the arc clock at day 0 so day 9 is past the grace period.
    const s = advanceOvermind(initialOvermindSpreadState(), g1, 0, FAST).state;
    const a = advanceOvermind(s, g1, 9, FAST);
    const b = advanceOvermind(s, g2, 9, FAST);
    expect(a.captured).toEqual(b.captured);
    expect(a.captured.length).toBe(1);
  });

  it("respects the spread cadence (no double-capture within the interval)", () => {
    const galaxy = makeGalaxy(12, ["s6"]);
    let state = advanceOvermind(
      initialOvermindSpreadState(),
      galaxy,
      0,
      FAST,
    ).state;

    const r3 = advanceOvermind(state, galaxy, 3, FAST);
    expect(r3.captured).toHaveLength(1);
    for (const id of r3.captured) galaxy.overmindSystems.push(id);
    state = r3.state;

    // Day 4 and 5 are inside the cadence window after lastSpreadDay = 3.
    const r4 = advanceOvermind(state, galaxy, 4, FAST);
    expect(r4.captured).toHaveLength(0);
    const r5 = advanceOvermind(state, galaxy, 5, FAST);
    expect(r5.captured).toHaveLength(0);

    // Day 6 is back on cadence.
    const r6 = advanceOvermind(state, galaxy, 6, FAST);
    expect(r6.captured).toHaveLength(1);
  });

  it("captures across a ONE-WAY overmind→faction edge (undirected frontier)", () => {
    // Galaxy warp links are not all bidirectional: `ensureConnectivity` bridges
    // components with one-way edges. Here the only link out of the Overmind
    // cluster is the one-way s0(overmind) → s1(faction); s1 has NO edge back.
    // A directed faction→overmind scan would see an empty frontier and the arc
    // would stall forever; the undirected frontier must still capture s1.
    const galaxy: SpreadGalaxyView & { overmindSystems: string[] } = {
      id: "seed-oneway",
      systems: [
        { id: "s0", connections: [{ toSystemId: "s1" }] }, // overmind, one-way out
        { id: "s1", connections: [{ toSystemId: "s2" }] }, // faction, no edge back to s0
        { id: "s2", connections: [{ toSystemId: "s1" }] }, // faction
      ],
      overmindSystems: ["s0"],
      overmindCoreSystemId: "",
    };
    const state = advanceOvermind(
      initialOvermindSpreadState(),
      galaxy,
      0,
      FAST,
    ).state;
    const r = advanceOvermind(state, galaxy, 3, FAST); // past grace, on cadence
    expect(r.captured).toEqual(["s1"]);
  });

  it("the player retaking systems contains the arc", () => {
    // 10-system chain seeded so the front can peak above the contained line
    // without crossing the loss line after a capture.
    const galaxy = makeGalaxy(10, ["s2", "s3"]); // share 0.2
    let state = advanceOvermind(
      initialOvermindSpreadState(),
      galaxy,
      0,
      FAST,
    ).state;

    // Let it advance once (capture → share 0.3) so peakThreat is recorded high.
    const adv = advanceOvermind(state, galaxy, 6, FAST);
    for (const id of adv.captured) galaxy.overmindSystems.push(id);
    state = adv.state;
    expect(state.peakThreat).toBeGreaterThan(FAST.containedShare);
    expect(state.status).toBe("advancing");

    // Player liberates the front down to one system (share 0.1 ≤ contained 0.2).
    galaxy.overmindSystems = ["s5"];
    // Advance on a non-cadence day so no re-capture masks the containment.
    const contained = advanceOvermind(state, galaxy, 7, FAST);
    expect(contained.captured).toHaveLength(0);
    expect(contained.state.status).toBe("contained");
    expect(contained.state.threat).toBeCloseTo(0.1, 5);
  });

  it("fires the loss threshold when the Overmind share crosses the line", () => {
    // 12 systems, 6 already Overmind-controlled → share 0.5 == lossShare.
    const galaxy = makeGalaxy(12, ["s0", "s1", "s2", "s3", "s4", "s5"]);
    const state = advanceOvermind(
      initialOvermindSpreadState(),
      galaxy,
      0,
      FAST,
    ).state;
    expect(state.status).toBe("dormant"); // still in grace

    const r = advanceOvermind(state, galaxy, 10, FAST); // past grace
    expect(r.state.status).toBe("lost");
  });

  it("does NOT fire loss on a tiny/legacy map below minSystemsForLoss", () => {
    // 4 systems, 3 Overmind → share 0.75 but below minSystemsForLoss (8).
    const galaxy = makeGalaxy(4, ["s0", "s1", "s2"]);
    const state = advanceOvermind(
      initialOvermindSpreadState(),
      galaxy,
      0,
      FAST,
    ).state;
    const r = advanceOvermind(state, galaxy, 10, FAST);
    expect(r.state.status).not.toBe("lost");
  });

  it("wins when the core is broken (removed from Overmind control)", () => {
    const galaxy = makeGalaxy(12, ["s5", "s6"], "s5");
    const state = advanceOvermind(
      initialOvermindSpreadState(),
      galaxy,
      0,
      FAST,
    ).state;
    expect(state.status).toBe("dormant");

    // Player destroys the core: it leaves Overmind control.
    galaxy.overmindSystems = ["s6"];
    const r = advanceOvermind(state, galaxy, 5, FAST);
    expect(r.state.status).toBe("won");
  });

  it("wins when the Overmind is eradicated entirely after a real start", () => {
    const galaxy = makeGalaxy(12, ["s5", "s6"]);
    const state = advanceOvermind(
      initialOvermindSpreadState(),
      galaxy,
      0,
      FAST,
    ).state;
    expect(state.peakThreat).toBeGreaterThan(0);

    // Player clears the last Overmind system.
    galaxy.overmindSystems = [];
    const r = advanceOvermind(state, galaxy, 5, FAST);
    expect(r.state.status).toBe("won");
  });

  it("does NOT false-win a galaxy that never had any Overmind presence", () => {
    const galaxy = makeGalaxy(12, [], "s5"); // core named but never controlled, empty front
    const r = advanceOvermind(initialOvermindSpreadState(), galaxy, 5, FAST);
    expect(r.state.status).not.toBe("won");
  });

  it("terminal states are sticky (won/lost never re-open)", () => {
    const galaxy = makeGalaxy(12, []);
    // Force a won state, then keep advancing.
    const wonState = {
      ...initialOvermindSpreadState(),
      status: "won" as const,
    };
    const r = advanceOvermind(wonState, galaxy, 50, FAST);
    expect(r.state.status).toBe("won");
    expect(r.captured).toHaveLength(0);
  });

  it("handles an empty galaxy without throwing", () => {
    const galaxy: SpreadGalaxyView = {
      id: "empty",
      systems: [],
      overmindSystems: [],
      overmindCoreSystemId: "",
    };
    const r = advanceOvermind(initialOvermindSpreadState(), galaxy, 10, FAST);
    expect(r.captured).toHaveLength(0);
    expect(r.state.threat).toBe(0);
  });

  it("exposes a sensible default config", () => {
    expect(DEFAULT_OVERMIND_SPREAD_CONFIG.lossShare).toBeGreaterThan(0);
    expect(
      DEFAULT_OVERMIND_SPREAD_CONFIG.capturesPerTick,
    ).toBeGreaterThanOrEqual(1);
    expect(DEFAULT_OVERMIND_SPREAD_CONFIG.containedShare).toBeLessThan(
      DEFAULT_OVERMIND_SPREAD_CONFIG.lossShare,
    );
  });
});
