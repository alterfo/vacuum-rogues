// Tiny i18n layer (`docs/plans/20260625-localization-i18n.md`).
//
// The game's UI was hardcoded Russian; this introduces a key-based lookup with
// **RU + EN** dictionaries so strings can be translated incrementally without a
// save/schema change. `language` is a browser-level pref (`localStorage`), the
// same class as `fontScale`/`neuralEnabled` — **default `ru`** (no behaviour
// change; EN is additive).
//
// Design:
//   • `translate(lang, key, params?)` is the **pure** resolver — fully testable,
//     no storage. It looks the key up in the active-language dict, falls back to
//     the other-language dict, then to the **key itself** (a missing key renders
//     visibly rather than blanking the UI), and interpolates `{param}` tokens.
//   • `t(key, params?)` is the thin live wrapper used by scenes — it reads the
//     current language from storage and delegates to `translate`.
//   • `getLanguage` / `setLanguage` over `localStorage("language")`, every access
//     `typeof`/try-guarded so a runtime without `localStorage` degrades to the
//     default / a no-op rather than throwing (safe under Vitest).

import { ru } from "./ru";
import { en } from "./en";

/** Supported UI languages. */
export type Language = "ru" | "en";

/** A flat key → string dictionary for one language. */
export type Dict = Record<string, string>;

/** Interpolation params for `{token}` placeholders in a template. */
export type TParams = Record<string, string | number>;

/** The default UI language — Russian, so existing behaviour is unchanged. */
export const DEFAULT_LANGUAGE: Language = "ru";

/** localStorage key holding the active UI language. */
export const LANGUAGE_KEY = "language";

/** The dictionaries, keyed by language. */
export const DICTS: Readonly<Record<Language, Dict>> = { ru, en };

/** Minimal injectable view of the persistence store (a `Storage` subset). */
export interface I18nStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The live `localStorage`, or `undefined` when the runtime lacks it. */
function liveStore(): I18nStore | undefined {
  try {
    return typeof localStorage !== "undefined" ? localStorage : undefined;
  } catch {
    // Accessing `localStorage` can throw in sandboxed/disabled-storage contexts.
    return undefined;
  }
}

/** True for a valid {@link Language} value. */
function isLanguage(value: string | null): value is Language {
  return value === "ru" || value === "en";
}

/**
 * The active UI language. Reads `localStorage("language")`, defaulting to
 * {@link DEFAULT_LANGUAGE} for a fresh/unknown value or an unavailable store.
 * Pure given an injected `store`.
 */
export function getLanguage(
  store: I18nStore | undefined = liveStore(),
): Language {
  if (!store) return DEFAULT_LANGUAGE;
  try {
    const v = store.getItem(LANGUAGE_KEY);
    return isLanguage(v) ? v : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

/**
 * Persist the active UI language. Best-effort no-op when storage is unavailable
 * or write-blocked (a storage-disabled browser simply can't remember it).
 */
export function setLanguage(
  lang: Language,
  store: I18nStore | undefined = liveStore(),
): void {
  if (!store) return;
  try {
    store.setItem(LANGUAGE_KEY, lang);
  } catch {
    // Best-effort.
  }
}

/** Replace `{token}` placeholders with `params[token]`; leave unknown tokens. */
function interpolate(template: string, params?: TParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name)
      ? String(params[name])
      : match,
  );
}

/**
 * **Pure** key resolver: look `key` up in the `lang` dict, fall back to the
 * other language, then to the key itself, and interpolate `{param}` tokens.
 * Has no storage dependency — the unit-testable core of {@link t}.
 */
export function translate(
  lang: Language,
  key: string,
  params?: TParams,
): string {
  const primary = DICTS[lang];
  const other = DICTS[lang === "ru" ? "en" : "ru"];
  const template = primary[key] ?? other[key] ?? key;
  return interpolate(template, params);
}

/**
 * Translate `key` into the **active** language (read live from storage) with
 * optional `{param}` interpolation. The choke point every UI literal migrates
 * onto; a missing key renders as the key itself so the UI never blanks.
 */
export function t(key: string, params?: TParams): string {
  return translate(getLanguage(), key, params);
}
