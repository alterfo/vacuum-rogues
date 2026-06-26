import { describe, it, expect } from "vitest";
import {
  t,
  translate,
  getLanguage,
  setLanguage,
  DEFAULT_LANGUAGE,
  LANGUAGE_KEY,
  DICTS,
  type I18nStore,
} from "@/i18n/i18n";

/** In-memory Storage subset for the language-persistence tests. */
function fakeStore(initial: Record<string, string> = {}): I18nStore & {
  map: Map<string, string>;
} {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    map,
    getItem: (k) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

describe("translate — pure key resolver", () => {
  it("looks a key up in the requested language", () => {
    expect(translate("ru", "common.back")).toBe(DICTS.ru["common.back"]);
    expect(translate("en", "common.back")).toBe(DICTS.en["common.back"]);
  });

  it("returns distinct values per language for the same key", () => {
    expect(translate("ru", "settings.title")).not.toBe(
      translate("en", "settings.title"),
    );
  });

  it("falls back to the other language when the key is missing in the active one", () => {
    // Inject a key only into EN, ask in RU → should resolve to the EN value.
    const key = "__test.only_en";
    DICTS.en[key] = "EN only";
    try {
      expect(translate("ru", key)).toBe("EN only");
    } finally {
      delete DICTS.en[key];
    }
  });

  it("falls back to the key itself when missing in both dictionaries", () => {
    expect(translate("ru", "no.such.key")).toBe("no.such.key");
    expect(translate("en", "no.such.key")).toBe("no.such.key");
  });

  it("interpolates {param} tokens", () => {
    const key = "__test.greet";
    DICTS.ru[key] = "Привет, {name}! У вас {count} кредитов";
    try {
      expect(translate("ru", key, { name: "Пилот", count: 500 })).toBe(
        "Привет, Пилот! У вас 500 кредитов",
      );
    } finally {
      delete DICTS.ru[key];
    }
  });

  it("leaves unknown {tokens} untouched and ignores extra params", () => {
    const key = "__test.partial";
    DICTS.ru[key] = "{a} and {b}";
    try {
      expect(translate("ru", key, { a: "X", extra: "ignored" })).toBe(
        "X and {b}",
      );
    } finally {
      delete DICTS.ru[key];
    }
  });
});

describe("getLanguage / setLanguage", () => {
  it("defaults to ru on a fresh store", () => {
    expect(getLanguage(fakeStore())).toBe("ru");
    expect(DEFAULT_LANGUAGE).toBe("ru");
  });

  it("setLanguage persists and getLanguage reads it back", () => {
    const store = fakeStore();
    setLanguage("en", store);
    expect(store.map.get(LANGUAGE_KEY)).toBe("en");
    expect(getLanguage(store)).toBe("en");
  });

  it("treats an unknown stored value as the default", () => {
    expect(getLanguage(fakeStore({ [LANGUAGE_KEY]: "fr" }))).toBe("ru");
    expect(getLanguage(fakeStore({ [LANGUAGE_KEY]: "" }))).toBe("ru");
  });

  describe("degraded storage", () => {
    it("getLanguage degrades to the default when the store is undefined", () => {
      expect(getLanguage(undefined)).toBe(DEFAULT_LANGUAGE);
    });

    it("setLanguage is a no-op (does not throw) when undefined", () => {
      expect(() => setLanguage("en", undefined)).not.toThrow();
    });

    it("does not throw when getItem/setItem throw", () => {
      const throwing: I18nStore = {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
      };
      expect(() => setLanguage("en", throwing)).not.toThrow();
      expect(getLanguage(throwing)).toBe(DEFAULT_LANGUAGE);
    });
  });
});

describe("t — live wrapper", () => {
  it("reads the active language from localStorage and switches live", () => {
    localStorage.clear();
    // Default (nothing stored) → ru.
    expect(t("settings.title")).toBe(DICTS.ru["settings.title"]);
    // Switch to en via the live store and re-resolve.
    setLanguage("en");
    expect(t("settings.title")).toBe(DICTS.en["settings.title"]);
    setLanguage("ru");
    expect(t("settings.title")).toBe(DICTS.ru["settings.title"]);
    localStorage.clear();
  });

  it("interpolates params through the live wrapper", () => {
    const key = "__test.live";
    DICTS.ru[key] = "{n} единиц";
    try {
      localStorage.clear();
      expect(t(key, { n: 3 })).toBe("3 единиц");
    } finally {
      delete DICTS.ru[key];
      localStorage.clear();
    }
  });
});
