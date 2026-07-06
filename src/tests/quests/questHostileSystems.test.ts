import { describe, it, expect } from "vitest";
import type { StarSystem } from "@/domain/StarSystem";
import { QuestType } from "@/types";
import { generateQuestBoard } from "@/systems/quests/QuestGenerator";

/**
 * Task 6 (three-year-campaign plan) — routine contracts must never TARGET a
 * hostile-HELD system: an occupied system has no functioning civilian port,
 * and a board that sells a starter-rank courier run into a standing 9-ship
 * garrison is selling a death sentence. Measured on the campaign harness
 * (seed LETSPLAY_CI-0): the board issued «Цепь курьеров» into a pirate-held
 * system two hops from home; the agent took the 1-jump delivery, flew to its
 * own quest target, and was annihilated by the garrison before it could flee.
 * A human beta-tester following the same contract dies the same way.
 *
 * War content stays on its designed paths — DEFENSE quests target the
 * *frontier* (`overmindAdjacentSystems`), finale quests deliberately point
 * into held space — and the exclusion is opt-in (`hostileSystems`), so every
 * legacy board without the option stays byte-identical.
 */
function sys(id: string, name: string, toIds: string[]): StarSystem {
  return {
    id,
    name,
    connections: toIds.map((toSystemId) => ({
      fromSystemId: id,
      toSystemId,
      fuelCost: 5,
    })),
    planets: [{ id: `${id}_p1`, isHabitable: true }],
    explored: true,
  } as unknown as StarSystem;
}

describe("QuestGenerator: hostile-held systems are never quest targets (Task 6)", () => {
  // Hub topology: the origin connects to every spoke; all explored, so only
  // the hostile filter can exclude a spoke.
  const SYSTEMS = [
    sys("o", "Origin", ["s1", "s2", "h1", "h2"]),
    sys("s1", "Safe-1", ["o"]),
    sys("s2", "Safe-2", ["o"]),
    sys("h1", "PirateDen", ["o"]),
    sys("h2", "OvermindHeld", ["o"]),
  ];
  const HOSTILE = ["h1", "h2"];

  it("never assigns a routine/chain/elite quest target to a hostile-held system", () => {
    const board = generateQuestBoard({
      systems: SYSTEMS,
      originSystemId: "o",
      planetId: "o_p1",
      day: 0,
      seed: "hostile-exclusion",
      count: 40,
      textRatio: 0,
      // Chains and elites draw from the same filtered pool — leave both on
      // so the assertion covers every builder, not just plain routine.
      hostileSystems: HOSTILE,
    });

    expect(board.length).toBe(40);
    const hostileSet = new Set(HOSTILE);
    for (const q of board) {
      expect(hostileSet.has(q.targetSystemId), q.template.title).toBe(false);
      for (const o of q.template.objectives)
        expect(
          o.targetSystemId == null || !hostileSet.has(o.targetSystemId),
          `${q.template.title}: objective → ${o.targetSystemId}`,
        ).toBe(true);
    }

    // Sanity: cross-system quests still exist and go to the safe spokes
    // (otherwise the exclusion could be vacuously true).
    const crossSystem = board.filter((q) => q.jumps > 0);
    expect(crossSystem.length).toBeGreaterThan(0);
    for (const q of crossSystem) {
      expect(["s1", "s2"]).toContain(q.targetSystemId);
    }
  });

  it("omitting hostileSystems keeps the legacy board byte-identical (all spokes targetable)", () => {
    const opts = {
      systems: SYSTEMS,
      originSystemId: "o",
      planetId: "o_p1",
      day: 0,
      seed: "hostile-exclusion",
      count: 40,
      textRatio: 0,
    };
    const legacy = generateQuestBoard(opts);
    const explicitEmpty = generateQuestBoard({ ...opts, hostileSystems: [] });
    expect(explicitEmpty).toEqual(legacy);
    // The unfiltered pool really includes the hostile spokes, proving the
    // first test's exclusion is doing the work.
    const targeted = new Set(legacy.map((q) => q.targetSystemId));
    expect(targeted.has("h1") || targeted.has("h2")).toBe(true);
  });

  it("DEFENSE frontier quests still work alongside the hostile exclusion", () => {
    const board = generateQuestBoard({
      systems: SYSTEMS,
      originSystemId: "o",
      planetId: "o_p1",
      day: 0,
      seed: "hostile-exclusion",
      count: 3,
      textRatio: 0,
      chainRatio: 0,
      eliteRatio: 0,
      hostileSystems: HOSTILE,
      overmindSystems: ["h2"],
      overmindAdjacentSystems: ["s1"],
    });

    const defense = board.filter((q) => q.template.type === QuestType.DEFENSE);
    expect(defense.length).toBe(1);
    // The DEFENSE quest targets the frontier system, never the held one.
    expect(defense[0].targetSystemId).toBe("s1");
  });

  it("an all-hostile neighbourhood degrades to local/text quests, never a hostile target", () => {
    const board = generateQuestBoard({
      systems: SYSTEMS,
      originSystemId: "o",
      planetId: "o_p1",
      day: 0,
      seed: "hostile-exclusion",
      count: 10,
      textRatio: 0,
      hostileSystems: ["s1", "s2", "h1", "h2"],
    });

    // Best-effort board still fills, but nothing points at a held system.
    const bad = new Set(["s1", "s2", "h1", "h2"]);
    for (const q of board) {
      expect(q.jumps === 0 || !bad.has(q.targetSystemId)).toBe(true);
    }
  });
});
