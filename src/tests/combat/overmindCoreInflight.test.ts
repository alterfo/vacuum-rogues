import { describe, it, expect } from "vitest";
import { Container } from "pixi.js";
import {
  NpcShipManager,
  type NpcShipManagerDeps,
} from "@/presentation/flight/NpcShipManager";
import type { Renderer } from "@/presentation/Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import type { NpcShipSprite } from "@/presentation/NpcShipSprite";

/**
 * Task 5 (hex removal): the OVERMIND-core final boss used to hop to the hex
 * `SceneType.COMBAT`. It now resolves in real-time in-flight combat — the prompt
 * spawns the core as an aggressive in-flight combatant and killing it wins the
 * game. Both assertions would have failed before this change (the boss had no
 * in-flight path and transitioned scenes instead).
 */
describe("OVERMIND core — real-time in-flight boss (no hex CombatScene)", () => {
  function makeHarness(): {
    manager: NpcShipManager;
    engaged: NpcShipSprite[];
    targeted: NpcShipSprite[];
    transitions: unknown[];
    wins: boolean[];
    galaxy: { npcShips: unknown[]; id: string };
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

    const engaged: NpcShipSprite[] = [];
    const targeted: NpcShipSprite[] = [];
    const transitions: unknown[] = [];
    const wins: boolean[] = [];

    const galaxy = { npcShips: [], id: "g1" };
    const gameEngine = {
      galaxy,
      player: { currentSystemId: "core_sys" },
      transitionTo: (...args: unknown[]) => transitions.push(args),
      showGameOutcomeScreen: (win: boolean) => wins.push(win),
    } as unknown as GameEngine;

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
      startInFlightCombat: (s) => engaged.push(s),
      selectCombatTarget: (s) => targeted.push(s),
    };

    const manager = new NpcShipManager(
      renderer,
      gameEngine as unknown as GameEngine,
      gameLayer,
      uiLayer,
      deps,
    );
    manager.initialize();
    return { manager, engaged, targeted, transitions, wins, galaxy };
  }

  it("spawns the core as an in-flight combatant, no scene transition", () => {
    const { manager, engaged, targeted, transitions } = makeHarness();

    (
      manager as unknown as { spawnOvermindCoreCombatant(): void }
    ).spawnOvermindCoreCombatant();

    expect(engaged.length).toBe(1);
    expect(engaged[0].npc.id).toBe("overmind_core");
    expect(engaged[0].aggressive).toBe(true);
    expect(targeted.length).toBe(1);
    expect(targeted[0].npc.id).toBe("overmind_core");
    expect(transitions.length).toBe(0);

    manager.destroy();
  });

  it("is idempotent — a second prompt-attack does not double-spawn", () => {
    const { manager, engaged } = makeHarness();
    const spawn = () =>
      (
        manager as unknown as { spawnOvermindCoreCombatant(): void }
      ).spawnOvermindCoreCombatant();
    spawn();
    spawn();
    expect(engaged.length).toBe(1);
    manager.destroy();
  });

  it("killing the core in-flight wins the game", () => {
    const { manager, wins } = makeHarness();
    (
      manager as unknown as { spawnOvermindCoreCombatant(): void }
    ).spawnOvermindCoreCombatant();

    const sprites = (manager as unknown as { npcSprites: NpcShipSprite[] })
      .npcSprites;
    const core = sprites.find((s) => s.npc.id === "overmind_core");
    expect(core).toBeDefined();

    manager.handleInFlightDeath(core as NpcShipSprite, () => 0.99);

    expect(wins).toEqual([true]);
    manager.destroy();
  });

  it("a normal NPC death does not win the game", () => {
    const { manager, wins } = makeHarness();
    (
      manager as unknown as { spawnOvermindCoreCombatant(): void }
    ).spawnOvermindCoreCombatant();
    const sprites = (manager as unknown as { npcSprites: NpcShipSprite[] })
      .npcSprites;
    const core = sprites.find((s) => s.npc.id === "overmind_core");
    // Rename the spawned sprite's npc id so it is treated as an ordinary kill.
    (core as unknown as { npc: { id: string } }).npc.id = "pirate_42";
    manager.handleInFlightDeath(core as NpcShipSprite, () => 0.99);
    expect(wins).toEqual([]);
    manager.destroy();
  });
});
