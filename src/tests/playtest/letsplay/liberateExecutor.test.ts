/**
 * Task 1 of the Overmind-slayer plan: the `liberate` action's engine seam.
 *
 * `legalActionsForScene` gating is covered in `observe.test.ts`; this file
 * covers the **executor** — `PlayerAgent.apply("liberate")` must call the real
 * `GameEngine.liberateCurrentSystem()` (→ `Galaxy.tryLiberate`), not degrade to
 * a silent tick. Real-engine tier: boots the real `GameEngine` (pixi.js
 * stubbed only), so it exercises actual wiring, mirroring
 * `src/tests/playtest/playerLiberate.test.ts`'s setup for the plain engine API.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { RealEngineHarness } from "../realEngineHarness";
import { PlayerAgent } from "./PlayerAgent";
import type { PlayerPolicy, Action } from "./PlayerPolicy";
import type { Observation } from "./observe";
import { NpcShip } from "@/domain/NpcShip";
import { Faction } from "@/types/faction";
import { FactionType, NpcRole, NpcState } from "@/types";

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

/** A freshly generated galaxy may already place a few hostiles in-system —
 *  clear them first so only a deliberately staged garrison controls a test. */
function clearHostiles(
  galaxy: { npcShips: NpcShip[] },
  systemId: string,
): void {
  for (const n of galaxy.npcShips) {
    if (n.currentSystemId !== systemId) continue;
    if (n.faction === Faction.OVERMIND || n.role === NpcRole.PIRATE) {
      n.state = NpcState.DEAD;
    }
  }
}

function overmindGarrison(systemId: string): NpcShip {
  return new NpcShip({
    id: `garrison-${systemId}`,
    name: "Страж",
    race: FactionType.OUTLANDERS,
    faction: Faction.OVERMIND,
    role: NpcRole.PATROL,
    hullHP: 100,
    maxHull: 100,
    shields: 0,
    speed: 1,
    damage: 10,
    currentSystemId: systemId,
    state: NpcState.PATROLLING,
    goal: null,
    destinationSystemId: null,
    daysToArrival: 0,
    credits: 0,
    reputation: 0,
  });
}

describe("letsplay liberate executor (Task 1)", () => {
  let harness: RealEngineHarness;

  afterEach(() => {
    harness?.dispose();
  });

  it("liberate calls the real engine.liberateCurrentSystem() and frees a cleared capture", async () => {
    harness = await RealEngineHarness.boot({ seed: "LIBERATE-EXEC" });
    await harness.newGame();
    const engine = harness.engine;
    const galaxy = harness.galaxy()!;
    const sys = harness.player()!.currentSystemId;

    clearHostiles(galaxy, sys);
    galaxy.overmindSystems = [sys];
    expect(engine.canLiberateCurrentSystem()).toBe(true);

    const agent = new PlayerAgent(harness, scripted("liberate"));
    await agent.run(1);

    expect(galaxy.isOvermindSystem(sys)).toBe(false);
    expect(harness.errors()).toEqual([]);
  });

  it("liberate is a safe no-op while a hostile garrison is still present", async () => {
    harness = await RealEngineHarness.boot({ seed: "LIBERATE-DEFENDED" });
    await harness.newGame();
    const engine = harness.engine;
    const galaxy = harness.galaxy()!;
    const sys = harness.player()!.currentSystemId;

    clearHostiles(galaxy, sys);
    galaxy.overmindSystems = [sys];
    galaxy.npcShips.push(overmindGarrison(sys));
    expect(engine.canLiberateCurrentSystem()).toBe(false);

    // "liberate" isn't in legalActions here, so the scripted policy falls back
    // to "wait" — asserting the whole loop stays legal-only and side-effect-free.
    const agent = new PlayerAgent(harness, scripted("liberate"));
    await agent.run(1);

    expect(galaxy.isOvermindSystem(sys)).toBe(true);
    expect(harness.errors()).toEqual([]);
  });
});
