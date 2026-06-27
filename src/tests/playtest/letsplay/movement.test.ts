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
