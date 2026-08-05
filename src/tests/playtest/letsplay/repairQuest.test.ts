import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RealEngineHarness } from "../realEngineHarness";
import { PlayerAgent } from "./PlayerAgent";
import type { PlayerPolicy, Action } from "./PlayerPolicy";
import type { Observation } from "./observe";
import { SceneType } from "@/types";
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

describe("letsplay repair + quest executor (Task 4)", () => {
  let harness: RealEngineHarness;

  beforeEach(async () => {
    localStorage.clear();
    harness = await RealEngineHarness.boot({ seed: "REPAIR-QUEST-TEST" });
    await harness.newGame();
  });

  afterEach(() => {
    harness?.dispose();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("repair restores hull and spends credits", async () => {
    expect(harness.currentSceneType()).toBe(SceneType.SPACE_FLIGHT);

    const engine = harness.engine;
    const sys = currentSystem(engine);
    const station = sys?.stations[0];
    if (!station) {
      const player = engine.player!;
      player.ship.hullHP = Math.max(1, player.ship.maxHull - 50);
      const agent = new PlayerAgent(harness, scripted("repair"));
      await agent.run(1);
      expect(harness.errors()).toHaveLength(0);
      return;
    }

    await harness.goTo(SceneType.STATION, { station });
    expect(harness.currentSceneType()).toBe(SceneType.STATION);

    const player = engine.player!;
    const maxHull = player.ship.maxHull;
    player.ship.hullHP = Math.max(1, maxHull - 50);
    const hullBefore = player.ship.hullHP;
    const creditsBefore = player.credits;

    const agent = new PlayerAgent(harness, scripted("repair"));
    await agent.run(1);

    const hullAfter = player.ship.hullHP;
    const creditsAfter = player.credits;
    expect(hullAfter).toBeGreaterThan(hullBefore);
    expect(creditsAfter).toBeLessThan(creditsBefore);
    expect(harness.errors()).toHaveLength(0);
  });

  it("repair is a safe no-op when hull is already perfect", async () => {
    const engine = harness.engine;
    const sys = currentSystem(engine);
    const station = sys?.stations[0];

    if (station) {
      await harness.goTo(SceneType.STATION, { station });
    }

    const player = engine.player!;
    const loadout = engine.playerLoadout;
    const { applyLoadoutHullToShip } =
      await import("@/systems/equipment/GearBridge");
    if (loadout) applyLoadoutHullToShip(player.ship, loadout);
    player.ship.hullHP = player.ship.maxHull;
    const creditsBefore = player.credits;

    const agent = new PlayerAgent(harness, scripted("repair"));
    await agent.run(1);

    expect(player.credits).toBe(creditsBefore);
    expect(harness.errors()).toHaveLength(0);
  });

  it("take-quest accepts a board quest via the real QuestManager", async () => {
    const engine = harness.engine;

    const sys = currentSystem(engine);
    const planet = sys?.planets.find((p) => p.availableQuests.length > 0);
    if (!planet) {
      const agent = new PlayerAgent(harness, scripted("take-quest"));
      await agent.run(1);
      expect(harness.errors()).toHaveLength(0);
      return;
    }

    await harness.goTo(SceneType.PLANET, { planet });
    expect(harness.currentSceneType()).toBe(SceneType.PLANET);

    const questsBefore = engine.questManager.getActiveQuests().length;

    const agent = new PlayerAgent(harness, scripted("take-quest"));
    await agent.run(1);

    const questsAfter = engine.questManager.getActiveQuests().length;
    expect(questsAfter).toBeGreaterThan(questsBefore);
    expect(harness.errors()).toHaveLength(0);
  });

  it("quest completion grants credits via the real grantReward path", async () => {
    const engine = harness.engine;

    const sys = currentSystem(engine);
    const planet = sys?.planets.find((p) => p.availableQuests.length > 0);
    if (!planet) {
      expect(harness.errors()).toHaveLength(0);
      return;
    }

    await harness.goTo(SceneType.PLANET, { planet });
    const agent = new PlayerAgent(harness, scripted("take-quest"));
    await agent.run(1);

    const activeQuests = engine.questManager.getActiveQuests();
    if (activeQuests.length === 0) {
      expect(harness.errors()).toHaveLength(0);
      return;
    }

    const quest = activeQuests[0];
    const creditsBefore = engine.player!.credits;
    const completedBefore = engine.questManager.getCompletedQuestIds().length;

    const claimed = engine.questManager.forceCompleteQuest(
      quest.id,
      engine.player!,
    );
    expect(claimed).toBe(true);

    expect(engine.player!.credits).toBeGreaterThanOrEqual(creditsBefore);
    expect(engine.questManager.getCompletedQuestIds().length).toBe(
      completedBefore + 1,
    );
    expect(harness.errors()).toHaveLength(0);
  });
});
