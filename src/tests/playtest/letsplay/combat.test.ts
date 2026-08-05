import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RealEngineHarness } from "../realEngineHarness";
import { PlayerAgent, LOOT_LINGER_TICKS } from "./PlayerAgent";
import type { PlayerPolicy, Action } from "./PlayerPolicy";
import type { Observation } from "./observe";
import { SceneType } from "@/types";
import { GAME_BALANCE } from "@/config/balance";
import { currentSystem } from "./engineQueries";

vi.mock("pixi.js", async () => (await import("../pixiStub")).makePixiStub());

function scripted(kind: Action["kind"]): PlayerPolicy {
  return {
    name: "scripted",
    decide(obs: Observation): Action {
      const k = obs.legalActions.includes(kind) ? kind : "wait";
      return { kind: k, reason: "scripted" };
    },
  };
}

function forceAggressorInRange(
  harness: RealEngineHarness,
  weaponRange: number,
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

describe("letsplay combat executor (Task 3)", () => {
  let harness: RealEngineHarness;

  beforeEach(async () => {
    localStorage.clear();
    harness = await RealEngineHarness.boot({ seed: "COMBAT-TEST" });
    await harness.newGame();
  });

  afterEach(() => {
    harness?.dispose();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("attack drives combat to completion — hull changes when a hostile is in weapon range", async () => {
    expect(harness.currentSceneType()).toBe(SceneType.SPACE_FLIGHT);

    const engine = harness.engine;

    const npc = forceAggressorInRange(harness, GAME_BALANCE.weaponRange);
    if (!npc) {
      const agent = new PlayerAgent(harness, scripted("attack"));
      await agent.run(1);
      expect(harness.errors()).toHaveLength(0);
      return;
    }

    engageCombatNow(harness);

    const playerHullBefore = engine.player!.ship.hullHP;
    const npcHullBefore = npc.hullHP; // always 200 (set by e2eForceAggressorInRange)

    const agent = new PlayerAgent(harness, scripted("attack"));
    await agent.run(1);

    const playerHullAfter = engine.player!.ship.hullHP;
    const npcHullAfter = npc.hullHP; // live reference — mutated by fireNpcShot/firePlayerShot

    const combatFired =
      playerHullAfter !== playerHullBefore || npcHullAfter < npcHullBefore;
    expect(combatFired).toBe(true);
    expect(harness.errors()).toHaveLength(0);
  });

  it("attack engages the afterburner while still closing to a fresh target (2026-07-19: combat-variant coverage, Task 7)", async () => {
    const npc = forceAggressorInRange(harness, GAME_BALANCE.weaponRange);
    if (!npc) {
      const agent = new PlayerAgent(harness, scripted("attack"));
      await agent.run(1);
      expect(harness.errors()).toHaveLength(0);
      return;
    }
    const scene = harness.currentScene() as unknown as {
      combatPlanning?: { setAfterburner?: (on: boolean) => void };
    };
    const setAfterburnerSpy = vi.spyOn(
      scene.combatPlanning as { setAfterburner: (on: boolean) => void },
      "setAfterburner",
    );

    const agent = new PlayerAgent(harness, scripted("attack"));
    await agent.run(1);

    expect(setAfterburnerSpy).toHaveBeenCalledWith(true);
    expect(harness.errors()).toHaveLength(0);
  });

  it("attack lingers at a fresh kill instead of leaving instantly, giving the wreck's staggered loot a chance to spawn+get picked up (2026-07-19 live report)", async () => {
    const npc = forceAggressorInRange(harness, GAME_BALANCE.weaponRange);
    if (!npc) {
      const agent = new PlayerAgent(harness, scripted("attack"));
      await agent.run(1);
      expect(harness.errors()).toHaveLength(0);
      return;
    }
    (npc as unknown as { hullHP: number; maxHull: number }).hullHP = 1;
    (npc as unknown as { hullHP: number; maxHull: number }).maxHull = 2;

    let deathTickIndex = -1;
    const originalTick = harness.tick.bind(harness);
    const tickSpy = vi
      .spyOn(harness, "tick")
      .mockImplementation((deltaMs?: number) => {
        originalTick(deltaMs);
        if (deathTickIndex === -1 && npc.hullHP <= 0) {
          deathTickIndex = tickSpy.mock.calls.length - 1;
        }
      });

    const agent = new PlayerAgent(harness, scripted("attack"));
    await agent.run(1);

    expect(deathTickIndex).toBeGreaterThanOrEqual(0); // confirms the kill happened
    const ticksAfterDeath = tickSpy.mock.calls.length - 1 - deathTickIndex;
    expect(ticksAfterDeath).toBeGreaterThanOrEqual(LOOT_LINGER_TICKS - 5);
    expect(harness.errors()).toHaveLength(0);
  });

  it("flee navigates to the star map when connections exist", async () => {
    expect(harness.currentSceneType()).toBe(SceneType.SPACE_FLIGHT);

    const sys = currentSystem(harness.engine);
    const hasConnections = (sys?.connections.length ?? 0) > 0;
    if (!hasConnections) {
      forceAggressorInRange(harness, GAME_BALANCE.weaponRange);
      const agent = new PlayerAgent(harness, scripted("flee"));
      await agent.run(1);
      expect(harness.errors()).toHaveLength(0);
      return;
    }

    forceAggressorInRange(harness, GAME_BALANCE.weaponRange);

    const agent = new PlayerAgent(harness, scripted("flee"));
    await agent.run(1);

    expect(harness.currentSceneType()).toBe(SceneType.STAR_MAP);
    expect(harness.errors()).toHaveLength(0);
  });

  it("flee falls back to waitOneDay when no connections exist", async () => {
    const sys = currentSystem(harness.engine);
    if (sys) {
      (sys as unknown as { connections: unknown[] }).connections = [];
    }
    const day0 = harness.engine.galaxy!.gameDays;

    forceAggressorInRange(harness, GAME_BALANCE.weaponRange);

    const agent = new PlayerAgent(harness, scripted("flee"));
    await agent.run(1);

    expect(harness.engine.galaxy!.gameDays).toBeGreaterThan(day0);
    expect(harness.errors()).toHaveLength(0);
  });

  it("attack is a safe no-op (wait tick) when no hostile is in weapon range", async () => {
    const day0 = harness.engine.galaxy!.gameDays;

    const agent = new PlayerAgent(harness, scripted("attack"));
    await agent.run(1);

    expect(harness.engine.galaxy!.gameDays).toBeGreaterThanOrEqual(day0);
    expect(harness.errors()).toHaveLength(0);
  });
});
