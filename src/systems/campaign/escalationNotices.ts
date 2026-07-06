import type { OvermindStatus } from "@/types";
import { GAME_BALANCE, ESCALATION_NOTICED_POWER } from "@/config/balance";

/**
 * Escalation notices — adaptive difficulty made *felt* (three-year-campaign
 * plan, Task 5).
 *
 * The adaptive campaign machinery (Tasks 2–4) silently accelerates the
 * Overmind spread and hardens garrisons as the ratcheted `campaignPeakPower`
 * grows. This module derives the player-facing side of that: one-shot news
 * notices announcing each escalation band as it is crossed.
 *
 * Stages (in escalation order):
 * - `NOTICED`    — ratcheted power reached `ESCALATION_NOTICED_POWER` (the
 *                  battle-ready band): "the Overmind has noticed you".
 * - `HARDENING`  — Overmind share reached `OVERMIND_WARNING_THRESHOLD` (the
 *                  same band the star-map warning indicator uses): "the front
 *                  is hardening".
 * - `FINAL_PUSH` — the arc status machine derived `contained` (front peaked
 *                  and was pushed back below the contained line): "the final
 *                  push is available".
 *
 * Pure derivation + a small fire-once tracker. Nothing here is persisted: the
 * tracker seeds itself silently from the first state it observes for a run
 * (keyed by galaxy id), so a mid-game save loaded in a fresh session never
 * spams retroactive notices, and the fire-once guarantee holds within a run.
 */

export type EscalationStage = "NOTICED" | "HARDENING" | "FINAL_PUSH";

/** All stages, in the order multiple same-tick crossings are announced. */
export const ESCALATION_STAGES: readonly EscalationStage[] = [
  "NOTICED",
  "HARDENING",
  "FINAL_PUSH",
];

/** The observable campaign state the stage bands are derived from. */
export interface EscalationInputs {
  /** Ratcheted campaign peak power ∈ [0,1] (never decreases within a run). */
  peakPower: number;
  /** Current Overmind share of the galaxy ∈ [0,1]. */
  overmindShare: number;
  /** Current Overmind endgame-arc status. */
  arcStatus: OvermindStatus;
}

/** Tunable bands (defaults come from `balance.ts` — never tune call sites). */
export interface EscalationConfig {
  /** Ratcheted power at/above which NOTICED is active. */
  noticedPower: number;
  /** Overmind share at/above which HARDENING is active. */
  hardeningShare: number;
}

function defaultConfig(): EscalationConfig {
  return {
    noticedPower: ESCALATION_NOTICED_POWER,
    hardeningShare: GAME_BALANCE.OVERMIND_WARNING_THRESHOLD,
  };
}

/**
 * Pure: the stages whose band is currently crossed, in escalation order.
 * Terminal arc states (`won`/`lost`) suppress everything — the run is already
 * decided and the outcome overlay owns the messaging.
 */
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

/**
 * Fire-once tracker: `observe()` returns the stages that newly crossed since
 * the previous observation of the same run, marking them fired forever (for
 * that run). The FIRST observation of a run seeds the fired set from the
 * current state and returns nothing — stages already crossed when a session
 * first sees a galaxy (a loaded mid-game save) stay silent.
 */
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
