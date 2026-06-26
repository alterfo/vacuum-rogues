import { describe, it, expect } from "vitest";
import {
  TemplateQuestNarrator,
  type NarratorContext,
} from "@/ai/adapters/QuestNarrator";

const CTX: NarratorContext = {
  role: "Пилот",
  tone: "Нейтральный",
  systemName: "Солнечная",
  daysSinceStart: 5,
};

const ALL_SAMPLE_KEYS = [
  "secret_cargo.intro",
  "secret_cargo.dilemma",
  "secret_cargo.inspect",
  "secret_cargo.deliver",
  "secret_cargo.refuse",
  "drifting_ship.scan",
  "drifting_ship.board",
  "drifting_ship.rescue",
  "drifting_ship.loot",
  "drifting_ship.report",
];

describe("TemplateQuestNarrator", () => {
  const narrator = new TemplateQuestNarrator();

  it("returns a non-empty string for every sample quest node key", async () => {
    for (const key of ALL_SAMPLE_KEYS) {
      const result = await narrator.narrate(key, CTX);
      expect(result.length).toBeGreaterThan(10);
    }
  });

  it("substitutes systemName into templates that use it", async () => {
    const result = await narrator.narrate("secret_cargo.intro", CTX);
    expect(result).toContain("Солнечная");
  });

  it("substitutes daysSinceStart into templates that use it", async () => {
    const result = await narrator.narrate("drifting_ship.scan", CTX);
    expect(result).toContain("5");
  });

  it("returns a fallback string for an unknown key", async () => {
    const result = await narrator.narrate("unknown.key", CTX);
    expect(result.length).toBeGreaterThan(0);
  });
});
