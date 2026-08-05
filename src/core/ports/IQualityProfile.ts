import type { ProfileLevel } from "@/types";

export interface IQualityProfile {
  readonly level: ProfileLevel;
  benchmark(): void;
}
