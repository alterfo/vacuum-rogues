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

type NpcOpts = {
  role?: NpcRole;
  faction?: Faction;
  systemId?: string;
};

function makeNpc(id: string, opts: NpcOpts = {}): NpcShip {
  return new NpcShip({
    id,
    name: id,
    race: FactionType.OUTLANDERS,
    faction: opts.faction ?? Faction.INDEPENDENT,
    role: opts.role ?? NpcRole.TRADER,
    hullHP: 100,
    maxHull: 100,
    shields: 0,
    speed: 0.1,
    damage: 20,
    currentSystemId: opts.systemId ?? "sys_a",
    state: NpcState.PATROLLING,
    goal: null,
    destinationSystemId: null,
    daysToArrival: 0,
    credits: 0,
    reputation: 0,
  });
}

describe("NpcShip hostility flag", () => {
  it("defaults to not hostile / not aggressive", () => {
    const npc = makeNpc("trader_1");
    expect(npc.hostile).toBe(false);
    expect(npc.isAggressive()).toBe(false);
  });

  it("markHostile() turns a neutral trader hostile and aggressive", () => {
    const npc = makeNpc("trader_1", { role: NpcRole.TRADER });
    expect(npc.hostile).toBe(false);
    npc.markHostile();
    expect(npc.hostile).toBe(true);
    expect(npc.isAggressive()).toBe(true);
  });
});

function makeManager(npcs: NpcShip[]): NpcShipManager {
  const stage = new Container();
  const uiLayer = new Container();
  const gameLayer = new Container();
  const renderer = {
    app: { screen: { width: 800, height: 600 } },
    stage,
    uiLayer,
    gameLayer,
  } as unknown as Renderer;

  const galaxy = {
    npcShips: npcs,
    isHostileSystem: () => false,
  } as unknown as Galaxy;
  const gameEngine = {
    galaxy,
    player: { currentSystemId: "sys_a" },
  } as unknown as GameEngine;

  const deps: NpcShipManagerDeps = {
    getShipPhysics: () => null,
    getPlanetSprites: () => [],
    getStarCenter: () => ({ x: 400, y: 300 }),
    isTurnRunning: () => false,
    showMessage: () => {},
    showTooltip: () => {},
    hideTooltip: () => {},
    executeRouteTo: () => {},
    clearRouteTarget: () => {},
    endTurn: () => {},
  };

  return new NpcShipManager(renderer, gameEngine, gameLayer, uiLayer, deps);
}

describe("NpcShipManager hostility escalation", () => {
  it("attacking one neutral NPC marks all same-faction ships in the system hostile", () => {
    const trader1 = makeNpc("trader_1", { faction: Faction.INDEPENDENT });
    const trader2 = makeNpc("trader_2", { faction: Faction.INDEPENDENT });
    const other = makeNpc("syndicate_1", { faction: Faction.SYNDICATE });
    const farTrader = makeNpc("trader_far", {
      faction: Faction.INDEPENDENT,
      systemId: "sys_b",
    });
    const manager = makeManager([trader1, trader2, other, farTrader]);
    manager.initialize();

    // The player attacks one neutral trader (real player-attack entry point).
    (manager as unknown as { onAttackNpc(npc: NpcShip): void }).onAttackNpc(
      trader1,
    );

    // The attacked ship and its same-faction neighbour in-system turn hostile…
    expect(trader1.hostile).toBe(true);
    expect(trader2.hostile).toBe(true);
    // …but a different faction in the same system is spared…
    expect(other.hostile).toBe(false);
    // …and a same-faction ship in a different system is untouched.
    expect(farTrader.hostile).toBe(false);

    manager.destroy();
  });

  it("escalateHostility is idempotent for already-hostile garrison ships", () => {
    const pirate = makeNpc("pirate_1", { role: NpcRole.PIRATE });
    pirate.markHostile();
    const manager = makeManager([pirate]);
    manager.initialize();

    manager.escalateHostility(pirate);
    expect(pirate.hostile).toBe(true);

    manager.destroy();
  });
});
