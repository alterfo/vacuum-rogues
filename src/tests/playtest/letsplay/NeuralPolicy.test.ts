import { describe, it, expect, vi } from "vitest";
import { SceneType, FactionType } from "@/types";
import { GameSystemException } from "@/exceptions/GameSystemException";
import { GameValidationException } from "@/exceptions/GameValidationException";
import {
  ACTION_ORDER,
  legalActionsForScene,
  type Observation,
  type NpcSnapshot,
  type PlayerSnapshot,
  type SystemSnapshot,
  type PlayerActionKind,
} from "./observe";
import { HeuristicPolicy } from "./HeuristicPolicy";
import type { Action } from "./PlayerPolicy";
import type { MlpWeights } from "./mlp";
import {
  NeuralPolicy,
  featurize,
  mapNetOutputToAction,
  FEATURE_LENGTH,
} from "./NeuralPolicy";

/**
 * A tiny single-layer net (`FEATURE_LENGTH → ACTION_ORDER.length`) whose weight
 * matrix is all-zero, so `forward` returns its bias vector verbatim regardless of
 * the input. A one-hot bias on `kind` therefore makes the net argmax that action
 * for *any* observation — a deterministic teacher for the loaded-net path.
 */
function netFavouring(kind: PlayerActionKind): MlpWeights {
  const idx = ACTION_ORDER.indexOf(kind);
  const W = ACTION_ORDER.map(() =>
    Array.from({ length: FEATURE_LENGTH }, () => 0),
  );
  const b = ACTION_ORDER.map((_, i) => (i === idx ? 1 : 0));
  return { layers: [{ W, b }] };
}

/**
 * Task 5 of the dev-only letsplay engine: the **neural-policy seam (stub)**.
 *
 * The trained net is Post-Completion, so the assertions pin the seam, not a
 * model:
 *  - `featurize` is a pure, fixed-width, normalised encoder of an observation;
 *  - `mapNetOutputToAction` turns a (possibly adversarial) net output into a
 *    **legal** action — even when the net's argmax is illegal for the scene;
 *  - `NeuralPolicy` with no model is **inert** — `load()` throws "not trained
 *    yet" and `decide` falls back to the heuristic, never an illegal action.
 */
vi.mock("pixi.js", async () => (await import("../pixiStub")).makePixiStub());

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
  connections?: number;
  hostiles?: NpcSnapshot[];
  landedQuests?: number | null;
}

/** Build a self-consistent observation whose `legalActions` are the real set. */
function makeObs(scene: SceneType, opts: ObsOpts = {}): Observation {
  const hasPlayer = opts.hasPlayer ?? true;
  const planets = opts.planets ?? [];
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
    ? { id: "sys-1", name: "Сол", planets, stations: [], connections }
    : null;

  const currentPlanet =
    scene === SceneType.PLANET && opts.landedQuests != null
      ? { id: "p-landed", name: "Земля", availableQuests: opts.landedQuests }
      : null;

  return {
    scene,
    hasPlayer,
    player,
    system,
    currentPlanet,
    npcs: hostiles,
    hostiles,
    quests: [],
    legalActions: legalActionsForScene(scene, {
      hasPlayer,
      planetCount: planets.length,
      stationCount: 0,
      hostileCount: hostiles.length,
      connectionCount: connections,
      availableQuestCount,
    }),
  };
}

const planet = (id: string, quests = 0) => ({
  id,
  name: id,
  availableQuests: quests,
});

const SAMPLE_STATES: Observation[] = [
  makeObs(SceneType.MAIN_MENU, { hasPlayer: false }),
  makeObs(SceneType.SPACE_FLIGHT, {}),
  makeObs(SceneType.SPACE_FLIGHT, { planets: [planet("p1")], connections: 2 }),
  makeObs(SceneType.SPACE_FLIGHT, { connections: 3 }),
  makeObs(SceneType.SPACE_FLIGHT, { hostiles: [hostile()], hullFraction: 0.9 }),
  makeObs(SceneType.SPACE_FLIGHT, { hostiles: [hostile()], hullFraction: 0.1 }),
  makeObs(SceneType.PLANET, { landedQuests: 0 }),
  makeObs(SceneType.PLANET, { landedQuests: 2 }),
  makeObs(SceneType.STAR_MAP, { connections: 4 }),
  makeObs(SceneType.GAME_OVER, {}),
];

describe("featurize (pure encoder)", () => {
  it("is deterministic and fixed-width with every component in [0, 1]", () => {
    for (const obs of SAMPLE_STATES) {
      const a = featurize(obs);
      const b = featurize(obs);
      expect(a).toEqual(b); // same obs ⇒ same vector
      expect(a).toHaveLength(FEATURE_LENGTH);
      for (const v of a) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
        expect(Number.isFinite(v)).toBe(true);
      }
    }
  });

  it("encodes a player-less (menu) observation with zeroed vitals", () => {
    const v = featurize(makeObs(SceneType.MAIN_MENU, { hasPlayer: false }));
    expect(v[0]).toBe(0); // hasPlayer flag
    expect(v[1]).toBe(0); // hull
    expect(v[2]).toBe(0); // fuel
  });

  it("reflects hull / hostiles in the vector", () => {
    const calm = featurize(
      makeObs(SceneType.SPACE_FLIGHT, { hullFraction: 1 }),
    );
    const hurt = featurize(
      makeObs(SceneType.SPACE_FLIGHT, {
        hullFraction: 0.2,
        hostiles: [hostile()],
      }),
    );
    expect(hurt[1]).toBeLessThan(calm[1]); // lower hull
    expect(hurt[8]).toBeGreaterThan(calm[8]); // more hostiles
  });
});

describe("mapNetOutputToAction (net output → legal action)", () => {
  /** A score vector that maxes out `kind` and zeroes the rest. */
  function favour(kind: PlayerActionKind): number[] {
    return ACTION_ORDER.map((k) => (k === kind ? 1 : 0));
  }

  it("returns the highest-scoring *legal* action", () => {
    const obs = makeObs(SceneType.SPACE_FLIGHT, {
      planets: [planet("p1")],
      connections: 2,
    });
    // "land" is legal here and scored highest ⇒ chosen.
    expect(obs.legalActions).toContain("land");
    expect(mapNetOutputToAction(favour("land"), obs).kind).toBe("land");
  });

  it("never returns an illegal action — even when the net's argmax is illegal", () => {
    // On a planet, "attack" is NOT legal; the net argmaxes it anyway.
    const obs = makeObs(SceneType.PLANET, { landedQuests: 0 });
    expect(obs.legalActions).not.toContain("attack");
    const action = mapNetOutputToAction(favour("attack"), obs);
    expect(obs.legalActions).toContain(action.kind);
  });

  it("falls to the legal floor on empty / short / non-finite scores", () => {
    for (const obs of SAMPLE_STATES) {
      for (const scores of [[], [Number.NaN], [1, 2]]) {
        const action = mapNetOutputToAction(scores, obs);
        expect(obs.legalActions).toContain(action.kind);
      }
    }
  });

  it("tags the decision as neural for the transcript", () => {
    const obs = makeObs(SceneType.SPACE_FLIGHT, { connections: 3 });
    expect(mapNetOutputToAction(favour("warp"), obs).reason).toBe("neural");
  });
});

describe("NeuralPolicy (inert stub until trained)", () => {
  it("load() rejects with 'not trained yet' when no weights are given", async () => {
    const policy = new NeuralPolicy();
    expect(policy.isLoaded).toBe(false);
    await expect(policy.load()).rejects.toBeInstanceOf(GameSystemException);
    await expect(policy.load()).rejects.toThrow(/not trained yet/i);
    expect(policy.isLoaded).toBe(false);
  });

  it("decide() is inert — it falls back to the heuristic baseline", () => {
    const neural = new NeuralPolicy();
    const heuristic = new HeuristicPolicy();
    for (const obs of SAMPLE_STATES) {
      expect(neural.decide(obs)).toEqual(heuristic.decide(obs));
    }
  });

  it("decide() never throws and never returns an illegal action (untrained)", () => {
    const policy = new NeuralPolicy();
    for (const obs of SAMPLE_STATES) {
      let action!: Action;
      expect(() => (action = policy.decide(obs))).not.toThrow();
      expect(obs.legalActions).toContain(action.kind);
    }
  });

  it("honours a custom fallback policy", () => {
    const stub = {
      name: "stub",
      decide: vi.fn((): Action => ({ kind: "wait", reason: "stub" })),
    };
    const policy = new NeuralPolicy({ fallback: stub });
    const obs = makeObs(SceneType.SPACE_FLIGHT, { connections: 3 });
    expect(policy.decide(obs)).toEqual({ kind: "wait", reason: "stub" });
    expect(stub.decide).toHaveBeenCalledWith(obs);
  });
});

describe("NeuralPolicy (loaded — runs the pure-TS MLP)", () => {
  it("load() adopts valid weights and isLoaded becomes true", async () => {
    const policy = new NeuralPolicy({ weights: netFavouring("land") });
    expect(policy.isLoaded).toBe(false);
    await policy.load();
    expect(policy.isLoaded).toBe(true);
  });

  it("decide() runs the net → the highest-scoring legal action, tagged neural", async () => {
    const policy = new NeuralPolicy({ weights: netFavouring("land") });
    await policy.load();
    const obs = makeObs(SceneType.SPACE_FLIGHT, {
      planets: [planet("p1")],
      connections: 2,
    });
    expect(obs.legalActions).toContain("land");
    const action = policy.decide(obs);
    expect(action.kind).toBe("land");
    expect(action.reason).toBe("neural");
  });

  it("decide() still never returns an illegal action when the net's argmax is illegal", async () => {
    // The net always argmaxes "land", which is NOT legal on a planet.
    const policy = new NeuralPolicy({ weights: netFavouring("land") });
    await policy.load();
    for (const obs of SAMPLE_STATES) {
      let action!: Action;
      expect(() => (action = policy.decide(obs))).not.toThrow();
      expect(obs.legalActions).toContain(action.kind);
    }
  });

  it("decide() is deterministic — same obs ⇒ same action", async () => {
    const policy = new NeuralPolicy({ weights: netFavouring("warp") });
    await policy.load();
    const obs = makeObs(SceneType.STAR_MAP, { connections: 4 });
    expect(policy.decide(obs)).toEqual(policy.decide(obs));
  });

  it("load() rejects malformed weights with a validation error", async () => {
    const policy = new NeuralPolicy({ weights: { layers: [] } });
    await expect(policy.load()).rejects.toBeInstanceOf(GameValidationException);
    expect(policy.isLoaded).toBe(false);
  });

  it("load() rejects a net whose input width != featurize width", async () => {
    // A 10→10 net (wrong input width) must fail loudly at load, so decide's
    // forward can never throw on a width mismatch.
    const W = ACTION_ORDER.map(() => Array.from({ length: 10 }, () => 0));
    const b = ACTION_ORDER.map(() => 0);
    const policy = new NeuralPolicy({ weights: { layers: [{ W, b }] } });
    await expect(policy.load()).rejects.toBeInstanceOf(GameValidationException);
    await expect(policy.load()).rejects.toThrow(/input width/i);
    expect(policy.isLoaded).toBe(false);
  });

  it("load() rejects a net whose output width != action count", async () => {
    const W = Array.from({ length: 4 }, () =>
      Array.from({ length: FEATURE_LENGTH }, () => 0),
    );
    const b = [0, 0, 0, 0];
    const policy = new NeuralPolicy({ weights: { layers: [{ W, b }] } });
    await expect(policy.load()).rejects.toBeInstanceOf(GameValidationException);
    await expect(policy.load()).rejects.toThrow(/output width/i);
    expect(policy.isLoaded).toBe(false);
  });
});
