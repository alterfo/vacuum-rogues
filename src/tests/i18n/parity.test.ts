import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import { en } from "@/i18n/en";

describe("i18n dictionary parity (ru ⇄ en)", () => {
  it("ru and en have identical key sets", () => {
    const ruKeys = Object.keys(ru).sort();
    const enKeys = Object.keys(en).sort();

    const missingInEn = ruKeys.filter((k) => !(k in en));
    const missingInRu = enKeys.filter((k) => !(k in ru));

    expect(
      missingInEn,
      `keys missing from en.ts: ${missingInEn.join(", ")}`,
    ).toEqual([]);
    expect(
      missingInRu,
      `keys missing from ru.ts: ${missingInRu.join(", ")}`,
    ).toEqual([]);
    expect(enKeys).toEqual(ruKeys);
  });

  it("every value is a non-empty string in both languages", () => {
    for (const [key, value] of Object.entries(ru)) {
      expect(typeof value, `ru["${key}"] must be a string`).toBe("string");
      expect(
        value.trim().length,
        `ru["${key}"] must be non-empty`,
      ).toBeGreaterThan(0);
    }
    for (const [key, value] of Object.entries(en)) {
      expect(typeof value, `en["${key}"] must be a string`).toBe("string");
      expect(
        value.trim().length,
        `en["${key}"] must be non-empty`,
      ).toBeGreaterThan(0);
    }
  });

  it("the migrated set is non-empty (the dictionaries are seeded)", () => {
    expect(Object.keys(ru).length).toBeGreaterThan(0);
    expect(Object.keys(en).length).toBe(Object.keys(ru).length);
  });

  it("each key's {param} placeholders are identical across ru and en", () => {
    const tokens = (s: string): string =>
      [...s.matchAll(/\{(\w+)\}/g)]
        .map((m) => m[1])
        .sort()
        .join(",");
    const mismatches: string[] = [];
    for (const key of Object.keys(ru)) {
      const ruTokens = tokens(ru[key]);
      const enTokens = tokens(en[key] ?? "");
      if (ruTokens !== enTokens) {
        mismatches.push(`${key}: ru={${ruTokens}} en={${enTokens}}`);
      }
    }
    expect(
      mismatches,
      `{param} placeholders diverge between ru/en:\n${mismatches.join("\n")}`,
    ).toEqual([]);
  });

  it("EN values differ from RU for at least the visibly-translated keys", () => {
    expect(en["settings.title"]).not.toBe(ru["settings.title"]);
    expect(en["common.back"]).not.toBe(ru["common.back"]);
  });
});
