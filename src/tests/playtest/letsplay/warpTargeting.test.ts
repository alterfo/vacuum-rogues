import { describe, it, expect, vi } from "vitest";
import { SceneType, StationType } from "@/types";
import {
  observe,
  legalActionsForScene,
  type Observation,
  type PlayerSnapshot,
  type SystemSnapshot,
} from "./observe";
import { createMemory } from "./AgentMemory";
import {
  decideWithMemory,
  MemoryHeuristicPolicy,
} from "./MemoryHeuristicPolicy";
import { RealEngineHarness, type RecordedError } from "../realEngineHarness";
import { PlayerAgent } from "./PlayerAgent";

/**
 * Task 5 of the smart-autopilot plan: smart warp-target selection.
 *
 * Root cause (see docs/plans/20260701-smart-autopilot-player.md): `Observation`
 * only ever exposed a `connections` *count*, not the neighbors' identity, so
 * every `warp` the base ladder emitted carried no `targetId` — the actual
 * destination was picked blind, deep in the appliers (`pickWarpTarget` off raw
 * engine connections), invisible to the policy that is supposed to be the
 * single source of truth. These tests pin the fix: `Observation.system.neighbors`
 * carries each neighbor's identity + real fog-of-war (`visited`) + Overmind
 * control (`overmindHeld`), and `decideWithMemory` uses it to choose an
 * unvisited, non-Overmind `targetId` on every `warp` it emits — falling back to
 * no target (the old blind-pick path) only when the observation carries no
 * neighbor detail at all (older hand-built fixtures).
 */
vi.mock("pixi.js", async () => (await import("../pixiStub")).makePixiStub());

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
  neighbors?: SystemSnapshot["neighbors"];
  omitNeighbors?: boolean;
}

/** Mirrors the fixture builder in MemoryHeuristicPolicy.test.ts (kept local to avoid touching that file). */
function obs(opts: ObsOpts = {}): Observation {
  const scene = opts.scene ?? SceneType.STAR_MAP;
  const neighbors = opts.omitNeighbors ? undefined : (opts.neighbors ?? []);
  const connections = neighbors?.length ?? 0;

  const system: SystemSnapshot = {
    id: "sysA",
    name: "A",
    planets: [],
    stations: [] as { id: string; name: string; type: StationType }[],
    connections,
    ...(neighbors ? { neighbors } : {}),
  };

  const legalActions = legalActionsForScene(scene, {
    hasPlayer: true,
    planetCount: 0,
    stationCount: 0,
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

describe("decideWithMemory — smart warp-target selection (pure)", () => {
  it("prefers an unvisited, non-Overmind neighbor over an already-visited one", () => {
    const here = obs({
      neighbors: [
        { systemId: "B", visited: true, overmindHeld: false },
        { systemId: "C", visited: false, overmindHeld: false },
      ],
    });

    const action = decideWithMemory(here, createMemory());

    expect(action.kind).toBe("warp");
    expect(action.targetId).toBe("C");
  });

  it("avoids an Overmind-held neighbor when a clean alternative exists", () => {
    const here = obs({
      neighbors: [
        { systemId: "B", visited: false, overmindHeld: true },
        { systemId: "C", visited: false, overmindHeld: false },
      ],
    });

    const action = decideWithMemory(here, createMemory());

    expect(action.kind).toBe("warp");
    expect(action.targetId).toBe("C");
  });

  it("falls back to the Overmind-held neighbor when it's the only way out", () => {
    const here = obs({
      neighbors: [{ systemId: "B", visited: false, overmindHeld: true }],
    });

    const action = decideWithMemory(here, createMemory());

    expect(action.kind).toBe("warp");
    expect(action.targetId).toBe("B");
  });

  it("omits a targetId (blind-pick fallback preserved) when the observation carries no neighbor detail", () => {
    const here = obs({ omitNeighbors: true, neighbors: undefined });
    // Force at least one legal connection without neighbor detail.
    here.system!.connections = 1;
    here.legalActions = legalActionsForScene(SceneType.STAR_MAP, {
      hasPlayer: true,
      planetCount: 0,
      stationCount: 0,
      hostileCount: 0,
      connectionCount: 1,
      availableQuestCount: 0,
    });

    const action = decideWithMemory(here, createMemory());

    expect(action.kind).toBe("warp");
    expect(action.targetId).toBeUndefined();
  });

  it("also targets the chosen neighbor from SPACE_FLIGHT's 'explore' candidate", () => {
    const here = obs({
      scene: SceneType.SPACE_FLIGHT,
      neighbors: [
        { systemId: "B", visited: false, overmindHeld: true },
        { systemId: "C", visited: false, overmindHeld: false },
      ],
    });

    const action = decideWithMemory(here, createMemory());

    expect(action.kind).toBe("warp");
    expect(action.targetId).toBe("C");
  });
});

/** Render the harness error sink as a readable assertion hint. */
function formatRecorded(errors: RecordedError[]): string {
  return errors.map((e) => `[${e.source}] ${e.message}`).join("\n");
}

describe("observe() — real-engine neighbor projection (Task 5)", () => {
  it("marks a neighbor Overmind-held/unvisited from real galaxy state, not a blind count", async () => {
    const harness = await RealEngineHarness.boot({
      seed: "LETSPLAY_WARP_TARGETING",
      systemCount: 30,
    });
    try {
      await harness.newGame();
      const engine = harness.engine;
      const galaxy = harness.galaxy()!;
      const start = galaxy.systems.find((s) => s.connections.length >= 2)!;
      expect(start).toBeDefined();
      engine.player!.currentSystemId = start.id;
      const heldId = start.connections[0]!.toSystemId;
      const cleanId = start.connections[1]!.toSystemId;
      galaxy.addOvermindSystem(heldId);
      // Galaxy generation may pre-reveal a starting pocket around the actual
      // home system — force both probed neighbors back to "unexplored" so the
      // assertion below is about the projection logic, not incidental seed state.
      galaxy.systems.find((s) => s.id === heldId)!.explored = false;
      galaxy.systems.find((s) => s.id === cleanId)!.explored = false;

      const observation = observe(engine);

      const heldEntry = observation.system?.neighbors?.find(
        (n) => n.systemId === heldId,
      );
      const cleanEntry = observation.system?.neighbors?.find(
        (n) => n.systemId === cleanId,
      );
      expect(heldEntry?.overmindHeld).toBe(true);
      expect(heldEntry?.visited).toBe(false);
      expect(cleanEntry?.overmindHeld).toBe(false);
      expect(cleanEntry?.visited).toBe(false);
    } finally {
      harness.dispose();
    }
  });
});

describe("PlayerAgent — real-engine smart warp targeting (Task 5)", () => {
  // Rewritten under the three-year-campaign test license (Task 7), meaning
  // preserved: warp targeting picks purposeful, non-Overmind destinations —
  // never the held neighbor. The old pin required reaching ONE SPECIFIC clean
  // neighbor (`connections[1]`); the Task 7 economy tier instead settles into
  // whatever profitable trade loop it discovers first (on this seed an
  // A↔B ARTIFACTS farm through a different clean neighbor — go-restock/
  // find-sell routed warps, ~330cr/cycle), which is smarter play, not worse
  // targeting. What must stay true: the agent genuinely warps, every chosen
  // destination avoids the held system, and it never ends up inside it.
  it("warps to clean destinations only — never the Overmind-held neighbor", async () => {
    const harness = await RealEngineHarness.boot({
      seed: "LETSPLAY_WARP_TARGETING_SESSION",
      systemCount: 30,
    });
    try {
      await harness.newGame();
      const engine = harness.engine;
      const galaxy = harness.galaxy()!;
      const player = engine.player!;
      const start = galaxy.systems.find((s) => s.connections.length >= 2)!;
      expect(start).toBeDefined();
      player.currentSystemId = start.id;
      const heldId = start.connections[0]!.toSystemId;
      const cleanId = start.connections[1]!.toSystemId;
      galaxy.addOvermindSystem(heldId);
      galaxy.systems.find((s) => s.id === heldId)!.explored = false;
      galaxy.systems.find((s) => s.id === cleanId)!.explored = false;

      const agent = new PlayerAgent(harness, new MemoryHeuristicPolicy());
      const res = await agent.run(40);

      expect(res.errors, formatRecorded(res.errors)).toEqual([]);

      const warps = res.steps.filter((s) => s.action.kind === "warp");
      const warpedSomewhere = warps.some((s) => s.action.targetId != null);
      const warpedToHeld = warps.some((s) => s.action.targetId === heldId);
      expect(warpedSomewhere).toBe(true);
      expect(warpedToHeld).toBe(false);
      expect(player.currentSystemId).not.toBe(heldId);
      expect(player.currentSystemId).not.toBe(start.id); // it actually left
    } finally {
      harness.dispose();
    }
  });
});
