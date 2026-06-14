import { describe, it, expect } from "vitest";
import { QuestManager } from "@/systems/QuestManager";

describe("QuestManager — no hardcoded templates", () => {
  it("starts with an empty template map", () => {
    const qm = new QuestManager();
    expect(qm.getQuestTemplate("quest_urgent_medicine")).toBeUndefined();
  });

  it("returns undefined for every former hardcoded template id", () => {
    const qm = new QuestManager();
    const legacyIds = [
      "quest_urgent_medicine",
      "quest_bounty_hunt",
      "quest_research_artifacts",
      "quest_contraband",
      "quest_diplomacy",
      "quest_rescue",
      "quest_delivery_ore",
      "quest_explore_system",
    ];
    for (const id of legacyIds) {
      expect(
        qm.getQuestTemplate(id),
        `expected ${id} to be undefined`,
      ).toBeUndefined();
    }
  });

  it("acceptQuest returns null for a former hardcoded template id", () => {
    const qm = new QuestManager();
    const result = qm.acceptQuest("quest_urgent_medicine");
    expect(result).toBeNull();
  });
});
