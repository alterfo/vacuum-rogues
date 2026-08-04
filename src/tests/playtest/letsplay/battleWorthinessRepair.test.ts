import { describe, it, expect } from "vitest";
import { SceneType, StationType, FactionType } from "@/types";
import {
  legalActionsForScene,
  type Observation,
  type PlayerSnapshot,
  type SystemSnapshot,
  type NpcSnapshot,
} from "./observe";
import { createMemory } from "./AgentMemory";
import {
  decideWithMemory,
  isBattleReady,
  BATTLE_READY_MAX_HULL,
  BATTLE_READY_WEAPON_DAMAGE,
  OVERMIND_THREAT_HULL_FRACTION,
  OVERMIND_THREAT_SHARE,
} from "./MemoryHeuristicPolicy";

function player(over: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
  return {
    credits: 2000,
    hull: 100,
    maxHull: 100,
    hullFraction: 1,
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

function hostile(id = "raider-1"): NpcSnapshot {
  return {
    id,
    name: id,
    faction: FactionType.SYNDICATE,
    hostile: true,
    hullHP: 80,
  };
}

interface ObsOpts {
  scene?: SceneType;
  player?: Partial<PlayerSnapshot>;
  stations?: boolean;
  hostiles?: NpcSnapshot[];
  overmindShare?: number;
  neighbors?: SystemSnapshot["neighbors"];
  canAffordRepair?: boolean;
}

function obs(opts: ObsOpts = {}): Observation {
  const scene = opts.scene ?? SceneType.SPACE_FLIGHT;
  const stations = opts.stations
    ? [{ id: "st0", name: "St", type: StationType.TRADE_POST }]
    : [];
  const hostiles = opts.hostiles ?? [];
  const system: SystemSnapshot = {
    id: "sysA",
    name: "A",
    planets: [],
    stations,
    connections: 2,
    neighbors: opts.neighbors,
  };
  const p = player(opts.player);
  return {
    scene,
    hasPlayer: true,
    player: { ...p, canAffordRepair: opts.canAffordRepair ?? true },
    system,
    currentPlanet: null,
    npcs: hostiles,
    hostiles,
    quests: [],
    overmindShare: opts.overmindShare,
    legalActions: legalActionsForScene(scene, {
      hasPlayer: true,
      planetCount: 0,
      stationCount: stations.length,
      hostileCount: hostiles.length,
      connectionCount: 2,
      availableQuestCount: 0,
    }),
  };
}

const DEAD_ZONE_HULL = 0.5; // between hurt (0.35) and overmind-threat (0.6)

describe("battle-worthiness repair — the [hurt, threat) dead zone docks to heal instead of fleeing forever", () => {
  it("dead-zone hull + threatened galaxy + a station here ⇒ docks to repair, not flee-overmind-front", () => {
    const here = obs({
      stations: true,
      overmindShare: OVERMIND_THREAT_SHARE + 0.05,
      player: { hullFraction: DEAD_ZONE_HULL, hull: 50 },
    });
    const action = decideWithMemory(here, createMemory());
    expect(action.kind).toBe("dock");
    expect(action.reason).toContain("dock-to-repair");
  });

  it("dead-zone hull + threatened galaxy + NO station ⇒ still flees the front (avoidance preserved)", () => {
    const here = obs({
      overmindShare: OVERMIND_THREAT_SHARE + 0.05,
      player: { hullFraction: DEAD_ZONE_HULL, hull: 50 },
    });
    const action = decideWithMemory(here, createMemory());
    expect(action.kind).toBe("warp");
    expect(action.reason).toContain("flee-overmind-front");
  });

  it("dead-zone hull NEXT TO THE CORE ⇒ flees first, repairs one hop away (core proximity outranks the dock detour)", () => {
    const here = obs({
      stations: true,
      player: { hullFraction: DEAD_ZONE_HULL, hull: 50 },
    });
    here.nearOvermindCore = true;
    const action = decideWithMemory(here, createMemory());
    expect(action.kind).toBe("warp");
    expect(action.reason).toContain("flee-overmind-front");
  });

  it("dead-zone hull but a live hostile present ⇒ the fight/flee tier still owns the decision", () => {
    const here = obs({
      stations: true,
      hostiles: [hostile()],
      player: { hullFraction: DEAD_ZONE_HULL, hull: 50 },
    });
    const action = decideWithMemory(here, createMemory());
    expect(action.reason).not.toContain("dock-to-repair");
  });

  it("unaffordable repair ⇒ no dock detour", () => {
    const here = obs({
      stations: true,
      overmindShare: OVERMIND_THREAT_SHARE + 0.05,
      player: { hullFraction: DEAD_ZONE_HULL, hull: 50, credits: 0 },
      canAffordRepair: false,
    });
    const action = decideWithMemory(here, createMemory());
    expect(action.reason).not.toContain("dock-to-repair");
  });

  it("a damaged battle-ready ship repairs before advancing on the front", () => {
    const here = obs({
      stations: true,
      player: {
        maxHull: BATTLE_READY_MAX_HULL,
        hull: Math.floor(BATTLE_READY_MAX_HULL * 0.7),
        hullFraction: 0.7,
        weaponDamage: BATTLE_READY_WEAPON_DAMAGE,
      },
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
    expect(action.kind).toBe("dock");
    expect(action.reason).toContain("dock-to-repair");
  });

  it("a battle-ready ship below the worthiness floor does NOT slayer-advance (no half-dead assaults)", () => {
    const here = obs({
      player: {
        maxHull: BATTLE_READY_MAX_HULL,
        hull: Math.floor(
          BATTLE_READY_MAX_HULL * (OVERMIND_THREAT_HULL_FRACTION - 0.1),
        ),
        hullFraction: OVERMIND_THREAT_HULL_FRACTION - 0.1,
        weaponDamage: BATTLE_READY_WEAPON_DAMAGE,
      },
      neighbors: [
        {
          systemId: "front",
          visited: false,
          overmindHeld: true,
          hopsToOvermindFront: 0,
        },
      ],
    });
    const action = decideWithMemory(here, createMemory());
    expect(action.reason).not.toContain("slayer-advance");
  });

  it("a battle-ready slayer facing an outgunning garrison pack disengages instead of suiciding", () => {
    const pack = Array.from({ length: 6 }, (_, i) => ({
      id: `g${i}`,
      name: `g${i}`,
      faction: FactionType.SYNDICATE,
      hostile: true,
      hullHP: 300,
      damage: 15,
    }));
    const here = obs({
      hostiles: pack,
      player: {
        maxHull: BATTLE_READY_MAX_HULL,
        hull: BATTLE_READY_MAX_HULL,
        hullFraction: 1,
        weaponDamage: BATTLE_READY_WEAPON_DAMAGE,
      },
    });
    here.overmindHeldHere = true;
    const action = decideWithMemory(here, createMemory());
    expect(action.reason).not.toContain("slayer-clear-garrison");
    expect(action.kind).toBe("flee");
  });

  it("a battle-ready slayer still engages a winnable lone garrison tank", () => {
    const here = obs({
      hostiles: [
        {
          id: "g0",
          name: "g0",
          faction: FactionType.SYNDICATE,
          hostile: true,
          hullHP: 500,
          damage: 2,
        },
      ],
      player: {
        maxHull: BATTLE_READY_MAX_HULL,
        hull: BATTLE_READY_MAX_HULL,
        hullFraction: 1,
        weaponDamage: BATTLE_READY_WEAPON_DAMAGE,
      },
    });
    here.overmindHeldHere = true;
    const action = decideWithMemory(here, createMemory());
    expect(action.kind).toBe("attack");
    expect(action.reason).toContain("slayer-clear-garrison");
  });

  it("a healthy battle-ready ship still slayer-advances (press preserved)", () => {
    const here = obs({
      player: {
        maxHull: BATTLE_READY_MAX_HULL,
        hull: BATTLE_READY_MAX_HULL,
        hullFraction: 1,
        weaponDamage: BATTLE_READY_WEAPON_DAMAGE,
      },
      neighbors: [
        {
          systemId: "front",
          visited: false,
          overmindHeld: true,
          hopsToOvermindFront: 0,
        },
      ],
    });
    const action = decideWithMemory(here, createMemory());
    expect(action.kind).toBe("warp");
    expect(action.reason).toContain("slayer-advance");
  });
});
