import { describe, it, expect } from "vitest";
import { Container } from "pixi.js";
import { NpcShipSprite, type SystemBounds } from "@/presentation/NpcShipSprite";
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

const BOUNDS: SystemBounds = {
  cx: 0,
  cy: 0,
  rInner: 100,
  rOuter: 500,
  boundary: 800,
};

describe("NpcShipSprite dwell lifecycle", () => {
  it("isAnchored() reflects orbit-anchor state", () => {
    const sprite = new NpcShipSprite(makeNpc("npc_anchored"), 200, 0, BOUNDS);
    expect(sprite.isAnchored()).toBe(false);
    sprite.setAnchor(200, 0);
    expect(sprite.isAnchored()).toBe(true);
    sprite.destroy();
  });

  it("exposes a deterministic dwellDurationMs in [8000, 20000] ms", () => {
    const s1 = new NpcShipSprite(makeNpc("npc_dwell_a"), 200, 0, BOUNDS);
    const s2 = new NpcShipSprite(makeNpc("npc_dwell_a"), 200, 0, BOUNDS);
    expect(s1.dwellDurationMs).toBe(s2.dwellDurationMs);
    expect(s1.dwellDurationMs).toBeGreaterThanOrEqual(8000);
    expect(s1.dwellDurationMs).toBeLessThanOrEqual(20000);
    s1.destroy();
    s2.destroy();
  });

  it("clears anchor after dwellDurationMs of orbit time", () => {
    const sprite = new NpcShipSprite(makeNpc("npc_dwell_b"), 200, 0, BOUNDS);
    sprite.setAnchor(200, 0);
    sprite.setTargetProvider(() => ({ x: 50, y: 50 }));

    expect(sprite.isAnchored()).toBe(true);

    sprite.update(sprite.dwellDurationMs - 1);
    expect(sprite.isAnchored()).toBe(true);

    sprite.update(2);
    expect(sprite.isAnchored()).toBe(false);

    sprite.destroy();
  });

  it("isLeaving() is false before beginDeparture() and true after", () => {
    const sprite = new NpcShipSprite(
      makeNpc("npc_leaving_flag"),
      200,
      0,
      BOUNDS,
    );
    expect(sprite.isLeaving()).toBe(false);
    sprite.beginDeparture();
    expect(sprite.isLeaving()).toBe(true);
    sprite.destroy();
  });

  it("does NOT increment dwell while departing (orbit branch is skipped)", () => {
    const sprite = new NpcShipSprite(makeNpc("npc_depart"), 200, 0, BOUNDS);
    sprite.setAnchor(200, 0);
    sprite.beginDeparture();

    sprite.update(sprite.dwellDurationMs + 1);

    expect(sprite.isAnchored()).toBe(true);

    sprite.destroy();
  });

  it("after dwell fires, the sprite moves toward the next target (not staying still)", () => {
    const sprite = new NpcShipSprite(makeNpc("npc_dwell_move"), 200, 0, BOUNDS);
    sprite.setAnchor(200, 0);
    sprite.setTargetProvider(() => ({ x: -400, y: -400 }));

    sprite.update(sprite.dwellDurationMs + 1);
    expect(sprite.isAnchored()).toBe(false);

    const x0 = sprite.x;
    const y0 = sprite.y;

    sprite.update(200);
    const moved = Math.hypot(sprite.x - x0, sprite.y - y0);
    expect(moved).toBeGreaterThan(0);

    sprite.destroy();
  });
});

describe("NpcShipManager dwell-expiry cleanup", () => {
  function makeManagerWithPlanets(
    npcs: NpcShip[],
    planets: { screenX: number; screenY: number; displayRadius: number }[],
  ): {
    manager: NpcShipManager;
    isTurnRunning: { value: boolean };
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

    const galaxy = { npcShips: npcs } as unknown as Galaxy;
    const gameEngine = {
      galaxy,
      player: { currentSystemId: "sys_a" },
    } as unknown as GameEngine;

    const isTurnRunning = { value: false };
    const deps: NpcShipManagerDeps = {
      getShipPhysics: () => null,
      getPlanetSprites: () =>
        planets as unknown as import("@/presentation/PlanetSprite").PlanetSprite[],
      getStarCenter: () => ({ x: 0, y: 0 }),
      isTurnRunning: () => isTurnRunning.value,
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
    return { manager, isTurnRunning };
  }

  it("re-anchors a non-pirate sprite when it arrives at the next planet after dwell expiry", () => {
    const planet = { screenX: 300, screenY: 0, displayRadius: 50 };
    const { manager, isTurnRunning } = makeManagerWithPlanets(
      [makeNpc("trader_reanchor")],
      [planet],
    );
    manager.initialize();

    const sprite = (
      manager as unknown as {
        npcSprites: Array<{
          x: number;
          y: number;
          dwellDurationMs: number;
          isAnchored(): boolean;
        }>;
      }
    ).npcSprites[0];

    isTurnRunning.value = true;
    manager.update(sprite.dwellDurationMs + 1, 0);
    expect(sprite.isAnchored()).toBe(false);

    sprite.x = planet.screenX;
    sprite.y = planet.screenY;

    manager.update(16, 0);
    expect(sprite.isAnchored()).toBe(true);

    const anchorMap = (
      manager as unknown as { npcAnchorPlanet: Map<unknown, unknown> }
    ).npcAnchorPlanet;
    const rawSprite = (manager as unknown as { npcSprites: unknown[] })
      .npcSprites[0];
    expect(anchorMap.has(rawSprite)).toBe(true);

    manager.destroy();
  });

  it("re-anchors even when the planet has drifted more than 20px from the arrival point", () => {
    const planet = { screenX: 300, screenY: 0, displayRadius: 50 };
    const { manager, isTurnRunning } = makeManagerWithPlanets(
      [makeNpc("trader_drift")],
      [planet],
    );
    manager.initialize();

    const sprite = (
      manager as unknown as {
        npcSprites: Array<{
          x: number;
          y: number;
          dwellDurationMs: number;
          isAnchored(): boolean;
        }>;
      }
    ).npcSprites[0];

    isTurnRunning.value = true;
    manager.update(sprite.dwellDurationMs + 1, 0);
    expect(sprite.isAnchored()).toBe(false);

    sprite.x = 300;
    sprite.y = 0;

    planet.screenX = 325;

    manager.update(16, 0);
    expect(sprite.isAnchored()).toBe(true);

    manager.destroy();
  });

  it("removes the anchor-planet map entry after the sprite's dwell expires", () => {
    const planet1 = { screenX: 300, screenY: 0, displayRadius: 50 };
    const planet2 = { screenX: -300, screenY: 0, displayRadius: 50 };
    const { manager, isTurnRunning } = makeManagerWithPlanets(
      [makeNpc("trader_dwell")],
      [planet1, planet2],
    );
    manager.initialize();
    expect(manager.npcCount).toBe(1);

    const sprite = (
      manager as unknown as {
        npcSprites: Array<{ dwellDurationMs: number; isAnchored(): boolean }>;
      }
    ).npcSprites[0];

    const dwellMs = sprite.dwellDurationMs;

    isTurnRunning.value = true;
    manager.update(dwellMs + 1, 0);

    expect(sprite.isAnchored()).toBe(false);

    const anchorMap = (
      manager as unknown as { npcAnchorPlanet: Map<unknown, unknown> }
    ).npcAnchorPlanet;
    const rawSprite = (manager as unknown as { npcSprites: unknown[] })
      .npcSprites[0];
    expect(anchorMap.has(rawSprite)).toBe(false);

    manager.destroy();
  });
});
