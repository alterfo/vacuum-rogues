import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RealEngineHarness } from "../playtest/realEngineHarness";
import {
  buildRumorPanel,
  feedEventVisible,
  RUMOR_PANEL_MAX,
} from "@/presentation/rumorPanel";
import { isSystemKnown } from "@/systems/galaxy/systemKnown";
import { createRumor } from "@/domain/RouteRumor";
import type { RouteLike } from "@/domain/RouteRumor";
import { ResourceType } from "@/types";

vi.mock("pixi.js", async () =>
  (await import("../playtest/pixiStub")).makePixiStub(),
);

const NUMERIC_MARGIN = /маржа ~\d+%/;

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

describe("InfoCenter margin visibility — fresh game knows its home cluster", () => {
  let harness: RealEngineHarness;

  beforeEach(async () => {
    localStorage.clear();
    harness = await RealEngineHarness.boot();
  });

  afterEach(() => {
    harness?.dispose();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("flags the starting system AND its neighbours as known at game start", async () => {
    await harness.newGame();
    const player = harness.player()!;
    const galaxy = harness.galaxy()!;
    const homeId = player.currentSystemId;
    const home = galaxy.systems.find((s) => s.id === homeId)!;
    expect(home).toBeDefined();

    expect(isSystemKnown(player, galaxy, homeId)).toBe(true);

    const neighbourIds = home.connections.map((c) => c.toSystemId);
    expect(neighbourIds.length).toBeGreaterThan(0);
    for (const nId of neighbourIds) {
      expect(isSystemKnown(player, galaxy, nId)).toBe(true);
    }

    expect(harness.errors()).toEqual([]);
  });

  it("shows the numeric margin for a rumor inside the known home cluster", async () => {
    await harness.newGame();
    const player = harness.player()!;
    const galaxy = harness.galaxy()!;
    const homeId = player.currentSystemId;
    const home = galaxy.systems.find((s) => s.id === homeId)!;
    const neighbourId = home.connections
      .map((c) => c.toSystemId)
      .find((id) => !galaxy.isHostileSystem(id))!;

    galaxy.activeRumors = [
      createRumor(route(ResourceType.FUEL, homeId, neighbourId, 42), 1),
    ];
    const data = buildRumorPanel(galaxy, RUMOR_PANEL_MAX, player);
    expect(data.lines).toHaveLength(1);
    expect(data.lines[0].text).toMatch(NUMERIC_MARGIN);
    expect(data.lines[0].text).toContain("маржа ~42%");
    expect(data.lines[0].text).not.toContain("?");

    expect(harness.errors()).toEqual([]);
  });

  it("still masks a rumor touching a system beyond the known cluster", async () => {
    await harness.newGame();
    const player = harness.player()!;
    const galaxy = harness.galaxy()!;
    const homeId = player.currentSystemId;
    const home = galaxy.systems.find((s) => s.id === homeId)!;

    const knownIds = new Set([
      homeId,
      ...home.connections.map((c) => c.toSystemId),
    ]);
    const far = galaxy.systems.find(
      (s) => !knownIds.has(s.id) && !isSystemKnown(player, galaxy, s.id),
    );
    expect(far).toBeDefined();

    galaxy.activeRumors = [
      createRumor(route(ResourceType.METALS, homeId, far!.id, 70), 1),
    ];
    const data = buildRumorPanel(galaxy, RUMOR_PANEL_MAX, player);
    expect(data.lines).toHaveLength(1);
    expect(data.lines[0].text).not.toMatch(NUMERIC_MARGIN);
    expect(data.lines[0].text).toContain("маржа ~?%");

    expect(harness.errors()).toEqual([]);
  });
});

describe("InfoCenter hides tips into captured systems", () => {
  let harness: RealEngineHarness;

  beforeEach(async () => {
    localStorage.clear();
    harness = await RealEngineHarness.boot();
  });

  afterEach(() => {
    harness?.dispose();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("drops an already-open rumor once its destination is Overmind-captured", async () => {
    await harness.newGame();
    const player = harness.player()!;
    const galaxy = harness.galaxy()!;
    const homeId = player.currentSystemId;
    const home = galaxy.systems.find((s) => s.id === homeId)!;
    const neighbourId = home.connections
      .map((c) => c.toSystemId)
      .find((id) => !galaxy.isHostileSystem(id))!;

    galaxy.activeRumors = [
      createRumor(route(ResourceType.FUEL, homeId, neighbourId, 42), 1),
    ];
    expect(buildRumorPanel(galaxy, RUMOR_PANEL_MAX, player).lines).toHaveLength(
      1,
    );

    galaxy.addOvermindSystem(neighbourId);
    const data = buildRumorPanel(galaxy, RUMOR_PANEL_MAX, player);
    expect(data.lines).toHaveLength(0);

    expect(harness.errors()).toEqual([]);
  });

  it("drops an already-open rumor once its destination is pirate-captured", async () => {
    await harness.newGame();
    const player = harness.player()!;
    const galaxy = harness.galaxy()!;
    const homeId = player.currentSystemId;
    const home = galaxy.systems.find((s) => s.id === homeId)!;
    const neighbourId = home.connections
      .map((c) => c.toSystemId)
      .find((id) => !galaxy.isHostileSystem(id))!;

    galaxy.activeRumors = [
      createRumor(route(ResourceType.FUEL, homeId, neighbourId, 42), 1),
    ];
    expect(buildRumorPanel(galaxy, RUMOR_PANEL_MAX, player).lines).toHaveLength(
      1,
    );
    galaxy.addPirateSystem(neighbourId);
    const data = buildRumorPanel(galaxy, RUMOR_PANEL_MAX, player);
    expect(data.lines).toHaveLength(0);

    expect(harness.errors()).toEqual([]);
  });

  it("still shows a rumor between two non-hostile systems (no over-filtering)", async () => {
    await harness.newGame();
    const player = harness.player()!;
    const galaxy = harness.galaxy()!;
    const homeId = player.currentSystemId;
    const home = galaxy.systems.find((s) => s.id === homeId)!;
    const neighbourId = home.connections
      .map((c) => c.toSystemId)
      .find((id) => !galaxy.isHostileSystem(id))!;
    const unrelated = galaxy.systems.find(
      (s) => s.id !== homeId && s.id !== neighbourId,
    )!;
    galaxy.addOvermindSystem(unrelated.id);

    galaxy.activeRumors = [
      createRumor(route(ResourceType.FUEL, homeId, neighbourId, 42), 1),
    ];
    const data = buildRumorPanel(galaxy, RUMOR_PANEL_MAX, player);
    expect(data.lines).toHaveLength(1);
    expect(data.lines[0].text).toContain("маржа ~42%");

    expect(harness.errors()).toEqual([]);
  });

  it("hides a TRADE_OPPORTUNITY news event whose destination is hostile", async () => {
    await harness.newGame();
    const player = harness.player()!;
    const galaxy = harness.galaxy()!;
    const homeId = player.currentSystemId;
    const home = galaxy.systems.find((s) => s.id === homeId)!;
    const neighbourId = home.connections[0]!.toSystemId;
    galaxy.addOvermindSystem(neighbourId);

    const visible = feedEventVisible(
      {
        type: "TRADE_OPPORTUNITY",
        systemId: homeId,
        fromSystemId: homeId,
        toSystemId: neighbourId,
      },
      galaxy,
      player,
    );
    expect(visible).toBe(false);

    expect(harness.errors()).toEqual([]);
  });
});
