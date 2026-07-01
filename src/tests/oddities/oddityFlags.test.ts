import { describe, it, expect } from "vitest";
import { readFlags } from "@/tests/playtest/letsplay/oddityFlags";

/**
 * Task 7 — the informational half of the live-flagging feedback loop
 * (`docs/plans/20260701-letsplay-action-expansion-and-neural-scale.md`). While
 * watching the live autopilot, a human flags a weird moment
 * (`window.__autopilot.flag(...)` or the silent `Shift+F` hotkey), persisted
 * to `localStorage("autopilot_oddity_flags")` in that browser session.
 *
 * This oracle test runs as part of `npm run letsplay:ci` and simply surfaces
 * whatever is in that store as CI output — it does **not** gate on the count.
 * Under CI/vitest the store is normally empty (a fresh jsdom instance per run
 * has no prior browser session to inherit flags from); a non-zero count is a
 * signal for a human to go investigate, never a build failure.
 */
describe("oddity flags — surfaced for review (informational only)", () => {
  it("prints any flagged oddities from the last session", () => {
    const flags = readFlags();
    for (const f of flags) {
      // eslint-disable-next-line no-console
      console.warn(
        `[ODDITY FLAG] step=${f.step} scene=${f.scene} note=${f.note ?? "(none)"}`,
      );
    }
    // Informational only — never fails the gate on a non-zero count.
    expect(flags.length).toBeGreaterThanOrEqual(0);
  });
});
