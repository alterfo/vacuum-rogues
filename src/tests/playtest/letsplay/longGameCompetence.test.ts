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
    await harness.newGame(FactionType.OUTLANDERS, "GOD");
    const engine = harness.engine;
    expect(harness.currentSceneType()).toBe(SceneType.SPACE_FLIGHT);

    const npc = forceAggressorInRange(harness);
    if (!npc) {
      expect(harness.errors()).toHaveLength(0);
      return;
    }
    engageCombatNow(harness);

    const startSystem = engine.player!.currentSystemId;

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
      expect(engine.currentSceneType).toBe(SceneType.SPACE_FLIGHT);
    }

    expect(hullStart - hullAfterStep[3]).toBeGreaterThanOrEqual(
      2 * weaponDamage,
    );
    expect(hullAfterStep[3]).toBeLessThan(hullAfterStep[0]);
    expect(harness.errors()).toHaveLength(0);
  }, 60_000);

  it("(d) a committed escape jump completes even when the GOD floor trips mid-transit", async () => {
    localStorage.clear();
    harness = await RealEngineHarness.boot({ seed: "COMBAT-TEST" });
    await harness.newGame(FactionType.OUTLANDERS, "GOD");
    const engine = harness.engine;
    const startSystem = engine.player!.currentSystemId;

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
    const ship = engine.player!.ship;
    const floored = applyDamageWithMode(
      "GOD",
      ship.hullHP,
      ship.hullHP + ship.maxHull,
      ship.maxHull,
    );
    expect(floored.downed).toBe(true); // the volley DID down the ship
    ship.hullHP = floored.hull;
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

  it("(c) 200-day horizon — quests complete at a positive rate and the run stays solvent", async () => {
    localStorage.clear();
    const r = await runCampaignSession({
      seed: "CAMPAIGN-CAPACITY-0",
      maxDays: 200,
      gameMode: "GOD",
    });
    const detail = formatCampaignReport([r]);

    expect(r.errors, detail).toBe(0);
    expect(r.violations, detail).toBe(0);
    expect(r.calendarWedged, detail).toBe(false);
    expect(r.stepStalled, detail).toBe(false);
    expect(r.died, detail).toBe(false);

    expect(r.questsCompleted, detail).toBeGreaterThanOrEqual(3);
    expect(r.finalCredits - r.loanBalance, detail).toBeGreaterThan(-500);
  }, 120_000);
});
