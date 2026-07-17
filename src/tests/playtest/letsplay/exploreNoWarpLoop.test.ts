import { describe, it, expect, vi } from "vitest";
import { SceneType, ResourceType, StationType } from "@/types";
import {
  legalActionsForScene,
  type Observation,
  type PlayerSnapshot,
  type SystemSnapshot,
} from "./observe";
import { createMemory, type AgentMemory } from "./AgentMemory";
import {
  decideWithMemory,
  MAX_CONSECUTIVE_WARPS_WITHOUT_LAND,
  MemoryHeuristicPolicy,
} from "./MemoryHeuristicPolicy";
import type { PriceRecord } from "./AgentMemory";
import { RealEngineHarness, type RecordedError } from "../realEngineHarness";
import { PlayerAgent } from "./PlayerAgent";

/**
 * Task 2 of the smart-autopilot plan: break the warp-forever loop.
 *
 * Root cause (see docs/plans/20260701-smart-autopilot-player.md): `warp
 * "find-sell-destination"` outranked `land "earn"` in the base ladder, so once
 * the agent held cargo with only one planet's prices known, it warped
 * system-to-system forever without ever landing on a second planet to learn
 * its prices — a self-reinforcing loop that only ended in fuel-death (fixed
 * separately by Task 1's fuel-survival tier, which now just makes it refuel
 * mid-loop instead of dying). These tests pin the fix: landing on an
 * unvisited in-system planet outranks the blind cross-system warp, and an
 * anti-consecutive-warp cadence stops the ladder from ever warping more than
 * {@link MAX_CONSECUTIVE_WARPS_WITHOUT_LAND} times in a row without a landing.
 */
vi.mock("pixi.js", async () => (await import("../pixiStub")).makePixiStub());

const M = ResourceType.METALS;

function playerFixture(over: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
  return {
    credits: 1000,
    hull: 100,
    maxHull: 100,
    hullFraction: 1,
    fuel: 50,
    maxFuel: 50,
    fuelFraction: 1,
    cargo: [],
    cargoUsed: 0,
    cargoCapacity: 20,
    systemId: "sysA",
    position: null,
    ...over,
  };
}

interface ObsOpts {
  scene?: SceneType;
  player?: Partial<PlayerSnapshot>;
  planets?: { id: string; name: string; availableQuests: number }[];
  stations?: { id: string; name: string; type: StationType }[];
  connections?: number;
}

/** Mirrors the fixture builder in MemoryHeuristicPolicy.test.ts (kept local to avoid touching that file). */
function obs(opts: ObsOpts = {}): Observation {
  const scene = opts.scene ?? SceneType.SPACE_FLIGHT;
  const planets = opts.planets ?? [];
  const stations = opts.stations ?? [];
  const connections = opts.connections ?? 0;

  const system: SystemSnapshot = {
    id: "sysA",
    name: "A",
    planets,
    stations,
    connections,
  };

  const legalActions = legalActionsForScene(scene, {
    hasPlayer: true,
    planetCount: planets.length,
    stationCount: stations.length,
    hostileCount: 0,
    connectionCount: connections,
    availableQuestCount: 0,
  });

  return {
    scene,
    hasPlayer: true,
    player: playerFixture(opts.player),
    system,
    currentPlanet: null,
    npcs: [],
    hostiles: [],
    quests: [],
    legalActions,
  };
}

const rec = (buy: number, sell: number): PriceRecord => ({
  buy,
  sell,
  seenAt: 1,
});

describe("decideWithMemory — land-before-warp economy tier (pure)", () => {
  it("holding cargo with an unvisited in-system planet ⇒ lands there instead of blind-warping", () => {
    const mem: AgentMemory = createMemory();
    // Bought elsewhere (no priceBook entry at all — nothing to arbitrage yet).
    mem.inventoryLots = [{ good: M, qty: 5, buyPrice: 100 }];
    const here = obs({
      planets: [{ id: "Q", name: "Q", availableQuests: 0 }],
      connections: 1,
    });

    const action = decideWithMemory(here, mem);

    expect(action.kind).toBe("land");
    expect(action.reason).toContain("discover-prices");
    expect(action.targetId).toBe("Q");
  });

  it("holding cargo with the in-system planet already visited ⇒ falls through to the cross-system warp", () => {
    const mem: AgentMemory = createMemory();
    mem.inventoryLots = [{ good: M, qty: 5, buyPrice: 100 }];
    mem.priceBook.set("Q", new Map([[M, rec(90, 70)]])); // already visited, no margin
    const here = obs({
      planets: [{ id: "Q", name: "Q", availableQuests: 0 }],
      connections: 1,
    });

    const action = decideWithMemory(here, mem);

    expect(action.kind).toBe("warp");
    expect(action.reason).toContain("find-sell-destination");
  });

  it("go-sell (in-system remembered margin) still outranks the discover-prices loop-breaker", () => {
    const mem: AgentMemory = createMemory();
    mem.inventoryLots = [{ good: M, qty: 5, buyPrice: 100 }];
    mem.priceBook.set("A", new Map([[M, rec(100, 80)]]));
    mem.priceBook.set("B", new Map([[M, rec(200, 160)]])); // sells here for profit
    const here = obs({
      planets: [
        { id: "B", name: "B", availableQuests: 0 },
        { id: "Q", name: "Q", availableQuests: 0 }, // unvisited, would otherwise win
      ],
      connections: 1,
    });

    const action = decideWithMemory(here, mem);

    expect(action.kind).toBe("land");
    expect(action.reason).toContain("go-sell");
    expect(action.targetId).toBe("B");
  });
});

describe("decideWithMemory — anti-consecutive-warp cadence (pure)", () => {
  it("trips once the tally hits the cap, forcing a non-warp action", () => {
    const mem: AgentMemory = createMemory();
    mem.priceBook.set("A", new Map([[M, rec(100, 80)]]));
    mem.priceBook.set("B", new Map([[M, rec(200, 160)]]));
    mem.inventoryLots = [{ good: M, qty: 5, buyPrice: 100 }];
    mem.consecutiveWarpsWithoutLanding = MAX_CONSECUTIVE_WARPS_WITHOUT_LAND;
    // No planets here (mirrors the existing "warps to find a sell destination"
    // fixture) so the only way to satisfy holdingForOtherSystem is a warp.
    const here = obs({ connections: 2 });

    const action = decideWithMemory(here, mem);

    expect(action.kind).not.toBe("warp");
  });

  it("below the cap, the same state still warps as before (no over-triggering)", () => {
    const mem: AgentMemory = createMemory();
    mem.priceBook.set("A", new Map([[M, rec(100, 80)]]));
    mem.priceBook.set("B", new Map([[M, rec(200, 160)]]));
    mem.inventoryLots = [{ good: M, qty: 5, buyPrice: 100 }];
    mem.consecutiveWarpsWithoutLanding = MAX_CONSECUTIVE_WARPS_WITHOUT_LAND - 1;
    const here = obs({ connections: 2 });

    const action = decideWithMemory(here, mem);

    expect(action.kind).toBe("warp");
  });
});

/** Render the harness error sink as a readable assertion hint. */
function formatRecorded(errors: RecordedError[]): string {
  return errors.map((e) => `[${e.source}] ${e.message}`).join("\n");
}

describe("PlayerAgent — real-engine no warp-forever loop (Task 2)", () => {
  it("plays a full session that lands on ≥2 distinct planets and never strings more than the cadence cap of consecutive warps", async () => {
    const harness = await RealEngineHarness.boot({ seed: "LETSPLAY_EXPLORE" });
    try {
      await harness.newGame();
      const agent = new PlayerAgent(harness, new MemoryHeuristicPolicy());
      const res = await agent.run(150);

      expect(res.errors, formatRecorded(res.errors)).toEqual([]);

      // The loop-breaker's payoff: the agent actually landed on more than one
      // planet's market rather than warping blind forever.
      expect(agent.belief.priceBook.size).toBeGreaterThanOrEqual(2);

      // The cadence's payoff: no run of consecutive system-to-system hops
      // longer than the cap ever occurs without a landing in between. Each
      // real hop is requested exactly once from SPACE_FLIGHT (the applier's
      // two-step warp then re-decides "warp" again from STAR_MAP to execute
      // the jump it just requested) — filtering to that scene counts hops,
      // not the doubled raw action count.
      //
      // A flee-motivated hop (kind "flee", or a "warp" whose reason is a
      // `mem:flee-*` escape jump) also resets the streak, same as landing:
      // this cap targets the *blind economic* warp-forever loop (Task 2's own
      // bug — no in-system planet ever visited between hops), not legitimate
      // back-to-back danger-avoidance. The round-budget hardening pass
      // (win-rate-100pct plan) made an ambushed ship correctly continue
      // fleeing instead of getting hijacked into the combat auto-orbit
      // (`CombatPursuitController.tickAggressor`'s ambush-preservation fix) —
      // fleeing successfully from one hostile system straight into fleeing
      // the Overmind front again (verified live: seed LETSPLAY_EXPLORE,
      // steps 109/111 — `mem:flee-outmatched` then `mem:flee-overmind-front`)
      // is the intended, safer outcome, not the bug this cadence cap exists
      // to catch.
      let streak = 0;
      let longestStreak = 0;
      for (const step of res.steps) {
        if (
          step.action.kind === "land" ||
          step.action.kind === "flee" ||
          step.action.reason?.startsWith("mem:flee")
        ) {
          streak = 0;
        } else if (
          step.action.kind === "warp" &&
          step.scene === SceneType.SPACE_FLIGHT
        ) {
          streak += 1;
          longestStreak = Math.max(longestStreak, streak);
        }
      }
      expect(longestStreak).toBeLessThanOrEqual(
        MAX_CONSECUTIVE_WARPS_WITHOUT_LAND,
      );
    } finally {
      harness.dispose();
    }
  });
});
