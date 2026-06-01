import type { ProfileLevel } from "@/types";

/**
 * Port for adaptive quality profiling.
 */
export interface IQualityProfile {
  readonly level: ProfileLevel;
  benchmark(): void;
}
