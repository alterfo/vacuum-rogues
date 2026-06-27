import { describe, it, expect } from "vitest";
import { Container } from "pixi.js";
import {
  NpcShipManager,
  type NpcShipManagerDeps,
} from "@/presentation/flight/NpcShipManager";
import type { Renderer } from "@/presentation/Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import { ShipPhysics } from "@/systems/ShipPhysics";
import { NpcShip } from "@/domain/NpcShip";
import { NpcRole, NpcState, FactionType } from "@/types";
import { Faction } from "@/types/faction";

function makeNpc(id: string, role: NpcRole = NpcRole.PIRATE): NpcShip {
  return new NpcShip({
    id,
    name: id,
    race: FactionType.OUTLANDERS,
    faction: Faction.INDEPENDENT,
    role,
    hullHP: 100,
    maxHull: 100,
    shields: 40,
    speed: 0.1,
    damage: 20,
    currentSystemId: "sys_a",
    state: NpcState.PATROLLING,
    goal: null,
    destinationSystemId: null,
    daysToArrival: 0,
    credits: 0,
    reputation: 0,
  });
}

/**
 * Build a flight harness wired to count endTurn() invocations, with a real
 * ShipPhysics + a live player ship so updateCombat reaches its decision switch.
 */
function makeHarness(npcs: NpcShip[]): {
  manager: NpcShipManager;
  endTurnCalls: () => number;
  messages: () => string[];
} {
  const stage = new Container();
  const uiLayer = new Container();
  const gameLayer = new Container();
  const renderer = {
    app: { screen: { width: 800, height: 600 } },
    stage,
    uiLayer,
    gameLayer,
  } as unknown as Renderer;

  const physics = new ShipPhysics(0, 0, 0.2);
  const galaxy = { npcShips: npcs };
  const gameEngine = {
    galaxy,
    player: { currentSystemId: "sys_a", ship: { maxHull: 100, hullHP: 100 } },
  } as unknown as GameEngine;

  let endTurns = 0;
  const msgs: string[] = [];
  const deps: NpcShipManagerDeps = {
    getShipPhysics: () => physics,
    getPlanetSprites: () => [],
    getStarCenter: () => ({ x: 400, y: 300 }),
    isTurnRunning: () => true,
    showMessage: (m: string) => msgs.push(m),
    showTooltip: () => {},
    hideTooltip: () => {},
    executeRouteTo: () => {},
    clearRouteTarget: () => {},
    endTurn: () => {
      endTurns += 1;
    },
  };

  const manager = new NpcShipManager(
    renderer,
    gameEngine,
    gameLayer,
    uiLayer,
    deps,
  );
  return {
    manager,
    endTurnCalls: () => endTurns,
    messages: () => msgs,
  };
}

describe("Цель потеряна ends the running turn (regression)", () => {
  it("a lost chase target ends the turn exactly once and clears the follow id", () => {
    // Chase a target id that is NOT present among the spawned sprites → the
    // resolver returns "lost". Losing the target must stop the running turn so
    // the calendar doesn't keep advancing on a chase with nothing to pursue.
    const { manager, endTurnCalls, messages } = makeHarness([
      makeNpc("present_npc"),
    ]);
    manager.initialize();

    // Follow a ship that doesn't exist in the system → "lost" branch.
    manager.followNpcId = "ghost_npc";

    manager.updateCombat(1 / 60);

    expect(messages()).toContain("Цель потеряна");
    expect(manager.followNpcId).toBeNull();
    // The turn was ended (mirrors the shakedown-hail freeze).
    expect(endTurnCalls()).toBe(1);

    // A second tick with the cleared follow id is "idle" → no further endTurn.
    manager.updateCombat(1 / 60);
    expect(endTurnCalls()).toBe(1);

    manager.destroy();
  });

  it("a live chase target does NOT end the turn (only a lost one does)", () => {
    // Sanity guard: a normal chase path must not fire endTurn — only the "lost"
    // branch does. The followed NPC IS present (placed beyond weapon range so the
    // resolver returns "chase", not "launch"), so the turn keeps running.
    const present = makeNpc("present_npc");
    const { manager, endTurnCalls } = makeHarness([present]);
    manager.initialize();

    const sprite = (
      manager as unknown as { npcSprites: Array<{ x: number; y: number }> }
    ).npcSprites[0];
    sprite.x = 900; // well beyond WEAPON_RANGE from the ship at the origin
    sprite.y = 0;

    manager.followNpcId = "present_npc";
    manager.updateCombat(1 / 60);

    // Still chasing the live target; the turn was not ended.
    expect(manager.followNpcId).toBe("present_npc");
    expect(endTurnCalls()).toBe(0);

    manager.destroy();
  });
});
