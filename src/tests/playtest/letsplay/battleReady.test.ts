/**
 * Task 2 regression: the "battle-ready" capability signal + the military-
 * progression ladder tiers that drive toward it.
 *
 * `isBattleReady` reads the ship's *derived* combat stats (`maxHull` +
 * installed `weaponDamage`) — distinct from the health-fraction
 * `BATTLE_READY_HULL_FRACTION`. The ladder must, while NOT battle-ready, arm up
 * at a station (raise firepower) and dock-to-refit from flight when a concrete
 * upgrade is available — pure decisions over hand-built fixtures, exactly as
 * `MemoryHeuristicPolicy.test.ts`.
 */
import { describe, it, expect } from "vitest";
import { SceneType, StationType } from "@/types";
import {
  legalActionsForScene,
  type Observation,
  type PlayerSnapshot,
  type SystemSnapshot,
} from "./observe";
import { createMemory } from "./AgentMemory";
import {
  decideWithMemory,
  isBattleReady,
  BATTLE_READY_MAX_HULL,
  BATTLE_READY_WEAPON_DAMAGE,
} from "./MemoryHeuristicPolicy";

function player(over: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
  return {
    credits: 5000,
    hull: 200,
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
  scene?: SceneType;
  player?: Partial<PlayerSnapshot>;
  stations?: { id: string; name: string; type: StationType }[];
  connections?: number;
  canArmUp?: boolean;
  bestHullPrice?: number | null;
}

function obs(opts: Opts = {}): Observation {
  const scene = opts.scene ?? SceneType.SPACE_FLIGHT;
  const stations = opts.stations ?? [];
  const connections = opts.connections ?? 0;
  const p = player(opts.player);
  const system: SystemSnapshot = {
    id: "sysA",
    name: "A",
    planets: [],
    stations,
    connections,
  };
  const legalActions = legalActionsForScene(scene, {
    hasPlayer: true,
    planetCount: 0,
    stationCount: stations.length,
    hostileCount: 0,
    connectionCount: connections,
    availableQuestCount: 0,
    credits: p.credits,
    canArmUp: opts.canArmUp,
    bestHullPrice: opts.bestHullPrice ?? null,
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
    canArmUp: opts.canArmUp,
    bestHullPrice: opts.bestHullPrice ?? null,
  };
}

const station = { id: "st1", name: "Base", type: StationType.TRADE_POST };

describe("isBattleReady (capability signal, Task 2)", () => {
  it("true only when both maxHull and weaponDamage clear their thresholds", () => {
    expect(isBattleReady(obs())).toBe(true);
  });

  it("false with a starter-sized hull even at full firepower", () => {
    expect(isBattleReady(obs({ player: { maxHull: 140 } }))).toBe(false);
  });

  it("false with a big hull but a lone starter weapon", () => {
    expect(isBattleReady(obs({ player: { weaponDamage: 14 } }))).toBe(false);
  });

  it("false when the weapon-damage field is absent (old fixtures default to 0)", () => {
    expect(isBattleReady(obs({ player: { weaponDamage: undefined } }))).toBe(
      false,
    );
  });
});

describe("military-progression ladder (Task 2)", () => {
  it("arms up at a station while short on firepower", () => {
    const here = obs({
      scene: SceneType.STATION,
      stations: [station],
      canArmUp: true,
      player: { maxHull: 140, weaponDamage: 14 },
    });
    expect(here.legalActions).toContain("arm-up");
    const action = decideWithMemory(here, createMemory());
    expect(action.kind).toBe("arm-up");
    expect(action.reason).toContain("arm-up");
  });

  it("does not arm up once already weapon-ready (leaves it to repair/leave)", () => {
    const here = obs({
      scene: SceneType.STATION,
      stations: [station],
      canArmUp: true,
      player: { maxHull: 140, weaponDamage: BATTLE_READY_WEAPON_DAMAGE },
    });
    const action = decideWithMemory(here, createMemory());
    expect(action.kind).not.toBe("arm-up");
  });

  it("docks to refit from flight when not battle-ready and a refit is available", () => {
    const here = obs({
      scene: SceneType.SPACE_FLIGHT,
      stations: [station],
      connections: 1,
      canArmUp: true,
      player: { maxHull: 140, weaponDamage: 14 },
    });
    const action = decideWithMemory(here, createMemory());
    expect(action.kind).toBe("dock");
    expect(action.reason).toContain("go-battle-ready");
    expect(action.targetId).toBe(station.id);
  });

  it("does not dock-to-refit once battle-ready", () => {
    const here = obs({
      scene: SceneType.SPACE_FLIGHT,
      stations: [station],
      connections: 1,
      canArmUp: true, // even if a refit is technically offered
    });
    const action = decideWithMemory(here, createMemory());
    expect(action.reason).not.toContain("go-battle-ready");
  });
});
