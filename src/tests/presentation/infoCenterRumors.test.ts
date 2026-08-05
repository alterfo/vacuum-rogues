import { describe, it, expect } from "vitest";
import {
  buildRumorPanel,
  maskTradeNewsMargin,
  RUMOR_PANEL_MAX,
} from "@/presentation/rumorPanel";
import { Galaxy } from "@/domain/Galaxy";
import { createRumor } from "@/domain/RouteRumor";
import type { RouteLike } from "@/domain/RouteRumor";
import type { StarSystem } from "@/domain/StarSystem";
import type { Overmind } from "@/domain/Overmind";
import type { Player } from "@/domain/Player";
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

function makeGalaxyWithExplored(
  systems: Array<{ id: string; name: string; explored: boolean }>,
): Galaxy {
  return new Galaxy(
    "g1",
    systems as unknown as StarSystem[],
    {} as unknown as Overmind,
    [],
  );
}

function makePlayer(visited: string[]): Player {
  const visitedSystems = [...visited];
  return {
    visitedSystems,
    hasVisited: (id: string) => visitedSystems.includes(id),
  } as unknown as Player;
}

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
    expect(data.lines[0].text).toContain("Металлы");
    expect(data.lines[0].text).toContain("маржа ~70%");
    expect(data.lines[1].text).toContain("Топливо");
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
    expect(data.lines[0].text).toContain("маржа ~60%");
    expect(data.lines[1].text).toContain("маржа ~50%");
  });
});

describe("buildRumorPanel — partial observability (margins masked for unknown systems)", () => {
  const NUMERIC_MARGIN = /маржа ~\d+%/;

  it("masks the margin when a route endpoint is unknown (neither explored nor visited)", () => {
    const galaxy = makeGalaxyWithExplored([
      { id: "S1", name: "Соль", explored: true },
      { id: "S2", name: "Вега", explored: false }, // destination undiscovered
    ]);
    galaxy.activeRumors = [
      createRumor(route(ResourceType.FUEL, "S1", "S2", 30), 1),
    ];
    const player = makePlayer([]); // visited nothing

    const data = buildRumorPanel(galaxy, RUMOR_PANEL_MAX, player);
    expect(data.lines).toHaveLength(1);
    expect(data.lines[0].text).not.toMatch(NUMERIC_MARGIN);
    expect(data.lines[0].text).toContain("маржа ~?%");
    expect(data.lines[0].text).toContain("Топливо");
    expect(data.lines[0].text).toContain("Соль");
    expect(data.lines[0].text).toContain("Вега");
  });

  it("shows the margin when both endpoints are explored on the star-map", () => {
    const galaxy = makeGalaxyWithExplored([
      { id: "S1", name: "Соль", explored: true },
      { id: "S2", name: "Вега", explored: true },
    ]);
    galaxy.activeRumors = [
      createRumor(route(ResourceType.FUEL, "S1", "S2", 30), 1),
    ];
    const player = makePlayer([]);

    const data = buildRumorPanel(galaxy, RUMOR_PANEL_MAX, player);
    expect(data.lines[0].text).toContain("маржа ~30%");
    expect(data.lines[0].text).not.toContain("?");
  });

  it("masks the margin when the SOURCE endpoint is unknown (destination known)", () => {
    const galaxy = makeGalaxyWithExplored([
      { id: "S1", name: "Соль", explored: false }, // source undiscovered
      { id: "S2", name: "Вега", explored: true },
    ]);
    galaxy.activeRumors = [
      createRumor(route(ResourceType.FUEL, "S1", "S2", 30), 1),
    ];
    const player = makePlayer([]); // visited nothing

    const data = buildRumorPanel(galaxy, RUMOR_PANEL_MAX, player);
    expect(data.lines[0].text).not.toMatch(NUMERIC_MARGIN);
    expect(data.lines[0].text).toContain("маржа ~?%");
  });

  it("masks the margin when neither endpoint is known (player supplied)", () => {
    const galaxy = makeGalaxyWithExplored([
      { id: "S1", name: "Соль", explored: false },
      { id: "S2", name: "Вега", explored: false },
    ]);
    galaxy.activeRumors = [
      createRumor(route(ResourceType.FUEL, "S1", "S2", 30), 1),
    ];
    const player = makePlayer([]);

    const data = buildRumorPanel(galaxy, RUMOR_PANEL_MAX, player);
    expect(data.lines[0].text).not.toMatch(NUMERIC_MARGIN);
    expect(data.lines[0].text).toContain("маржа ~?%");
  });

  it("shows the margin when an unexplored endpoint has been visited", () => {
    const galaxy = makeGalaxyWithExplored([
      { id: "S1", name: "Соль", explored: true },
      { id: "S2", name: "Вега", explored: false },
    ]);
    galaxy.activeRumors = [
      createRumor(route(ResourceType.FUEL, "S1", "S2", 30), 1),
    ];
    const player = makePlayer(["S2"]); // visited the otherwise-hidden endpoint

    const data = buildRumorPanel(galaxy, RUMOR_PANEL_MAX, player);
    expect(data.lines[0].text).toContain("маржа ~30%");
  });

  it("masks per-row: known route keeps its margin, unknown route is hidden", () => {
    const galaxy = makeGalaxyWithExplored([
      { id: "S1", name: "Соль", explored: true },
      { id: "S2", name: "Вега", explored: true },
      { id: "S3", name: "Орион", explored: false }, // undiscovered
    ]);
    galaxy.activeRumors = [
      createRumor(route(ResourceType.METALS, "S2", "S3", 70), 1), // touches unknown S3
      createRumor(route(ResourceType.FUEL, "S1", "S2", 30), 1), // both known
    ];
    const player = makePlayer([]);

    const data = buildRumorPanel(galaxy, RUMOR_PANEL_MAX, player);
    expect(data.lines[0].text).toContain("Металлы");
    expect(data.lines[0].text).not.toMatch(NUMERIC_MARGIN);
    expect(data.lines[0].text).toContain("маржа ~?%");
    expect(data.lines[1].text).toContain("маржа ~30%");
  });

  it("does not mask when no player is supplied (legacy callers unchanged)", () => {
    const galaxy = makeGalaxyWithExplored([
      { id: "S1", name: "Соль", explored: false },
      { id: "S2", name: "Вега", explored: false },
    ]);
    galaxy.activeRumors = [
      createRumor(route(ResourceType.FUEL, "S1", "S2", 30), 1),
    ];

    const data = buildRumorPanel(galaxy, RUMOR_PANEL_MAX);
    expect(data.lines[0].text).toContain("маржа ~30%");
  });
});

describe("maskTradeNewsMargin — InfoCenter news feed respects partial observability", () => {
  const NUMERIC_MARGIN = /маржа ~\d+%/;
  const DESC = "Везите Топливо из Соль в Вега: маржа ~70%";

  function tradeEvent(from = "S1", to = "S2") {
    return { type: "TRADE_OPPORTUNITY", fromSystemId: from, toSystemId: to };
  }

  it("masks the baked margin when a route endpoint is undiscovered", () => {
    const galaxy = makeGalaxyWithExplored([
      { id: "S1", name: "Соль", explored: true },
      { id: "S2", name: "Вега", explored: false }, // undiscovered
    ]);
    const out = maskTradeNewsMargin(DESC, tradeEvent(), galaxy, makePlayer([]));
    expect(out).not.toMatch(NUMERIC_MARGIN);
    expect(out).toContain("маржа ~?%");
    expect(out).toContain("Топливо");
    expect(out).toContain("Соль");
    expect(out).toContain("Вега");
  });

  it("keeps the margin when both endpoints are known", () => {
    const galaxy = makeGalaxyWithExplored([
      { id: "S1", name: "Соль", explored: true },
      { id: "S2", name: "Вега", explored: true },
    ]);
    const out = maskTradeNewsMargin(DESC, tradeEvent(), galaxy, makePlayer([]));
    expect(out).toBe(DESC);
  });

  it("masks when the SOURCE endpoint is unknown (destination known)", () => {
    const galaxy = makeGalaxyWithExplored([
      { id: "S1", name: "Соль", explored: false }, // undiscovered source
      { id: "S2", name: "Вега", explored: true },
    ]);
    const out = maskTradeNewsMargin(DESC, tradeEvent(), galaxy, makePlayer([]));
    expect(out).not.toMatch(NUMERIC_MARGIN);
    expect(out).toContain("маржа ~?%");
  });

  it("leaves non-trade news events untouched", () => {
    const galaxy = makeGalaxyWithExplored([
      { id: "S1", name: "Соль", explored: false },
      { id: "S2", name: "Вега", explored: false },
    ]);
    const event = {
      type: "MARKET_SHIFT",
      fromSystemId: "S1",
      toSystemId: "S2",
    };
    const desc =
      "Везти Топливо из Соль в Вега больше невыгодно — акция закончилась.";
    expect(maskTradeNewsMargin(desc, event, galaxy, makePlayer([]))).toBe(desc);
  });

  it("does not mask when no player is supplied (legacy/headless path)", () => {
    const galaxy = makeGalaxyWithExplored([
      { id: "S1", name: "Соль", explored: false },
      { id: "S2", name: "Вега", explored: false },
    ]);
    expect(maskTradeNewsMargin(DESC, tradeEvent(), galaxy, null)).toBe(DESC);
  });

  it("passes through a trade event missing endpoint ids", () => {
    const galaxy = makeGalaxyWithExplored([
      { id: "S1", name: "Соль", explored: false },
    ]);
    const event = { type: "TRADE_OPPORTUNITY" };
    expect(maskTradeNewsMargin(DESC, event, galaxy, makePlayer([]))).toBe(DESC);
  });
});
