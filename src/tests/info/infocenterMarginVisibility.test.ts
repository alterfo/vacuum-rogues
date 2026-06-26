/**
 * Task 3 (playtest bug pass): the InfoCenter trade-margin column must show the
 * **real** margin number for routes anchored in systems the player already
 * knows — not «маржа ~?%» for everything. The over-broad masking made the column
 * useless: at game start ONLY the starting system was flagged known (its
 * neighbours were never revealed until the player happened to open the star
 * map), so — under the both-endpoints-known rule — *no* cross-system rumor could
 * ever show its margin.
 *
 * The masking rule itself is unchanged and still correct (both endpoints must be
 * known; a route touching an undiscovered system stays masked — locked by
 * `infoCenterRumors.test.ts`). The fix is on the **known-detection** side: a
 * fresh game now reveals the starting system **and its immediate neighbours**,
 * so a rumor within that home cluster renders a number while a far rumor stays
 * masked.
 *
 * Real-engine playtest tier: boots the real GameEngine into a new game and
 * asserts the observable known set + the rumor projection the InfoCenter renders,
 * with zero logged errors.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RealEngineHarness } from "../playtest/realEngineHarness";
import { buildRumorPanel, RUMOR_PANEL_MAX } from "@/presentation/rumorPanel";
import { isSystemKnown } from "@/systems/galaxy/systemKnown";
import { createRumor } from "@/domain/RouteRumor";
import type { RouteLike } from "@/domain/RouteRumor";
import { ResourceType } from "@/types";

vi.mock("pixi.js", async () =>
  (await import("../playtest/pixiStub")).makePixiStub(),
);

/** A concrete numeric margin, e.g. "маржа ~30%". */
const NUMERIC_MARGIN = /маржа ~\d+%/;

/** A scanner-shaped route between two systems with a derived consistent margin. */
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

    // The starting system is known (visited + explored) — never masked.
    expect(isSystemKnown(player, galaxy, homeId)).toBe(true);

    // The home system has warp neighbours and EVERY immediate neighbour is now
    // known too — so a home↔neighbour route has two known endpoints to read.
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
    const neighbourId = home.connections[0]!.toSystemId;

    // A rumor between two systems the player knows (home + an immediate
    // neighbour) renders its real margin — not «маржа ~?%».
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

    // Pick a system that is neither home, a neighbour, nor otherwise known.
    const knownIds = new Set([
      homeId,
      ...home.connections.map((c) => c.toSystemId),
    ]);
    const far = galaxy.systems.find(
      (s) => !knownIds.has(s.id) && !isSystemKnown(player, galaxy, s.id),
    );
    expect(far).toBeDefined();

    // A route into the undiscovered system keeps its margin masked even though
    // the source (home) is known — the both-endpoints rule is unchanged.
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
