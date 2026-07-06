/**
 * Task 7 (three-year-campaign plan) — autopilot long-game competence.
 *
 * Three real-engine gates on the letsplay apply layer + economy tier:
 *
 *  (a) **flee disengages** — a `flee` decision followed by the escape jump
 *      actually LEAVES the contested system (the old executor was a silent
 *      tick: the ship stood in weapon range trading volleys forever — the
 *      `project-letsplay-flee-noop-deadhead` ceiling).
 *  (b) **attack lands damage over ticks** — consecutive `attack` steps drive
 *      the real CombatModule day after day: the engaged hostile's hull keeps
 *      falling across steps (not just one lucky volley in one step, which
 *      `combat.test.ts` already pins).
 *  (c) **200-day economy horizon** — the `MemoryHeuristicPolicy` economy tier
 *      keeps producing over a long campaign horizon: quests complete at a
 *      positive rate and the run ends credit-positive vs the 1000cr start.
 *      GOD mode isolates the ECONOMY tier from combat survival (deaths are
 *      Task 8's slayer-tuning concern; GOD floors hull but changes no
 *      decision, price, or payout).
 *
 * Real-engine tier: boots the real GameEngine (pixi.js stubbed), drives the
 * real PlayerAgent applier — never a mocked seam.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { FactionType, SceneType } from "@/types";
import { RealEngineHarness } from "../realEngineHarness";
import { PlayerAgent } from "./PlayerAgent";
import type { PlayerPolicy, Action } from "./PlayerPolicy";
import type { Observation } from "./observe";
import { runCampaignSession } from "./campaign.run";
import { formatCampaignReport } from "./campaignMetrics";
import { applyDamageWithMode } from "@/systems/combat/godMode";
import { reachableNeighbors } from "./engineQueries";

vi.mock("pixi.js", async () => (await import("../pixiStub")).makePixiStub());

/**
 * Access the NpcShipManager's white-box `e2eForceAggressorInRange` test seam
 * (same pattern as `combat.test.ts`): position the first NPC sprite inside
 * weapon range, mark it aggressive, and return its live NPC domain object.
 */
function forceAggressorInRange(
  harness: RealEngineHarness,
  weaponRange = 200,
): { hullHP: number; damage: number } | null {
  const scene = harness.currentScene() as unknown as {
    npcManager?: {
      e2eForceAggressorInRange?: (
        range: number,
      ) => { npc: { hullHP: number; damage: number } } | null;
    };
  } | null;
  const sprite = scene?.npcManager?.e2eForceAggressorInRange?.(weaponRange);
  return sprite?.npc ?? null;
}

/** Register the forced sprite as a combatant NOW (see `combat.test.ts`). */
function engageCombatNow(harness: RealEngineHarness): void {
  const scene = harness.currentScene() as unknown as {
    npcManager?: { e2eEngageCombat?: () => void };
  } | null;
  scene?.npcManager?.e2eEngageCombat?.();
}

describe("Task 7 — long-game competence (executors + economy)", () => {
  let harness: RealEngineHarness | null = null;

  afterEach(() => {
    harness?.dispose();
    harness = null;
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("(a) flee executor disengages — the ship escapes the contested system, not a no-op tick", async () => {
    localStorage.clear();
    harness = await RealEngineHarness.boot({ seed: "COMBAT-TEST" });
    // GOD keeps the fleeing starter ship alive through the escape volleys so
    // the assertion is about the EXECUTOR (does flee actually leave?), not
    // about whether this seed's hostile happens to kill a 130-hull corvette.
    await harness.newGame(FactionType.OUTLANDERS, "GOD");
    const engine = harness.engine;
    expect(harness.currentSceneType()).toBe(SceneType.SPACE_FLIGHT);

    const npc = forceAggressorInRange(harness);
    if (!npc) {
      // No NPC sprite with this seed (would be a seed drift) — nothing to flee.
      expect(harness.errors()).toHaveLength(0);
      return;
    }
    engageCombatNow(harness);

    const startSystem = engine.player!.currentSystemId;

    // Scripted two-step escape, exactly the ladder's own shape: `flee` while a
    // hostile is present (→ STAR_MAP), `warp` from the map (→ escape jump).
    const fleeThenWarp: PlayerPolicy = {
      name: "flee-then-warp",
      decide(obs: Observation): Action {
        if (
          obs.scene === SceneType.STAR_MAP &&
          obs.legalActions.includes("warp")
        ) {
          return { kind: "warp", reason: "mem:flee-escape-jump" };
        }
        if (obs.hostiles.length > 0 && obs.legalActions.includes("flee")) {
          return { kind: "flee", reason: "mem:flee-outgunned" };
        }
        return { kind: "wait", reason: "scripted" };
      },
    };

    const agent = new PlayerAgent(harness, fleeThenWarp);
    // flee (→ STAR_MAP) + warp (jump + completeWarp) + slack for a rejected
    // first pick — the old no-op executor never changes system in ANY budget.
    for (let i = 0; i < 6; i++) {
      await agent.run(1);
      if (engine.player!.currentSystemId !== startSystem) break;
    }

    expect(engine.player!.currentSystemId).not.toBe(startSystem);
    expect(harness.errors()).toHaveLength(0);
  }, 60_000);

  it("(b) attack executor lands damage over ticks — hostile hull keeps falling across attack steps", async () => {
    localStorage.clear();
    harness = await RealEngineHarness.boot({ seed: "COMBAT-TEST" });
    // GOD floors the PLAYER's hull only — the hostile's hull and the player's
    // outgoing damage are untouched, so the "damage lands over ticks" signal
    // is exactly NORMAL's while the multi-day exchange can't end the test in
    // a GAME_OVER before enough volleys accumulate.
    await harness.newGame(FactionType.OUTLANDERS, "GOD");
    const engine = harness.engine;

    const npc = forceAggressorInRange(harness);
    if (!npc) {
      expect(harness.errors()).toHaveLength(0);
      return;
    }
    engageCombatNow(harness);

    const hullStart = npc.hullHP; // 200, set by the seam
    const weaponDamage = 14; // starter pulse laser — one landed shot's worth

    const alwaysAttack: PlayerPolicy = {
      name: "always-attack",
      decide(obs: Observation): Action {
        return obs.legalActions.includes("attack")
          ? { kind: "attack", reason: "scripted" }
          : { kind: "wait", reason: "scripted" };
      },
    };

    const agent = new PlayerAgent(harness, alwaysAttack);
    const hullAfterStep: number[] = [];
    for (let i = 0; i < 4; i++) {
      await agent.run(1);
      hullAfterStep.push(npc.hullHP);
      // The player may leave flight only via game-over (GOD forbids it) — the
      // scripted attack never navigates, so the fight stays engaged.
      expect(engine.currentSceneType).toBe(SceneType.SPACE_FLIGHT);
    }

    // Damage accumulated ACROSS steps: at least two landed shots in total…
    expect(hullStart - hullAfterStep[3]).toBeGreaterThanOrEqual(
      2 * weaponDamage,
    );
    // …and it kept falling in the later steps (not one first-step volley):
    expect(hullAfterStep[3]).toBeLessThan(hullAfterStep[0]);
    expect(harness.errors()).toHaveLength(0);
  }, 60_000);

  it("(d) a committed escape jump completes even when the GOD floor trips mid-transit", async () => {
    localStorage.clear();
    harness = await RealEngineHarness.boot({ seed: "COMBAT-TEST" });
    await harness.newGame(FactionType.OUTLANDERS, "GOD");
    const engine = harness.engine;
    const startSystem = engine.player!.currentSystemId;

    // Commit the jump LEGALLY (healthy ship) straight on the map scene —
    // initiating a jump while downed stays blocked, that gate is untouched.
    // (The agent's own `warp` step drives the whole transit atomically, so
    // the mid-transit interruption must be staged around the raw seam.)
    await harness.goTo(SceneType.STAR_MAP);
    const neighbor = reachableNeighbors(
      engine.galaxy?.systems ?? [],
      startSystem,
    )[0]?.toSystemId;
    expect(neighbor).toBeTruthy();
    const mapScene = harness.currentScene() as unknown as {
      performWarpJumpTo?: (id: string) => Promise<void>;
    } | null;
    await mapScene!.performWarpJumpTo!(neighbor!);
    expect(harness.currentSceneType()).toBe(SceneType.SPACE_FLIGHT);
    expect(engine.player!.currentSystemId).toBe(startSystem); // still in transit
    // Mid-transit intercept: floor the hull the way a garrison volley does
    // (`applyDamageWithMode` in GOD floors above 0 ⇒ DOWNED) — the exact
    // pinned-at-the-front state of the measured day-255 campaign wedge, where
    // `performWarp` used to CANCEL the committed jump on `isDowned` at the
    // system edge and the repair→jump→intercepted→cancelled loop ran until
    // bankruptcy (27 failed escapes). Reaching the edge must mean escape.
    const ship = engine.player!.ship;
    const floored = applyDamageWithMode(
      "GOD",
      ship.hullHP,
      ship.hullHP + ship.maxHull,
      ship.maxHull,
    );
    expect(floored.downed).toBe(true); // the volley DID down the ship
    ship.hullHP = floored.hull;
    // Drive the remaining transit (the agent's warp-in-transit guard drives
    // `completeWarp`): the committed escape must still fire at the edge.
    const waiter: PlayerPolicy = {
      name: "waiter",
      decide(): Action {
        return { kind: "wait", reason: "scripted" };
      },
    };
    const agent = new PlayerAgent(harness, waiter);
    for (let i = 0; i < 6; i++) {
      await agent.run(1);
      if (engine.player!.currentSystemId !== startSystem) break;
    }

    expect(engine.player!.currentSystemId).not.toBe(startSystem);
    expect(harness.errors()).toHaveLength(0);
  }, 60_000);

  it("(c) 200-day horizon — quests complete at a positive rate and the run ends credit-positive", async () => {
    localStorage.clear();
    // GOD isolates the economy tier from combat survival (Task 8 owns
    // deaths); the seed is the campaign harness's own capacity seed, so this
    // gate and `letsplay:campaign` read the same trajectory.
    const r = await runCampaignSession({
      seed: "CAMPAIGN-CAPACITY-0",
      maxDays: 200,
      gameMode: "GOD",
    });
    const detail = formatCampaignReport([r]);

    // The session ran honestly: no faults, no frozen calendar, no death.
    expect(r.errors, detail).toBe(0);
    expect(r.violations, detail).toBe(0);
    expect(r.calendarWedged, detail).toBe(false);
    expect(r.stepStalled, detail).toBe(false);
    expect(r.died, detail).toBe(false);

    // Positive quest cadence over the long horizon — the pre-Task-7 economy
    // completed 1 quest in 200 days and then churned land↔take-off broke.
    expect(r.questsCompleted, detail).toBeGreaterThanOrEqual(3);
    // Credit-positive vs the 1000cr start, NET of any outstanding loan —
    // earning must outrun repair/fees, and borrowed principal doesn't count.
    expect(r.finalCredits - r.loanBalance, detail).toBeGreaterThan(1000);
  }, 120_000);
});
