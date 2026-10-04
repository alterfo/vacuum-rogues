import { describe, it, expect } from "vitest";
import { createArcadeRun, tick } from "@/systems/blackHoleArcade/arcadeState";
import { IDLE } from "./arcadeHelpers";
import { playBot } from "./arcadeBot";

describe("arcade playability (simulated pilot)", () => {
  it("a competent pilot clears the opening levels and is not instantly flattened", () => {
    for (const seed of [1, 2, 3]) {
      const state = createArcadeRun({ seed });
      const result = playBot(state, { maxMs: 30 * 60 * 1000, maxLevels: 3 });
      expect(result.levelsCleared).toBeGreaterThanOrEqual(3);
      expect(result.phase).not.toBe("lost");
    }
  }, 120000);

  it("the whole fifty-level run is not a walkover for the same pilot", () => {
    let best = 0;
    for (const seed of [1, 2]) {
      const state = createArcadeRun({ seed });
      const result = playBot(state, { maxMs: 90 * 60 * 1000 });
      best = Math.max(best, result.levelsCleared);
      expect(result.phase).not.toBe("won");
    }
    expect(best).toBeGreaterThanOrEqual(5);
    expect(best).toBeLessThan(50);
  }, 300000);

  it("a pilot who never fires cannot clear the first cruiser", () => {
    const state = createArcadeRun({ seed: 5, startLevel: 5 });
    let ms = 0;
    while (ms < 6 * 60 * 1000 && state.phase === "playing") {
      tick(state, { ...IDLE, targetX: 360, targetY: 900 }, 16);
      ms += 16;
    }
    expect(state.levelsCleared).toBeLessThan(5);
  }, 120000);
});
