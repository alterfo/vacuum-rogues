import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createRumor,
  describeRumor,
  resourceLabelRu,
  rumorMarginMasked,
  type RouteLike,
} from "@/domain/RouteRumor";
import { maskTradeNewsMargin } from "@/presentation/rumorPanel";
import { t } from "@/i18n/i18n";
import { ru } from "@/i18n/ru";
import { en } from "@/i18n/en";
import { ResourceType } from "@/types";
import type { Galaxy } from "@/domain/Galaxy";
import type { Player } from "@/domain/Player";

function setLang(lang: "ru" | "en"): void {
  try {
    localStorage.setItem("language", lang);
  } catch {
    /* runtime without localStorage */
  }
}

function makeGalaxy(systems: { id: string; name: string }[]): Galaxy {
  return { systems } as unknown as Galaxy;
}

const CANDIDATE: RouteLike = {
  resource: ResourceType.METALS,
  fromSystemId: "S1",
  fromPlanetId: "A",
  toSystemId: "S2",
  toPlanetId: "B",
  fromPrice: 100,
  toPrice: 135,
  marginPct: 35,
};

const GALAXY = makeGalaxy([
  { id: "S1", name: "Sol" },
  { id: "S2", name: "Vega" },
]);

describe("rumor/news i18n", () => {
  beforeEach(() => setLang("ru"));
  afterEach(() => {
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
  });

  it("resourceLabelRu renders the active language", () => {
    setLang("ru");
    expect(resourceLabelRu(ResourceType.METALS)).toBe("Металлы");
    setLang("en");
    expect(resourceLabelRu(ResourceType.METALS)).toBe("Metals");
  });

  it("describeRumor renders RU by default and EN under language=en, params filled", () => {
    const rumor = createRumor(CANDIDATE, 3);

    setLang("ru");
    expect(describeRumor(rumor, GALAXY)).toBe(
      "Везите Металлы из Sol в Vega: маржа ~35%",
    );

    setLang("en");
    expect(describeRumor(rumor, GALAXY)).toBe(
      "Ship Metals from Sol to Vega: margin ~35%",
    );
  });

  it("describeRumor masks the margin per language while keeping the route text", () => {
    const rumor = createRumor(CANDIDATE, 0);

    setLang("ru");
    expect(describeRumor(rumor, GALAXY, true)).toBe(
      "Везите Металлы из Sol в Vega: маржа ~?%",
    );

    setLang("en");
    const en1 = describeRumor(rumor, GALAXY, true);
    expect(en1).toBe("Ship Metals from Sol to Vega: margin ~?%");
    expect(en1).not.toMatch(/[А-Яа-я]/);
  });

  it("rumorMarginMasked follows the active language", () => {
    setLang("ru");
    expect(rumorMarginMasked()).toBe("маржа ~?%");
    setLang("en");
    expect(rumorMarginMasked()).toBe("margin ~?%");
  });

  it("the RumorDirector 'deal ended' line localizes (the exact t() call it emits)", () => {
    setLang("ru");
    expect(
      t("rumor.expired", {
        resource: resourceLabelRu(ResourceType.METALS),
        from: "Sol",
        to: "Vega",
      }),
    ).toBe("Везти Металлы из Sol в Vega больше невыгодно — акция закончилась.");

    setLang("en");
    const enLine = t("rumor.expired", {
      resource: resourceLabelRu(ResourceType.METALS),
      from: "Sol",
      to: "Vega",
    });
    expect(enLine).not.toMatch(/[А-Яа-я]/);
    expect(enLine).toContain("Metals");
    expect(enLine).toContain("Sol");
    expect(enLine).toContain("Vega");
  });

  it("the news re-mask is language-robust (matches a margin baked in either tongue)", () => {
    const galaxy = makeGalaxy([
      { id: "S1", name: "Sol" },
      { id: "S2", name: "Vega" },
    ]);
    const player = { hasVisited: () => false } as unknown as Player;
    const event = {
      type: "TRADE_OPPORTUNITY",
      fromSystemId: "S1",
      toSystemId: "S2",
    };

    setLang("en");
    const ruBaked = "Везите Металлы из Sol в Vega: маржа ~70%";
    const out = maskTradeNewsMargin(ruBaked, event, galaxy, player);
    expect(out).toContain("margin ~?%");
    expect(out).not.toContain("~70%");

    const enBaked = "Ship Metals from Sol to Vega: margin ~70%";
    expect(maskTradeNewsMargin(enBaked, event, galaxy, player)).toBe(
      "Ship Metals from Sol to Vega: margin ~?%",
    );
  });

  it("every rumor.* / news.* key exists in BOTH catalogs (parity)", () => {
    const keys = Object.keys(ru).filter(
      (k) => k.startsWith("rumor.") || k.startsWith("news."),
    );
    expect(keys.length).toBeGreaterThan(0);
    const missing: string[] = [];
    for (const k of keys) {
      if (!(k in en)) missing.push(`en missing ${k}`);
      if (!ru[k]) missing.push(`ru empty ${k}`);
      if (!en[k]) missing.push(`en empty ${k}`);
    }
    expect(missing, missing.join("\n")).toEqual([]);
  });
});
