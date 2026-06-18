/**
 * Task 7 (living-trade-economy-rumors): the Info Center surfaces active
 * trade-route rumors to the player. `buildRumorPanel` is the pure projection
 * the news tab's "Торговые возможности" band renders — sorted most-profitable
 * first, capped, formatted with the domain `describeRumor` one-liner, with an
 * empty-state fallback. Tested without a PixiJS renderer.
 */
import { describe, it, expect } from "vitest";
import { buildRumorPanel } from "@/presentation/rumorPanel";
import { Galaxy } from "@/domain/Galaxy";
import { createRumor } from "@/domain/RouteRumor";
import type { RouteLike } from "@/domain/RouteRumor";
import type { StarSystem } from "@/domain/StarSystem";
import type { Overmind } from "@/domain/Overmind";
import { ResourceType } from "@/types";

const SYS = [
  { id: "S1", name: "Соль" },
  { id: "S2", name: "Вега" },
  { id: "S3", name: "Орион" },
];

function makeGalaxy(): Galaxy {
  return new Galaxy(
    "g1",
    SYS as unknown as StarSystem[],
    {} as unknown as Overmind,
    [],
  );
}

/** A scanner-shaped route; toPrice derived so the margin math is consistent. */
function route(
  resource: ResourceType,
  from: string,
  to: string,
  marginPct: number,
): RouteLike {
  const fromPrice = 100;
  return {
    resource,
    fromSystemId: from,
    fromPlanetId: `${from}p`,
    toSystemId: to,
    toPlanetId: `${to}p`,
    fromPrice,
    toPrice: fromPrice * (1 + marginPct / 100),
    marginPct,
  };
}

describe("buildRumorPanel", () => {
  it("returns the empty-state copy when the galaxy is null", () => {
    const data = buildRumorPanel(null);
    expect(data.lines).toEqual([]);
    expect(data.emptyText).toBe("Активных торговых маршрутов нет");
  });

  it("returns the empty-state copy when there are no active rumors", () => {
    const galaxy = makeGalaxy();
    const data = buildRumorPanel(galaxy);
    expect(data.lines).toEqual([]);
    expect(data.emptyText).not.toBeNull();
  });

  it("lists active rumors most-profitable first with the Russian formatter", () => {
    const galaxy = makeGalaxy();
    galaxy.activeRumors = [
      createRumor(route(ResourceType.FUEL, "S1", "S2", 30), 1),
      createRumor(route(ResourceType.METALS, "S2", "S3", 70), 1),
    ];

    const data = buildRumorPanel(galaxy);
    expect(data.emptyText).toBeNull();
    expect(data.lines).toHaveLength(2);
    // Higher margin (70%) sorts first.
    expect(data.lines[0].text).toContain("Металлы");
    expect(data.lines[0].text).toContain("маржа ~70%");
    expect(data.lines[1].text).toContain("Топливо");
    // System names are resolved, not raw ids.
    expect(data.lines[0].text).toContain("Вега");
    expect(data.lines[0].text).toContain("Орион");
    expect(data.lines[0].text).toContain("Везите");
  });

  it("caps the panel to the requested maximum", () => {
    const galaxy = makeGalaxy();
    galaxy.activeRumors = [
      createRumor(route(ResourceType.FUEL, "S1", "S2", 60), 1),
      createRumor(route(ResourceType.METALS, "S2", "S3", 50), 1),
      createRumor(route(ResourceType.CRYSTALS, "S3", "S1", 40), 1),
    ];

    const data = buildRumorPanel(galaxy, 2);
    expect(data.lines).toHaveLength(2);
    // The two highest margins survive the cap, in order.
    expect(data.lines[0].text).toContain("маржа ~60%");
    expect(data.lines[1].text).toContain("маржа ~50%");
  });
});
