import { describe, it, expect, vi } from "vitest";
import { SceneType, ResourceType, FactionType, StationType } from "@/types";
import {
  legalActionsForScene,
  observe,
  type Observation,
  type PlayerSnapshot,
  type SystemSnapshot,
  type NpcSnapshot,
} from "./observe";
import { createMemory, type AgentMemory } from "./AgentMemory";
import {
  decideWithMemory,
  MemoryHeuristicPolicy,
  MAX_STAR_MAP_WARP_STALLS,
  REFUEL_THRESHOLD,
} from "./MemoryHeuristicPolicy";
import { RealEngineHarness, type RecordedError } from "../realEngineHarness";
import { PlayerAgent } from "./PlayerAgent";
import { createLiveSceneController } from "./installAutopilotHook";
import { applyLiveAction } from "./LiveApplier";

/**
 * Task 1 of the smart-autopilot plan: the fuel-survival tier.
 *
 * Root cause (see docs/plans/20260701-smart-autopilot-player.md): every `warp`
 * burns fuel, only `land` refuels, and — before this fix — a `warp` candidate
 * could out-rank an available in-system `land` regardless of how little fuel
 * was left, so the goal-less agent could warp itself into a fuel-dead stall.
 * These tests pin the fix: below {@link REFUEL_THRESHOLD} the agent always
 * prefers landing to refuel and never emits `warp` at all.
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
  hostiles?: NpcSnapshot[];
}

/** Mirrors the fixture builder in MemoryHeuristicPolicy.test.ts (kept local to avoid touching that file). */
function obs(opts: ObsOpts = {}): Observation {
  const scene = opts.scene ?? SceneType.SPACE_FLIGHT;
  const planets = opts.planets ?? [];
  const stations = opts.stations ?? [];
  const connections = opts.connections ?? 0;
  const hostiles = opts.hostiles ?? [];

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
    hostileCount: hostiles.length,
    connectionCount: connections,
    availableQuestCount: 0,
  });

  return {
    scene,
    hasPlayer: true,
    player: playerFixture(opts.player),
    system,
    currentPlanet: null,
    npcs: hostiles,
    hostiles,
    quests: [],
    legalActions,
  };
}

const CRITICAL_FUEL = REFUEL_THRESHOLD - 0.01;

describe("decideWithMemory — fuel survival tier (pure)", () => {
  it("fuel-critical + holding unsellable cargo ⇒ lands to refuel instead of warping to find a buyer", () => {
    const mem: AgentMemory = createMemory();
    // Holding cargo with no known sell planet — pre-fix this alone made the
    // ladder push `warp "find-sell-destination"` ahead of the in-system `land`.
    mem.inventoryLots = [{ good: M, qty: 5, buyPrice: 100 }];
    const here = obs({
      player: { fuelFraction: CRITICAL_FUEL },
      planets: [{ id: "P", name: "P", availableQuests: 0 }],
      connections: 1,
    });

    const action = decideWithMemory(here, mem);

    expect(action.kind).toBe("land");
    expect(action.reason).toContain("refuel-critical");
    expect(action.targetId).toBe("P");
  });

  it("fuel-critical with an empty hold still routes to land, not the explore warp", () => {
    const here = obs({
      player: { fuelFraction: CRITICAL_FUEL },
      planets: [{ id: "P", name: "P", availableQuests: 0 }],
      connections: 1,
    });

    const action = decideWithMemory(here, createMemory());

    expect(action.kind).toBe("land");
    expect(action.reason).toContain("refuel-critical");
  });

  it("fuel-critical + no habitable planet in system ⇒ never warps (falls back safely)", () => {
    const here = obs({
      player: { fuelFraction: CRITICAL_FUEL },
      planets: [],
      connections: 1,
    });

    const action = decideWithMemory(here, createMemory());

    expect(action.kind).not.toBe("warp");
    expect(here.legalActions).toContain(action.kind);
  });

  it("fuel-critical on the star map ⇒ never warps either", () => {
    const here = obs({
      scene: SceneType.STAR_MAP,
      player: { fuelFraction: CRITICAL_FUEL },
      connections: 2,
    });

    const action = decideWithMemory(here, createMemory());

    expect(action.kind).not.toBe("warp");
  });

  it("fuel above the threshold still explores by warp as before (no over-triggering)", () => {
    const here = obs({
      player: { fuelFraction: REFUEL_THRESHOLD + 0.2 },
      connections: 2,
    });

    const action = decideWithMemory(here, createMemory());

    expect(action.kind).toBe("warp");
  });

  it("Task 3: a stalled STAR_MAP warp (repeated no-progress folds) gives up on warp and leaves to flight", () => {
    // Fuel fraction is fine (above REFUEL_THRESHOLD) — the live engine's own
    // absolute per-target fuel gate (StarMapScene.performWarpJump) is what's
    // actually failing here, invisible to this fraction-only observation. The
    // stall counter is how the pure ladder finds out a chosen `warp` isn't
    // actually landing anywhere.
    const here = obs({
      scene: SceneType.STAR_MAP,
      player: { fuelFraction: REFUEL_THRESHOLD + 0.01 },
      connections: 2,
    });
    const mem = createMemory();
    mem.starMapStallFolds = MAX_STAR_MAP_WARP_STALLS;

    const action = decideWithMemory(here, mem);

    expect(action.kind).toBe("move");
    expect(action.reason).toContain("back");
  });

  it("Task 3: below the stall threshold, warp is still attempted as before", () => {
    const here = obs({
      scene: SceneType.STAR_MAP,
      player: { fuelFraction: REFUEL_THRESHOLD + 0.01 },
      connections: 2,
    });
    const mem = createMemory();
    mem.starMapStallFolds = MAX_STAR_MAP_WARP_STALLS - 1;

    const action = decideWithMemory(here, mem);

    expect(action.kind).toBe("warp");
  });

  it("a present hostile still wins over the fuel-critical refuel routing", () => {
    const hostile: NpcSnapshot = {
      id: "raider-1",
      name: "raider-1",
      faction: FactionType.SYNDICATE,
      hostile: true,
      hullHP: 80,
    };
    const here = obs({
      player: { fuelFraction: CRITICAL_FUEL, hullFraction: 0.9 },
      planets: [{ id: "P", name: "P", availableQuests: 0 }],
      hostiles: [hostile],
    });

    const action = decideWithMemory(here, createMemory());

    expect(action.kind).toBe("attack");
  });
});

/** Render the harness error sink as a readable assertion hint. */
function formatRecorded(errors: RecordedError[]): string {
  return errors.map((e) => `[${e.source}] ${e.message}`).join("\n");
}

describe("PlayerAgent — real-engine fuel survival (Task 1)", () => {
  it("never warps while fuel is critical, and actually refuels before the tank empties", async () => {
    const harness = await RealEngineHarness.boot({ seed: "LETSPLAY_FUEL" });
    try {
      await harness.newGame();
      const ship = harness.engine.player!.ship;
      const maxFuel = ship.maxEnergy;
      // Force the tank to just under the survival threshold — the scenario the
      // bug report describes as "warps until fuel hits 0".
      ship.energy = Math.max(
        1,
        Math.floor(maxFuel * (REFUEL_THRESHOLD - 0.05)),
      );

      const agent = new PlayerAgent(harness, new MemoryHeuristicPolicy());
      const res = await agent.run(40);

      expect(res.errors, formatRecorded(res.errors)).toEqual([]);

      // The fix: no step ever warps while the fuel fraction it observed was
      // below the survival threshold.
      const criticalWarp = res.steps.find((s) => {
        const fuel = s.vitals?.fuel ?? maxFuel;
        return fuel / maxFuel < REFUEL_THRESHOLD && s.action.kind === "warp";
      });
      expect(criticalWarp).toBeUndefined();

      // The fix's payoff: the ship actually refuelled (landed) rather than
      // idling forever at a critical tank.
      expect(ship.energy).toBeGreaterThan(maxFuel * REFUEL_THRESHOLD);
    } finally {
      harness.dispose();
    }
  });
});

describe("Live autopilot — never idle on the star map (Task 3)", () => {
  it("escapes a STAR_MAP where the engine's absolute fuel gate silently rejects every warp", async () => {
    // Live-observed bug: `MemoryHeuristicPolicy`'s STAR_MAP tier only checks
    // `REFUEL_THRESHOLD` (a *fraction*), but the live engine
    // (`StarMapScene.performWarpJump`) gates the actual jump on an *absolute*
    // fuel cost for the specific target. A shrunk tank can satisfy the
    // fraction gate (so the ladder keeps choosing `warp`) while still being
    // short of the real per-jump cost (so `createLiveSceneController.warp()`'s
    // call into the engine silently no-ops, showing a toast the autopilot
    // can't see) — repeating forever with zero feedback, stranding the ship on
    // the map instead of returning to flight to refuel.
    const harness = await RealEngineHarness.boot({ seed: "LETSPLAY_FUEL" });
    try {
      await harness.newGame();
      const ship = harness.engine.player!.ship;
      // Fraction gate: 4/20 = 0.2, not < REFUEL_THRESHOLD (0.2) ⇒ the ladder's
      // fuelGate does NOT trip and `warp` looks fine. The engine's flat
      // connected-system warp cost is 5 — genuinely unaffordable at 4.
      ship.maxEnergy = 20;
      ship.energy = 4;
      await harness.goTo(SceneType.STAR_MAP);

      const policy = new MemoryHeuristicPolicy();
      const liveController = createLiveSceneController(harness.engine);

      let escapedStarMap = false;
      for (let i = 0; i < MAX_STAR_MAP_WARP_STALLS + 5; i++) {
        const here = observe(harness.engine);
        const action = policy.decide(here);
        await applyLiveAction(action, here, liveController);
        if (observe(harness.engine).scene !== SceneType.STAR_MAP) {
          escapedStarMap = true;
          break;
        }
      }

      expect(escapedStarMap).toBe(true);
      expect(harness.errors()).toEqual([]);
    } finally {
      harness.dispose();
    }
  });
});
