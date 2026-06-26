/**
 * Dictionary parity guard (`docs/plans/20260625-localization-i18n.md`, Task 2).
 *
 * The RU and EN dictionaries must stay in lockstep — every key present in one
 * MUST exist in the other, so a migrated string is never missing a translation
 * (which would silently fall back to the other language or the bare key). This
 * test is the gate that fails the moment the two key sets diverge.
 */
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
    // Stronger single assertion: the exact same sorted key arrays.
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

  it("EN values differ from RU for at least the visibly-translated keys", () => {
    // A migrated key like `settings.title` should NOT be left as the RU value
    // in en.ts (the most common parity-passing-but-untranslated mistake).
    expect(en["settings.title"]).not.toBe(ru["settings.title"]);
    expect(en["common.back"]).not.toBe(ru["common.back"]);
  });
});
