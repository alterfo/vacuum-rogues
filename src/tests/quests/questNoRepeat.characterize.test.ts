import { describe, it, expect } from "vitest";
import type { StarSystem } from "@/domain/StarSystem";
import {
  generateQuestBoard,
  questKey,
  type BoardOptions,
  type GeneratedQuest,
} from "@/systems/quests/QuestGenerator";

/**
 * Characterization for "quests should not repeat" (`docs/plans/20260625-quests-no-repeat.md`).
 *
 * Task 1 (investigation): pin a stable {@link questKey} and reproduce the repeat
 * as a RED expectation. `generateQuestBoard` is deterministic and has **no
 * per-quest exclusion input** today, so a quest the player has already taken or
 * completed is re-offered verbatim when the board is regenerated. That repeat is
 * captured below with `it.fails` (the inner expectation is red today, which keeps
 * the committed suite green); Task 2 wires the exclusion and flips it to a normal
 * passing test.
 *
 * Exclusion-source decision (Task 1): derive keys from the already-persisted
 * **active** quest set (full `Quest` objects → `questKey` is computable) and the
 * **on-board** set (dedupe within the board being built) — no new persisted field
 * and no save migration. The completed set in `QuestManager` is a `Set<string>`
 * of ids only (no template retained), so completed-quest dedupe stays id-based as
 * today; promoting it to content-key dedupe would need a persisted "seen" set
 * (schema + migration + version bump), which the plan defers.
 */

/** Minimal star-system stub (generator reads id/name/connections/planets only). */
function sys(
  id: string,
  name: string,
  toIds: string[],
  planetIds: { id: string; isHabitable: boolean }[] = [
    { id: `${id}_p1`, isHabitable: true },
  ],
): StarSystem {
  return {
    id,
    name,
    connections: toIds.map((toSystemId) => ({
      fromSystemId: id,
      toSystemId,
      fuelCost: 5,
    })),
    planets: planetIds,
  } as unknown as StarSystem;
}

/** Linear chain A—B—C—D (origin A): B=1 jump, C=2, D=3. */
function chainGalaxy(): StarSystem[] {
  return [
    sys("A", "Альфа", ["B"]),
    sys("B", "Бета", ["A", "C"]),
    sys("C", "Гамма", ["B", "D"]),
    sys("D", "Дельта", ["C"]),
  ];
}

function baseOpts(over: Partial<BoardOptions> = {}): BoardOptions {
  return {
    systems: chainGalaxy(),
    originSystemId: "A",
    planetId: "A_p1",
    day: 0,
    seed: "galaxy-seed",
    ...over,
  };
}

describe("quest board no-repeat (characterization)", () => {
  it("questKey: same job → same key; the bucket-bearing slot id and reward are ignored", () => {
    const board = generateQuestBoard(baseOpts({ textRatio: 0, count: 40 }));
    expect(board.length).toBeGreaterThan(0);

    // Distinct quests produce distinct keys (the key is not a constant).
    const distinct = new Set(board.map(questKey));
    expect(distinct.size).toBeGreaterThan(1);

    // A copy of the same job carrying a *different* slot id + reward (what a
    // board refresh / an accepted quest would look like) keeps the same key.
    const q = board[0];
    const relabelled: GeneratedQuest = {
      ...q,
      template: {
        ...q.template,
        id: `${q.template.id}_RELABELLED`,
        reward: {
          ...q.template.reward,
          credits: q.template.reward.credits + 999,
        },
      },
    };
    expect(questKey(relabelled)).toBe(questKey(q));
  });

  it("questKey is distinct across different target systems and kinds", () => {
    const board = generateQuestBoard(baseOpts({ textRatio: 0, count: 60 }));
    // At least one delivery and at least one non-delivery, to different systems,
    // must not collide on key.
    const deliveries = board.filter((q) => q.template.type === "DELIVERY");
    const others = board.filter((q) => q.template.type !== "DELIVERY");
    expect(deliveries.length).toBeGreaterThan(0);
    expect(others.length).toBeGreaterThan(0);
    expect(questKey(deliveries[0])).not.toBe(questKey(others[0]));

    // Same kind, different target system → different key.
    const byKind = board.filter(
      (q) => q.template.type === deliveries[0].template.type,
    );
    const differentTarget = byKind.find(
      (q) => q.targetSystemId !== deliveries[0].targetSystemId,
    );
    if (differentTarget) {
      expect(questKey(differentTarget)).not.toBe(questKey(deliveries[0]));
    }
  });

  // GREEN (Task 2): with the taken quest's key excluded, regenerating the board
  // no longer re-offers it, and the board still fills to its target size from the
  // remaining pool. (Task 1 pinned this as a RED `it.fails`; Task 2 wired the
  // `excludeKeys` input and converted it to a normal passing test.)
  it("regenerating the board with the taken quest excluded does not re-offer it", () => {
    const board1 = generateQuestBoard(baseOpts());
    expect(board1.length).toBeGreaterThan(0);
    const taken = board1[0];
    const takenKey = questKey(taken);

    // The player accepted `taken`. Re-open the board, excluding its content key:
    const board2 = generateQuestBoard(baseOpts({ excludeKeys: [takenKey] }));

    // The taken quest is never re-offered…
    expect(board2.map(questKey)).not.toContain(takenKey);
    // …and the board still fills to its full size from the remaining pool.
    expect(board2.length).toBe(board1.length);
  });
});
