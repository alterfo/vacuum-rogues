/**
 * Task 1 (docs/plans/20260712-autopilot-live-tick-symptoms.md) — reproduction
 * probe for the four live-only autopilot symptoms reported in play: looping,
 * sudden teleport-like jumps, modal-ignoring, and quest-skipping. Drives
 * `createLiveSceneController` (the concrete live controller the dev autopilot
 * actually uses) against a REAL `GameEngine`/`SpaceFlightScene`
 * (`RealEngineHarness`, pixi-stubbed) — not the headless `PlayerAgent` path —
 * per this project's three-tier convention for wiring bugs. Findings are
 * recorded in the plan; each `it` documents what it found, whether that
 * confirms or rules out the symptom headlessly.
 */
import { describe, it, expect, vi } from "vitest";
import { RealEngineHarness } from "../realEngineHarness";
import { SceneType } from "@/types";
import type { Planet } from "@/domain/Planet";
import { MemoryHeuristicPolicy } from "./MemoryHeuristicPolicy";
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

/** Structural view of the live flight scene's modal-owning members. */
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

/** Longest run of `a-b-a-b...` alternation between exactly two systems (mirrors liveSmoke16b.test.ts). */
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
      // A fresh flight scene auto-shows the "welcome" onboarding help panel;
      // tick()'s help-panel check runs FIRST and returns early, so flush it
      // before probing the modal-close race below (mirrors the extra frames
      // a real player's session would already have passed through).
      controller.tick();
      const scene = harness.currentScene() as unknown as FlightSceneModals;

      // A real player opens the quest journal manually (mirrors the "J" hotkey).
      scene.hud.toggleQuestJournal();
      expect(scene.hud.isQuestJournalOpen()).toBe(true);

      // FIXED (Task 2): the first tick after a human opens the panel grants a
      // grace window instead of closing it immediately.
      controller.tick();
      expect(scene.hud.isQuestJournalOpen()).toBe(true);

      // Regression coverage for the original fix this task modifies: if the
      // panel is still open (left idle) on the NEXT tick, it still gets
      // auto-dismissed — the autopilot never sits stuck behind it forever.
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

      // A real player clicks a planet, opening its info panel.
      scene.planetManager.handlePlanetClick(planet);
      expect(scene.planetManager.hasInfoPanel).toBe(true);

      // FIXED (Task 2): survives the grace tick.
      controller.tick();
      expect(scene.planetManager.hasInfoPanel).toBe(true);

      // Regression coverage: still auto-dismissed if left idle past the grace tick.
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

      controller.land();

      // RULED OUT under plausible live conditions: `PlanetManager.createPlanets()`
      // populates `planetSprites` synchronously during scene initialize(), so a
      // planet in the current system always has a live sprite by the time
      // land() runs — the fallback's `void goTo(SceneType.PLANET, ...)` branch
      // (a direct transitionTo(PLANET, ...) call) is never taken here.
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

      // RULED OUT at the applier level: takeQuest() correctly accepts a taken
      // quest when landed and a board offers one. Symptom (4) is therefore a
      // decision-policy frequency effect (MemoryHeuristicPolicy not choosing a
      // take-quest action often enough), not a bug in this executor.
      expect(after).toBeGreaterThan(before);
      expect(harness.errors()).toEqual([]);
    } finally {
      harness.dispose();
    }
  });

  it("(1) a real session (real policy, real decisions) does not collapse into a tight system ping-pong", async () => {
    // A warp is two-step (openStarMap → warp) and does not teleport: warp()
    // only PLOTS a route to the target system's edge — the ship must then
    // physically fly there over real ticks (mirrors dock()'s comment: only
    // dock() teleports). So this drives the exact same
    // observe → updateMemory → decide → applyLiveAction → (frame ticks) loop
    // `liveSmoke16b.test.ts` already runs, instrumented here specifically for
    // symptom (1)'s system-id sequence.
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
      // eslint-disable-next-line no-console
      console.log(
        `[PROBE-WARP-1] distinct=${distinctVisited} pingPong=${pingPong} sequence=${sequence.join(",")}`,
      );

      // RECORDED: no tight 2-3 system oscillation reproduces here (mirrors
      // liveSmoke16b's existing `< 30` gate) — the anti-ping-pong closures
      // are not the cause of a tight loop under the real decision policy.
      // What DID show up: across 150 folds the ship visited only 2 distinct
      // systems total, sitting in the starting system for the first ~80
      // folds before its one and only warp. That is a real, headlessly
      // observed data point for symptom (1) — but it is NOT the same shape
      // as "cycling without progress" (gameDays and local trade/quest/repair
      // business keep advancing the whole time) and this probe cannot tell
      // apart "legitimate extended local business before exploring" from an
      // actual bug. Left for Task 4 to interpret against more runs/seeds.
      expect(pingPong).toBeLessThan(30);
      expect(harness.errors()).toEqual([]);
    } finally {
      harness.dispose();
    }
  }, 30_000);
});
