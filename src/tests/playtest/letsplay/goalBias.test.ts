/**
 * Tests for the scenario goal-bias seam (Task 4).
 *
 * Two layers, mirroring the heuristic-policy tests:
 *  - the **pure** {@link GoalBiasedPolicy.decide} is unit-tested over synthetic
 *    observations — it must prefer the goal's action when legal, stay legal in
 *    every state, never throw, and defer verbatim to the base policy when the
 *    goal has no legal preference;
 *  - a short **real-engine** run shows the bias *measurably* steers the agent: a
 *    `free-explore`-biased run takes a different action sequence than the plain
 *    heuristic over the same fresh game.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SceneType, FactionType, StationType } from "@/types";
import { RealEngineHarness } from "../realEngineHarness";
import {
  legalActionsForScene,
  type Observation,
  type NpcSnapshot,
  type PlayerSnapshot,
  type SystemSnapshot,
} from "./observe";
import { HeuristicPolicy } from "./HeuristicPolicy";
import { PlayerAgent } from "./PlayerAgent";
import {
  GoalBiasedPolicy,
  SCENARIO_GOALS,
  isScenarioGoal,
  type ScenarioGoal,
} from "./goalBias";

vi.mock("pixi.js", async () => (await import("../pixiStub")).makePixiStub());

const base = new HeuristicPolicy();

/** A hostile NPC snapshot for synthetic observations. */
function hostile(id = "raider-1", hullHP = 80): NpcSnapshot {
  return {
    id,
    name: id,
    faction: FactionType.SYNDICATE,
    hostile: true,
    hullHP,
  };
}

interface ObsOpts {
  hasPlayer?: boolean;
  hullFraction?: number;
  planets?: { id: string; name: string; availableQuests: number }[];
  stations?: { id: string; name: string; type: StationType }[];
  connections?: number;
  hostiles?: NpcSnapshot[];
  landedQuests?: number | null;
}

/** Build a self-consistent observation whose legal set is the real one. */
function makeObs(scene: SceneType, opts: ObsOpts = {}): Observation {
  const hasPlayer = opts.hasPlayer ?? true;
  const planets = opts.planets ?? [];
  const stations = opts.stations ?? [];
  const connections = opts.connections ?? 0;
  const hostiles = opts.hostiles ?? [];
  const hullFraction = opts.hullFraction ?? 1;

  const availableQuestCount =
    opts.landedQuests ??
    planets.reduce((max, p) => Math.max(max, p.availableQuests), 0);

  const player: PlayerSnapshot | null = hasPlayer
    ? {
        credits: 1000,
        hull: Math.round(100 * hullFraction),
        maxHull: 100,
        hullFraction,
        fuel: 50,
        maxFuel: 100,
        fuelFraction: 0.5,
        cargo: [],
        cargoUsed: 0,
        cargoCapacity: 20,
        systemId: "sys-1",
        position: { x: 0, y: 0 },
      }
    : null;

  const system: SystemSnapshot | null = hasPlayer
    ? { id: "sys-1", name: "Сол", planets, stations, connections }
    : null;

  const currentPlanet =
    scene === SceneType.PLANET && opts.landedQuests != null
      ? {
          id: "p-landed",
          name: "Земля",
          availableQuests: opts.landedQuests,
          market: [],
        }
      : null;

  const legalActions = legalActionsForScene(scene, {
    hasPlayer,
    planetCount: planets.length,
    stationCount: stations.length,
    hostileCount: hostiles.length,
    connectionCount: connections,
    availableQuestCount,
  });

  return {
    scene,
    hasPlayer,
    player,
    system,
    currentPlanet,
    npcs: hostiles,
    hostiles,
    quests: [],
    legalActions,
  };
}

const planet = (id: string, quests = 0) => ({
  id,
  name: id,
  availableQuests: quests,
});
const station = (id: string) => ({
  id,
  name: id,
  type: StationType.REPAIR_DOCK,
});

/** Representative states the biased policy must stay legal across. */
const SAMPLE_STATES: Observation[] = [
  makeObs(SceneType.MAIN_MENU, { hasPlayer: false }),
  makeObs(SceneType.SPACE_FLIGHT, {
    planets: [planet("p1", 2)],
    connections: 2,
  }),
  makeObs(SceneType.SPACE_FLIGHT, {
    stations: [station("s1")],
    connections: 1,
  }),
  makeObs(SceneType.SPACE_FLIGHT, { connections: 3 }),
  makeObs(SceneType.SPACE_FLIGHT, { hostiles: [hostile()], hullFraction: 0.9 }),
  makeObs(SceneType.PLANET, { landedQuests: 2 }),
  makeObs(SceneType.PLANET, { landedQuests: 0 }),
  makeObs(SceneType.TRADE, {}),
  makeObs(SceneType.STATION, { hullFraction: 0.2 }),
  makeObs(SceneType.STAR_MAP, { connections: 4 }),
  makeObs(SceneType.WIN_SCREEN, {}),
];

describe("ScenarioGoal vocabulary", () => {
  it("isScenarioGoal accepts every canonical goal and rejects junk", () => {
    for (const g of SCENARIO_GOALS) expect(isScenarioGoal(g)).toBe(true);
    expect(isScenarioGoal("conquer")).toBe(false);
    expect(isScenarioGoal(42)).toBe(false);
    expect(isScenarioGoal(undefined)).toBe(false);
  });
});

describe("GoalBiasedPolicy.decide (pure)", () => {
  it("never returns an illegal action for any goal across the sampled states", () => {
    for (const goal of SCENARIO_GOALS) {
      const policy = new GoalBiasedPolicy(base, goal);
      for (const obs of SAMPLE_STATES) {
        const action = policy.decide(obs);
        expect(obs.legalActions).toContain(action.kind);
      }
    }
  });

  it("never throws — even on a player-less observation", () => {
    for (const goal of SCENARIO_GOALS) {
      const policy = new GoalBiasedPolicy(base, goal);
      expect(() =>
        policy.decide(makeObs(SceneType.MAIN_MENU, { hasPlayer: false })),
      ).not.toThrow();
    }
  });

  it("names itself as base+goal", () => {
    expect(new GoalBiasedPolicy(base, "hoard").name).toBe("heuristic+hoard");
  });

  it("go-broke shops the market instead of banking the offered quest", () => {
    const obs = makeObs(SceneType.PLANET, { landedQuests: 3 });
    // Baseline: the heuristic takes the paid work.
    expect(base.decide(obs).kind).toBe("take-quest");
    // Biased: it spends at the market instead.
    expect(new GoalBiasedPolicy(base, "go-broke").decide(obs).kind).toBe(
      "trade",
    );
  });

  it("hoard buys at the market over taking the quest", () => {
    const obs = makeObs(SceneType.PLANET, { landedQuests: 3 });
    expect(new GoalBiasedPolicy(base, "hoard").decide(obs).kind).toBe("trade");
  });

  it("max-rep disengages from a fight the heuristic would pick", () => {
    const obs = makeObs(SceneType.SPACE_FLIGHT, {
      hostiles: [hostile("raider-x")],
      hullFraction: 0.95,
    });
    // Baseline: a healthy hull attacks.
    expect(base.decide(obs).kind).toBe("attack");
    // Biased: it flees rather than tank reputation in combat.
    const action = new GoalBiasedPolicy(base, "max-rep").decide(obs);
    expect(action.kind).toBe("flee");
    expect(action.targetId).toBe("raider-x");
  });

  it("free-explore warps where the heuristic would land", () => {
    const obs = makeObs(SceneType.SPACE_FLIGHT, {
      planets: [planet("p-work", 2)],
      connections: 3,
    });
    expect(base.decide(obs).kind).toBe("land");
    expect(new GoalBiasedPolicy(base, "free-explore").decide(obs).kind).toBe(
      "warp",
    );
  });

  it("defers to the base policy when the goal has no legal preference", () => {
    // hoard prefers only `trade`, which is illegal in flight → fall through.
    const obs = makeObs(SceneType.SPACE_FLIGHT, { connections: 3 });
    const baseAction = base.decide(obs);
    const biased = new GoalBiasedPolicy(base, "hoard").decide(obs);
    expect(biased.kind).toBe(baseAction.kind);
  });

  it("resolves a land target preferring a planet offering work", () => {
    const obs = makeObs(SceneType.SPACE_FLIGHT, {
      planets: [planet("p-empty", 0), planet("p-work", 2)],
    });
    const action = new GoalBiasedPolicy(base, "ignore-overmind").decide(obs);
    expect(action.kind).toBe("land");
    expect(action.targetId).toBe("p-work");
  });
});

describe("GoalBiasedPolicy steers the agent over a real short run", () => {
  let harness: RealEngineHarness;

  beforeEach(async () => {
    localStorage.clear();
    harness = await RealEngineHarness.boot();
  });

  afterEach(() => {
    harness?.dispose();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("a free-explore bias produces a measurably different action sequence than free-play", async () => {
    // Same fresh game, two brains — the only difference is the goal bias.
    await harness.newGame();
    const baseResult = await new PlayerAgent(harness, base).run(20);

    harness.dispose();
    localStorage.clear();
    harness = await RealEngineHarness.boot();
    await harness.newGame();
    const explore: ScenarioGoal = "free-explore";
    const biasedResult = await new PlayerAgent(
      harness,
      new GoalBiasedPolicy(base, explore),
    ).run(20);

    // Both ran cleanly.
    expect(baseResult.errors).toEqual([]);
    expect(biasedResult.errors).toEqual([]);

    // Measurable steering: the biased agent did not play the identical sequence,
    // and it reached for exploration (warp/move) at least as eagerly.
    const baseKinds = baseResult.steps.map((s) => s.action.kind);
    const biasedKinds = biasedResult.steps.map((s) => s.action.kind);
    expect(biasedKinds).not.toEqual(baseKinds);

    const exploreCount = (kinds: string[]) =>
      kinds.filter((k) => k === "warp" || k === "move").length;
    expect(exploreCount(biasedKinds)).toBeGreaterThan(exploreCount(baseKinds));
  });
});
