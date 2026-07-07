import { describe, it, expect } from "vitest";
import {
  nextCampaignChainStep,
  buildCampaignChainQuest,
  isCampaignChainStepId,
  completedCampaignSteps,
  CAMPAIGN_CHAIN_STEPS,
  CAMPAIGN_CHAIN_STEP_IDS,
  type CampaignChainInputs,
  type CampaignChainTarget,
} from "@/systems/quests/campaignChain";
import {
  CAMPAIGN_CHAIN_LIBERATION_POWER,
  CAMPAIGN_CHAIN_CORE_ASSAULT_SHARE,
  CAMPAIGN_CHAIN_STEP_REWARDS,
} from "@/config/balance";
import { QuestType, type OvermindStatus } from "@/types";

/**
 * Overmind campaign quest chain — gating predicate + quest builder (Task 12).
 *
 * The chain is a fixed, ordered sequence gated on player milestones, not days.
 * These tests pin the two invariants the plan demands: steps unlock **in order
 * and only in order**, and the builder emits catalog quests that reuse existing
 * completion paths with a stable id that lands in `completedQuests`.
 */

const STEP = {
  distress: "campaign-overmind-1-distress",
  recon: "campaign-overmind-2-recon",
  requisition: "campaign-overmind-3-requisition",
  liberation: "campaign-overmind-4-liberation",
  counteroffensive: "campaign-overmind-5-counteroffensive",
  core: "campaign-overmind-6-core",
} as const;

function inputs(
  overrides: Partial<CampaignChainInputs> = {},
): CampaignChainInputs {
  return {
    completedStepIds: [],
    overmindShare: 0.3,
    peakPower: 0,
    arcStatus: "advancing" as OvermindStatus,
    ...overrides,
  };
}

describe("campaignChain — step ids + helpers", () => {
  it("has 6 steps in strictly increasing order with unique stable ids", () => {
    expect(CAMPAIGN_CHAIN_STEPS).toHaveLength(6);
    CAMPAIGN_CHAIN_STEPS.forEach((s, i) => expect(s.order).toBe(i));
    const ids = CAMPAIGN_CHAIN_STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(6);
    expect(CAMPAIGN_CHAIN_STEP_IDS.size).toBe(6);
  });

  it("isCampaignChainStepId recognises step ids only", () => {
    expect(isCampaignChainStepId(STEP.distress)).toBe(true);
    expect(isCampaignChainStepId(STEP.core)).toBe(true);
    expect(isCampaignChainStepId("gen_planet_0_0")).toBe(false);
    expect(isCampaignChainStepId("")).toBe(false);
  });

  it("completedCampaignSteps filters + orders a raw completed-quest list", () => {
    const raw = [STEP.recon, "some-other-quest", STEP.distress];
    expect(completedCampaignSteps(raw)).toEqual([STEP.distress, STEP.recon]);
  });
});

describe("campaignChain — nextCampaignChainStep ordering", () => {
  it("offers nothing before the Overmind appears (no front to react to)", () => {
    expect(
      nextCampaignChainStep(inputs({ overmindShare: 0, arcStatus: "dormant" })),
    ).toBeNull();
  });

  it("offers step 1 once the Overmind is present and nothing is completed", () => {
    const step = nextCampaignChainStep(inputs());
    expect(step?.id).toBe(STEP.distress);
  });

  it("offers ONLY step 1 even when later milestones are already crossed", () => {
    // Fully armed, front collapsed — but no step completed, so the chain must
    // still start at step 1 (in order and only in order).
    const step = nextCampaignChainStep(
      inputs({ peakPower: 1, overmindShare: 0.05, arcStatus: "contained" }),
    );
    expect(step?.id).toBe(STEP.distress);
  });

  it("advances step-by-step as each prior step completes (early band)", () => {
    expect(
      nextCampaignChainStep(inputs({ completedStepIds: [STEP.distress] }))?.id,
    ).toBe(STEP.recon);
    expect(
      nextCampaignChainStep(
        inputs({ completedStepIds: [STEP.distress, STEP.recon] }),
      )?.id,
    ).toBe(STEP.requisition);
  });

  it("returns null when the whole chain is complete", () => {
    expect(
      nextCampaignChainStep(
        inputs({
          completedStepIds: CAMPAIGN_CHAIN_STEPS.map((s) => s.id),
          overmindShare: 0.1,
          peakPower: 1,
          arcStatus: "contained",
        }),
      ),
    ).toBeNull();
  });

  it("never skips ahead when an out-of-order completion is present", () => {
    // recon marked complete but distress not (corrupted order): must offer the
    // first INCOMPLETE step (distress) — never jump ahead to requisition.
    expect(
      nextCampaignChainStep(inputs({ completedStepIds: [STEP.recon] }))?.id,
    ).toBe(STEP.distress);
  });

  it("is pure/deterministic — identical inputs yield identical results", () => {
    const args = inputs({ completedStepIds: [STEP.distress] });
    expect(nextCampaignChainStep(args)?.id).toBe(
      nextCampaignChainStep(args)?.id,
    );
  });
});

describe("campaignChain — milestone bands", () => {
  const priorThree = [STEP.distress, STEP.recon, STEP.requisition];

  it("gates step 4 (first liberation) on battle-ready power", () => {
    const below = nextCampaignChainStep(
      inputs({
        completedStepIds: priorThree,
        peakPower: CAMPAIGN_CHAIN_LIBERATION_POWER - 0.01,
      }),
    );
    expect(below).toBeNull();
    const atOrAbove = nextCampaignChainStep(
      inputs({
        completedStepIds: priorThree,
        peakPower: CAMPAIGN_CHAIN_LIBERATION_POWER,
      }),
    );
    expect(atOrAbove?.id).toBe(STEP.liberation);
  });

  it("gates step 5 (counteroffensive) on the front being pushed back (contained)", () => {
    const done4 = [...priorThree, STEP.liberation];
    const stillAdvancing = nextCampaignChainStep(
      inputs({
        completedStepIds: done4,
        peakPower: 1,
        arcStatus: "advancing",
      }),
    );
    expect(stillAdvancing).toBeNull();
    const contained = nextCampaignChainStep(
      inputs({
        completedStepIds: done4,
        peakPower: 1,
        arcStatus: "contained",
      }),
    );
    expect(contained?.id).toBe(STEP.counteroffensive);
  });

  it("gates step 6 (core assault) on the Overmind being a positive remnant", () => {
    const done5 = [...priorThree, STEP.liberation, STEP.counteroffensive];
    // Front still broad — not yet the final push.
    expect(
      nextCampaignChainStep(
        inputs({
          completedStepIds: done5,
          peakPower: 1,
          overmindShare: CAMPAIGN_CHAIN_CORE_ASSAULT_SHARE + 0.1,
          arcStatus: "contained",
        }),
      ),
    ).toBeNull();
    // Remnant remains — core assault available.
    expect(
      nextCampaignChainStep(
        inputs({
          completedStepIds: done5,
          peakPower: 1,
          overmindShare: CAMPAIGN_CHAIN_CORE_ASSAULT_SHARE,
          arcStatus: "contained",
        }),
      )?.id,
    ).toBe(STEP.core);
    // Overmind already gone (share 0): the remnant step is moot.
    expect(
      nextCampaignChainStep(
        inputs({
          completedStepIds: done5,
          peakPower: 1,
          overmindShare: 0,
          arcStatus: "contained",
        }),
      ),
    ).toBeNull();
  });

  it("suppresses the whole chain once the run is decided (won/lost)", () => {
    for (const arcStatus of ["won", "lost"] as OvermindStatus[]) {
      expect(
        nextCampaignChainStep(
          inputs({ completedStepIds: [STEP.distress], arcStatus }),
        ),
      ).toBeNull();
    }
  });

  it("respects a custom config's bands", () => {
    const done4 = [
      STEP.distress,
      STEP.recon,
      STEP.requisition,
      STEP.liberation,
    ];
    // A stricter liberation band would keep step 5 gated on containment as usual,
    // but a looser core-assault band changes when step 6 opens.
    const done5 = [...done4, STEP.counteroffensive];
    const strict = nextCampaignChainStep(
      inputs({
        completedStepIds: done5,
        peakPower: 1,
        overmindShare: 0.25,
        arcStatus: "contained",
      }),
      { liberationPower: 0.15, coreAssaultShare: 0.3 },
    );
    expect(strict?.id).toBe(STEP.core);
  });
});

describe("campaignChain — buildCampaignChainQuest", () => {
  const target: CampaignChainTarget = {
    systemId: "sys-front",
    systemName: "Тау Кита",
    planetId: "planet-front",
    jumps: 2,
  };

  it("builds an EXPLORATION visit for a non-cargo step with a stable step id", () => {
    const step = CAMPAIGN_CHAIN_STEPS[0]; // distress
    const q = buildCampaignChainQuest(step, target, "issuer-planet");
    expect(q.template.id).toBe(step.id); // stable ⇒ lands in completedQuests
    expect(q.template.type).toBe(QuestType.EXPLORATION);
    expect(q.template.objectives).toHaveLength(1);
    expect(q.template.objectives[0].type).toBe("VISIT_LOCATION");
    expect(q.template.objectives[0].locationId).toBe("planet-front");
    expect(q.template.targetSystemId).toBe("sys-front");
    expect(q.template.reward.credits).toBe(CAMPAIGN_CHAIN_STEP_REWARDS[0]);
    // The prose names the destination and reads as a life-and-death briefing.
    expect(q.template.description).toContain("Тау Кита");
    expect(q.template.description.length).toBeGreaterThan(80);
    expect(q.issuerPlanetId).toBe("issuer-planet");
  });

  it("builds a DELIVERY (buy + haul) for the requisition step", () => {
    const step = CAMPAIGN_CHAIN_STEPS[2]; // requisition (has cargo)
    const q = buildCampaignChainQuest(step, target, "issuer-planet");
    expect(q.template.type).toBe(QuestType.DELIVERY);
    const types = q.template.objectives.map((o) => o.type);
    expect(types).toContain("COLLECT_ITEM");
    expect(types).toContain("VISIT_LOCATION");
    expect(q.template.reward.credits).toBe(CAMPAIGN_CHAIN_STEP_REWARDS[2]);
  });

  it("falls back to the system id as location when no planet is resolved", () => {
    const q = buildCampaignChainQuest(
      CAMPAIGN_CHAIN_STEPS[1],
      { ...target, planetId: null },
      "issuer-planet",
    );
    expect(q.template.objectives[0].locationId).toBe("sys-front");
    expect(q.template.targetPlanetId).toBeNull();
  });

  it("never sets a deadline (milestone quests must not expire mid arm-up)", () => {
    for (const step of CAMPAIGN_CHAIN_STEPS) {
      const q = buildCampaignChainQuest(step, target, "issuer-planet");
      expect(q.template.deadline).toBe(0);
      expect(q.template.minReputation).toBe(0);
      expect(q.template.minRank).toBe(0);
    }
  });
});
