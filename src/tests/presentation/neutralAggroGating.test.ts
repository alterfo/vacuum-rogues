import { describe, it, expect } from "vitest";
import { Container } from "pixi.js";
import {
  NpcShipManager,
  type NpcShipManagerDeps,
} from "@/presentation/flight/NpcShipManager";
import type { Renderer } from "@/presentation/Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import type { Galaxy } from "@/domain/Galaxy";
import { NpcShip } from "@/domain/NpcShip";
import { NpcRole, NpcState, FactionType } from "@/types";
import { Faction } from "@/types/faction";
import { NEUTRAL_AGGRO_POWER_THRESHOLD } from "@/config/balance";

function makeOvermind(id: string): NpcShip {
  const npc = new NpcShip({
    id,
    name: id,
    race: FactionType.OUTLANDERS,
    faction: Faction.OVERMIND,
    role: NpcRole.PATROL,
    hullHP: 100,
    maxHull: 100,
    shields: 0,
    speed: 0.2,
    damage: 20,
    currentSystemId: "sys_a",
    state: NpcState.PATROLLING,
    goal: null,
    destinationSystemId: null,
    daysToArrival: 0,
    credits: 0,
    reputation: 0,
  });
  npc.markHostile(); // a live besieging Overmind spawns hostile
  return npc;
}

function makeRenderer(): Renderer {
  return {
    app: { screen: { width: 800, height: 600 } },
    stage: new Container(),
    uiLayer: new Container(),
    gameLayer: new Container(),
  } as unknown as Renderer;
}

function sprites(manager: NpcShipManager): Array<{ aggressive: boolean }> {
  return (manager as unknown as { npcSprites: Array<{ aggressive: boolean }> })
    .npcSprites;
}

function makeManager(
  npcs: NpcShip[],
  opts: { hostile: boolean; peakPower?: number | null; withContext?: boolean },
): NpcShipManager {
  const renderer = makeRenderer();
  const galaxy = {
    npcShips: npcs,
    isHostileSystem: (id: string) => opts.hostile && id === "sys_a",
  } as unknown as Galaxy;
  const base = {
    galaxy,
    player: { currentSystemId: "sys_a" },
  } as Record<string, unknown>;
  if (opts.withContext) base.campaignPeakPower = opts.peakPower ?? null;
  const gameEngine = base as unknown as GameEngine;

  const deps: NpcShipManagerDeps = {
    getShipPhysics: () => null,
    getPlanetSprites: () => [],
    getStarCenter: () => ({ x: 400, y: 300 }),
    isTurnRunning: () => true,
    showMessage: () => {},
    showTooltip: () => {},
    hideTooltip: () => {},
    executeRouteTo: () => {},
    clearRouteTarget: () => {},
    endTurn: () => {},
  };

  return new NpcShipManager(
    renderer,
    gameEngine,
    (renderer as unknown as { gameLayer: Container }).gameLayer,
    (renderer as unknown as { uiLayer: Container }).uiLayer,
    deps,
  );
}

describe("NpcShipManager.checkGarrisonAggro — neutral-pack aggro gating", () => {
  it("a WEAK ship (power 0) is NOT hunted by a wandering neutral Overmind", () => {
    const manager = makeManager([makeOvermind("ov_siege")], {
      hostile: false,
      peakPower: 0,
      withContext: true,
    });
    manager.initialize();
    manager.checkGarrisonAggro("sys_a", false);

    expect(sprites(manager)[0].aggressive).toBe(false);
    manager.destroy();
  });

  it("a real engine BEFORE the first ratchet (null power) shields the weak ship", () => {
    const manager = makeManager([makeOvermind("ov_siege")], {
      hostile: false,
      peakPower: null,
      withContext: true,
    });
    manager.initialize();
    manager.checkGarrisonAggro("sys_a", false);

    expect(sprites(manager)[0].aggressive).toBe(false);
    manager.destroy();
  });

  it("an ARMED ship (power ≥ threshold) IS hunted in a neutral system", () => {
    const manager = makeManager([makeOvermind("ov_siege")], {
      hostile: false,
      peakPower: NEUTRAL_AGGRO_POWER_THRESHOLD,
      withContext: true,
    });
    manager.initialize();
    manager.checkGarrisonAggro("sys_a", false);

    expect(sprites(manager)[0].aggressive).toBe(true);
    manager.destroy();
  });

  it("a ship just below the threshold is shielded (boundary is inclusive-armed)", () => {
    const manager = makeManager([makeOvermind("ov_siege")], {
      hostile: false,
      peakPower: NEUTRAL_AGGRO_POWER_THRESHOLD - 0.001,
      withContext: true,
    });
    manager.initialize();
    manager.checkGarrisonAggro("sys_a", false);

    expect(sprites(manager)[0].aggressive).toBe(false);
    manager.destroy();
  });

  it("the shield NEVER protects a weak ship inside a captured (hostile) garrison", () => {
    const manager = makeManager([makeOvermind("ov_garrison")], {
      hostile: true, // captured system — standing garrison
      peakPower: 0,
      withContext: true,
    });
    manager.initialize();
    manager.checkGarrisonAggro("sys_a", true);

    expect(sprites(manager)[0].aggressive).toBe(true);
    manager.destroy();
  });

  it("no campaign context (legacy stub) ⇒ hunted, byte-identical to pre-Task-9", () => {
    const manager = makeManager([makeOvermind("ov_siege")], {
      hostile: false,
      withContext: false, // getter absent ⇒ campaignPeakPower reads undefined
    });
    manager.initialize();
    manager.checkGarrisonAggro("sys_a", false);

    expect(sprites(manager)[0].aggressive).toBe(true);
    manager.destroy();
  });
});
