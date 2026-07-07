/**
 * Overmind mood-art stage derivation (three-year-campaign plan, Task 18).
 *
 * Pure mapping from the same escalation bands Task 5 uses for news notices
 * (`activeEscalationStages`) down to a single mood-art key — the most severe
 * currently-active band, or `"dormant"` before any band is crossed.
 */
import { describe, it, expect } from "vitest";
import { overmindMoodStage } from "@/systems/campaign/overmindMoodStage";
import type { EscalationInputs } from "@/systems/campaign/escalationNotices";
import { GAME_BALANCE, ESCALATION_NOTICED_POWER } from "@/config/balance";

const WARNING = GAME_BALANCE.OVERMIND_WARNING_THRESHOLD;

function inputs(over: Partial<EscalationInputs> = {}): EscalationInputs {
  return {
    peakPower: 0,
    overmindShare: 0,
    arcStatus: "dormant",
    ...over,
  };
}

describe("overmindMoodStage (pure)", () => {
  it("is dormant for a fresh weak-player galaxy", () => {
    expect(overmindMoodStage(inputs())).toBe("dormant");
  });

  it("is noticed once ratcheted power crosses the band, not below it", () => {
    expect(
      overmindMoodStage(
        inputs({ peakPower: ESCALATION_NOTICED_POWER - 0.001 }),
      ),
    ).toBe("dormant");
    expect(
      overmindMoodStage(inputs({ peakPower: ESCALATION_NOTICED_POWER })),
    ).toBe("noticed");
  });

  it("is hardening once Overmind share crosses the warning band", () => {
    expect(overmindMoodStage(inputs({ overmindShare: WARNING }))).toBe(
      "hardening",
    );
  });

  it("prefers the most severe active band when several are crossed", () => {
    expect(
      overmindMoodStage(
        inputs({ peakPower: ESCALATION_NOTICED_POWER, overmindShare: WARNING }),
      ),
    ).toBe("hardening");
    expect(
      overmindMoodStage(
        inputs({
          peakPower: ESCALATION_NOTICED_POWER,
          overmindShare: WARNING,
          arcStatus: "contained",
        }),
      ),
    ).toBe("final_push");
  });

  it("is dormant once the arc is won or lost (terminal suppression)", () => {
    expect(
      overmindMoodStage(
        inputs({
          peakPower: 1,
          overmindShare: 1,
          arcStatus: "won",
        }),
      ),
    ).toBe("dormant");
    expect(
      overmindMoodStage(
        inputs({
          peakPower: 1,
          overmindShare: 1,
          arcStatus: "lost",
        }),
      ),
    ).toBe("dormant");
  });
});
