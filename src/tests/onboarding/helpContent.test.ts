import { describe, it, expect } from "vitest";
import {
  HELP_CONTENT,
  helpFor,
  type HelpKey,
} from "@/systems/onboarding/helpContent";

/** Every reachable gameplay screen + the intro/hints must have content. */
const ALL_KEYS: HelpKey[] = [
  "SPACE_FLIGHT",
  "STAR_MAP",
  "PLANET",
  "TRADE",
  "STATION",
  "EQUIPMENT_SHOP",
  "GOVERNMENT",
  "INFO_CENTER",
  "BANK",
  "INVENTORY",
  "TEXT_QUEST",
  "welcome",
  "quest-journal",
  "combat",
];

describe("helpContent registry", () => {
  it("covers every expected help key (no gaps)", () => {
    for (const key of ALL_KEYS) {
      expect(HELP_CONTENT[key], `missing entry for ${key}`).toBeDefined();
    }
    // No extra/unexpected keys either — the record matches the key list exactly.
    expect(Object.keys(HELP_CONTENT).sort()).toEqual([...ALL_KEYS].sort());
  });

  it("every entry has a non-empty title and ≥1 body line", () => {
    for (const key of ALL_KEYS) {
      const entry = HELP_CONTENT[key];
      expect(
        entry.title.trim().length,
        `empty title for ${key}`,
      ).toBeGreaterThan(0);
      expect(
        entry.body.length,
        `no body lines for ${key}`,
      ).toBeGreaterThanOrEqual(1);
      for (const line of entry.body) {
        expect(line.trim().length, `blank body line in ${key}`).toBeGreaterThan(
          0,
        );
      }
    }
  });

  it("optional controls, when present, are all non-empty", () => {
    for (const key of ALL_KEYS) {
      const controls = HELP_CONTENT[key].controls;
      if (controls) {
        expect(controls.length).toBeGreaterThan(0);
        for (const c of controls) {
          expect(c.trim().length, `blank control in ${key}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("helpFor returns the matching entry for each key", () => {
    for (const key of ALL_KEYS) {
      expect(helpFor(key)).toBe(HELP_CONTENT[key]);
    }
  });

  it("the welcome entry states the game's goal", () => {
    const welcome = helpFor("welcome");
    const text = welcome.body.join(" ").toLowerCase();
    // Goal: get rich and stop the Overmind threat.
    expect(text).toContain("цель");
    expect(text).toContain("овермайнд");
  });
});
