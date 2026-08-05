import type { IQualityProfile } from "@/core/ports/IQualityProfile";
import type { ProfileLevel } from "@/types";
import { AdaptiveQualityProfile } from "@/ai/AdaptiveQualityProfile";

export class QualityProfileAdapter implements IQualityProfile {
  private readonly delegate = new AdaptiveQualityProfile();

  get level(): ProfileLevel {
    return this.delegate.level;
  }

  benchmark(): void {
    this.delegate.benchmark();
  }
}
