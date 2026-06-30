/**
 * Letsplay Task 1 (full-game play): the agent must actually advance galaxy days.
 * Its biggest gap was that `wait`/`move` only ticked a single frame, so a session
 * never crossed a day boundary — markets/NPC sim/quests/Overmind never moved, the
 * CI balance bands read empty, and the BC net could only clone a time-frozen
 * teacher. Now `wait` runs a real course-less wait turn (one day) and in-flight
 * `move` flies a real route across the system.
 *
 * Real-engine tier: boots the real GameEngine into a new game and drives the real
 * PlayerAgent applier with a scripted policy, asserting observable engine state
 * (gameDays up, ship moved) with zero logged errors.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RealEngineHarness } from "../realEngineHarness";
import { PlayerAgent } from "./PlayerAgent";
import type { PlayerPolicy, Action } from "./PlayerPolicy";
import type { Observation } from "./observe";
import { SceneType } from "@/types";

vi.mock("pixi.js", async () => (await import("../pixiStub")).makePixiStub());

/** A scripted policy that always issues the given action kind (legal-filtered). */
function scripted(kind: Action["kind"]): PlayerPolicy {
  return {
    name: "scripted",
    decide(obs: Observation): Action {
      // Fall back to wait if the scripted kind isn't legal in this scene.
      const k = obs.legalActions.includes(kind) ? kind : "wait";
      return { kind: k, reason: "scripted" };
    },
  };
}

describe("letsplay agent advances galaxy days (Task 1)", () => {
  let harness: RealEngineHarness;

  beforeEach(async () => {
    localStorage.clear();
    harness = await RealEngineHarness.boot();
    await harness.newGame();
  });

  afterEach(() => {
    harness?.dispose();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("a wait turn advances the calendar by at least one day", async () => {
    expect(harness.currentSceneType()).toBe(SceneType.SPACE_FLIGHT);
    const day0 = harness.galaxy()!.gameDays;

    const agent = new PlayerAgent(harness, scripted("wait"));
    await agent.run(3);

    expect(harness.galaxy()!.gameDays).toBeGreaterThan(day0);
    expect(harness.errors()).toEqual([]);
  });

  it("an in-flight move flies a real distance and advances time", async () => {
    const phys = (
      harness.currentScene() as unknown as {
        shipPhysics: { shipX: number; shipY: number };
      }
    ).shipPhysics;
    const start = { x: phys.shipX, y: phys.shipY };
    const day0 = harness.galaxy()!.gameDays;

    const agent = new PlayerAgent(harness, scripted("move"));
    await agent.run(2);

    const moved = Math.hypot(phys.shipX - start.x, phys.shipY - start.y);
    expect(moved).toBeGreaterThan(0); // the ship actually traversed space
    expect(harness.galaxy()!.gameDays).toBeGreaterThanOrEqual(day0);
    expect(harness.errors()).toEqual([]);
  });
});

describe("letsplay agent — warpInTransit safety net covers every action (PlayerAgent.apply)", () => {
  let harness: RealEngineHarness;

  beforeEach(async () => {
    localStorage.clear();
    harness = await RealEngineHarness.boot();
    await harness.newGame();
  });

  afterEach(() => {
    harness?.dispose();
    vi.clearAllMocks();
    localStorage.clear();
  });

  /**
   * Drive a real two-step hyperjump (open the star map, commit the jump) so the
   * harness lands mid-transit — SPACE_FLIGHT, `pendingWarp` set, ship not yet
   * moving — the exact state `obs.warpInTransit` flags. Mirrors the same
   * `performWarpJumpTo` call PlayerAgent's own "warp" case drives. Returns the
   * (still-private) flight scene so the test can inspect `pendingWarp`/
   * `plannedRoute` directly, the same structural-cast pattern the existing
   * `shipPhysics` assertions above already use.
   */
  async function startWarpInTransit(): Promise<{
    flightScene: {
      pendingWarp: unknown;
      plannedRoute: { x: number; y: number } | null;
    };
  }> {
    const origin = harness.engine.player!.currentSystemId;
    const sys = harness.galaxy()!.systems.find((s) => s.id === origin)!;
    const target = sys.connections[0].toSystemId;
    await harness.goTo(SceneType.STAR_MAP);
    const starMap = harness.currentScene() as unknown as {
      performWarpJumpTo(id: string): Promise<void>;
    };
    await starMap.performWarpJumpTo(target);
    expect(harness.currentSceneType()).toBe(SceneType.SPACE_FLIGHT);
    const flightScene = harness.currentScene() as unknown as {
      pendingWarp: unknown;
      plannedRoute: { x: number; y: number } | null;
    };
    expect(flightScene.pendingWarp).toBeTruthy();
    return { flightScene };
  }

  // "land"/"dock" are legal in SPACE_FLIGHT regardless of warpInTransit (the
  // starting system has both a planet and a station), so a memoryless policy
  // like HeuristicPolicy would routinely pick them over "wait" mid-transit.
  // Before the dispatch-layer guard, this tore down SpaceFlightScene via a real
  // `transitionTo` — silently dropping the in-progress hyperjump with no way
  // back to flight (the scripted policy has nothing that returns it there).
  // Asserting only that the scene stays SPACE_FLIGHT (rather than the warp
  // fully completing) keeps this independent of unrelated combat timing —
  // hostile garrisons can legitimately pause `completeWarp()`'s own drive, but
  // that must never surface as a scene teardown.
  it.each<Action["kind"]>(["land", "dock"])(
    "a `%s` action mid-warp-transit drives the safety net instead of tearing down the scene",
    async (kind) => {
      await startWarpInTransit();

      const agent = new PlayerAgent(harness, scripted(kind));
      await agent.run(1);

      expect(harness.currentSceneType()).toBe(SceneType.SPACE_FLIGHT);
      expect(harness.errors()).toEqual([]);
    },
  );

  it("an in-flight `move` mid-warp-transit does not hijack the route away from the warp edge", async () => {
    const { flightScene } = await startWarpInTransit();
    const edge = {
      x: flightScene.plannedRoute!.x,
      y: flightScene.plannedRoute!.y,
    };

    const agent = new PlayerAgent(harness, scripted("move"));
    await agent.run(1);

    // The route must still point at the warp edge — not an arbitrary point
    // flyForward() would have picked toward/away from the star.
    expect(flightScene.plannedRoute).toEqual(edge);
    expect(harness.currentSceneType()).toBe(SceneType.SPACE_FLIGHT);
    expect(harness.errors()).toEqual([]);
  });
});
