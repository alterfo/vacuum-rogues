import { GAME_BALANCE } from "@/config/balance";

export type ThreatLevel = "safe" | "caution" | "warning" | "critical";

export interface GalaxyThreatState {
  overmindCount: number;
  pirateCount: number;
  totalSystems: number;
  overmindShare: number;
  pirateShare: number;
  threatLevel: ThreatLevel;
}

export function computeGalaxyThreat(
  overmindSystems: readonly string[],
  pirateSystems: readonly string[],
  totalSystemCount: number,
): GalaxyThreatState {
  if (totalSystemCount === 0) {
    return {
      overmindCount: 0,
      pirateCount: 0,
      totalSystems: 0,
      overmindShare: 0,
      pirateShare: 0,
      threatLevel: "safe",
    };
  }

  const overmindCount = overmindSystems.length;
  const pirateCount = pirateSystems.length;
  const overmindShare = overmindCount / totalSystemCount;
  const pirateShare = pirateCount / totalSystemCount;
  const warningThreshold = GAME_BALANCE.OVERMIND_WARNING_THRESHOLD;

  let threatLevel: ThreatLevel;
  if (overmindShare >= 0.45) {
    threatLevel = "critical";
  } else if (overmindShare >= warningThreshold) {
    threatLevel = "warning";
  } else if (overmindShare >= 0.2) {
    threatLevel = "caution";
  } else {
    threatLevel = "safe";
  }

  return {
    overmindCount,
    pirateCount,
    totalSystems: totalSystemCount,
    overmindShare,
    pirateShare,
    threatLevel,
  };
}
