import { describe, it, expect } from "vitest";
import {
  buildRumorPanel,
  feedEventVisible,
  rumorPanelNoIntel,
  RUMOR_PANEL_MAX,
} from "@/presentation/rumorPanel";
import { Galaxy } from "@/domain/Galaxy";
import { createRumor } from "@/domain/RouteRumor";
import type { RouteLike } from "@/domain/RouteRumor";
import type { StarSystem } from "@/domain/StarSystem";
import type { Overmind } from "@/domain/Overmind";
import type { Player } from "@/domain/Player";
import { ResourceType } from "@/types";

function makeGalaxy(
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

describe("buildRumorPanel — hideUnknown drops unexplored-system routes entirely", () => {
  const NUMERIC_MARGIN = /маржа ~\d+%/;

  it("removes the row for a route touching an unknown system (not just masked)", () => {
    const galaxy = makeGalaxy([
      { id: "S1", name: "Соль", explored: true },
      { id: "S2", name: "Вега", explored: false }, // undiscovered destination
    ]);
    galaxy.activeRumors = [
      createRumor(route(ResourceType.FUEL, "S1", "S2", 30), 1),
    ];
    const player = makePlayer([]);

    const data = buildRumorPanel(galaxy, RUMOR_PANEL_MAX, player, true);
    expect(data.lines).toHaveLength(0);
    expect(data.emptyText).toBe(rumorPanelNoIntel());
  });

  it("keeps a fully-known route with its real margin", () => {
    const galaxy = makeGalaxy([
      { id: "S1", name: "Соль", explored: true },
      { id: "S2", name: "Вега", explored: true },
    ]);
    galaxy.activeRumors = [
      createRumor(route(ResourceType.FUEL, "S1", "S2", 42), 1),
    ];
    const player = makePlayer([]);

    const data = buildRumorPanel(galaxy, RUMOR_PANEL_MAX, player, true);
    expect(data.lines).toHaveLength(1);
    expect(data.lines[0].text).toMatch(NUMERIC_MARGIN);
    expect(data.lines[0].text).toContain("маржа ~42%");
    expect(data.emptyText).toBeNull();
  });

  it("drops only the unknown route, keeps the known one", () => {
    const galaxy = makeGalaxy([
      { id: "S1", name: "Соль", explored: true },
      { id: "S2", name: "Вега", explored: true },
      { id: "S3", name: "Орион", explored: false }, // undiscovered
    ]);
    galaxy.activeRumors = [
      createRumor(route(ResourceType.METALS, "S2", "S3", 70), 1), // unknown S3
      createRumor(route(ResourceType.FUEL, "S1", "S2", 30), 1), // both known
    ];
    const player = makePlayer([]);

    const data = buildRumorPanel(galaxy, RUMOR_PANEL_MAX, player, true);
    expect(data.lines).toHaveLength(1);
    expect(data.lines[0].text).toContain("маржа ~30%");
    expect(data.lines[0].text).not.toContain("Орион");
  });

  it("default (hideUnknown=false) preserves the legacy masking behaviour", () => {
    const galaxy = makeGalaxy([
      { id: "S1", name: "Соль", explored: true },
      { id: "S2", name: "Вега", explored: false },
    ]);
    galaxy.activeRumors = [
      createRumor(route(ResourceType.FUEL, "S1", "S2", 30), 1),
    ];
    const player = makePlayer([]);

    const data = buildRumorPanel(galaxy, RUMOR_PANEL_MAX, player);
    expect(data.lines).toHaveLength(1);
    expect(data.lines[0].text).toContain("маржа ~?%");
  });
});

describe("feedEventVisible — news feed scoped to scouted systems", () => {
  const galaxy = makeGalaxy([
    { id: "S1", name: "Соль", explored: true },
    { id: "S2", name: "Вега", explored: false },
  ]);

  it("hides a single-system event in an unknown system", () => {
    const event = { type: "SYSTEM_CAPTURED", systemId: "S2" };
    expect(feedEventVisible(event, galaxy, makePlayer([]))).toBe(false);
  });

  it("shows a single-system event in a known system", () => {
    const event = { type: "SYSTEM_CAPTURED", systemId: "S1" };
    expect(feedEventVisible(event, galaxy, makePlayer([]))).toBe(true);
  });

  it("hides a trade route when an endpoint is unknown", () => {
    const event = {
      type: "TRADE_OPPORTUNITY",
      systemId: "S1",
      fromSystemId: "S1",
      toSystemId: "S2",
    };
    expect(feedEventVisible(event, galaxy, makePlayer([]))).toBe(false);
  });

  it("shows a trade route when both endpoints are known", () => {
    const event = {
      type: "TRADE_OPPORTUNITY",
      systemId: "S1",
      fromSystemId: "S1",
      toSystemId: "S1",
    };
    expect(feedEventVisible(event, galaxy, makePlayer([]))).toBe(true);
  });

  it("shows everything when no player is supplied (headless/legacy)", () => {
    const event = { type: "SYSTEM_CAPTURED", systemId: "S2" };
    expect(feedEventVisible(event, galaxy, null)).toBe(true);
  });

  it("does not hide a malformed trade event missing an endpoint", () => {
    const event = { type: "TRADE_OPPORTUNITY", systemId: "S1" };
    expect(feedEventVisible(event, galaxy, makePlayer([]))).toBe(true);
  });
});
