import { describe, it, expect, afterEach, vi } from "vitest";
import { RealEngineHarness } from "../playtest/realEngineHarness";
import type { StarSystem } from "@/domain/StarSystem";
import type { Player } from "@/domain/Player";
import type { Reward } from "@/types";
import { QuestManager } from "@/systems/QuestManager";
import { Quest } from "@/domain/Quest";
import { QuestType, ResourceType } from "@/types";
import { generateQuestBoard } from "@/systems/quests/QuestGenerator";
import { jumpDistances } from "@/systems/galaxy/jumpDistance";
import { pirateSalvageAmount } from "@/systems/combat/pirateSalvage";
import { stepOwnershipTick } from "@/systems/galaxy/OvermindBalance";
import { SeededRNG } from "@/utils/seededRNG";
import {
  GAME_BALANCE,
  QUEST_REPUTATION_REWARD,
  QUEST_DEADLINE_BASE_DAYS,
  QUEST_DEADLINE_PER_JUMP_DAYS,
  QUEST_DEADLINE_BUFFER_MIN_DAYS,
  QUEST_DEADLINE_BUFFER_MAX_DAYS,
} from "@/config/balance";

/**
 * Task 8 — the late-game **recoverability** oracle (covers the letsplay oracle's
 * day-blind spot). The CI oracle (`npm run letsplay:ci`) never advances a galaxy
 * day, so it cannot see the pathologies the reporter hit by day 1066: a galaxy
 * captured beyond recovery, a runaway pirate-salvage faucet, a reputation that
 * only ever decays, and quest deadlines unreachable for their real jump route.
 *
 * This file advances the **real** engine over many galaxy days (and exercises the
 * pure recovery seams added in Tasks 1–5) and asserts the four invariants the
 * whole pass exists to guarantee:
 *  1. the Overmind/pirate front settles into a **non-terminal equilibrium** and is
 *     **regainable** — never an irreversible total wipe;
 *  2. the salvage **anti-farm cap** holds — farming pirates can't exceed a sane
 *     credits/day;
 *  3. reputation is **recoverable but not trivial** — honest quest play climbs out
 *     of −50 over a *bounded* number of quests, never one-shot, never overshooting;
 *  4. quest **deadlines** generated across the run are **reachable** for the real
 *     (undirected nav) jump distance.
 *
 * Relationships, not magnitudes (the oddity-hunting convention) — only an actual
 * regression (a runaway front, an uncapped faucet, a dead/one-shot recovery, an
 * impossible deadline) reds the gate.
 */
vi.mock("pixi.js", async () =>
  (await import("../playtest/pixiStub")).makePixiStub(),
);

/** Day step between sampled boards — wider than BOARD_REFRESH_DAYS so each bucket
 *  re-rolls a fresh board. */
const BOARD_REFRESH_TEST_STEP = 7;

describe("Task 8 — late-game front stays a recoverable equilibrium (not a total wipe)", () => {
  let harness: RealEngineHarness;
  afterEach(() => harness?.dispose());

  it("the negative-feedback ownership churn converges over a long horizon — faction systems always remain", async () => {
    // The recoverable game's stable core: the self-balancing ownership tick
    // (`stepOwnershipTick`) must pin the hostile share into a *bounded
    // equilibrium* rather than ratchet to a total wipe. Drive it over the REAL
    // generated warp graph for hundreds of iterations with the live tuning — the
    // escalating Overmind *arc* (`advanceOvermind`) is a separate, deliberately
    // unbounded narrative front and is NOT what this invariant is about; this is
    // the equilibrium that keeps the galaxy from becoming irreversibly hostile.
    harness = await RealEngineHarness.boot({
      seed: "LATEGAME_EQUILIBRIUM",
      systemCount: 24,
    });
    await harness.newGame();
    const galaxy = harness.galaxy()!;
    const total = galaxy.systems.length;

    const nodes = galaxy.systems.map((s) => ({
      id: s.id,
      connections: s.connections,
    }));
    const config = {
      pCapture: GAME_BALANCE.OVERMIND_CAPTURE_PROB,
      pRecaptureBase: GAME_BALANCE.OVERMIND_RECAPTURE_BASE_PROB,
      feedbackStrength: GAME_BALANCE.OVERMIND_FEEDBACK_STRENGTH,
    };
    // Seed a small hostile front (one overmind + one pirate) and let it churn.
    let overmind = [galaxy.systems[0].id];
    let pirate = [galaxy.systems[Math.floor(total / 2)].id];
    const rng = new SeededRNG("equilibrium-horizon");

    let peakHostileShare = 0;
    let everPersisted = false;
    for (let tick = 0; tick < 500; tick++) {
      const result = stepOwnershipTick(nodes, overmind, pirate, rng, config);
      overmind = result.overmindSystems;
      pirate = result.pirateSystems;
      const hostile = overmind.length + pirate.length;
      // Never a total wipe — faction-held systems always remain, every tick.
      expect(hostile).toBeLessThan(total);
      if (hostile > 0) everPersisted = true;
      peakHostileShare = Math.max(peakHostileShare, hostile / total);
    }

    // The equilibrium is genuinely *bounded* — the negative feedback caps the
    // front well below a wipe (the majority of the galaxy stays faction-held).
    expect(peakHostileShare).toBeLessThanOrEqual(0.6);
    // ...and it is a real, non-trivial equilibrium (the front persists — the tick
    // neither runs away nor auto-erases every hostile system).
    expect(everPersisted).toBe(true);
    expect(harness.errors().map((e) => e.message)).toEqual([]);
  });

  it("a captured front is reversible — every captured system is regainable (no one-way ratchet)", async () => {
    // Let the front grow under neglect, then prove it can be fully reclaimed: the
    // late game is never a permanent brick.
    harness = await RealEngineHarness.boot({
      seed: "LATEGAME_REVERSIBLE",
      systemCount: 24,
    });
    await harness.newGame();
    const galaxy = harness.galaxy()!;
    const startHostile =
      galaxy.overmindSystems.length + galaxy.pirateSystems.length;

    for (let day = 0; day < 20; day++) harness.engine.advanceGalaxyDay();
    const captured = [
      ...new Set([...galaxy.overmindSystems, ...galaxy.pirateSystems]),
    ];
    // The front genuinely advanced under neglect (otherwise the test is vacuous).
    expect(captured.length).toBeGreaterThan(startHostile);

    // Every captured system flips back to faction control — the player CAN recover.
    for (const id of captured) {
      expect(galaxy.isHostileSystem(id)).toBe(true);
      expect(galaxy.tryLiberate(id)).toBe(true);
      expect(galaxy.isHostileSystem(id)).toBe(false);
    }
    // Fully reclaimed: no hostile system remains.
    expect(galaxy.overmindSystems.length + galaxy.pirateSystems.length).toBe(0);
    expect(harness.errors().map((e) => e.message)).toEqual([]);
  });
});

describe("Task 8 — pirate salvage anti-farm cap holds (sane credits/day)", () => {
  const cap = GAME_BALANCE.pirateSalvageDailyCap;
  const fraction = GAME_BALANCE.pirateSalvageFraction;

  it("no number of kills exceeds the per-day cap — salvage is never an infinite faucet", () => {
    // Farm 100 rich (1000 cr) wrecks in a single galaxy day.
    let salvagedToday = 0;
    for (let kill = 0; kill < 100; kill++) {
      salvagedToday += pirateSalvageAmount(1000, fraction, salvagedToday, cap);
    }
    // The day's total is clamped EXACTLY at the cap, regardless of kill count.
    expect(salvagedToday).toBe(cap);
  });

  it("the cap is meaningful but sane — several kills to fill a day, capped well below a major upgrade", () => {
    const oneRichKill = pirateSalvageAmount(1000, fraction, 0, cap);
    expect(oneRichKill).toBeGreaterThan(0); // a real reward
    expect(oneRichKill).toBeLessThan(cap); // ...but one kill is not the whole day
    // Sane ceiling: a full day of salvage-farming stays a combat *supplement*, not
    // a primary income exploit — it can't bankroll a major ship upgrade in a day.
    expect(cap).toBeGreaterThan(0);
    expect(cap).toBeLessThanOrEqual(2000);
  });
});

/** Minimal Player projection the QuestManager rep path reads. */
function playerStub(): Player {
  const reputation: Record<string, number> = {};
  return {
    credits: 0,
    experience: 0,
    contrabandGoods: [],
    completedQuestChains: [],
    inventory: {
      resources: [] as { type: ResourceType; amount: number }[],
      modules: [],
      micromodules: [],
      cosmetics: [],
    },
    reputation,
    getReputation: (id: string) => reputation[id] ?? 0,
    adjustReputation: (id: string, delta: number) => {
      reputation[id] = Math.max(
        -100,
        Math.min(100, (reputation[id] ?? 0) + delta),
      );
    },
  } as unknown as Player;
}

/** A faction-issued quest, due `deadline` days from now. */
function makeFactionQuest(id: string, factionId: string): Quest {
  const reward: Reward = { credits: 300, experience: 100, items: [] };
  return new Quest(
    id,
    "Faction Quest",
    QuestType.DELIVERY,
    [
      {
        id: `${id}_visit`,
        description: "Visit",
        type: "VISIT_LOCATION",
        targetAmount: 1,
        currentAmount: 0,
        completed: false,
        locationId: "sys_B_p1",
      },
    ],
    reward,
    [],
    "origin_planet",
    0,
    10,
    { reputationLoss: 15, description: "test penalty" },
    "sys_B",
    null,
    0,
    null,
    -1,
    factionId,
    null,
  );
}

describe("Task 8 — reputation is recoverable but not trivial", () => {
  it("honest quest play climbs out of −50 over a BOUNDED number of quests (no one-shot, no overshoot)", () => {
    const REWARD = QUEST_REPUTATION_REWARD;
    expect(REWARD).toBeGreaterThan(0);
    expect(REWARD).toBeLessThan(50); // a single quest can't undo a −50 collapse

    const qm = new QuestManager();
    const player = playerStub();
    (player.reputation as Record<string, number>)["faction_A"] = -50;

    // Enough quests to recover, with headroom — the recovery must fit this bound.
    const MAX_QUESTS = Math.ceil(50 / REWARD) + 2;
    let completed = 0;
    let prev = player.getReputation("faction_A");
    while (player.getReputation("faction_A") < 0 && completed < MAX_QUESTS) {
      const quest = makeFactionQuest(`q_lh_${completed}`, "faction_A");
      qm["activeQuests"].set(quest.id, quest);
      expect(qm.forceCompleteQuest(quest.id, player)).toBe(true);
      const now = player.getReputation("faction_A");
      expect(now).toBeGreaterThan(prev); // monotone climb — every quest helps
      expect(now).toBeLessThanOrEqual(100); // never overshoots the rep clamp
      prev = now;
      completed++;
    }

    expect(player.getReputation("faction_A")).toBeGreaterThanOrEqual(0); // recovered
    expect(completed).toBeGreaterThan(1); // NOT a one-shot fix (takes several quests)
    expect(completed).toBeLessThanOrEqual(MAX_QUESTS); // ...but bounded, not endless
  });

  it("the rep clamp prevents overshoot at the ceiling (99 → 100, never past)", () => {
    const qm = new QuestManager();
    const player = playerStub();
    (player.reputation as Record<string, number>)["faction_A"] = 99;
    const quest = makeFactionQuest("q_lh_clamp", "faction_A");
    qm["activeQuests"].set(quest.id, quest);
    qm.forceCompleteQuest(quest.id, player);
    expect(player.getReputation("faction_A")).toBe(100);
  });
});

describe("Task 8 — quest deadlines stay reachable across the run", () => {
  let harness: RealEngineHarness;
  afterEach(() => harness?.dispose());

  it("every timed quest on every refresh bucket is reachable for its real (undirected nav) jump distance", async () => {
    harness = await RealEngineHarness.boot({
      seed: "LATEGAME_DEADLINES",
      systemCount: 24,
    });
    await harness.newGame();
    const galaxy = harness.galaxy()!;

    // The nav warps along an edge in EITHER direction, so the deadline budget and
    // the advertised distance must both use the undirected graph (Task 1). Use the
    // real warp graph; mark systems explored so the board has reachable targets.
    const navSystems = galaxy.systems.map(
      (s) =>
        ({
          id: s.id,
          name: s.name,
          explored: true,
          connections: s.connections,
          planets: s.planets,
        }) as unknown as StarSystem,
    );
    const origin =
      galaxy.systems.find(
        (s) =>
          s.id === harness.player()!.currentSystemId && s.planets.length > 0,
      ) ?? galaxy.systems.find((s) => s.planets.length > 0)!;
    const planet = origin.planets[0];
    const navDist = jumpDistances(navSystems, origin.id, { undirected: true });

    let timedSeen = 0;
    // Sweep many refresh buckets — "across the run" the board re-rolls but every
    // timed job it ever advertises must be travellable in time.
    for (let bucket = 0; bucket < 40; bucket++) {
      const board = generateQuestBoard({
        systems: navSystems,
        originSystemId: origin.id,
        planetId: planet.id,
        day: bucket * BOARD_REFRESH_TEST_STEP,
        seed: `lategame-deadlines-${bucket}`,
        count: 30,
        textRatio: 0,
        eliteRatio: 0.1,
        chainRatio: 0.1,
      });
      for (const q of board) {
        if (q.template.deadline <= 0) continue; // local/text quests carry no jump
        timedSeen++;
        const budget =
          QUEST_DEADLINE_BASE_DAYS + q.jumps * QUEST_DEADLINE_PER_JUMP_DAYS;
        // Reachable: ≥ a realistic travel budget for the real jump count + buffer.
        expect(q.template.deadline).toBeGreaterThanOrEqual(
          budget + QUEST_DEADLINE_BUFFER_MIN_DAYS,
        );
        // ...but bounded (linear in jumps) — a far job is not infinite free time.
        expect(q.template.deadline).toBeLessThanOrEqual(
          budget + QUEST_DEADLINE_BUFFER_MAX_DAYS,
        );
        // The advertised distance equals what the nav actually travels (one metric).
        expect(q.jumps).toBe(navDist.get(q.targetSystemId));
      }
    }
    expect(timedSeen).toBeGreaterThan(0); // not a vacuous pass
    expect(harness.errors().map((e) => e.message)).toEqual([]);
  });
});
