import { describe, it, expect } from "vitest";
import {
  createRumor,
  rumorId,
  describeRumor,
  resourceLabelRu,
  type RouteRumor,
  type RouteLike,
} from "@/domain/RouteRumor";
import { RouteRumorSchema, NewsEventSchema } from "@/validation/schemas";
import type { Galaxy } from "@/domain/Galaxy";
import type { NewsEvent } from "@/types";
import { ResourceType } from "@/types";

/** A RouteScanner-shaped candidate (structurally satisfies RouteLike). */
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

/** Minimal galaxy stub: describeRumor only reads systems[].id + .name. */
function makeGalaxy(systems: { id: string; name: string }[]): Galaxy {
  return { systems } as unknown as Galaxy;
}

describe("RouteRumor — construction & identity", () => {
  it("createRumor copies route fields and stamps lifecycle bookkeeping", () => {
    const rumor = createRumor(CANDIDATE, 7);
    expect(rumor).toMatchObject({
      resource: ResourceType.METALS,
      fromSystemId: "S1",
      fromPlanetId: "A",
      toSystemId: "S2",
      toPlanetId: "B",
      fromPrice: 100,
      toPrice: 135,
      marginPct: 35,
      createdDay: 7,
      lastMarginPct: 35,
    });
  });

  it("rumorId is deterministic and keyed by resource + endpoints", () => {
    expect(rumorId(CANDIDATE)).toBe("METALS:S1->S2");
    expect(createRumor(CANDIDATE, 1).id).toBe(rumorId(CANDIDATE));
    // Same route, different day → same id (so re-scans update in place).
    expect(createRumor(CANDIDATE, 99).id).toBe("METALS:S1->S2");
  });
});

describe("RouteRumor — Russian formatter", () => {
  it("resourceLabelRu maps every resource type", () => {
    for (const r of Object.values(ResourceType)) {
      expect(resourceLabelRu(r).length).toBeGreaterThan(0);
    }
    expect(resourceLabelRu(ResourceType.FUEL)).toBe("Топливо");
  });

  it("describeRumor renders 'Везите <товар> из <A> в <B>: маржа ~N%'", () => {
    const galaxy = makeGalaxy([
      { id: "S1", name: "Соль" },
      { id: "S2", name: "Вега" },
    ]);
    const rumor = createRumor(CANDIDATE, 3);
    expect(describeRumor(rumor, galaxy)).toBe(
      "Везите Металлы из Соль в Вега: маржа ~35%",
    );
  });

  it("describeRumor rounds the live lastMarginPct, not the open margin", () => {
    const galaxy = makeGalaxy([
      { id: "S1", name: "Соль" },
      { id: "S2", name: "Вега" },
    ]);
    const rumor: RouteRumor = {
      ...createRumor(CANDIDATE, 0),
      lastMarginPct: 12.6,
    };
    expect(describeRumor(rumor, galaxy)).toContain("маржа ~13%");
  });

  it("describeRumor falls back to raw system ids when unknown", () => {
    const galaxy = makeGalaxy([]);
    const rumor = createRumor(CANDIDATE, 0);
    expect(describeRumor(rumor, galaxy)).toBe(
      "Везите Металлы из S1 в S2: маржа ~35%",
    );
  });
});

describe("RouteRumor — schema round-trips", () => {
  it("RouteRumorSchema accepts a created rumor unchanged", () => {
    const rumor = createRumor(CANDIDATE, 5);
    const parsed = RouteRumorSchema.parse(rumor);
    expect(parsed).toEqual(rumor);
  });

  it("RouteRumorSchema rejects an unknown resource", () => {
    const bad = { ...createRumor(CANDIDATE, 5), resource: "UNOBTANIUM" };
    expect(() => RouteRumorSchema.parse(bad)).toThrow();
  });

  it("NewsEventSchema round-trips a TRADE_OPPORTUNITY event with rumor fields", () => {
    const event: NewsEvent = {
      type: "TRADE_OPPORTUNITY",
      systemId: "S1",
      day: 4,
      description: "Везите Металлы из Соль в Вега: маржа ~35%",
      resource: ResourceType.METALS,
      fromSystemId: "S1",
      toSystemId: "S2",
      marginPct: 35,
    };
    const parsed = NewsEventSchema.parse(event);
    expect(parsed).toMatchObject({
      type: "TRADE_OPPORTUNITY",
      resource: "METALS",
      fromSystemId: "S1",
      toSystemId: "S2",
      marginPct: 35,
    });
  });

  it("NewsEventSchema still validates legacy events without rumor fields", () => {
    const legacy: NewsEvent = {
      type: "MARKET_SHIFT",
      systemId: "S3",
      day: 2,
      description: "Цены качнулись",
    };
    expect(() => NewsEventSchema.parse(legacy)).not.toThrow();
  });
});
