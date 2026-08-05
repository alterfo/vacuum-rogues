import { ru } from "./ru";
import { en } from "./en";

export type Language = "ru" | "en";

export type Dict = Record<string, string>;

export type TParams = Record<string, string | number>;

export const DEFAULT_LANGUAGE: Language = "ru";

export const LANGUAGE_KEY = "language";

export const DICTS: Readonly<Record<Language, Dict>> = { ru, en };

export interface I18nStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function liveStore(): I18nStore | undefined {
  try {
    return typeof localStorage !== "undefined" ? localStorage : undefined;
  } catch {
    return undefined;
  }
}

function isLanguage(value: string | null): value is Language {
  return value === "ru" || value === "en";
}

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

function interpolate(template: string, params?: TParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name)
      ? String(params[name])
      : match,
  );
}

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

export function t(key: string, params?: TParams): string {
  return translate(getLanguage(), key, params);
}
