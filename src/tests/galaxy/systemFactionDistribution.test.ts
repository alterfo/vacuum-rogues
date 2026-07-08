import { describe, it, expect } from "vitest";
import { Faction } from "@/types/faction";
import { SeededRNG } from "@/utils/seededRNG";
import { FACTION_DISTRIBUTION_WEIGHTS } from "@/config/balance";
import { pickSystemFaction } from "@/systems/galaxy/systemFactionDistribution";

describe("pickSystemFaction (weighted galaxy owner-faction distribution)", () => {
  it("is deterministic for the same seed", () => {
    const a = pickSystemFaction(new SeededRNG("sys_faction_7"));
    const b = pickSystemFaction(new SeededRNG("sys_faction_7"));
    expect(a).toBe(b);
  });

  it("produces every weighted faction across many draws, INDEPENDENT commonest", () => {
    const counts = new Map<Faction, number>();
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const f = pickSystemFaction(new SeededRNG(`draw_${i}`));
      counts.set(f, (counts.get(f) ?? 0) + 1);
    }
    for (const [faction] of FACTION_DISTRIBUTION_WEIGHTS) {
      expect(counts.get(faction) ?? 0).toBeGreaterThan(0);
    }
    const independent = counts.get(Faction.INDEPENDENT) ?? 0;
    expect(independent).toBeGreaterThan(0);
    expect(independent).toBeLessThan(N); // not every system is INDEPENDENT
    for (const [faction, count] of counts) {
      if (faction !== Faction.INDEPENDENT) {
        expect(independent).toBeGreaterThanOrEqual(count);
      }
    }
  });

  it("never emits OVERMIND (live capture state, not a generation-time roll)", () => {
    for (let i = 0; i < 500; i++) {
      expect(pickSystemFaction(new SeededRNG(`ov_${i}`))).not.toBe(
        Faction.OVERMIND,
      );
    }
  });

  it("roughly tracks the configured weights", () => {
    const total = FACTION_DISTRIBUTION_WEIGHTS.reduce((s, [, w]) => s + w, 0);
    const counts = new Map<Faction, number>();
    const N = 8000;
    for (let i = 0; i < N; i++) {
      const f = pickSystemFaction(new SeededRNG(`w_${i}`));
      counts.set(f, (counts.get(f) ?? 0) + 1);
    }
    for (const [faction, weight] of FACTION_DISTRIBUTION_WEIGHTS) {
      const expected = weight / total;
      const actual = (counts.get(faction) ?? 0) / N;
      expect(Math.abs(actual - expected)).toBeLessThan(0.05);
    }
  });
});
