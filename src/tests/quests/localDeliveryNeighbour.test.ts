import { describe, it, expect } from "vitest";
import type { StarSystem } from "@/domain/StarSystem";
import { generateQuestBoard } from "@/systems/quests/QuestGenerator";
import { QuestType } from "@/types";

/**
 * «Местный подряд» is a genuine intra-system courier run: the goods go to a
 * *different* planet in the same system (a neighbour), never the issuing planet
 * ("buy here, deliver here" was illogical). And a system with only one planet has
 * no neighbour, so it must NOT emit a local delivery at all — the board slot falls
 * back to a text quest instead.
 *
 * Local delivery is the non-text fallback when nothing else is reachable
 * (reachable.length === 0), so an isolated single-system galaxy with textRatio:0
 * forces every slot through that fallback.
 */

function boardFor(system: StarSystem) {
  return generateQuestBoard({
    systems: [system],
    originSystemId: system.id,
    planetId: "ISO_p1", // the issuing planet
    day: 0,
    seed: "neighbour-seed",
    count: 6,
    textRatio: 0,
  });
}

describe("Местный подряд targets a neighbouring planet (≠ issuer)", () => {
  it("multi-planet system → targetPlanetId is a different planet (habitable neighbour preferred)", () => {
    // Issuer ISO_p1 is habitable; the system also has a non-habitable ISO_p2 and a
    // habitable ISO_p3. The neighbour pick must skip the issuer and prefer the
    // habitable neighbour (ISO_p3) over the non-habitable one (ISO_p2).
    const system = {
      id: "ISO",
      name: "Захолустье",
      connections: [],
      planets: [
        { id: "ISO_p1", name: "Столица", isHabitable: true },
        { id: "ISO_p2", name: "Луна", isHabitable: false },
        { id: "ISO_p3", name: "Колония", isHabitable: true },
      ],
    } as unknown as StarSystem;

    const locals = boardFor(system).filter(
      (q) => q.template.title === "Местный подряд",
    );
    expect(locals.length).toBeGreaterThan(0);

    for (const local of locals) {
      // Never the issuer planet — a real neighbour delivery, not "deliver here".
      expect(local.targetPlanetId).not.toBe("ISO_p1");
      // A habitable neighbour is preferred over the non-habitable one.
      expect(local.targetPlanetId).toBe("ISO_p3");
      // Still an in-system run: no jumps, origin system is the target system.
      expect(local.jumps).toBe(0);
      expect(local.targetSystemId).toBe("ISO");
    }
  });

  it("single-planet system → the slot is a text quest, not «Местный подряд»", () => {
    const single = {
      id: "ISO",
      name: "Захолустье",
      connections: [],
      planets: [{ id: "ISO_p1", name: "Столица", isHabitable: true }],
    } as unknown as StarSystem;

    const board = boardFor(single);

    // No local delivery can be issued where there is no neighbour to deliver to.
    expect(
      board.find((q) => q.template.title === "Местный подряд"),
    ).toBeUndefined();
    // Every (non-text-ratio) slot falls back to a text adventure instead.
    expect(board.length).toBeGreaterThan(0);
    for (const q of board) {
      expect(q.template.type).toBe(QuestType.TEXT_ADVENTURE);
    }
  });
});
