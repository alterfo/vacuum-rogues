import { describe, it, expect, vi } from "vitest";
import { SceneType, ResourceType } from "@/types";
import {
  runLetsplay,
  checkInvariants,
  formatLetsplayReport,
  writeLetsplayReport,
} from "./letsplay.run";
import {
  legalActionsForScene,
  type Observation,
  type PlayerSnapshot,
  type SystemSnapshot,
  type CurrentPlanetSnapshot,
} from "./observe";
import { RealEngineHarness, type RecordedError } from "../realEngineHarness";
import { PlayerAgent } from "./PlayerAgent";
import { MemoryHeuristicPolicy } from "./MemoryHeuristicPolicy";
import { type AgentMemory, createMemory, updateMemory } from "./AgentMemory";
import type { PlayerPolicy } from "./PlayerPolicy";

/**
 * Task 3 of the dev-only letsplay engine: the session runner + bug-discovery
 * report.
 *
 * Two tiers in one file:
 *  - the **always-on** fast session (part of `npm run test:playtest`, the pre-push
 *    gate): a short real-engine session completes with zero logged/thrown errors
 *    and zero always-actionable-invariant violations, and visibly moves the game;
 *  - the **env-gated full bug-finder** (`LETSPLAY_FULL=1`, driven by `npm run
 *    letsplay`): plays `K` sessions × `N` steps, writes the transcript + failure
 *    report to `.letsplay/`, and fails (non-zero exit) on any failure.
 *
 * Real `GameEngine` / `QuestManager` / `BankingService` / scene wiring — only
 * PixiJS is stubbed. The pixi mock here is what lets the (test-free) runner boot
 * the real harness headlessly.
 */
vi.mock("pixi.js", async () => (await import("../pixiStub")).makePixiStub());

/** A minimal synthetic observation for the pure-invariant unit checks. */
function obs(partial: Partial<Observation>): Observation {
  return {
    scene: SceneType.SPACE_FLIGHT,
    hasPlayer: true,
    player: {
      credits: 1000,
      hull: 100,
      maxHull: 100,
      hullFraction: 1,
      fuel: 50,
      maxFuel: 100,
      fuelFraction: 0.5,
      cargo: [],
      cargoUsed: 0,
      cargoCapacity: 20,
      systemId: "sys-1",
      position: { x: 0, y: 0 },
    },
    system: null,
    currentPlanet: null,
    npcs: [],
    hostiles: [],
    quests: [],
    legalActions: ["move", "wait"],
    ...partial,
  };
}

describe("checkInvariants (pure net)", () => {
  it("passes a sound state", () => {
    expect(checkInvariants(obs({}))).toEqual([]);
  });

  it("flags a stranded player — a non-terminal scene offering only wait", () => {
    const v = checkInvariants(obs({ legalActions: ["wait"] }));
    expect(v.map((x) => x.invariant)).toContain("always-actionable");
  });

  it("a terminal screen offering only wait is NOT a violation", () => {
    expect(
      checkInvariants(
        obs({ scene: SceneType.GAME_OVER, legalActions: ["wait"] }),
      ),
    ).toEqual([]);
  });

  it("flags corrupt vitals (negative / NaN hull, over-max hull)", () => {
    const neg = checkInvariants(
      obs({ player: { ...obs({}).player!, hull: -1, hullFraction: -0.01 } }),
    );
    expect(neg.map((x) => x.invariant)).toContain("hull-nonnegative");

    const over = checkInvariants(
      obs({
        player: {
          ...obs({}).player!,
          hull: 150,
          maxHull: 100,
          hullFraction: 1.5,
        },
      }),
    );
    expect(over.map((x) => x.invariant)).toContain("hull-within-max");

    const badCredits = checkInvariants(
      obs({ player: { ...obs({}).player!, credits: Number.NaN } }),
    );
    expect(badCredits.map((x) => x.invariant)).toContain("credits-finite");
  });
});

describe("runLetsplay — short real-engine session", () => {
  it("completes with zero errors and zero invariant violations", async () => {
    const report = await runLetsplay({
      sessions: 1,
      steps: 20,
      seedPrefix: "LETSPLAY_FAST",
    });

    // The bug-finder found nothing — a clean run.
    expect(report.failures, formatLetsplayReport(report)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.totalSteps).toBe(20);
    expect(report.sessions).toHaveLength(1);

    // Non-degenerate: the agent actually played — it neither sat on «wait» the
    // whole time nor stayed in one scene.
    const [session] = report.sessions;
    expect(session.transcript).toHaveLength(20);
    const nonWait = session.transcript.filter((s) => s.action.kind !== "wait");
    expect(nonWait.length).toBeGreaterThan(0);
    const scenes = new Set(session.transcript.map((s) => s.scene));
    expect(scenes.size).toBeGreaterThanOrEqual(2);
  });

  it("a report with failures renders them and is not ok", () => {
    // formatLetsplayReport is the human surface the runner logs — prove it
    // surfaces a failure rather than silently swallowing it.
    const summary = formatLetsplayReport({
      sessions: [],
      totalSteps: 0,
      ok: false,
      failures: [
        {
          session: 0,
          kind: "invariant",
          step: 3,
          scene: SceneType.SPACE_FLIGHT,
          message: "always-actionable: player stranded",
        },
      ],
    });
    expect(summary).toContain("✗");
    expect(summary).toContain("always-actionable");
  });
});

const METALS = ResourceType.METALS;

/** Render the harness error sink as a readable assertion hint. */
function formatRecorded(errors: RecordedError[]): string {
  return errors.map((e) => `[${e.source}] ${e.message}`).join("\n");
}

/** A vitals fixture for the scripted loop-contract scenario. */
function memPlayer(over: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
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
    systemId: "sysX",
    position: null,
    ...over,
  };
}

/** A landed-planet observation exposing one good's market (the only visible prices). */
function planetObs(
  id: string,
  buy: number,
  sell: number,
  player: Partial<PlayerSnapshot> = {},
): Observation {
  const currentPlanet: CurrentPlanetSnapshot = {
    id,
    name: id,
    availableQuests: 0,
    market: [{ resource: METALS, buy, sell }],
  };
  return {
    scene: SceneType.PLANET,
    hasPlayer: true,
    player: memPlayer({ systemId: "sysX", ...player }),
    system: {
      id: "sysX",
      name: "X",
      planets: [],
      stations: [],
      connections: 0,
    },
    currentPlanet,
    npcs: [],
    hostiles: [],
    quests: [],
    legalActions: legalActionsForScene(SceneType.PLANET, {
      hasPlayer: true,
      planetCount: 0,
      stationCount: 0,
      hostileCount: 0,
      connectionCount: 0,
      availableQuestCount: 0,
    }),
  };
}

/** An in-flight observation with reachable in-system planets. */
function flightObs(opts: {
  planets: { id: string; name: string; availableQuests: number }[];
  player?: Partial<PlayerSnapshot>;
}): Observation {
  const system: SystemSnapshot = {
    id: "sysX",
    name: "X",
    planets: opts.planets,
    stations: [],
    connections: opts.planets.length,
  };
  return {
    scene: SceneType.SPACE_FLIGHT,
    hasPlayer: true,
    player: memPlayer({ systemId: "sysX", ...opts.player }),
    system,
    currentPlanet: null,
    npcs: [],
    hostiles: [],
    quests: [],
    legalActions: legalActionsForScene(SceneType.SPACE_FLIGHT, {
      hasPlayer: true,
      planetCount: opts.planets.length,
      stationCount: 0,
      hostileCount: 0,
      connectionCount: opts.planets.length,
      availableQuestCount: 0,
    }),
  };
}

/**
 * Task 5 of the partial-observability plan: the agent carries a per-run belief.
 *
 * {@link PlayerAgent} now owns an {@link AgentMemory}, folds each egocentric
 * observation into it **before** the policy decides, hands `{obs, memory}` to the
 * policy, and starts fresh per run. These tests prove that wiring on the *real*
 * engine (the integration tier) plus a deterministic loop-contract replay of the
 * scripted return-to-sell the memory enables (a decision the memoryless baseline
 * cannot make).
 */
describe("PlayerAgent carries a per-run belief (Task 5)", () => {
  it("accumulates one belief across a real session, feeds it to the policy, no errors", async () => {
    const harness = await RealEngineHarness.boot({ seed: "LETSPLAY_MEM" });
    try {
      await harness.newGame();
      const agent = new PlayerAgent(harness, new MemoryHeuristicPolicy());
      const res = await agent.run(20);

      // The wiring added no engine fault — a clean memory-driven run.
      expect(res.errors, formatRecorded(res.errors)).toEqual([]);
      // ONE accumulating notebook was folded each step (step === budget); a fresh
      // memory per step would leave it at 1.
      expect(agent.belief.step).toBe(20);
      // Every decision was made over the belief — the memory policy stamps `mem:`.
      expect(res.steps).toHaveLength(20);
      expect(res.steps.every((s) => s.action.reason?.startsWith("mem:"))).toBe(
        true,
      );
    } finally {
      harness.dispose();
    }
  });

  it("passes its own accumulating notebook into the policy, updated before each decide", async () => {
    const harness = await RealEngineHarness.boot({ seed: "LETSPLAY_MEM_REC" });
    try {
      await harness.newGame();
      const seen: AgentMemory[] = [];
      const recorder: PlayerPolicy = {
        name: "recorder",
        decide(_obs, memory) {
          seen.push(memory!);
          return { kind: "wait", reason: "rec" };
        },
      };
      const agent = new PlayerAgent(harness, recorder);
      const res = await agent.run(5);

      expect(res.errors, formatRecorded(res.errors)).toEqual([]);
      // The policy was handed a memory every step…
      expect(seen).toHaveLength(5);
      // …already advanced before the decide (update-then-decide), strictly growing…
      expect(seen.map((m) => m.step)).toEqual([1, 2, 3, 4, 5]);
      // …and the latest is the agent's own notebook.
      expect(seen[seen.length - 1]).toBe(agent.belief);
    } finally {
      harness.dispose();
    }
  });

  it("belief is per-run — reset() and a fresh agent both start empty", async () => {
    const harness = await RealEngineHarness.boot({
      seed: "LETSPLAY_MEM_RESET",
    });
    try {
      await harness.newGame();
      const agent = new PlayerAgent(harness, new MemoryHeuristicPolicy());
      await agent.run(10);
      expect(agent.belief.step).toBe(10);

      agent.reset();
      expect(agent.belief.step).toBe(0);
      expect(agent.belief.priceBook.size).toBe(0);
      expect(agent.belief.inventoryLots).toEqual([]);

      // A brand-new agent on the same harness also begins from a clean slate.
      const fresh = new PlayerAgent(harness, new MemoryHeuristicPolicy());
      expect(fresh.belief.step).toBe(0);
      expect(fresh.belief.priceBook.size).toBe(0);
    } finally {
      harness.dispose();
    }
  });

  it("the update→decide loop the agent runs yields a memory-informed return-to-sell", () => {
    // PlayerAgent.run's per-step contract is exactly:
    //   memory = updateMemory(memory, obs); action = policy.decide(obs, memory)
    // Replaying it over a scripted buy@A → flight sequence reproduces the
    // return-to-sell that the memoryless baseline cannot perform.
    const policy = new MemoryHeuristicPolicy();
    let mem = createMemory();
    const step = (o: Observation) => {
      mem = updateMemory(mem, o);
      return policy.decide(o, mem);
    };

    // 1) Learn A's cheap market, 2) learn B's dear market — now a margin is known.
    step(planetObs("A", 100, 80));
    step(planetObs("B", 200, 160));
    // 3) Standing on the cheap source with an empty hold ⇒ buy low.
    const buy = step(planetObs("A", 100, 80));
    expect(buy.reason).toContain("buy-low");
    // 4) The buy lands 5 units of METALS in the hold (recorded at A's buy price).
    step(
      planetObs("A", 100, 80, {
        cargo: [{ type: METALS, amount: 5 }],
        cargoUsed: 5,
        credits: 500,
      }),
    );
    // 5) Back in flight with both planets reachable ⇒ return to B to sell.
    const sell = step(
      flightObs({
        planets: [
          { id: "A", name: "A", availableQuests: 0 },
          { id: "B", name: "B", availableQuests: 0 },
        ],
        player: {
          cargo: [{ type: METALS, amount: 5 }],
          cargoUsed: 5,
          credits: 500,
        },
      }),
    );
    expect(sell.kind).toBe("land");
    expect(sell.targetId).toBe("B");
    expect(sell.reason).toContain("go-sell");
  });
});

/**
 * The full bug-finder, opt-in via `LETSPLAY_FULL` so the always-on playtest gate
 * stays fast. `npm run letsplay` sets it: plays `K`×`N`, writes `.letsplay/`
 * artifacts, and the assertion below turns any failure into a non-zero exit.
 * `LETSPLAY_SESSIONS` / `LETSPLAY_STEPS` override the K/N defaults.
 */
const FULL = !!process.env.LETSPLAY_FULL;
describe.runIf(FULL)("npm run letsplay — full bug-finder", () => {
  it("plays K sessions × N steps with zero failures (writes a report)", async () => {
    const sessions = Number(process.env.LETSPLAY_SESSIONS ?? 3);
    const steps = Number(process.env.LETSPLAY_STEPS ?? 40);

    const report = await runLetsplay({ sessions, steps });
    const written = writeLetsplayReport(report);
    // Surface the summary + where the full report landed for the dev driver.
    // eslint-disable-next-line no-console
    console.log(
      `${formatLetsplayReport(report)}\n  report: ${written.reportPath}`,
    );

    expect(report.failures, formatLetsplayReport(report)).toEqual([]);
    expect(report.ok).toBe(true);
  }, 120_000);
});
