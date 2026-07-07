import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RealEngineHarness } from "./realEngineHarness";
import { isCampaignChainStepId } from "@/systems/quests/campaignChain";
import type { GeneratedQuest } from "@/systems/quests/QuestGenerator";

/**
 * Overmind campaign quest chain — offer path over the REAL engine (Task 12).
 *
 * Drives the genuine `getQuestBoard` → `acceptBoardQuest` → complete pipeline
 * (real `GameEngine`, `QuestManager`, `Galaxy`) to prove the chain:
 * - starts at step 1 once the Overmind is present and offers only that step;
 * - advances one step at a time as each prior step completes (in order);
 * - holds the arm-up-gated step back until the player is battle-ready
 *   (milestones fire as the player progresses);
 * - resumes mid-chain across a real save/load round trip (no new persisted
 *   field — completion rides the existing `questLog.completedQuests`).
 */
vi.mock("pixi.js", async () => (await import("./pixiStub")).makePixiStub());

/** The campaign steps currently on a board, by id (order-preserving). */
function campaignSteps(board: GeneratedQuest[]): string[] {
  return board.map((q) => q.template.id).filter(isCampaignChainStepId);
}

/** Accept a board quest and force-complete it through the real quest service. */
function completeStep(harness: RealEngineHarness, quest: GeneratedQuest): void {
  const planetId = quest.issuerPlanetId;
  const accepted = harness.engine.acceptBoardQuest(quest, planetId);
  expect(accepted).not.toBeNull();
  const ok = harness.engine.questManager.forceCompleteQuest(
    accepted!.id,
    harness.player()!,
  );
  expect(ok).toBe(true);
}

describe("Campaign chain — real-engine offer path", () => {
  let harness: RealEngineHarness;

  beforeEach(async () => {
    harness = await RealEngineHarness.boot({
      seed: "CAMPAIGN-CHAIN",
      systemCount: 14,
    });
    await harness.newGame();
    const galaxy = harness.galaxy()!;
    // Chart the whole galaxy so every quest target is a legal (explored)
    // destination, and plant a single Overmind system with a clean neighbour so
    // a frontier exists to point the chain at.
    galaxy.systems.forEach((s) => (s.explored = true));
    const current = harness.player()!.currentSystemId;
    // Pick an Overmind system that is NOT the player's current system and that
    // has at least one non-current neighbour to serve as the frontier target.
    const overmindHost = galaxy.systems.find(
      (s) =>
        s.id !== current && s.connections.some((c) => c.toSystemId !== current),
    )!;
    galaxy.addOvermindSystem(overmindHost.id);
    galaxy.overmindArc.status = "advancing";
  });

  afterEach(() => harness.dispose());

  /** The issuing planet on the player's current system. */
  function homePlanetId(): string {
    const galaxy = harness.galaxy()!;
    const current = harness.player()!.currentSystemId;
    const sys = galaxy.systems.find((s) => s.id === current)!;
    return sys.planets[0]!.id;
  }

  it("offers only step 1 while the Overmind is present and nothing is done", () => {
    const board = harness.engine.getQuestBoard(homePlanetId());
    const steps = campaignSteps(board);
    expect(steps).toEqual(["campaign-overmind-1-distress"]);
    expect(harness.errors()).toEqual([]);
  });

  it("advances the chain one step at a time as prior steps complete", () => {
    const planet = homePlanetId();

    // Step 1 → complete → step 2 offered, step 1 gone.
    let board = harness.engine.getQuestBoard(planet);
    let step = board.find(
      (q) => q.template.id === "campaign-overmind-1-distress",
    )!;
    expect(step).toBeTruthy();
    completeStep(harness, step);

    board = harness.engine.getQuestBoard(planet);
    expect(campaignSteps(board)).toEqual(["campaign-overmind-2-recon"]);

    // Step 2 → complete → step 3 (requisition) offered.
    step = board.find((q) => q.template.id === "campaign-overmind-2-recon")!;
    completeStep(harness, step);
    board = harness.engine.getQuestBoard(planet);
    expect(campaignSteps(board)).toEqual(["campaign-overmind-3-requisition"]);

    expect(harness.errors()).toEqual([]);
  });

  it("holds the liberation step back until the player is battle-ready", () => {
    const planet = homePlanetId();
    // Complete steps 1–3 (all in the early, always-available band).
    for (const id of [
      "campaign-overmind-1-distress",
      "campaign-overmind-2-recon",
      "campaign-overmind-3-requisition",
    ]) {
      const board = harness.engine.getQuestBoard(planet);
      completeStep(harness, board.find((q) => q.template.id === id)!);
    }

    // Not yet armed: the arm-up-gated step 4 must NOT be offered.
    const engineAsAny = harness.engine as unknown as {
      campaignPeakPowerValue: number | null;
    };
    engineAsAny.campaignPeakPowerValue = 0;
    expect(campaignSteps(harness.engine.getQuestBoard(planet))).toEqual([]);

    // Cross the battle-ready band: step 4 (first liberation) unlocks.
    engineAsAny.campaignPeakPowerValue = 0.5;
    expect(campaignSteps(harness.engine.getQuestBoard(planet))).toEqual([
      "campaign-overmind-4-liberation",
    ]);
    expect(harness.errors()).toEqual([]);
  });

  it("resumes mid-chain across a real save/load round trip", async () => {
    const planet = homePlanetId();
    // Complete steps 1–2, leaving step 3 as the next offer.
    for (const id of [
      "campaign-overmind-1-distress",
      "campaign-overmind-2-recon",
    ]) {
      const board = harness.engine.getQuestBoard(planet);
      completeStep(harness, board.find((q) => q.template.id === id)!);
    }
    expect(campaignSteps(harness.engine.getQuestBoard(planet))).toEqual([
      "campaign-overmind-3-requisition",
    ]);

    // Round-trip through the real save manager.
    await harness.engine.saveGame("campaign-chain-slot");
    const loaded = await harness.engine.loadGame("campaign-chain-slot");
    expect(loaded).toBe(true);

    // Completion persisted (no new field — rides questLog.completedQuests) and
    // the board still offers exactly the next step.
    const completed = harness.engine.questManager.getCompletedQuestIds();
    expect(completed).toContain("campaign-overmind-1-distress");
    expect(completed).toContain("campaign-overmind-2-recon");
    expect(campaignSteps(harness.engine.getQuestBoard(homePlanetId()))).toEqual(
      ["campaign-overmind-3-requisition"],
    );
    expect(harness.errors()).toEqual([]);
  });
});
