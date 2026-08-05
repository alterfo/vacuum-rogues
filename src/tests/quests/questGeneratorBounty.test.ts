import { describe, it, expect } from "vitest";
import type { StarSystem } from "@/domain/StarSystem";
import { QuestType } from "@/types";
import { generateQuestBoard } from "@/systems/quests/QuestGenerator";

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
  } as unknown as StarSystem;
}

function twoSystemGalaxy(): StarSystem[] {
  return [sys("A", "Альфа", ["B"]), sys("B", "Бета", ["A"])];
}

function bountyBoard(seed: string): ReturnType<typeof generateQuestBoard> {
  return generateQuestBoard({
    systems: twoSystemGalaxy(),
    originSystemId: "A",
    planetId: "A_p1",
    day: 0,
    seed,
    count: 20,
    textRatio: 0,
    eliteRatio: 0,
    chainRatio: 0,
  });
}

describe("BOUNTY quest ship name", () => {
  it("BOUNTY quest has targetNpcName set to a non-empty string", () => {
    const board = bountyBoard("bounty-seed-1");
    const bounty = board.find((q) => q.template.type === QuestType.BOUNTY);
    expect(bounty).toBeDefined();
    expect(bounty!.targetNpcName).not.toBeNull();
    expect(typeof bounty!.targetNpcName).toBe("string");
    expect((bounty!.targetNpcName as string).length).toBeGreaterThan(0);
  });

  it("BOUNTY description contains the ship name", () => {
    const board = bountyBoard("bounty-seed-2");
    const bounty = board.find((q) => q.template.type === QuestType.BOUNTY);
    expect(bounty).toBeDefined();
    const shipName = bounty!.targetNpcName as string;
    expect(bounty!.template.description).toContain(shipName);
  });

  it("BOUNTY description contains target line with ship name and system", () => {
    const board = bountyBoard("bounty-seed-3");
    const bounty = board.find((q) => q.template.type === QuestType.BOUNTY);
    expect(bounty).toBeDefined();
    const shipName = bounty!.targetNpcName as string;
    expect(bounty!.template.description).toContain(
      `Цель: корабль «${shipName}»`,
    );
    expect(bounty!.template.description).toContain("система");
  });

  it("non-BOUNTY quests have targetNpcName = null", () => {
    const board = bountyBoard("bounty-seed-4");
    const nonBounty = board.filter((q) => q.template.type !== QuestType.BOUNTY);
    for (const q of nonBounty) {
      expect(q.targetNpcName).toBeNull();
    }
  });

  it("BOUNTY objective description references the ship name", () => {
    const board = bountyBoard("bounty-seed-5");
    const bounty = board.find((q) => q.template.type === QuestType.BOUNTY);
    expect(bounty).toBeDefined();
    const shipName = bounty!.targetNpcName as string;
    const killObjective = bounty!.template.objectives.find(
      (o) => o.type === "DEFEAT_ENEMY",
    );
    expect(killObjective).toBeDefined();
    expect(killObjective!.description).toContain(shipName);
  });

  it("pickBountyDesc result contains the ship name (via board generation)", () => {
    for (let s = 0; s < 10; s++) {
      const board = bountyBoard(`pickBountyDesc-seed-${s}`);
      const bounty = board.find((q) => q.template.type === QuestType.BOUNTY);
      if (!bounty) continue;
      const shipName = bounty.targetNpcName as string;
      const [templatePart] = bounty.template.description.split("\nЦель:");
      expect(templatePart).toContain(shipName);
    }
  });
});
