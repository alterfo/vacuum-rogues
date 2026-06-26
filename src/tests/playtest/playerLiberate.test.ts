import { describe, it, expect, afterEach, vi } from "vitest";
import { RealEngineHarness } from "./realEngineHarness";
import { NpcShip } from "@/domain/NpcShip";
import { Faction } from "@/types/faction";
import { FactionType, NpcRole, NpcState } from "@/types";

/**
 * Real-engine playtest for player-driven liberation (Task 4 of the
 * late-game-recoverability pass). Boots the genuine `GameEngine` + galaxy and
 * only stubs PixiJS, so it exercises the wiring: `canLiberateCurrentSystem` /
 * `liberateCurrentSystem` over the real `Galaxy` (capture sets + live npcShips),
 * for both pirate- and Overmind-captured systems, gated on the local garrison
 * being cleared. Ends on the error-invariant (`errors()` empty).
 */
vi.mock("pixi.js", async () => (await import("./pixiStub")).makePixiStub());

/** Simulate the player having cleared the local garrison: mark every present
 *  hostile (pirate-role / Overmind-faction) ship in the system DEAD. Seed-
 *  independent — a freshly generated galaxy may already place a few hostiles. */
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

function pirateGuard(systemId: string): NpcShip {
  return new NpcShip({
    id: `pirate-${systemId}`,
    name: "Налётчик",
    race: FactionType.OUTLANDERS,
    faction: Faction.INDEPENDENT,
    role: NpcRole.PIRATE,
    hullHP: 40,
    maxHull: 40,
    shields: 0,
    speed: 1,
    damage: 5,
    currentSystemId: systemId,
    state: NpcState.PATROLLING,
    goal: null,
    destinationSystemId: null,
    daysToArrival: 0,
    credits: 100,
    reputation: 0,
  });
}

describe("player-driven liberation (real engine)", () => {
  let harness: RealEngineHarness;

  afterEach(() => {
    harness?.dispose();
  });

  it("liberates a cleared pirate-captured current system", async () => {
    harness = await RealEngineHarness.boot({ seed: "LIB_PIRATE" });
    await harness.newGame();
    const engine = harness.engine;
    const galaxy = harness.galaxy()!;
    const sys = harness.player()!.currentSystemId;

    // Pirates capture the system the player is sitting in.
    galaxy.addPirateSystem(sys);
    clearHostiles(galaxy, sys);
    expect(galaxy.isPirateSystem(sys)).toBe(true);

    // With no hostile garrison present, the player can liberate it.
    expect(engine.canLiberateCurrentSystem()).toBe(true);
    expect(engine.liberateCurrentSystem()).toBe(true);
    expect(galaxy.isPirateSystem(sys)).toBe(false);
    expect(galaxy.isHostileSystem(sys)).toBe(false);
    expect(harness.errors()).toEqual([]);
  });

  it("liberates a cleared Overmind-captured current system", async () => {
    harness = await RealEngineHarness.boot({ seed: "LIB_OVERMIND" });
    await harness.newGame();
    const engine = harness.engine;
    const galaxy = harness.galaxy()!;
    const sys = harness.player()!.currentSystemId;

    galaxy.addOvermindSystem(sys);
    clearHostiles(galaxy, sys);
    expect(galaxy.isOvermindSystem(sys)).toBe(true);

    expect(engine.liberateCurrentSystem()).toBe(true);
    expect(galaxy.isOvermindSystem(sys)).toBe(false);
    expect(harness.errors()).toEqual([]);
  });

  it("refuses to liberate while a hostile defender is still present (fight first)", async () => {
    harness = await RealEngineHarness.boot({ seed: "LIB_DEFENDED" });
    await harness.newGame();
    const engine = harness.engine;
    const galaxy = harness.galaxy()!;
    const sys = harness.player()!.currentSystemId;

    galaxy.addPirateSystem(sys);
    clearHostiles(galaxy, sys); // clear any seed-placed hostiles first…
    galaxy.npcShips.push(pirateGuard(sys)); // …leaving exactly one live defender

    expect(engine.canLiberateCurrentSystem()).toBe(false);
    expect(engine.liberateCurrentSystem()).toBe(false);
    expect(galaxy.isPirateSystem(sys)).toBe(true); // still captured

    // Clearing the defender (it dies) unlocks liberation — the "after a fight"
    // condition. No map-wide auto-clear: only this one system frees.
    galaxy.npcShips[galaxy.npcShips.length - 1].state = NpcState.DEAD;
    expect(engine.canLiberateCurrentSystem()).toBe(true);
    expect(engine.liberateCurrentSystem()).toBe(true);
    expect(galaxy.isPirateSystem(sys)).toBe(false);
    expect(harness.errors()).toEqual([]);
  });

  it("is a no-op on a faction-held system (nothing to liberate)", async () => {
    harness = await RealEngineHarness.boot({ seed: "LIB_NONE" });
    await harness.newGame();
    const engine = harness.engine;
    const sys = harness.player()!.currentSystemId;
    // The starting system is faction-held.
    expect(harness.galaxy()!.isHostileSystem(sys)).toBe(false);
    expect(engine.canLiberateCurrentSystem()).toBe(false);
    expect(engine.liberateCurrentSystem()).toBe(false);
    expect(harness.errors()).toEqual([]);
  });
});
