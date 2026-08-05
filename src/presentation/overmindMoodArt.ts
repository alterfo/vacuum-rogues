import { pickVariantKey } from "./textures";
import { overmindMoodStage } from "@/systems/campaign/overmindMoodStage";
import type { EscalationInputs } from "@/systems/campaign/escalationNotices";

export function overmindMoodArtKey(inputs: EscalationInputs): string | null {
  const stage = overmindMoodStage(inputs);
  if (stage === "dormant") return null;
  return pickVariantKey("overmind_mood", stage, stage) ?? null;
}
