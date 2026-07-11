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

  it("wins when the core is broken on a GENUINELY ENGAGED arc", () => {
    const galaxy = makeGalaxy(12, ["s5", "s6"], "s5");
    // Engage the arc: establish the clock then advance past grace so it actually
    // spreads at least once (lastSpreadDay >= 0). Only an engaged arc can be won —
    // clearing a never-engaged dormant front is a spurious Victory (see below).
    let state = advanceOvermind(
      initialOvermindSpreadState(),
      galaxy,
      0,
      FAST,
    ).state;
    const spread = advanceOvermind(state, galaxy, 3, FAST); // past grace, on cadence
    for (const id of spread.captured) galaxy.overmindSystems.push(id);
    state = spread.state;
    expect(state.lastSpreadDay).toBeGreaterThanOrEqual(0); // engaged
    expect(state.status).toBe("advancing");

    // Player destroys the core: it leaves Overmind control. Advance on a
    // non-cadence day so no re-capture masks the broken core. `playerLiberations`
    // records the genuine player participation (F10) — without it an
    // otherwise-identical NPC-only clear must not win (see below).
    galaxy.overmindSystems = galaxy.overmindSystems.filter((id) => id !== "s5");
    state = { ...state, playerLiberations: 1 };
    const r = advanceOvermind(state, galaxy, 4, FAST);
    expect(r.state.status).toBe("won");
  });

  it("wins when a GENUINELY ENGAGED Overmind is eradicated entirely (player participated)", () => {
    const galaxy = makeGalaxy(12, ["s5", "s6"]);
    // Engage the arc (spread at least once past grace) before it can be won.
    let state = advanceOvermind(
      initialOvermindSpreadState(),
      galaxy,
      0,
      FAST,
    ).state;
    const spread = advanceOvermind(state, galaxy, 3, FAST);
    for (const id of spread.captured) galaxy.overmindSystems.push(id);
    state = spread.state;
    expect(state.lastSpreadDay).toBeGreaterThanOrEqual(0); // engaged
    expect(state.peakThreat).toBeGreaterThan(0);

    // Player clears every Overmind system (recorded via playerLiberations,
    // exactly what `Galaxy.tryLiberate(id, "player")` increments — F10).
    // Advance on a non-cadence day.
    galaxy.overmindSystems = [];
    state = { ...state, playerLiberations: 1 };
    const r = advanceOvermind(state, galaxy, 4, FAST);
    expect(r.state.status).toBe("won");
  });

  it("does NOT win when an engaged front is eradicated/core-broken by NPCs alone, with zero player participation (F10 — no unearned victory)", () => {
    // Same engaged-arc setup as the two tests above, but `playerLiberations`
    // stays 0 — an NPC-only equilibrium/auto-liberation cleared the front
    // (a live-session finding: the player was rank 0, never battle-ready).
    const coreGalaxy = makeGalaxy(12, ["s5", "s6"], "s5");
    let coreState = advanceOvermind(
      initialOvermindSpreadState(),
      coreGalaxy,
      0,
      FAST,
    ).state;
    const coreSpread = advanceOvermind(coreState, coreGalaxy, 3, FAST);
    for (const id of coreSpread.captured) coreGalaxy.overmindSystems.push(id);
    coreState = coreSpread.state;
    expect(coreState.lastSpreadDay).toBeGreaterThanOrEqual(0); // engaged
    expect(coreState.playerLiberations ?? 0).toBe(0); // never touched by the player

    coreGalaxy.overmindSystems = coreGalaxy.overmindSystems.filter(
      (id) => id !== "s5",
    );
    const coreResult = advanceOvermind(coreState, coreGalaxy, 4, FAST);
    expect(coreResult.state.status).not.toBe("won");

    const eradGalaxy = makeGalaxy(12, ["s5", "s6"]);
    let eradState = advanceOvermind(
      initialOvermindSpreadState(),
      eradGalaxy,
      0,
      FAST,
    ).state;
    const eradSpread = advanceOvermind(eradState, eradGalaxy, 3, FAST);
    for (const id of eradSpread.captured) eradGalaxy.overmindSystems.push(id);
    eradState = eradSpread.state;
    expect(eradState.playerLiberations ?? 0).toBe(0);

    eradGalaxy.overmindSystems = [];
    const eradResult = advanceOvermind(eradState, eradGalaxy, 4, FAST);
    expect(eradResult.state.status).not.toBe("won");
  });

  it("does NOT false-win a galaxy that never had any Overmind presence", () => {
    const galaxy = makeGalaxy(12, [], "s5"); // core named but never controlled, empty front
    const r = advanceOvermind(initialOvermindSpreadState(), galaxy, 5, FAST);
    expect(r.state.status).not.toBe("won");
  });

  it("does NOT win when the never-engaged dormant front is cleared (spurious Victory regression)", () => {
    // The bug: peakThreat captures the initial share (>0) on the first EOD even
    // while still dormant in the grace window, so clearing the two isolated
    // starting systems — an early player skirmish, an autonomous NPC convoy
    // liberation, or a quest liberation — fired a spurious "ПОБЕДА!" before the
    // arc ever became a real threat. An UN-ENGAGED arc (lastSpreadDay < 0) being
    // cleared must NOT win.
    const galaxy = makeGalaxy(30, ["s28", "s29"], "s28");
    let state = advanceOvermind(
      initialOvermindSpreadState(),
      galaxy,
      0,
      FAST,
    ).state;
    expect(state.status).toBe("dormant");
    expect(state.peakThreat).toBeGreaterThan(0); // the false "real start" signal
    expect(state.lastSpreadDay).toBeLessThan(0); // never engaged

    // The whole front (core included) is liberated while still dormant.
    galaxy.overmindSystems = [];
    // On the next day (still in grace) and even later (past grace, but the empty
    // front can never spread, so it stays un-engaged) the arc must not win.
    state = advanceOvermind(state, galaxy, 1, FAST).state;
    expect(state.status).not.toBe("won");
    state = advanceOvermind(state, galaxy, 5, FAST).state;
    expect(state.status).not.toBe("won");
  });

  it("prefers the frontier candidate nearest the most recently captured system", () => {
    // Hub blob: "o" (captured first) fans out to nine faction leaves f1..f9.
    // The most recent capture "r" hangs off the hub with its own leaf "near".
    // Frontier = {f1..f9, near}; from "r" the distances are near=1, f*=2 — the
    // coherent front must grow at "near", not hash-jump to a far hub leaf.
    const leaves = Array.from({ length: 9 }, (_, i) => `f${i + 1}`);
    const galaxy: SpreadGalaxyView & { overmindSystems: string[] } = {
      id: "coherent-front", // under pure-hash ranking this id picks far leaf f3
      systems: [
        {
          id: "o",
          connections: [...leaves, "r"].map((id) => ({ toSystemId: id })),
        },
        ...leaves.map((id) => ({
          id,
          connections: [{ toSystemId: "o" }],
        })),
        {
          id: "r",
          connections: [{ toSystemId: "o" }, { toSystemId: "near" }],
        },
        { id: "near", connections: [{ toSystemId: "r" }] },
      ],
      overmindSystems: ["o", "r"], // "r" is the most recent addition
      overmindCoreSystemId: "",
    };
    const state = advanceOvermind(
      initialOvermindSpreadState(),
      galaxy,
      0,
      FAST,
    ).state;
    const r = advanceOvermind(state, galaxy, 3, FAST); // past grace, on cadence
    expect(r.captured).toEqual(["near"]);
  });

  it("proximity ranking stays deterministic by (seed, day) and skips unreachable blobs safely", () => {
    // Two disconnected Overmind blobs: a0 (older) with leaf a1, b0 (most
    // recent) with leaf b1. a1 is unreachable from b0 — it must rank after the
    // reachable b1 without throwing, and identical inputs give identical output.
    const make = (): SpreadGalaxyView & { overmindSystems: string[] } => ({
      id: "seed-islands",
      systems: [
        { id: "a0", connections: [{ toSystemId: "a1" }] },
        { id: "a1", connections: [{ toSystemId: "a0" }] },
        { id: "b0", connections: [{ toSystemId: "b1" }] },
        { id: "b1", connections: [{ toSystemId: "b0" }] },
      ],
      overmindSystems: ["a0", "b0"], // b0 is the most recent addition
      overmindCoreSystemId: "",
    });
    const g1 = make();
    const g2 = make();
    const state = advanceOvermind(
      initialOvermindSpreadState(),
      g1,
      0,
      FAST,
    ).state;
    const r1 = advanceOvermind(state, g1, 3, FAST);
    const r2 = advanceOvermind(state, g2, 3, FAST);
    expect(r1.captured).toEqual(["b1"]); // reachable neighbor of the fresh capture wins
    expect(r1.captured).toEqual(r2.captured); // deterministic by (seed, day)
  });

  it("still spreads inside the hardcoded day-constraint envelope (dayZero=1, day=7)", () => {
    // Mirrors the fixed day budget the arc tests hardcode (dayZero=1, first
    // check day=7 → graceDays ≤ 6, interval ≤ 5): with the default config the
    // proximity-ranked spread must still fire a capture by day 7.
    const galaxy = makeGalaxy(12, ["s6"]);
    let state = advanceOvermind(
      initialOvermindSpreadState(),
      galaxy,
      1,
      DEFAULT_OVERMIND_SPREAD_CONFIG,
    ).state;
    expect(state.dayZero).toBe(1);
    let captured: string[] = [];
    for (let day = 2; day <= 7; day++) {
      const r = advanceOvermind(
        state,
        galaxy,
        day,
        DEFAULT_OVERMIND_SPREAD_CONFIG,
      );
      captured = captured.concat(r.captured);
      for (const id of r.captured) galaxy.overmindSystems.push(id);
      state = r.state;
    }
    expect(captured.length).toBeGreaterThan(0);
    // Every capture is warp-adjacent to the blob as it stood (chain topology ⇒
    // coherent growth means only s5/s7 first, then their outward neighbors).
    for (const id of captured) {
      expect(["s4", "s5", "s7", "s8"]).toContain(id);
    }
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
