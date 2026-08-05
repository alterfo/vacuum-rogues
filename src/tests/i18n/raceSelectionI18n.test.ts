import { describe, expect, it } from "vitest";
import { translate } from "@/i18n/i18n";
import { ru } from "@/i18n/ru";
import { en } from "@/i18n/en";
import { FactionType } from "@/types";

const FACTIONS = Object.values(FactionType);
const MODES = ["GOD", "NORMAL", "HARD"] as const;

function raceKeys(): string[] {
  const keys = [
    "race.title",
    "race.back",
    "race.start",
    "race.difficulty",
    "race.stat.hull",
    "race.stat.shields",
    "race.stat.speed",
    "race.stat.evasion",
  ];
  for (const m of MODES) {
    keys.push(`race.mode.${m}.title`, `race.mode.${m}.desc`);
  }
  for (const f of FACTIONS) {
    keys.push(
      `race.faction.${f}.title`,
      `race.faction.${f}.desc`,
      `race.faction.${f}.bonus`,
    );
  }
  return keys;
}

const RU_CYRILLIC = /[А-Яа-яЁё]/;

describe("faction-selection (RaceSelectionScene) localization", () => {
  it("every race.* key exists in BOTH ru and en (parity)", () => {
    const missing: string[] = [];
    for (const k of raceKeys()) {
      if (!(k in ru)) missing.push(`ru: ${k}`);
      if (!(k in en)) missing.push(`en: ${k}`);
    }
    expect(missing, `missing race keys:\n${missing.join("\n")}`).toEqual([]);
  });

  it("resolves the verbatim Russian under the default language", () => {
    expect(translate("ru", "race.title")).toBe("ВЫБЕРИТЕ ФРАКЦИЮ");
    expect(translate("ru", "race.mode.GOD.title")).toBe("Бог");
    expect(translate("ru", "race.mode.NORMAL.title")).toBe("Средний");
    expect(translate("ru", "race.mode.HARD.title")).toBe("Сложный");
    expect(translate("ru", "race.start")).toBe("НАЧАТЬ ИГРУ");
  });

  it("resolves English when the language is English (no Russian leak)", () => {
    expect(translate("en", "race.title")).toBe("CHOOSE YOUR FACTION");
    const enStrings: string[] = [];
    for (const k of raceKeys()) enStrings.push(translate("en", k));
    const leaks = enStrings.filter((s) => RU_CYRILLIC.test(s));
    expect(
      leaks,
      `EN strings still contain Cyrillic:\n${leaks.join("\n")}`,
    ).toEqual([]);
  });

  it("interpolates the {value} param into the stat labels", () => {
    expect(translate("ru", "race.stat.hull", { value: 130 })).toBe(
      "Корпус: 130",
    );
    expect(translate("en", "race.stat.speed", { value: "1.5" })).toBe(
      "Speed: 1.5",
    );
  });
});
