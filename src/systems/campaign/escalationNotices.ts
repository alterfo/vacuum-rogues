import type { OvermindStatus } from "@/types";
import { GAME_BALANCE, ESCALATION_NOTICED_POWER } from "@/config/balance";

export type EscalationStage = "NOTICED" | "HARDENING" | "FINAL_PUSH";

export const ESCALATION_STAGES: readonly EscalationStage[] = [
  "NOTICED",
  "HARDENING",
  "FINAL_PUSH",
];

export interface EscalationInputs {
  peakPower: number;
  overmindShare: number;
  arcStatus: OvermindStatus;
}

export interface EscalationConfig {
  noticedPower: number;
  hardeningShare: number;
}

function defaultConfig(): EscalationConfig {
  return {
    noticedPower: ESCALATION_NOTICED_POWER,
    hardeningShare: GAME_BALANCE.OVERMIND_WARNING_THRESHOLD,
  };
}

export function activeEscalationStages(
  inputs: EscalationInputs,
  config: EscalationConfig = defaultConfig(),
): EscalationStage[] {
  if (inputs.arcStatus === "won" || inputs.arcStatus === "lost") return [];
  const active: EscalationStage[] = [];
  if (inputs.peakPower >= config.noticedPower) active.push("NOTICED");
  if (inputs.overmindShare >= config.hardeningShare) active.push("HARDENING");
  if (inputs.arcStatus === "contained") active.push("FINAL_PUSH");
  return active;
}

export class EscalationNoticeTracker {
  private galaxyKey: string | null = null;
  private fired = new Set<EscalationStage>();

  observe(
    galaxyKey: string,
    inputs: EscalationInputs,
    config: EscalationConfig = defaultConfig(),
  ): EscalationStage[] {
    const active = activeEscalationStages(inputs, config);
    if (this.galaxyKey !== galaxyKey) {
      this.galaxyKey = galaxyKey;
      this.fired = new Set(active);
      return [];
    }
    const fresh = active.filter((stage) => !this.fired.has(stage));
    for (const stage of fresh) this.fired.add(stage);
    return fresh;
  }
}
