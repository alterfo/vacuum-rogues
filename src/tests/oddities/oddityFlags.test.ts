import { describe, it, expect } from "vitest";
import { readFlags } from "@/tests/playtest/letsplay/oddityFlags";

describe("oddity flags — surfaced for review (informational only)", () => {
  it("prints any flagged oddities from the last session", () => {
    const flags = readFlags();
    for (const f of flags) {
       
      console.warn(
        `[ODDITY FLAG] step=${f.step} scene=${f.scene} note=${f.note ?? "(none)"}`,
      );
    }
    expect(flags.length).toBeGreaterThanOrEqual(0);
  });
});
