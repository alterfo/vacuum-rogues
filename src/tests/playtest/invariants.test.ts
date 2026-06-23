import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RealEngineHarness } from "./realEngineHarness";
import { SceneType, StationType } from "@/types";
import { Faction } from "@/types/faction";
import { Station } from "@/domain/Station";
import type { StarSystem } from "@/domain/StarSystem";

/**
 * Error-invariant + "always actionable" net (Task 3 of the real-engine playtest
 * harness). This is the **cheap catch-all** scenario: it boots a real new game
 * and drives a short scripted sequence — turn (tick + end-of-day), land, then
 * open every gameplay scene the player can reach from a planet/flight — asserting
 * two invariants throughout:
 *
 *  1. **Zero logged/thrown errors** (`errors()` empty) — catches the
 *     "X is not a constructor / cannot read property" class of wiring breakage
 *     that mocked unit tests can never see.
 *  2. **No dead-ends**: the player is never left with no available action —
 *     every non-terminal scene can return to the flight hub, and the flight hub
 *     always offers a forward move (warp or land).
 *
 * Real `GameEngine` / `QuestManager` / `BankingService` / scene logic — only
 * PixiJS is stubbed.
 */
vi.mock("pixi.js", async () => (await import("./pixiStub")).makePixiStub());

/** Systems carrying at least one planet (land/service flows need a planet). */
function systemsWithPlanets(harness: RealEngineHarness): StarSystem[] {
  return harness.galaxy()!.systems.filter((s) => s.planets.length > 0);
}

/**
 * True when the player has at least one forward move from the current state.
 * Terminal scenes (game-over / win) are intentionally dead-ends and excluded;
 * any other reachable scene must leave the player able to warp or land.
 */
function forwardActionAvailable(harness: RealEngineHarness): boolean {
  const t = harness.currentSceneType();
  if (t === SceneType.GAME_OVER || t === SceneType.WIN_SCREEN) return false;
  const player = harness.player();
  const galaxy = harness.galaxy();
  if (!player || !galaxy) return false;
  const canWarp = galaxy.systems.length > 1; // a star map with somewhere to go
  const here = galaxy.systems.find((s) => s.id === player.currentSystemId);
  const canLand = !!here && here.planets.length > 0;
  return canWarp || canLand;
}

describe("Error-invariant + always-actionable net (real engine)", () => {
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

  it("drives turn → land → every reachable scene with zero errors and no dead-ends", async () => {
    // Given a fresh game parked in a system that has a planet to land on.
    await harness.newGame();
    const sys = systemsWithPlanets(harness)[0];
    expect(sys).toBeDefined();
    const planet = sys.planets[0];
    harness.player()!.currentSystemId = sys.id;

    // A docked station for the STATION scene (generated systems carry none until
    // the simulator spawns them, so build one the way combat tests build NPCs).
    const station = new Station(
      "playtest-station",
      "Орбитальная станция",
      StationType.TRADE_POST,
      Faction.INDEPENDENT,
      400,
      0,
    );

    // The gameplay scenes the player can reach from flight + a landed planet.
    // (DIALOGUE/TEXT_QUEST need transient NPC/quest context — out of scope here.)
    const reachable: Array<{
      type: SceneType;
      label: string;
      context: () => object;
    }> = [
      { type: SceneType.STAR_MAP, label: "star map", context: () => ({}) },
      { type: SceneType.PLANET, label: "planet", context: () => ({ planet }) },
      { type: SceneType.TRADE, label: "market", context: () => ({ planet }) },
      {
        type: SceneType.EQUIPMENT_SHOP,
        label: "shipyard",
        context: () => ({ planet }),
      },
      {
        type: SceneType.GOVERNMENT,
        label: "government",
        context: () => ({ planet }),
      },
      {
        type: SceneType.INFO_CENTER,
        label: "info centre",
        context: () => ({ planet }),
      },
      { type: SceneType.BANK, label: "bank", context: () => ({ planet }) },
      {
        type: SceneType.STATION,
        label: "station",
        context: () => ({ station }),
      },
      { type: SceneType.INVENTORY, label: "inventory", context: () => ({}) },
    ];

    // When the player "takes a turn": a few flight frames + an end-of-day tick
    // (drives banking EOD, the NPC simulator and market drift — heavy real wiring).
    harness.tick(16);
    harness.tick(16);
    harness.engine.advanceGalaxyDay();
    expect(harness.errors().map((e) => e.message)).toEqual([]);
    expect(forwardActionAvailable(harness)).toBe(true);

    // …and lands.
    await harness.goTo(SceneType.PLANET, { planet });
    expect(harness.currentSceneType()).toBe(SceneType.PLANET);

    // Then every reachable scene opens, ticks and returns to flight — each step
    // logging/throwing nothing and never stranding the player without a move.
    for (const scene of reachable) {
      await harness.goTo(scene.type, scene.context());
      expect(harness.currentSceneType(), `${scene.label} did not open`).toBe(
        scene.type,
      );
      expect(
        harness.currentScene(),
        `${scene.label} scene is null`,
      ).not.toBeNull();
      harness.tick(16); // a frame on the opened scene must not throw
      expect(
        harness.errors().map((e) => e.message),
        `errors after opening ${scene.label}`,
      ).toEqual([]);

      // No dead-end: the player can always get back to the flight hub, alive and
      // with a forward action still available.
      await harness.goTo(SceneType.SPACE_FLIGHT);
      expect(harness.currentSceneType()).toBe(SceneType.SPACE_FLIGHT);
      expect(
        harness.player(),
        `${scene.label} stranded the player`,
      ).not.toBeNull();
      expect(
        forwardActionAvailable(harness),
        `dead-end after ${scene.label}`,
      ).toBe(true);
    }

    expect(harness.errors().map((e) => e.message)).toEqual([]);
  });

  it("never leaves the flight hub without an available action across several turns", async () => {
    // Given a fresh game in flight.
    await harness.newGame();

    // When several end-of-day turns pass (state drifts: markets, NPCs, banking).
    for (let day = 0; day < 5; day++) {
      expect(forwardActionAvailable(harness), `dead-end on day ${day}`).toBe(
        true,
      );
      harness.engine.advanceGalaxyDay();
      harness.tick(16);
    }

    // Then the player still has somewhere to go and nothing has errored.
    expect(forwardActionAvailable(harness)).toBe(true);
    expect(harness.errors().map((e) => e.message)).toEqual([]);
  });
});
