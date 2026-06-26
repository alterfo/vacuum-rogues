/**
 * Task 2 (late-game recoverability): completing a quest must GRANT faction
 * reputation — the missing recovery loop. Today rep only ever decays (quest
 * expiry / customs fine / loan default), so a long-running player slides to
 * −50 with "no way to raise standing". A modest +rep on success, keyed by the
 * SAME factionId the expiry penalty and the board/landing gate read, lets honest
 * play climb back out — over SEVERAL quests, not one (small amount + the rep
 * clamp guard against overshoot).
 */
import { describe, it, expect } from "vitest";
import { QuestManager } from "@/systems/QuestManager";
import { Quest } from "@/domain/Quest";
import { QuestType, ResourceType } from "@/types";
import type { Player } from "@/domain/Player";
import type { Reward } from "@/types";
import { QUEST_REPUTATION_REWARD } from "@/config/balance";

function playerStub(credits = 0): Player {
  const reputation: Record<string, number> = {};
  return {
    credits,
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

const EMPTY_REWARD: Reward = { credits: 300, experience: 100, items: [] };

/** A quest issued by `factionId` (and a fallback planetId), due `deadline` days. */
function makeFactionQuest(
  id: string,
  factionId: string,
  planetId = "origin_planet",
  deadline = 10,
  penalty: { reputationLoss: number } | null = { reputationLoss: 15 },
): Quest {
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
    EMPTY_REWARD,
    [],
    planetId,
    0,
    deadline,
    penalty ? { ...penalty, description: "test penalty" } : null,
    "sys_B",
    null,
    0,
    null,
    -1,
    factionId,
    null,
  );
}

describe("Task 2: quest completion grants faction reputation", () => {
  it("completing a quest raises reputation with the quest's factionId", () => {
    const qm = new QuestManager();
    const player = playerStub();
    const quest = makeFactionQuest("q_rep_1", "faction_A");
    qm["activeQuests"].set(quest.id, quest);

    expect(player.getReputation("faction_A")).toBe(0);
    expect(qm.forceCompleteQuest(quest.id, player)).toBe(true);
    expect(player.getReputation("faction_A")).toBe(QUEST_REPUTATION_REWARD);
  });

  it("keys the reward by the SAME factionId the expiry penalty uses (factionId, fallback planetId)", () => {
    const qm = new QuestManager();
    const player = playerStub();
    // No factionId → falls back to planetId, exactly like applyFailurePenalty.
    const quest = makeFactionQuest("q_rep_fallback", "", "planet_X");
    qm["activeQuests"].set(quest.id, quest);

    qm.forceCompleteQuest(quest.id, player);
    expect(player.getReputation("planet_X")).toBe(QUEST_REPUTATION_REWARD);
  });

  it("claimReturnReward (pending-return path) also grants the rep", () => {
    const qm = new QuestManager();
    const player = playerStub();
    const quest = makeFactionQuest("q_rep_return", "faction_R");
    qm["pendingReturnQuests"].set(quest.id, quest);

    expect(qm.claimReturnReward(quest.id, player)).toBe(true);
    expect(player.getReputation("faction_R")).toBe(QUEST_REPUTATION_REWARD);
  });

  it("is MODEST — climbs out of −50 over several quests, not one", () => {
    // Guard: a single completion cannot lift a −50 player to ≥0.
    expect(QUEST_REPUTATION_REWARD).toBeGreaterThan(0);
    expect(QUEST_REPUTATION_REWARD).toBeLessThan(50);

    const qm = new QuestManager();
    const player = playerStub();
    (player.reputation as Record<string, number>)["faction_A"] = -50;

    const quest = makeFactionQuest("q_rep_climb", "faction_A");
    qm["activeQuests"].set(quest.id, quest);
    qm.forceCompleteQuest(quest.id, player);
    // Still negative after one quest — recovery takes several.
    expect(player.getReputation("faction_A")).toBeLessThan(0);
    expect(player.getReputation("faction_A")).toBe(
      -50 + QUEST_REPUTATION_REWARD,
    );
  });

  it("respects the rep clamp — cannot overshoot +100", () => {
    const qm = new QuestManager();
    const player = playerStub();
    (player.reputation as Record<string, number>)["faction_A"] = 99;

    const quest = makeFactionQuest("q_rep_clamp", "faction_A");
    qm["activeQuests"].set(quest.id, quest);
    qm.forceCompleteQuest(quest.id, player);
    expect(player.getReputation("faction_A")).toBe(100);
  });

  it("does NOT grant rep on expiry — failures still COST reputation (penalty path unchanged)", () => {
    const qm = new QuestManager();
    const player = playerStub(1000);
    (player.reputation as Record<string, number>)["faction_A"] = -10;
    const quest = makeFactionQuest(
      "q_rep_expire",
      "faction_A",
      "origin_planet",
      1,
    );
    qm["activeQuests"].set(quest.id, quest);

    qm.checkExpiredQuests(5, player); // day 5 > 0 + 1 → expire
    // Penalty applied, NOT a reward: rep went DOWN by reputationLoss(15).
    expect(player.getReputation("faction_A")).toBe(-25);
    expect(qm.getActiveQuests()).toHaveLength(0);
  });
});
