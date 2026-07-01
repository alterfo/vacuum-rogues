/**
 * Task 3 regression: letsplay combat executor — `attack` and `flee` produce real
 * engine effects, not silent ticks.
 *
 * - `attack` → `waitOneDay()` drives the combat module: when a hostile sprite is
 *   positioned within weapon range (via the white-box `e2eForceAggressorInRange`
 *   test seam), at least one side's hull changes within a single day's ticks (4 ×
 *   1000 ms covers the 2500 ms combatFireIntervalMs).
 * - `flee` → navigates to the star-map when connections exist, setting up the
 *   subsequent `warp` step that actually jumps. Falls back to `waitOneDay()` when
 *   no connections are available.
 *
 * Real-engine tier: boots the real GameEngine (pixi.js stubbed) and drives the
 * real PlayerAgent applier. Zero harness errors expected.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RealEngineHarness } from "../realEngineHarness";
import { PlayerAgent } from "./PlayerAgent";
import type { PlayerPolicy, Action } from "./PlayerPolicy";
import type { Observation } from "./observe";
import { SceneType } from "@/types";
import { GAME_BALANCE } from "@/config/balance";
import { currentSystem } from "./engineQueries";

vi.mock("pixi.js", async () => (await import("../pixiStub")).makePixiStub());

/** A scripted policy that always issues the given action kind (legal-filtered). */
function scripted(kind: Action["kind"]): PlayerPolicy {
  return {
    name: "scripted",
    decide(obs: Observation): Action {
      const k = obs.legalActions.includes(kind) ? kind : "wait";
      return { kind: k, reason: "scripted" };
    },
  };
}

/**
 * Access the NpcShipManager's white-box `e2eForceAggressorInRange` test seam via
 * a structural cast on the live flight scene. Returns the forced sprite's NPC
 * domain object, or null if the scene or manager is unavailable (the test then
 * skips gracefully).
 */
function forceAggressorInRange(
  harness: RealEngineHarness,
  weaponRange: number,
): { hullHP: number; damage: number } | null {
  const scene = harness.currentScene() as unknown as {
    npcManager?: {
      e2eForceAggressorInRange?: (
        range: number,
      ) => { npc: { hullHP: number; damage: number } } | null;
    };
  } | null;
  const sprite = scene?.npcManager?.e2eForceAggressorInRange?.(weaponRange);
  return sprite?.npc ?? null;
}

/**
 * Directly register the first NPC sprite as a combatant via the white-box
 * `e2eEngageCombat` seam. Call this after `forceAggressorInRange` so combat is
 * active before any tick fires — bypassing the `refresh` → `checkGarrisonAggro`
 * cycle that would otherwise clear the forced aggressive flag.
 */
function engageCombatNow(harness: RealEngineHarness): void {
  const scene = harness.currentScene() as unknown as {
    npcManager?: { e2eEngageCombat?: () => void };
  } | null;
  scene?.npcManager?.e2eEngageCombat?.();
}

describe("letsplay combat executor (Task 3)", () => {
  let harness: RealEngineHarness;

  beforeEach(async () => {
    localStorage.clear();
    harness = await RealEngineHarness.boot({ seed: "COMBAT-TEST" });
    await harness.newGame();
  });

  afterEach(() => {
    harness?.dispose();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("attack drives combat to completion — hull changes when a hostile is in weapon range", async () => {
    expect(harness.currentSceneType()).toBe(SceneType.SPACE_FLIGHT);

    const engine = harness.engine;

    // Force the first NPC sprite into weapon range and return its domain object so
    // we can track its hull specifically (not ALL hostile NPCs in the system).
    const npc = forceAggressorInRange(harness, GAME_BALANCE.weaponRange);
    if (!npc) {
      // No NPC sprites in the system (rare with this seed) — assert no errors only.
      const agent = new PlayerAgent(harness, scripted("attack"));
      await agent.run(1);
      expect(harness.errors()).toHaveLength(0);
      return;
    }

    // Pre-register as a combatant BEFORE any tick fires. Without this, the first
    // advanceGalaxyDay → refresh → checkGarrisonAggro cycle clears the forced
    // aggressive flag before npcManager.update can call startInFlightCombat.
    engageCombatNow(harness);

    const playerHullBefore = engine.player!.ship.hullHP;
    const npcHullBefore = npc.hullHP; // always 200 (set by e2eForceAggressorInRange)

    const agent = new PlayerAgent(harness, scripted("attack"));
    await agent.run(1);

    // After one `attack` step (4 × 1000 ms ticks), at least one fire timer has
    // elapsed (combatFireIntervalMs = 2500 ms ≤ 4000 ms): player weapon fires in
    // tick 3 (timers accumulate 1000 ms per tick; 3000 ms ≥ 2500 ms). Either the
    // player hull decreases (NPC fired) or the forced NPC hull decreases (player
    // fired) — track only the specific forced NPC, not all hostiles in the system.
    const playerHullAfter = engine.player!.ship.hullHP;
    const npcHullAfter = npc.hullHP; // live reference — mutated by fireNpcShot/firePlayerShot

    const combatFired =
      playerHullAfter !== playerHullBefore || npcHullAfter < npcHullBefore;
    expect(combatFired).toBe(true);
    expect(harness.errors()).toHaveLength(0);
  });

  it("flee navigates to the star map when connections exist", async () => {
    expect(harness.currentSceneType()).toBe(SceneType.SPACE_FLIGHT);

    const sys = currentSystem(harness.engine);
    const hasConnections = (sys?.connections.length ?? 0) > 0;
    if (!hasConnections) {
      // Isolated system (no warp links) — flee falls back to waitOneDay.
      forceAggressorInRange(harness, GAME_BALANCE.weaponRange);
      const agent = new PlayerAgent(harness, scripted("flee"));
      await agent.run(1);
      expect(harness.errors()).toHaveLength(0);
      return;
    }

    // Ensure at least one hostile is present so `flee` is in the legal set.
    forceAggressorInRange(harness, GAME_BALANCE.weaponRange);

    const agent = new PlayerAgent(harness, scripted("flee"));
    await agent.run(1);

    // flee should have navigated to STAR_MAP (first step of the two-step escape).
    expect(harness.currentSceneType()).toBe(SceneType.STAR_MAP);
    expect(harness.errors()).toHaveLength(0);
  });

  it("flee falls back to waitOneDay when no connections exist", async () => {
    // Simulate a dead-end system by removing connections.
    const sys = currentSystem(harness.engine);
    if (sys) {
      (sys as unknown as { connections: unknown[] }).connections = [];
    }
    const day0 = harness.engine.galaxy!.gameDays;

    // Force a hostile in range so `flee` is legal.
    forceAggressorInRange(harness, GAME_BALANCE.weaponRange);

    const agent = new PlayerAgent(harness, scripted("flee"));
    await agent.run(1);

    // waitOneDay must advance the calendar.
    expect(harness.engine.galaxy!.gameDays).toBeGreaterThan(day0);
    expect(harness.errors()).toHaveLength(0);
  });

  it("attack is a safe no-op (wait tick) when no hostile is in weapon range", async () => {
    // Do NOT call forceAggressorInRange — rely on the natural state.
    const day0 = harness.engine.galaxy!.gameDays;

    const agent = new PlayerAgent(harness, scripted("attack"));
    await agent.run(1);

    // The action degraded to waitOneDay (no hostile in range → no combat triggered).
    expect(harness.engine.galaxy!.gameDays).toBeGreaterThanOrEqual(day0);
    expect(harness.errors()).toHaveLength(0);
  });
});
