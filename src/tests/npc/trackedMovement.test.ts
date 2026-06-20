import { describe, it, expect } from "vitest";
import { Container } from "pixi.js";
import { Galaxy } from "@/domain/Galaxy";
import { StarSystem } from "@/domain/StarSystem";
import { Overmind } from "@/domain/Overmind";
import { NpcShip } from "@/domain/NpcShip";
import { NpcSimulator } from "@/systems/npc/NpcSimulator";
import { advanceNpcOrbit, npcOrbitStep } from "@/systems/npc/npcPlacement";
import { SeededRNG } from "@/utils/seededRNG";
import {
  NpcShipManager,
  type NpcShipManagerDeps,
} from "@/presentation/flight/NpcShipManager";
import type { Renderer } from "@/presentation/Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import { StarType, NpcState, NpcRole, FactionType } from "@/types";
import { Faction } from "@/types/faction";

const GALAXY_SEED = "tracked-seed";

function makeNpc(
  id: string,
  state: NpcState = NpcState.PATROLLING,
  systemId = "sys_x",
): NpcShip {
  return new NpcShip({
    id,
    name: id,
    race: FactionType.OUTLANDERS,
    faction: Faction.INDEPENDENT,
    role: NpcRole.TRADER,
    hullHP: 100,
    maxHull: 100,
    shields: 40,
    speed: 0.1,
    damage: 20,
    currentSystemId: systemId,
    state,
    goal: null,
    destinationSystemId: null,
    daysToArrival: 0,
    credits: 0,
    reputation: 0,
  });
}

/**
 * Single connection-less system: a present ship can never travel out (no warp
 * target), so it stays in-system every tick — isolating the tracked-position
 * advance from the departure machinery.
 */
function makeGalaxy(npcs: NpcShip[]): Galaxy {
  const sys = new StarSystem(
    "sys_x",
    "X",
    { q: 0, r: 0 },
    StarType.YELLOW_DWARF,
    [],
    Faction.INDEPENDENT,
    [],
  );
  return new Galaxy(GALAXY_SEED, [sys], new Overmind(), [], npcs);
}

describe("NpcSimulator tracked in-system movement", () => {
  it("advances a placed ship one deterministic orbit step per tick", () => {
    const npc = makeNpc("npc_track");
    npc.setWorldPosition(120, -40);
    const galaxy = makeGalaxy([npc]);

    const before = { x: npc.worldX!, y: npc.worldY! };
    new NpcSimulator().tick(galaxy, new SeededRNG("tick_rng"));

    const step = npcOrbitStep(GALAXY_SEED, "npc_track");
    const expected = advanceNpcOrbit(before, step);
    expect(npc.worldX).toBeCloseTo(expected.x, 6);
    expect(npc.worldY).toBeCloseTo(expected.y, 6);
    // It actually moved…
    expect(npc.worldX).not.toBeCloseTo(before.x, 6);
    // …and a rotation preserves the orbital radius (stays in its band).
    expect(Math.hypot(npc.worldX!, npc.worldY!)).toBeCloseTo(
      Math.hypot(before.x, before.y),
      6,
    );
  });

  it("accumulates N tracked steps over N ticks", () => {
    const npc = makeNpc("npc_multi");
    npc.setWorldPosition(90, 60);
    const galaxy = makeGalaxy([npc]);

    const start = { x: npc.worldX!, y: npc.worldY! };
    const sim = new NpcSimulator();
    for (let i = 0; i < 3; i++) sim.tick(galaxy, new SeededRNG(`t${i}`));

    const step = npcOrbitStep(GALAXY_SEED, "npc_multi");
    let expected = start;
    for (let i = 0; i < 3; i++) expected = advanceNpcOrbit(expected, step);
    expect(npc.worldX).toBeCloseTo(expected.x, 6);
    expect(npc.worldY).toBeCloseTo(expected.y, 6);
  });

  it("is deterministic: same seed + start → identical advance across galaxies", () => {
    const a = makeNpc("npc_det");
    const b = makeNpc("npc_det");
    a.setWorldPosition(70, 110);
    b.setWorldPosition(70, 110);

    new NpcSimulator().tick(makeGalaxy([a]), new SeededRNG("rng_a"));
    new NpcSimulator().tick(makeGalaxy([b]), new SeededRNG("rng_b"));

    expect(a.worldX).toBe(b.worldX);
    expect(a.worldY).toBe(b.worldY);
  });

  it("freezes positions without a tick", () => {
    const npc = makeNpc("npc_frozen");
    npc.setWorldPosition(33, 77);
    makeGalaxy([npc]); // built but never ticked

    expect(npc.worldX).toBe(33);
    expect(npc.worldY).toBe(77);
  });

  it("never invents a position for an unplaced ship", () => {
    const npc = makeNpc("npc_unplaced");
    const galaxy = makeGalaxy([npc]);
    expect(npc.hasWorldPosition()).toBe(false);

    new NpcSimulator().tick(galaxy, new SeededRNG("rng"));

    expect(npc.worldX).toBeNull();
    expect(npc.worldY).toBeNull();
  });

  it("leaves a traveling ship's position frozen (no in-system spot to advance)", () => {
    const npc = makeNpc("npc_travel", NpcState.TRAVELING);
    npc.setWorldPosition(50, -50);
    npc.destinationSystemId = "sys_x";
    npc.daysToArrival = 5;
    const galaxy = makeGalaxy([npc]);

    new NpcSimulator().tick(galaxy, new SeededRNG("rng"));

    // daysToArrival ticked down (it is in transit), but the stale in-system
    // offset is NOT advanced — a traveling ship has no spot to orbit.
    expect(npc.worldX).toBe(50);
    expect(npc.worldY).toBe(-50);
  });
});

// ---------------------------------------------------------------------------
// Presentation write-back: the live in-flight position persists to the domain
// ---------------------------------------------------------------------------

const STAR_CENTER = { x: 400, y: 300 };

function makeHarness(npcs: NpcShip[]): {
  manager: NpcShipManager;
  sprites: Array<{ x: number; y: number; npc: NpcShip }>;
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

  const galaxy = { id: GALAXY_SEED, npcShips: npcs } as unknown as Galaxy;
  const gameEngine = {
    galaxy,
    player: { currentSystemId: "sys_x" },
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
  const sprites = (
    manager as unknown as {
      npcSprites: Array<{ x: number; y: number; npc: NpcShip }>;
    }
  ).npcSprites;
  return { manager, sprites };
}

describe("NpcShipManager live-position write-back", () => {
  it("persists each sprite's live position back to its domain ship", () => {
    const npc = makeNpc("npc_live");
    const { manager, sprites } = makeHarness([npc]);
    manager.initialize();

    // The ship drifts in flight to a new spot…
    sprites[0].x = STAR_CENTER.x + 210;
    sprites[0].y = STAR_CENTER.y - 130;
    manager.persistLivePositions();

    // …which is written back as an offset from the star centre.
    expect(npc.worldX).toBeCloseTo(210, 6);
    expect(npc.worldY).toBeCloseTo(-130, 6);

    manager.destroy();
  });

  it("destroy() captures the live layout so re-entry respawns it (no scatter)", () => {
    const npc = makeNpc("npc_persist");
    const { manager, sprites } = makeHarness([npc]);
    manager.initialize();

    sprites[0].x = STAR_CENTER.x + 55;
    sprites[0].y = STAR_CENTER.y + 88;
    manager.destroy();

    expect(npc.worldX).toBeCloseTo(55, 6);
    expect(npc.worldY).toBeCloseTo(88, 6);

    // Re-enter: the ship respawns exactly where it was left, not re-scattered.
    const { manager: m2, sprites: s2 } = makeHarness([npc]);
    m2.initialize();
    expect(s2[0].x).toBeCloseTo(STAR_CENTER.x + 55, 6);
    expect(s2[0].y).toBeCloseTo(STAR_CENTER.y + 88, 6);
    m2.destroy();
  });
});
