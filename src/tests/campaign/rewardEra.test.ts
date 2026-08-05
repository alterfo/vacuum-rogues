import { describe, it, expect } from "vitest";
import {
  questRewardEraMult,
  DEFAULT_REWARD_ERA,
} from "@/systems/campaign/rewardEra";
import {
  QUEST_REWARD_ERA_START_DAY,
  QUEST_REWARD_ERA_DOUBLING_DAYS,
  QUEST_REWARD_ERA_MAX_MULT,
  QUEST_BASE_REWARD,
  QUEST_REWARD_PER_JUMP,
} from "@/config/balance";

describe("questRewardEraMult — stepped late-game reward escalation", () => {
  it("the whole early game pays the unscaled baseline (deterministic sessions untouched)", () => {
    expect(questRewardEraMult(0)).toBe(1);
    expect(questRewardEraMult(200)).toBe(1);
    expect(questRewardEraMult(QUEST_REWARD_ERA_START_DAY - 1)).toBe(1);
    expect(questRewardEraMult(-5)).toBe(1);
    expect(questRewardEraMult(NaN)).toBe(1);
  });

  it("steps ×2 at the era start, then doubles every era period", () => {
    const s = QUEST_REWARD_ERA_START_DAY;
    const d = QUEST_REWARD_ERA_DOUBLING_DAYS;
    expect(questRewardEraMult(s)).toBe(2);
    expect(questRewardEraMult(s + d - 1)).toBe(2);
    expect(questRewardEraMult(s + d)).toBe(4);
    expect(questRewardEraMult(s + 2 * d)).toBe(8);
  });

  it("is monotone non-decreasing over the campaign", () => {
    let prev = 0;
    for (let day = 0; day <= 1200; day += 15) {
      const m = questRewardEraMult(day);
      expect(m).toBeGreaterThanOrEqual(prev);
      prev = m;
    }
  });

  it("caps at the configured max multiplier", () => {
    expect(questRewardEraMult(5000)).toBe(QUEST_REWARD_ERA_MAX_MULT);
    expect(questRewardEraMult(1080)).toBeLessThanOrEqual(
      QUEST_REWARD_ERA_MAX_MULT,
    );
  });

  it("a top-risk long-haul quest reaches the ~300k band by the campaign horizon", () => {
    const topBase = (QUEST_BASE_REWARD + 5 * QUEST_REWARD_PER_JUMP) * 1.8 * 1.2;
    const late = topBase * questRewardEraMult(1080);
    expect(late).toBeGreaterThan(250_000);
    expect(late).toBeLessThan(400_000);
  });

  it("honours a custom config (pure, no hidden globals)", () => {
    const cfg = { startDay: 10, doublingDays: 10, maxMult: 8 };
    expect(questRewardEraMult(9, cfg)).toBe(1);
    expect(questRewardEraMult(10, cfg)).toBe(2);
    expect(questRewardEraMult(20, cfg)).toBe(4);
    expect(questRewardEraMult(500, cfg)).toBe(8);
    expect(DEFAULT_REWARD_ERA.doublingDays).toBe(
      QUEST_REWARD_ERA_DOUBLING_DAYS,
    );
  });
});
