import {
  activeEscalationStages,
  type EscalationInputs,
} from "./escalationNotices";

/** Mood-art key for `overmind_mood/<stage>` (Task 18). */
export type OvermindMoodStage =
  | "dormant"
  | "noticed"
  | "hardening"
  | "final_push";

/**
 * Pure: the single most-severe escalation band currently active, mapped to
 * its mood-art key — `"dormant"` before any band is crossed (or once the arc
 * is won/lost, since `activeEscalationStages` suppresses terminal states).
 * Reuses Task 5's bands so the art matches the news feed's warning tone.
 */
export function overmindMoodStage(inputs: EscalationInputs): OvermindMoodStage {
  const active = activeEscalationStages(inputs);
  const mostSevere = active[active.length - 1];
  if (mostSevere === "FINAL_PUSH") return "final_push";
  if (mostSevere === "HARDENING") return "hardening";
  if (mostSevere === "NOTICED") return "noticed";
  return "dormant";
}
