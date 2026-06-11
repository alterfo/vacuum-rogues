/**
 * Threat levels for the star-map galaxy state indicator.
 * Driven by the OVERMIND-only share (the actual loss condition).
 */
export type ThreatLevel = "safe" | "caution" | "warning" | "critical";

export interface GalaxyThreatState {
  overmindCount: number;
  pirateCount: number;
  totalSystems: number;
  overmindShare: number;
  pirateShare: number;
  hostileShare: number;
  /** Derived from overmindShare vs warningThreshold and the 0.45 pre-loss ceiling. */
  threatLevel: ThreatLevel;
}

/**
 * Pure function — compute the star-map threat indicator state from raw arrays.
 *
 * Threat levels:
 *   safe     overmindShare < 0.20
 *   caution  [0.20, warningThreshold)
 *   warning  [warningThreshold, 0.45)
 *   critical ≥ 0.45  (loss imminent — majority is >0.50)
 *
 * Only overmindShare drives the level; pirate share is informational.
 */
export function computeGalaxyThreat(
  overmindSystems: readonly string[],
  pirateSystems: readonly string[],
  totalSystemCount: number,
  warningThreshold: number,
): GalaxyThreatState {
  if (totalSystemCount === 0) {
    return {
      overmindCount: 0,
      pirateCount: 0,
      totalSystems: 0,
      overmindShare: 0,
      pirateShare: 0,
      hostileShare: 0,
      threatLevel: "safe",
    };
  }

  const overmindCount = overmindSystems.length;
  const pirateCount = pirateSystems.length;
  const overmindShare = overmindCount / totalSystemCount;
  const pirateShare = pirateCount / totalSystemCount;
  const hostileShare = overmindShare + pirateShare;

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
    hostileShare,
    threatLevel,
  };
}
