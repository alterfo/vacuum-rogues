import {
  BLACK_HOLE_ARCADE_REWARD_DEFEAT_SHARE,
  BLACK_HOLE_ARCADE_REWARD_LEVEL_BASE,
  BLACK_HOLE_ARCADE_REWARD_LEVEL_GROWTH,
  BLACK_HOLE_ARCADE_REWARD_WIN_BONUS,
} from "@/config/balance";
import type { ArcadeRunState } from "./arcadeTypes";

export type ArcadeEnding = "won" | "cashOut" | "lost" | "retreat";

export function arcadeLevelReward(level: number): number {
  return Math.round(
    BLACK_HOLE_ARCADE_REWARD_LEVEL_BASE *
      Math.pow(BLACK_HOLE_ARCADE_REWARD_LEVEL_GROWTH, Math.max(0, level - 1)),
  );
}

export function arcadeLevelsReward(levelsCleared: number): number {
  let total = 0;
  for (let level = 1; level <= levelsCleared; level++) {
    total += arcadeLevelReward(level);
  }
  return total;
}

export function arcadeReward(
  levelsCleared: number,
  chipCredits: number,
  ending: ArcadeEnding,
): number {
  const levels = arcadeLevelsReward(levelsCleared);
  const share =
    ending === "lost" || ending === "retreat"
      ? BLACK_HOLE_ARCADE_REWARD_DEFEAT_SHARE
      : 1;
  const bonus = ending === "won" ? BLACK_HOLE_ARCADE_REWARD_WIN_BONUS : 0;
  return Math.round(levels * share) + Math.round(chipCredits) + bonus;
}

export function arcadeRunReward(
  state: ArcadeRunState,
  ending: ArcadeEnding,
): number {
  return arcadeReward(state.levelsCleared, state.chipCredits, ending);
}
