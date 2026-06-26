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
import { HeuristicPolicy, LOW_HULL_FRACTION } from "./HeuristicPolicy";
import { PlayerAgent } from "./PlayerAgent";

/**
 * Task 2 of the dev-only letsplay engine: the pluggable policy + agent loop.
 *
 * Two layers, mirroring the plan's TDD split:
 *  - the **pure** `HeuristicPolicy.decide` is unit-tested over synthetic
 *    observations — it must return a *legal*, *non-degenerate* action for every
 *    sampled state and never throw / never pick an illegal action;
 *  - the `PlayerAgent` observe→decide→apply→tick loop is tested over the **real**
 *    booted harness — a short session runs to completion with zero logged/thrown
 *    errors and visibly moves the game (more than one scene visited).
 */
vi.mock("pixi.js", async () => (await import("../pixiStub")).makePixiStub());

const policy = new HeuristicPolicy();

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
  /** Offered work on the *landed* planet (PLANET scene). */
  landedQuests?: number | null;
}

/**
 * Build a self-consistent {@link Observation} whose `legalActions` are computed
 * by the same pure `legalActionsForScene` the real `observe` uses — so a policy
 * decision over a synthetic obs is filtered against the exact same legal set the
 * engine would produce.
 */
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

/** A representative battery of game states the agent will face. */
const SAMPLE_STATES: Observation[] = [
  makeObs(SceneType.MAIN_MENU, { hasPlayer: false }),
  makeObs(SceneType.SPACE_FLIGHT, {}), // empty space
  makeObs(SceneType.SPACE_FLIGHT, { planets: [planet("p1")], connections: 2 }),
  makeObs(SceneType.SPACE_FLIGHT, {
    stations: [station("s1")],
    connections: 1,
  }),
  makeObs(SceneType.SPACE_FLIGHT, { connections: 3 }), // nothing local
  makeObs(SceneType.SPACE_FLIGHT, { hostiles: [hostile()], hullFraction: 0.9 }),
  makeObs(SceneType.SPACE_FLIGHT, { hostiles: [hostile()], hullFraction: 0.1 }),
  makeObs(SceneType.PLANET, { landedQuests: 0 }),
  makeObs(SceneType.PLANET, { landedQuests: 2 }),
  makeObs(SceneType.TRADE, {}),
  makeObs(SceneType.STATION, { hullFraction: 0.2 }),
  makeObs(SceneType.STATION, { hullFraction: 1 }),
  makeObs(SceneType.STAR_MAP, { connections: 4 }),
  makeObs(SceneType.STAR_MAP, { connections: 0 }),
  makeObs(SceneType.WIN_SCREEN, {}),
  makeObs(SceneType.GAME_OVER, {}),
  makeObs(SceneType.DIALOGUE, {}),
];

describe("HeuristicPolicy.decide (pure)", () => {
  it("never returns an illegal action across the sampled states", () => {
    for (const obs of SAMPLE_STATES) {
      const action = policy.decide(obs);
      expect(obs.legalActions).toContain(action.kind);
    }
  });

  it("never throws — even on an empty / player-less observation", () => {
    for (const obs of SAMPLE_STATES) {
      expect(() => policy.decide(obs)).not.toThrow();
    }
    expect(() =>
      policy.decide(makeObs(SceneType.MAIN_MENU, { hasPlayer: false })),
    ).not.toThrow();
  });

  it("is deterministic — the same state yields the same action", () => {
    const obs = makeObs(SceneType.SPACE_FLIGHT, {
      planets: [planet("p1")],
      connections: 2,
    });
    expect(policy.decide(obs)).toEqual(policy.decide(obs));
  });

  it("with no player (menu) the only move is to wait", () => {
    const action = policy.decide(
      makeObs(SceneType.MAIN_MENU, { hasPlayer: false }),
    );
    expect(action.kind).toBe("wait");
  });

  describe("earn: heads toward commerce", () => {
    it("in flight with a planet, lands on it (preferring one offering work)", () => {
      const action = policy.decide(
        makeObs(SceneType.SPACE_FLIGHT, {
          planets: [planet("p-empty", 0), planet("p-work", 3)],
          connections: 2,
        }),
      );
      expect(action.kind).toBe("land");
      expect(action.targetId).toBe("p-work"); // the one with quests
    });

    it("in flight with only a station, docks at it", () => {
      const action = policy.decide(
        makeObs(SceneType.SPACE_FLIGHT, {
          stations: [station("s1")],
          connections: 1,
        }),
      );
      expect(action.kind).toBe("dock");
      expect(action.targetId).toBe("s1");
    });

    it("on a planet offering work, takes the quest", () => {
      const action = policy.decide(
        makeObs(SceneType.PLANET, { landedQuests: 2 }),
      );
      expect(action.kind).toBe("take-quest");
    });

    it("on a planet with no work, shops the market instead", () => {
      const action = policy.decide(
        makeObs(SceneType.PLANET, { landedQuests: 0 }),
      );
      expect(action.kind).toBe("trade");
    });
  });

  describe("explore: when nothing is local", () => {
    it("in empty space with connections, warps to a neighbour", () => {
      const action = policy.decide(
        makeObs(SceneType.SPACE_FLIGHT, { connections: 3 }),
      );
      expect(action.kind).toBe("warp");
    });

    it("on the star map, warps", () => {
      const action = policy.decide(
        makeObs(SceneType.STAR_MAP, { connections: 4 }),
      );
      expect(action.kind).toBe("warp");
    });
  });

  describe("survive: reacts to threats and damage", () => {
    it("a hostile in range with a healthy hull ⇒ attack the hostile", () => {
      const action = policy.decide(
        makeObs(SceneType.SPACE_FLIGHT, {
          hostiles: [hostile("raider-x")],
          hullFraction: 0.9,
        }),
      );
      expect(action.kind).toBe("attack");
      expect(action.targetId).toBe("raider-x");
    });

    it("a hostile in range with a low hull ⇒ flee", () => {
      const action = policy.decide(
        makeObs(SceneType.SPACE_FLIGHT, {
          hostiles: [hostile()],
          hullFraction: LOW_HULL_FRACTION - 0.1,
        }),
      );
      expect(action.kind).toBe("flee");
    });

    it("a low hull at a repair base ⇒ repair", () => {
      const action = policy.decide(
        makeObs(SceneType.STATION, { hullFraction: 0.2 }),
      );
      expect(action.kind).toBe("repair");
    });
  });

  it("on a terminal screen, only waits", () => {
    expect(policy.decide(makeObs(SceneType.WIN_SCREEN, {})).kind).toBe("wait");
    expect(policy.decide(makeObs(SceneType.GAME_OVER, {})).kind).toBe("wait");
  });
});

describe("PlayerAgent loop over the real harness", () => {
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

  it("plays a short session to completion with zero errors", async () => {
    await harness.newGame();
    const agent = new PlayerAgent(harness, policy);

    const result = await agent.run(24);

    // The whole budget ran, every step is a legal decision, and nothing errored.
    expect(result.steps).toHaveLength(24);
    expect(result.errors).toEqual([]);

    // Non-degenerate: the agent actually moved the game — it neither sat on
    // «wait» the whole time nor stayed in a single scene.
    const nonWait = result.steps.filter((s) => s.action.kind !== "wait");
    expect(nonWait.length).toBeGreaterThan(0);
    const scenesVisited = new Set(result.steps.map((s) => s.scene));
    expect(scenesVisited.size).toBeGreaterThanOrEqual(2);
  });

  it("every decision the agent took was legal for the scene it was in", async () => {
    await harness.newGame();
    const agent = new PlayerAgent(harness, policy);
    const result = await agent.run(16);

    // Re-derive the legal set per visited scene from the transcript: a flight
    // decision is never a market action, a planet decision never an attack, etc.
    for (const step of result.steps) {
      const inSpace = step.scene === SceneType.SPACE_FLIGHT;
      if (inSpace) expect(step.action.kind).not.toBe("trade");
      if (step.scene === SceneType.PLANET)
        expect(step.action.kind).not.toBe("attack");
    }
    expect(result.errors).toEqual([]);
  });
});
