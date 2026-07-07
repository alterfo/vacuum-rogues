/**
 * Overmind mood-art key resolver (Task 18) — mirrors `flight/stationArt.ts`'s
 * "resolve to null when no art has landed" precedent, but for the lazy
 * `overmind_mood/` category (see CLAUDE.md, Texture Loading).
 */
import { pickVariantKey } from "./textures";
import { overmindMoodStage } from "@/systems/campaign/overmindMoodStage";
import type { EscalationInputs } from "@/systems/campaign/escalationNotices";

/**
 * Resolve the manifest key for the current escalation state's mood art, or
 * null when the stage is dormant (nothing to show) or no matching
 * `overmind_mood/<stage>` asset has been generated yet.
 */
export function overmindMoodArtKey(inputs: EscalationInputs): string | null {
  const stage = overmindMoodStage(inputs);
  if (stage === "dormant") return null;
  return pickVariantKey("overmind_mood", stage, stage) ?? null;
}
