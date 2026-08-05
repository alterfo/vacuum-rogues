import {
  QUEST_REWARD_ERA_START_DAY,
  QUEST_REWARD_ERA_DOUBLING_DAYS,
  QUEST_REWARD_ERA_MAX_MULT,
} from "@/config/balance";

export interface RewardEraConfig {
  readonly startDay: number;
  readonly doublingDays: number;
  readonly maxMult: number;
}

export const DEFAULT_REWARD_ERA: RewardEraConfig = {
  startDay: QUEST_REWARD_ERA_START_DAY,
  doublingDays: QUEST_REWARD_ERA_DOUBLING_DAYS,
  maxMult: QUEST_REWARD_ERA_MAX_MULT,
};

export function questRewardEraMult(
  day: number,
  config: RewardEraConfig = DEFAULT_REWARD_ERA,
): number {
  if (!Number.isFinite(day) || day < config.startDay) return 1;
  const era =
    Math.floor((day - config.startDay) / Math.max(1, config.doublingDays)) + 1;
  return Math.min(Math.max(1, config.maxMult), Math.pow(2, era));
}
