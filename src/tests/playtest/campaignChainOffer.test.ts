import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RealEngineHarness } from "./realEngineHarness";
import { isCampaignChainStepId } from "@/systems/quests/campaignChain";
import type { GeneratedQuest } from "@/systems/quests/QuestGenerator";

vi.mock("pixi.js", async () => (await import("./pixiStub")).makePixiStub());

function campaignSteps(board: GeneratedQuest[]): string[] {
  return board.map((q) => q.template.id).filter(isCampaignChainStepId);
}

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
    galaxy.systems.forEach((s) => (s.explored = true));
    const current = harness.player()!.currentSystemId;
    const overmindHost = galaxy.systems.find(
      (s) =>
        s.id !== current && s.connections.some((c) => c.toSystemId !== current),
    )!;
    galaxy.addOvermindSystem(overmindHost.id);
    galaxy.overmindArc.status = "advancing";
  });

  afterEach(() => harness.dispose());

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

    let board = harness.engine.getQuestBoard(planet);
    let step = board.find(
      (q) => q.template.id === "campaign-overmind-1-distress",
    )!;
    expect(step).toBeTruthy();
    completeStep(harness, step);

    board = harness.engine.getQuestBoard(planet);
    expect(campaignSteps(board)).toEqual(["campaign-overmind-2-recon"]);

    step = board.find((q) => q.template.id === "campaign-overmind-2-recon")!;
    completeStep(harness, step);
    board = harness.engine.getQuestBoard(planet);
    expect(campaignSteps(board)).toEqual(["campaign-overmind-3-requisition"]);

    expect(harness.errors()).toEqual([]);
  });

  it("holds the liberation step back until the player is battle-ready", () => {
    const planet = homePlanetId();
    for (const id of [
      "campaign-overmind-1-distress",
      "campaign-overmind-2-recon",
      "campaign-overmind-3-requisition",
    ]) {
      const board = harness.engine.getQuestBoard(planet);
      completeStep(harness, board.find((q) => q.template.id === id)!);
    }

    const engineAsAny = harness.engine as unknown as {
      campaignPeakPowerValue: number | null;
    };
    engineAsAny.campaignPeakPowerValue = 0;
    expect(campaignSteps(harness.engine.getQuestBoard(planet))).toEqual([]);

    engineAsAny.campaignPeakPowerValue = 0.5;
    expect(campaignSteps(harness.engine.getQuestBoard(planet))).toEqual([
      "campaign-overmind-4-liberation",
    ]);
    expect(harness.errors()).toEqual([]);
  });

  it("resumes mid-chain across a real save/load round trip", async () => {
    const planet = homePlanetId();
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

    await harness.engine.saveGame("campaign-chain-slot");
    const loaded = await harness.engine.loadGame("campaign-chain-slot");
    expect(loaded).toBe(true);

    const completed = harness.engine.questManager.getCompletedQuestIds();
    expect(completed).toContain("campaign-overmind-1-distress");
    expect(completed).toContain("campaign-overmind-2-recon");
    expect(campaignSteps(harness.engine.getQuestBoard(homePlanetId()))).toEqual(
      ["campaign-overmind-3-requisition"],
    );
    expect(harness.errors()).toEqual([]);
  });
});
