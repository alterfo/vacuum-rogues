import { describe, it, expect } from "vitest";
import { encounterOutcomeMessageRu } from "@/systems/encounters/encounterOutcomeText";
import type {
  EncounterOutcome,
  EncounterOutcomeKind,
} from "@/systems/encounters/encounterOutcome";

const ALL_KINDS: EncounterOutcomeKind[] = [
  "salvage",
  "trap",
  "bonus",
  "hazard",
  "rescue",
  "ambush",
  "ignored",
];

function outcome(
  kind: EncounterOutcomeKind,
  credits?: number,
): EncounterOutcome {
  return { kind, credits, message: "" };
}

describe("encounterOutcomeMessageRu", () => {
  it("returns Cyrillic copy that never leaks the raw enum kind token", () => {
    for (const kind of ALL_KINDS) {
      const text = encounterOutcomeMessageRu(outcome(kind, 100));
      expect(text).toMatch(/[А-Яа-яЁё]/);
      for (const token of ALL_KINDS) {
        expect(text).not.toContain(token);
      }
    }
  });

  it("interpolates the payoff for a positive salvage", () => {
    expect(encounterOutcomeMessageRu(outcome("salvage", 250))).toBe(
      "Обломок обчищен: +250 кр.",
    );
  });

  it("shows the signed cost for a hazard", () => {
    expect(encounterOutcomeMessageRu(outcome("hazard", -80))).toBe(
      "Аномалия повредила системы: -80 кр.",
    );
  });

  it("names the rescue payoff and goodwill", () => {
    expect(encounterOutcomeMessageRu(outcome("rescue", 500))).toBe(
      "Экипаж спасён: +500 кр. и доброе имя.",
    );
  });

  it("treats an omitted credit delta as zero", () => {
    expect(encounterOutcomeMessageRu(outcome("bonus"))).toBe(
      "Аномалия просканирована: +0 кр.",
    );
  });
});
