export type LaunchDenialReason = "engine" | "fuel" | null;

export interface LaunchGateStats {
  readonly canTakeOff: boolean;
  readonly speed: number;
  readonly fuelCapacity: number;
}

export function launchDenialReason(stats: LaunchGateStats): LaunchDenialReason {
  if (stats.canTakeOff) return null;
  if (stats.speed <= 0) return "engine";
  return "fuel";
}
