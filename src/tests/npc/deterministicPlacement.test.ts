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
import { deterministicNpcOffset } from "@/systems/npc/npcPlacement";
import { NpcRole, NpcState, FactionType } from "@/types";
import { Faction } from "@/types/faction";

const STAR_CENTER = { x: 400, y: 300 };

function makeNpc(id: string, role: NpcRole = NpcRole.TRADER): NpcShip {
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
 * Minimal NpcShipManager harness with a seeded galaxy id, so deterministic
 * placement resolves from a real seed. Star centre is fixed so a sprite's
 * screen position maps directly to its stored offset (offset = sprite − centre).
 */
function makeHarness(
  npcs: NpcShip[],
  galaxyId = "galaxy-seed",
): {
  manager: NpcShipManager;
  gameLayer: Container;
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

  const galaxy = { id: galaxyId, npcShips: npcs } as unknown as Galaxy;
  const gameEngine = {
    galaxy,
    player: { currentSystemId: "sys_a" },
  } as unknown as GameEngine;

  const deps: NpcShipManagerDeps = {
    getShipPhysics: () => null,
    getPlanetSprites: () => [],
    getStarCenter: () => STAR_CENTER,
    isTurnRunning: () => false,
    showMessage: () => {},
    showTooltip: () => {},
    hideTooltip: () => {},
    executeRouteTo: () => {},
    clearRouteTarget: () => {},
    endTurn: () => {},
  };

  const manager = new NpcShipManager(
    renderer,
    gameEngine,
    gameLayer,
    uiLayer,
    deps,
  );
  return { manager, gameLayer };
}

/** Screen position of the first spawned sprite. */
function firstSpritePos(manager: NpcShipManager): { x: number; y: number } {
  const sprite = (
    manager as unknown as { npcSprites: Array<{ x: number; y: number }> }
  ).npcSprites[0];
  return { x: sprite.x, y: sprite.y };
}

describe("NpcShipManager deterministic placement", () => {
  it("places a fresh ship at the seed-derived interior offset and persists it", () => {
    const npc = makeNpc("npc_1");
    const { manager } = makeHarness([npc]);
    manager.initialize();

    const offset = deterministicNpcOffset("galaxy-seed", "npc_1");
    const pos = firstSpritePos(manager);
    expect(pos.x).toBeCloseTo(STAR_CENTER.x + offset.x, 5);
    expect(pos.y).toBeCloseTo(STAR_CENTER.y + offset.y, 5);

    // The resolved offset is written back so the next entry reuses it.
    expect(npc.hasWorldPosition()).toBe(true);
    expect(npc.worldX).toBeCloseTo(offset.x, 5);
    expect(npc.worldY).toBeCloseTo(offset.y, 5);

    manager.destroy();
  });

  it("respawns at the same position on re-entry (no re-scatter)", () => {
    const npc = makeNpc("npc_1");
    const { manager } = makeHarness([npc]);

    manager.initialize();
    const first = firstSpritePos(manager);
    manager.destroy();

    // Re-enter the same system (the npc now carries a stored position).
    manager.initialize();
    const second = firstSpritePos(manager);
    manager.destroy();

    expect(second.x).toBe(first.x);
    expect(second.y).toBe(first.y);
  });

  it("is identical across independent managers (deterministic, not random)", () => {
    // Two separate galaxies/managers with fresh ships of the same id + seed must
    // place the ship at the same spot — proving Math.random was removed.
    const a = makeNpc("npc_7");
    const b = makeNpc("npc_7");
    const h1 = makeHarness([a]);
    const h2 = makeHarness([b]);

    h1.manager.initialize();
    h2.manager.initialize();
    const pa = firstSpritePos(h1.manager);
    const pb = firstSpritePos(h2.manager);
    h1.manager.destroy();
    h2.manager.destroy();

    expect(pa).toEqual(pb);
  });

  it("differs by ship id and by galaxy seed", () => {
    const here = makeNpc("npc_1");
    const there = makeNpc("npc_2");
    const h1 = makeHarness([here], "galaxy-seed");
    const h2 = makeHarness([there], "galaxy-seed");
    const h3 = makeHarness([makeNpc("npc_1")], "other-seed");

    h1.manager.initialize();
    h2.manager.initialize();
    h3.manager.initialize();
    const p1 = firstSpritePos(h1.manager);
    const p2 = firstSpritePos(h2.manager);
    const p3 = firstSpritePos(h3.manager);
    h1.manager.destroy();
    h2.manager.destroy();
    h3.manager.destroy();

    expect(p2).not.toEqual(p1); // different id
    expect(p3).not.toEqual(p1); // different seed
  });

  it("reuses a pre-stored world position instead of re-deriving it", () => {
    const npc = makeNpc("npc_1");
    npc.setWorldPosition(123, -45); // e.g. restored from a save
    const { manager } = makeHarness([npc]);
    manager.initialize();

    const pos = firstSpritePos(manager);
    expect(pos.x).toBe(STAR_CENTER.x + 123);
    expect(pos.y).toBe(STAR_CENTER.y - 45);

    // The stored position is untouched (not overwritten by a seed-derived one).
    expect(npc.worldX).toBe(123);
    expect(npc.worldY).toBe(-45);

    manager.destroy();
  });
});
