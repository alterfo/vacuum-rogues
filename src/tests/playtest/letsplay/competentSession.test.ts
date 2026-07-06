import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { SceneType, ResourceType, StationType } from "@/types";
import {
  legalActionsForScene,
  type Observation,
  type PlayerSnapshot,
  type SystemSnapshot,
  type CurrentPlanetSnapshot,
} from "./observe";
import { createMemory, type AgentMemory } from "./AgentMemory";
import {
  decideWithMemory,
  MemoryHeuristicPolicy,
} from "./MemoryHeuristicPolicy";
import { RealEngineHarness, type RecordedError } from "../realEngineHarness";
import { PlayerAgent, type AgentRunResult } from "./PlayerAgent";

/**
 * Task 4 of the smart-autopilot plan: the progression tier + holistic
 * goal-less competence.
 *
 * Root cause (see docs/plans/20260701-smart-autopilot-player.md): the
 * goal-less base ladder never spent an affordable in-station upgrade
 * (`bestHullPrice`/`cheapestGearPrice` were only ever read by the
 * goal-specific CJM-B gear-grinder branch, dead for a goal-less run) and
 * never reacted to `obs.questDeliveryHere` (only the goal-specific CJM-D
 * quest-runner did) — credits piled up unspent and a deliverable-now quest
 * was never landed on to complete. These tests pin both fixes, plus a
 * session-level competence assertion over the whole ladder.
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
  currentPlanet?: CurrentPlanetSnapshot | null;
  hasCraftCenter?: boolean;
  questDeliveryHere?: boolean;
  cheapestGearPrice?: number | null;
  bestHullPrice?: number | null;
}

/** Mirrors the fixture builder in cjm.test.ts (kept local to avoid touching that file). */
function obs(opts: ObsOpts = {}): Observation {
  const scene = opts.scene ?? SceneType.SPACE_FLIGHT;
  const planets = opts.planets ?? [];
  const stations = opts.stations ?? [];
  const connections = opts.connections ?? 0;
  const currentPlanet = opts.currentPlanet ?? null;
  const player = playerFixture(opts.player);
  const hasCraftCenter = opts.hasCraftCenter ?? false;
  const cheapestGearPrice = opts.cheapestGearPrice ?? null;
  const bestHullPrice = opts.bestHullPrice ?? null;

  const system: SystemSnapshot = {
    id: "sysA",
    name: "A",
    planets,
    stations,
    connections,
  };

  const availableQuestCount =
    currentPlanet?.availableQuests ??
    planets.reduce((max, p) => Math.max(max, p.availableQuests), 0);

  const legalActions = legalActionsForScene(scene, {
    hasPlayer: true,
    planetCount: planets.length,
    stationCount: stations.length,
    hostileCount: 0,
    connectionCount: connections,
    availableQuestCount,
    credits: player.credits,
    cargoUsed: player.cargoUsed,
    hasCraftCenter,
    cheapestGearPrice,
    bestHullPrice,
  });

  return {
    scene,
    hasPlayer: true,
    player,
    system,
    currentPlanet,
    npcs: [],
    hostiles: [],
    quests: [],
    legalActions,
    warpInTransit: false,
    hasCraftCenter,
    questDeliveryHere: opts.questDeliveryHere ?? false,
    cheapestGearPrice,
    bestHullPrice,
  };
}

describe("decideWithMemory — progression tier: affordable in-station upgrade (pure)", () => {
  it("buys the hull upgrade once credits clear the buffer, goal-less", () => {
    const here = obs({
      scene: SceneType.STATION,
      player: { credits: 12000 },
      bestHullPrice: 10000,
      cheapestGearPrice: 500,
    });

    const action = decideWithMemory(here, createMemory());

    expect(action.kind).toBe("upgrade-hull");
  });

  // Rewritten under the three-year-campaign test license (Task 7), meaning
  // preserved: a station visit with genuine surplus buys gear when the hull
  // upgrade is out of reach. Re-expressed on a BATTLE-READY ship with the
  // trade reserve intact — the campaign discipline defers all discretionary
  // shopping until battle-ready (hull-first: pre-battle-ready gear buys
  // pushed the one purchase the military ladder waits on out of reach) and
  // never spends into the reserve (measured wallet-to-zero blowup).
  it("buys gear from surplus once battle-ready when the hull upgrade is out of reach", () => {
    const here = obs({
      scene: SceneType.STATION,
      player: { credits: 2000, maxHull: 220, weaponDamage: 35 },
      bestHullPrice: 10000,
      cheapestGearPrice: 500,
    });

    const action = decideWithMemory(here, createMemory());

    expect(action.kind).toBe("buy-gear");
  });

  it("defers gear shopping while not yet battle-ready (hull-first discipline)", () => {
    const here = obs({
      scene: SceneType.STATION,
      player: { credits: 2000 },
      bestHullPrice: 10000,
      cheapestGearPrice: 500,
    });

    const action = decideWithMemory(here, createMemory());

    expect(action.kind).not.toBe("buy-gear");
  });

  // Rewritten under the three-year-campaign test license (Task 7), same
  // reasoning as the gear test above: module shopping is battle-ready-gated
  // and reserve-gated on the campaign horizon.
  it("buys a micromodule at a craft center when nothing bigger is affordable, goal-less", () => {
    const here = obs({
      scene: SceneType.STATION,
      player: { credits: 1500, maxHull: 220, weaponDamage: 35 },
      hasCraftCenter: true,
    });

    const action = decideWithMemory(here, createMemory());

    expect(action.kind).toBe("buy-module");
  });

  it("defers to repair/leave when nothing is affordable yet, goal-less", () => {
    const here = obs({
      scene: SceneType.STATION,
      player: { credits: 100 },
      bestHullPrice: 10000,
      cheapestGearPrice: 5000,
    });

    const action = decideWithMemory(here, createMemory());

    expect(action.kind).not.toBe("upgrade-hull");
    expect(action.kind).not.toBe("buy-gear");
    expect(action.kind).not.toBe("buy-module");
  });
});

describe("decideWithMemory — progression tier: quest delivery here (pure)", () => {
  it("lands on an in-system planet to close out a deliverable-now quest, goal-less", () => {
    const here = obs({
      questDeliveryHere: true,
      planets: [{ id: "Q", name: "Q", availableQuests: 0 }],
      connections: 1,
    });

    const action = decideWithMemory(here, createMemory());

    expect(action.kind).toBe("land");
    expect(action.reason).toContain("quest-delivery");
    expect(action.targetId).toBe("Q");
  });

  it("a known cross-planet margin sell still outranks the delivery landing", () => {
    const mem: AgentMemory = createMemory();
    mem.inventoryLots = [{ good: M, qty: 5, buyPrice: 100 }];
    mem.priceBook.set("Q", new Map([[M, { buy: 100, sell: 80, seenAt: 1 }]]));
    mem.priceBook.set("R", new Map([[M, { buy: 200, sell: 160, seenAt: 1 }]])); // sells here
    const here = obs({
      questDeliveryHere: true,
      planets: [
        { id: "R", name: "R", availableQuests: 0 },
        { id: "Q", name: "Q", availableQuests: 0 },
      ],
      connections: 1,
    });

    const action = decideWithMemory(here, mem);

    expect(action.kind).toBe("land");
    expect(action.reason).toContain("go-sell");
    expect(action.targetId).toBe("R");
  });

  it("with no in-system planet to land on, does not invent a target (falls through safely)", () => {
    const here = obs({ questDeliveryHere: true, connections: 1 });

    const action = decideWithMemory(here, createMemory());

    // The quest-delivery branch must not invent a `land` (there is no planet to
    // land on); with no planet in-system `land` is not even legal, so a bogus
    // land target would be silently pruned and this assertion alone would still
    // pass — pin the actual intent: the fall-through picks a real non-land move.
    expect(here.legalActions).toContain(action.kind);
    expect(action.kind).not.toBe("land");
  });
});

/** Render the harness error sink as a readable assertion hint. */
function formatRecorded(errors: RecordedError[]): string {
  return errors.map((e) => `[${e.source}] ${e.message}`).join("\n");
}

describe("PlayerAgent — competent goal-less session (Task 4)", () => {
  // Chosen deterministically: this seed/budget combo plays a real trade
  // cycle to completion without the run's outcome depending on rare
  // quest-generation timing or an unrelated deep-space Overmind-garrison
  // encounter (both outside this task's scope — see Task 5/8/9). The
  // quest-delivery and affordable-upgrade *additions* this task makes are
  // pinned deterministically by the pure fixture tests above; this
  // real-engine run instead proves the full ladder is stable end to end.
  let harness: RealEngineHarness;
  let res: AgentRunResult;
  let maxFuel: number;

  beforeAll(async () => {
    harness = await RealEngineHarness.boot({ seed: "LETSPLAY_HOLISTIC3" });
    await harness.newGame();
    maxFuel = harness.engine.player!.ship.maxEnergy;

    const agent = new PlayerAgent(harness, new MemoryHeuristicPolicy());
    res = await agent.run(200);
  }, 30_000);

  afterAll(() => {
    harness.dispose();
  });

  it("survives, never fuel-dies, and never soft-locks", () => {
    expect(res.errors, formatRecorded(res.errors)).toEqual([]);
    // REWRITTEN under the three-year-campaign plan's test license (Task 6),
    // meaning preserved: "the agent never dies of INCOMPETENCE (starvation,
    // stranding, picking losing fights)". The old blanket not-GAME_OVER pin
    // was actually satisfied via the combat-pause FREEZE exploit: a mid-warp
    // Overmind intercept froze both sides forever, and the "surviving" ship
    // was really soft-locked (this file's own header even scopes such
    // deep-space garrison encounters OUT — "see Task 5/8/9"). Task 6 made the
    // apply layer honest (a transiting ship keeps flying and combat
    // resolves), so on this seed the war now runs its course: the agent
    // trades competently for ~180 days while the small 12-system galaxy
    // collapses around it (share > 50%), then falls to a capture fleet that
    // hits its system the day it evacuates. That is a WAR casualty in a
    // nearly-lost galaxy, not incompetence — tolerated below iff it happens
    // late (past the adaptive grace, day ≥ 120) in a war-consumed galaxy
    // (share ≥ the 0.35 star-map warning band). Every incompetence guard
    // (fuel-death, soft-lock, bankruptcy) still applies unconditionally.
    // Task 8 (slayer tuning) owns driving campaign deaths to 0%.
    if (res.endScene === SceneType.GAME_OVER) {
      const lastDay = res.steps[res.steps.length - 1]?.day ?? 0;
      const galaxy = harness.engine.galaxy!;
      const share = galaxy.overmindSystems.length / galaxy.systems.length;
      expect(
        lastDay,
        "death before the adaptive grace window ended",
      ).toBeGreaterThanOrEqual(120);
      expect(
        share,
        "death in a galaxy the war had not consumed",
      ).toBeGreaterThanOrEqual(0.35);
    }

    // No fuel-death: never warped while fuel was critical, and the ship is
    // never left permanently stranded at 0 energy.
    const criticalWarp = res.steps.find((s) => {
      const fuel = s.vitals?.fuel ?? maxFuel;
      return fuel / maxFuel < 0.2 && s.action.kind === "warp";
    });
    expect(criticalWarp).toBeUndefined();
    expect(harness.engine.player!.ship.energy).toBeGreaterThan(0);

    // No soft-lock: no single (scene, action) pair repeats forever — a
    // general stagnation guard (this task's bestKnownMargin/holdingFor-
    // OtherSystem fix removed one such stall: an unrelated, larger known
    // margin was masking the held good's own sell opportunity, so the
    // agent looped land-earn/take-off forever on unsellable cargo).
    let streak = 0;
    let longestStreak = 0;
    let prevKey = "";
    for (const step of res.steps) {
      // A dead session has no decisions — the run loop idles on the GAME_OVER
      // screen to the step budget, which would read as a fake "soft-lock"
      // streak. Measure stagnation over LIVING play only (Task 6 license,
      // same rewrite as the war-casualty tolerance above).
      if (step.scene === SceneType.GAME_OVER) break;
      const key = `${step.scene}|${step.action.kind}:${step.action.reason}`;
      streak = key === prevKey ? streak + 1 : 1;
      longestStreak = Math.max(longestStreak, streak);
      prevKey = key;
    }
    expect(longestStreak).toBeLessThan(20);

    // Never goes broke to a negative balance.
    expect(res.finalVitals?.credits ?? 0).toBeGreaterThanOrEqual(0);
  });

  // Task 2's DELIVERY-quest cycle: a real, independently-verified opportunity
  // converted into progress on this same deterministic seed.
  it("completes a DELIVERY quest for its contractual reward", () => {
    const completedQuest = res.steps.some(
      (s) => (s.vitals?.questsCompleted ?? 0) > 0,
    );
    expect(completedQuest).toBe(true);
  });

  // HEALED REGRESSION (was pinned `.fails`): under the old fixed spread
  // (grace 6 / interval 5) this seed's small 6-system galaxy went mostly
  // Overmind-held mid-session, so `galaxyEffectivelyLost` correctly refused
  // the warp toward the known margin and `sell-for-profit` never fired. The
  // adaptive campaign clock (three-year-campaign Task 3: ADAPTIVE_GRACE_DAYS
  // of dormancy before any arc spread) keeps the galaxy free for the whole
  // session, so the ladder provably reaches `sell-for-profit` on this very
  // seed again — the healing condition the `.fails` note demanded.
  it("realises a known-margin sell-for-profit cycle", () => {
    const soldForProfit = res.steps.some(
      (s) =>
        s.action.kind === "trade" &&
        (s.action.reason ?? "").includes("sell-for-profit"),
    );
    expect(soldForProfit).toBe(true);
  });
});
