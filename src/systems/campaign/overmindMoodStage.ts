import {
  activeEscalationStages,
  type EscalationInputs,
} from "./escalationNotices";

export type OvermindMoodStage =
  | "dormant"
  | "noticed"
  | "hardening"
  | "final_push";

export function overmindMoodStage(inputs: EscalationInputs): OvermindMoodStage {
  const active = activeEscalationStages(inputs);
  const mostSevere = active[active.length - 1];
  if (mostSevere === "FINAL_PUSH") return "final_push";
  if (mostSevere === "HARDENING") return "hardening";
  if (mostSevere === "NOTICED") return "noticed";
  return "dormant";
}
