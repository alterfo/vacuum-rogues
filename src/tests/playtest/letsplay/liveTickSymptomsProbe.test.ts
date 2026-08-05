import { describe, it, expect, vi } from "vitest";
import { RealEngineHarness } from "../realEngineHarness";
import { SceneType } from "@/types";
import type { Planet } from "@/domain/Planet";
import {
  MemoryHeuristicPolicy,
  MAX_FOLDS_WITHOUT_DAY_ADVANCE,
} from "./MemoryHeuristicPolicy";
import {
  createMemory,
  updateMemory,
  questBaselineForObserve,
  type AgentMemory,
} from "./AgentMemory";
import { observe } from "./observe";
import { applyLiveAction } from "./LiveApplier";
import { createLiveSceneController } from "./installAutopilotHook";

vi.mock("pixi.js", async () => (await import("../pixiStub")).makePixiStub());

interface FlightSceneModals {
  hud: {
    toggleQuestJournal: () => void;
    isQuestJournalOpen: () => boolean;
  };
  planetManager: {
    handlePlanetClick: (planet: Planet) => void;
    hasInfoPanel: boolean;
  };
}

function longestTwoSystemPingPong(seq: string[]): number {
  let best = 1;
  let run = 1;
  for (let i = 2; i < seq.length; i++) {
    if (seq[i] === seq[i - 2] && seq[i] !== seq[i - 1]) {
      run += 1;
      best = Math.max(best, run);
    } else {
      run = 1;
    }
  }
  return best;
}

describe("Task 1 — live-tick symptom reproduction probe", () => {
  it("(3, Task 2 FIXED) a manually-opened quest journal survives one grace tick, then still auto-closes if left idle", async () => {
    const harness = await RealEngineHarness.boot({ seed: "PROBE-MODAL-1" });
    try {
      await harness.newGame();
      const controller = createLiveSceneController(harness.engine);
      controller.tick();
      const scene = harness.currentScene() as unknown as FlightSceneModals;

      scene.hud.toggleQuestJournal();
      expect(scene.hud.isQuestJournalOpen()).toBe(true);

      controller.tick();
      expect(scene.hud.isQuestJournalOpen()).toBe(true);

      controller.tick();
      expect(scene.hud.isQuestJournalOpen()).toBe(false);
      expect(harness.errors()).toEqual([]);
    } finally {
      harness.dispose();
    }
  });

  it("(3, Task 2 FIXED) a manually-opened planet info panel survives one grace tick, then still auto-closes if left idle", async () => {
    const harness = await RealEngineHarness.boot({ seed: "PROBE-MODAL-2" });
    try {
      await harness.newGame();
      const controller = createLiveSceneController(harness.engine);
      controller.tick(); // flush the "welcome" onboarding help panel — see the journal test above
      const scene = harness.currentScene() as unknown as FlightSceneModals;
      const planet = harness
        .galaxy()!
        .systems.find((s) => s.id === harness.player()!.currentSystemId)!
        .planets[0];
      expect(planet).toBeDefined();

      scene.planetManager.handlePlanetClick(planet);
      expect(scene.planetManager.hasInfoPanel).toBe(true);

      controller.tick();
      expect(scene.planetManager.hasInfoPanel).toBe(true);

      controller.tick();
      expect(scene.planetManager.hasInfoPanel).toBe(false);
      expect(harness.errors()).toEqual([]);
    } finally {
      harness.dispose();
    }
  });

  it("(2) land() routes physically and does NOT take the sprite-lookup fallback teleport when sprites exist (real scene init is synchronous)", async () => {
    const harness = await RealEngineHarness.boot({ seed: "PROBE-LAND-1" });
    try {
      await harness.newGame();
      const controller = createLiveSceneController(harness.engine);
      const transitionSpy = vi.spyOn(harness.engine, "transitionTo");
      const scene = harness.currentScene() as unknown as {
        planetManager: { routeTargetPlanetId: string | null };
      };
      const resolvedPlanet = harness
        .galaxy()!
        .systems.find((s) => s.id === harness.player()!.currentSystemId)!
        .planets.find((p) => p.isHabitable !== false)!;

      controller.land();

      expect(scene.planetManager.routeTargetPlanetId).toBe(resolvedPlanet.id);

      expect(transitionSpy).not.toHaveBeenCalledWith(
        SceneType.PLANET,
        expect.anything(),
      );
      expect(harness.errors()).toEqual([]);
    } finally {
      harness.dispose();
    }
  });

  it("(4) takeQuest() accepts an available board quest once landed — the applier itself is not the gap", async () => {
    const harness = await RealEngineHarness.boot({ seed: "PROBE-QUEST-1" });
    try {
      await harness.newGame();
      const controller = createLiveSceneController(harness.engine);
      const planet = harness
        .galaxy()!
        .systems.find((s) => s.id === harness.player()!.currentSystemId)!
        .planets[0];
      const board = harness.engine.getQuestBoard(planet.id);
      expect(board.length).toBeGreaterThan(0);

      await harness.goTo(SceneType.PLANET, { planet });
      expect(harness.player()!.landedPlanetId).toBe(planet.id);

      const before = harness.quests().getActiveQuests().length;
      controller.takeQuest();
      const after = harness.quests().getActiveQuests().length;

      expect(after).toBeGreaterThan(before);
      expect(harness.errors()).toEqual([]);
    } finally {
      harness.dispose();
    }
  });

  it("(1) a real session (real policy, real decisions) does not collapse into a tight system ping-pong", async () => {
    const harness = await RealEngineHarness.boot({
      seed: "PROBE-WARP-1",
      systemCount: 24,
    });
    try {
      await harness.newGame();
      const engine = harness.engine;
      let memory: AgentMemory = createMemory();
      const controller = createLiveSceneController(engine, () => memory);
      const policy = new MemoryHeuristicPolicy();
      const sequence: string[] = [];

      for (let i = 0; i < 150; i++) {
        const baseline = questBaselineForObserve(memory, engine);
        const obs = observe(engine, baseline);
        memory = updateMemory(memory, obs);
        if (obs.system) sequence.push(obs.system.id);

        const action = policy.decide(obs, memory);
        await applyLiveAction(action, obs, controller);
        for (let f = 0; f < 4; f++) harness.tick(200);
      }

      const distinctVisited = new Set(sequence).size;
      const pingPong = longestTwoSystemPingPong(sequence);
       
      console.log(
        `[PROBE-WARP-1] distinct=${distinctVisited} pingPong=${pingPong} sequence=${sequence.join(",")}`,
      );

      expect(pingPong).toBeLessThan(30);
      expect(harness.errors()).toEqual([]);
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it.each(["TASK4-LOOP-1", "TASK4-LOOP-2"])(
    "(1, Task 4) seed %s: no land↔take-off spin and no extended calendar stagnation over 300 folds",
    async (seed) => {
      const harness = await RealEngineHarness.boot({ seed, systemCount: 24 });
      try {
        await harness.newGame();
        const engine = harness.engine;
        let memory: AgentMemory = createMemory();
        const controller = createLiveSceneController(engine, () => memory);
        const policy = new MemoryHeuristicPolicy();
        const actionSequence: string[] = [];
        let maxFoldsSinceDayAdvance = 0;

        for (let i = 0; i < 300; i++) {
          const baseline = questBaselineForObserve(memory, engine);
          const obs = observe(engine, baseline);
          memory = updateMemory(memory, obs);
          maxFoldsSinceDayAdvance = Math.max(
            maxFoldsSinceDayAdvance,
            memory.foldsSinceDayAdvance,
          );

          const action = policy.decide(obs, memory);
          actionSequence.push(`${action.kind}:${action.reason ?? ""}`);
          await applyLiveAction(action, obs, controller);
          for (let f = 0; f < 4; f++) harness.tick(200);
        }

        const longestSameAction = longestRun(actionSequence);
         
        console.log(
          `[${seed}] maxFoldsSinceDayAdvance=${maxFoldsSinceDayAdvance} longestSameAction=${longestSameAction}`,
        );

        expect(maxFoldsSinceDayAdvance).toBeLessThan(
          MAX_FOLDS_WITHOUT_DAY_ADVANCE * 3,
        );
        expect(longestSameAction).toBeLessThan(220);
        expect(harness.errors()).toEqual([]);
      } finally {
        harness.dispose();
      }
    },
    30_000,
  );
});

function longestRun(seq: string[]): number {
  let best = 1;
  let run = 1;
  for (let i = 1; i < seq.length; i++) {
    if (seq[i] === seq[i - 1]) {
      run += 1;
      best = Math.max(best, run);
    } else {
      run = 1;
    }
  }
  return seq.length === 0 ? 0 : best;
}
