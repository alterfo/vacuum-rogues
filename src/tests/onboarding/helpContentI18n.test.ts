/**
 * Onboarding / contextual-help localization (Task 4 of
 * `docs/plans/20260626-playtest-bugs-pause-help-infocenter-i18n.md`).
 *
 * The help-content registry (`helpContent.ts`) now resolves every title / body /
 * controls string through the i18n layer (`t(...)`), so the help panel renders in
 * the active language and re-reads on a language change. This guard pins:
 *   • parity — every onboarding `help.<key>.*` key exists in BOTH catalogs, and
 *   • live resolution — `helpFor(key)` returns the active-language string (EN vs RU).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  HELP_SPEC,
  helpFor,
  helpI18nKeys,
  type HelpKey,
} from "@/systems/onboarding/helpContent";
import { ru } from "@/i18n/ru";
import { en } from "@/i18n/en";

const ALL_KEYS = Object.keys(HELP_SPEC) as HelpKey[];

function setLang(lang: "ru" | "en"): void {
  try {
    localStorage.setItem("language", lang);
  } catch {
    /* runtime without localStorage */
  }
}

describe("onboarding help content localization", () => {
  beforeEach(() => setLang("ru"));
  afterEach(() => {
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
  });

  it("every onboarding i18n key exists in BOTH ru and en (parity)", () => {
    const missing: string[] = [];
    for (const key of ALL_KEYS) {
      for (const k of helpI18nKeys(key)) {
        if (!(k in ru)) missing.push(`ru: ${k}`);
        if (!(k in en)) missing.push(`en: ${k}`);
      }
    }
    expect(missing, `missing onboarding keys:\n${missing.join("\n")}`).toEqual(
      [],
    );
  });

  it("the panel-chrome keys exist in both catalogs", () => {
    for (const k of ["help.controlsHeader", "help.gotIt"]) {
      expect(k in ru, `ru missing ${k}`).toBe(true);
      expect(k in en, `en missing ${k}`).toBe(true);
    }
  });

  it("helpFor resolves the RU strings under the default language", () => {
    for (const key of ALL_KEYS) {
      const entry = helpFor(key);
      const keys = helpI18nKeys(key);
      expect(entry.title).toBe(ru[keys[0]]);
      const lines = [...entry.body, ...(entry.controls ?? [])];
      const expected = keys.slice(1).map((k) => ru[k]);
      expect(lines).toEqual(expected);
    }
  });

  it("helpFor resolves the EN strings when the language is English", () => {
    setLang("en");
    for (const key of ALL_KEYS) {
      const entry = helpFor(key);
      const keys = helpI18nKeys(key);
      expect(entry.title).toBe(en[keys[0]]);
      const lines = [...entry.body, ...(entry.controls ?? [])];
      const expected = keys.slice(1).map((k) => en[k]);
      expect(lines).toEqual(expected);
    }
  });

  it("re-reads live on a language switch (same entry object, new strings)", () => {
    const entry = helpFor("welcome");
    expect(entry.title).toBe(ru["help.welcome.title"]);
    setLang("en");
    // Same object reference, but the getters now resolve to English.
    expect(entry.title).toBe(en["help.welcome.title"]);
    expect(entry.title).not.toBe(ru["help.welcome.title"]);
  });

  it("the welcome + combat one-shot hints resolve through t() (EN, no Russian leak)", () => {
    setLang("en");
    const welcome = helpFor("welcome");
    const combat = helpFor("combat");
    // Both render their English titles, not the Russian source text.
    expect(welcome.title).toBe(en["help.welcome.title"]);
    expect(combat.title).toBe(en["help.combat.title"]);
    // No Cyrillic in the English-resolved combat body/controls.
    const text = [
      combat.title,
      ...combat.body,
      ...(combat.controls ?? []),
    ].join(" ");
    expect(/[А-Яа-яЁё]/.test(text)).toBe(false);
  });
});
