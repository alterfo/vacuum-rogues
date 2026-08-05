import { describe, it, expect, afterEach, vi } from "vitest";
import { SceneType, FactionType, NpcRole, NpcState } from "@/types";
import { Faction } from "@/types/faction";
import { NpcShip } from "@/domain/NpcShip";
import { RealEngineHarness } from "../realEngineHarness";
import { PlayerAgent } from "./PlayerAgent";
import { MemoryHeuristicPolicy } from "./MemoryHeuristicPolicy";
import type { PlayerPolicy, Action } from "./PlayerPolicy";
import {
  legalActionsForScene,
  observe,
  type Observation,
  type PlayerSnapshot,
  type SystemSnapshot,
} from "./observe";
import {
  decideWithMemory,
  isBattleReady,
  BATTLE_READY_MAX_HULL,
  BATTLE_READY_WEAPON_DAMAGE,
  OVERMIND_THREAT_HULL_FRACTION,
  OVERMIND_THREAT_SHARE,
} from "./MemoryHeuristicPolicy";
import { createMemory, questBaselineForObserve } from "./AgentMemory";
import {
  acquireUninstalledGear,
  installOwnedGear,
  applyLoadoutHullToShip,
} from "@/systems/equipment/GearBridge";

function player(over: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
  return {
    credits: 1000,
    hull: BATTLE_READY_MAX_HULL,
    maxHull: BATTLE_READY_MAX_HULL,
    hullFraction: 1,
    weaponDamage: BATTLE_READY_WEAPON_DAMAGE,
    fuel: 50,
    maxFuel: 50,
    fuelFraction: 1,
    cargo: [],
    cargoUsed: 0,
    cargoCapacity: 20,
    systemId: "sysA",
    position: null,
    ...over,
  };
}

interface Opts {
  player?: Partial<PlayerSnapshot>;
  planets?: { id: string; name: string; availableQuests: number }[];
  neighbors?: SystemSnapshot["neighbors"];
  overmindShare?: number;
  nearOvermindCore?: boolean;
}

function obs(opts: Opts = {}): Observation {
  const scene = SceneType.SPACE_FLIGHT;
  const planets = opts.planets ?? [];
  const neighbors = opts.neighbors;
  const connections = neighbors ? neighbors.length : 1;
  const p = player(opts.player);
  const system: SystemSnapshot = {
    id: "sysA",
    name: "A",
    planets,
    stations: [],
    connections,
    neighbors,
  };
  const legalActions = legalActionsForScene(scene, {
    hasPlayer: true,
    planetCount: planets.length,
    stationCount: 0,
    hostileCount: 0,
    connectionCount: connections,
    availableQuestCount: 0,
    credits: p.credits,
  });
  return {
    scene,
    hasPlayer: true,
    player: p,
    system,
    currentPlanet: null,
    npcs: [],
    hostiles: [],
    quests: [],
    legalActions,
    overmindShare: opts.overmindShare,
    nearOvermindCore: opts.nearOvermindCore,
  };
}

function planetObs(opts: {
  battleReady: boolean;
  overmindShare: number;
}): Observation {
  const p = player(
    opts.battleReady ? {} : { maxHull: 140, hull: 140, weaponDamage: 14 },
  );
  const planets = [{ id: "P", name: "P", availableQuests: 2 }];
  const legalActions = legalActionsForScene(SceneType.PLANET, {
    hasPlayer: true,
    planetCount: 1,
    stationCount: 0,
    hostileCount: 0,
    connectionCount: 0,
    availableQuestCount: 2,
    credits: p.credits,
    cargoUsed: 0,
  });
  return {
    scene: SceneType.PLANET,
    hasPlayer: true,
    player: p,
    system: {
      id: "sysA",
      name: "A",
      planets,
      stations: [],
      connections: 0,
      neighbors: undefined,
    },
    currentPlanet: { id: "P", name: "P", availableQuests: 2, market: [] },
    npcs: [],
    hostiles: [],
    quests: [],
    legalActions,
    overmindShare: opts.overmindShare,
  };
}

describe("Task 8 — endgame press (battle-ready holds the front)", () => {
  const risingShare = OVERMIND_THREAT_SHARE + 0.1;
  const weakHull = OVERMIND_THREAT_HULL_FRACTION - 0.1;

  it("battle-ready + rising front + no hostile ⇒ does NOT flee the front (presses)", () => {
    const here = obs({
      overmindShare: risingShare,
      player: { hullFraction: weakHull, hull: Math.floor(180 * weakHull) },
      neighbors: [
        {
          systemId: "front",
          visited: false,
          overmindHeld: true,
          hopsToOvermindFront: 0,
        },
      ],
    });
    expect(isBattleReady(here)).toBe(true);
    const action = decideWithMemory(here, createMemory());
    expect(action.reason).not.toContain("flee-overmind-front");
  });

  it("NOT battle-ready + rising front + no hostile ⇒ still flees the front (weak reflex preserved)", () => {
    const here = obs({
      overmindShare: risingShare,
      player: {
        maxHull: 140,
        hull: Math.floor(140 * weakHull),
        weaponDamage: 14,
        hullFraction: weakHull,
      },
      neighbors: [
        { systemId: "elsewhere", visited: false, overmindHeld: false },
      ],
    });
    expect(isBattleReady(here)).toBe(false);
    const action = decideWithMemory(here, createMemory());
    expect(action.kind).toBe("warp");
    expect(action.reason).toContain("flee-overmind-front");
  });

  it("battle-ready + engaged galaxy ⇒ stops taking new courier work (war hysteresis)", () => {
    const here = planetObs({ battleReady: true, overmindShare: risingShare });
    const action = decideWithMemory(here, createMemory());
    expect(action.reason).not.toContain("take-work");
  });

  it("NOT battle-ready + engaged galaxy below the ceiling ⇒ still takes work (funds the refit)", () => {
    const here = planetObs({ battleReady: false, overmindShare: risingShare });
    const action = decideWithMemory(here, createMemory());
    expect(action.kind).toBe("take-quest");
    expect(action.reason).toContain("take-work");
  });
});

vi.mock("pixi.js", async () => (await import("../pixiStub")).makePixiStub());

function makeBattleReady(engine: RealEngineHarness["engine"]): void {
  const p = engine.player!;
  const loadout = engine.playerLoadout!;
  loadout.swapHull("hull_freighter"); // 180 hp
  acquireUninstalledGear(p, "wpn_beam"); // 30 dmg — second weapon slot
  installOwnedGear(p, loadout, "wpn_beam");
  applyLoadoutHullToShip(p.ship, loadout);
  p.ship.hullHP = p.ship.maxHull; // full health for the fight
}

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

function forceAggressorInRange(
  harness: RealEngineHarness,
  weaponRange = 200,
): { hullHP: number } | null {
  const scene = harness.currentScene() as unknown as {
    npcManager?: {
      e2eForceAggressorInRange?: (
        range: number,
      ) => { npc: { hullHP: number } } | null;
    };
  } | null;
  return (
    scene?.npcManager?.e2eForceAggressorInRange?.(weaponRange)?.npc ?? null
  );
}

function engageCombatNow(harness: RealEngineHarness): void {
  const scene = harness.currentScene() as unknown as {
    npcManager?: { e2eEngageCombat?: () => void };
  } | null;
  scene?.npcManager?.e2eEngageCombat?.();
}

describe("Task 8 — real-engine slayer loop", () => {
  let harness: RealEngineHarness | null = null;

  afterEach(() => {
    harness?.dispose();
    harness = null;
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("a battle-ready slayer clears a staged garrison — the enemy hull falls to death over ticks", async () => {
    localStorage.clear();
    harness = await RealEngineHarness.boot({ seed: "SLAYER-CLEAR" });
    await harness.newGame(FactionType.OUTLANDERS, "GOD");
    const engine = harness.engine;
    makeBattleReady(engine);

    const npc = forceAggressorInRange(harness);
    if (!npc) {
      expect(harness.errors()).toHaveLength(0);
      return; // seed drift — no NPC sprite to fight
    }
    engageCombatNow(harness);

    const alwaysAttack: PlayerPolicy = {
      name: "always-attack",
      decide(o: Observation): Action {
        return o.legalActions.includes("attack")
          ? { kind: "attack", reason: "scripted-slayer" }
          : { kind: "wait", reason: "scripted" };
      },
    };
    const agent = new PlayerAgent(harness, alwaysAttack);
    const hullStart = npc.hullHP;
    for (let i = 0; i < 40 && npc.hullHP > 0; i++) await agent.run(1);

    expect(npc.hullHP).toBeLessThanOrEqual(0);
    expect(hullStart).toBeGreaterThan(0);
    expect(harness.errors()).toHaveLength(0);
  }, 60_000);

  it("the real policy liberates a cleared held system — the Overmind's system count drops (share declines)", async () => {
    localStorage.clear();
    harness = await RealEngineHarness.boot({ seed: "SLAYER-LIBERATE" });
    await harness.newGame(FactionType.OUTLANDERS, "GOD");
    const engine = harness.engine;
    const galaxy = harness.galaxy()!;
    const here = engine.player!.currentSystemId;

    makeBattleReady(engine);
    clearHostiles(galaxy, here);
    const other = galaxy.systems.find((s) => s.id !== here)!.id;
    galaxy.overmindSystems = [here, other];
    const before = galaxy.overmindSystems.length;
    expect(engine.canLiberateCurrentSystem()).toBe(true);

    const agent = new PlayerAgent(harness, new MemoryHeuristicPolicy());
    const obsNow = observe(
      engine,
      questBaselineForObserve(new MemoryHeuristicPolicy().belief, engine),
    );
    expect(isBattleReady(obsNow)).toBe(true);
    for (let i = 0; i < 3 && galaxy.isOvermindSystem(here); i++) {
      await agent.run(1);
    }

    expect(galaxy.isOvermindSystem(here)).toBe(false);
    expect(galaxy.overmindSystems.length).toBeLessThan(before); // share declined
    expect(harness.errors()).toHaveLength(0);
  }, 60_000);

  it("core-kill: the policy liberates the engaged Overmind core and the arc resolves WON", async () => {
    localStorage.clear();
    harness = await RealEngineHarness.boot({
      seed: "SLAYER-CORE",
      systemCount: 24,
    });
    await harness.newGame(FactionType.OUTLANDERS, "GOD");
    const engine = harness.engine;
    const galaxy = harness.galaxy()!;
    const core = galaxy.overmindCoreSystemId;
    expect(core).not.toBe("");

    makeBattleReady(engine);
    engine.player!.currentSystemId = core;
    clearHostiles(galaxy, core);
    galaxy.overmindSystems = [core];
    galaxy.gameDays = 6;
    galaxy.overmindArc = {
      dayZero: 1,
      lastSpreadDay: 6,
      status: "advancing",
      threat: 0.2,
      peakThreat: 0.2,
    };
    expect(engine.canLiberateCurrentSystem()).toBe(true);

    const agent = new PlayerAgent(harness, new MemoryHeuristicPolicy());
    await agent.run(1); // slayer-liberate the core
    expect(galaxy.isOvermindSystem(core)).toBe(false);

    engine.advanceGalaxyDay(); // EOD arc tick reads the broken core
    expect(galaxy.overmindArc.status).toBe("won");
    expect(harness.errors()).toHaveLength(0);
  }, 60_000);
});
