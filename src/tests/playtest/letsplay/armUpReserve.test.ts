import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SceneType, StationType } from "@/types";
import { Faction } from "@/types/faction";
import { Station } from "@/domain/Station";
import {
  adjustPlayerCredits,
  GL_COUNTERPARTY,
} from "@/systems/banking/economy";
import { RealEngineHarness } from "../realEngineHarness";
import { currentSystem } from "./engineQueries";
import { planArmUp, executeArmUp } from "./equipmentQueries";
import {
  observe,
  legalActionsForScene,
  type Observation,
  type PlayerSnapshot,
  type SystemSnapshot,
} from "./observe";
import { createMemory } from "./AgentMemory";
import {
  decideWithMemory,
  MILITARY_SPEND_TRADE_RESERVE,
  BATTLE_READY_WEAPON_DAMAGE,
} from "./MemoryHeuristicPolicy";

vi.mock("pixi.js", async () => (await import("../pixiStub")).makePixiStub());

const RESERVE = MILITARY_SPEND_TRADE_RESERVE;

function player(over: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
  return {
    credits: 5000,
    hull: 130,
    maxHull: 130,
    hullFraction: 1,
    weaponDamage: 14, // starter corvette — short of BATTLE_READY_WEAPON_DAMAGE
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
  armUpCost?: number;
  bestHullPrice?: number | null;
  needsRepair?: boolean;
}

function obs(opts: Opts = {}): Observation {
  const scene = opts.scene ?? SceneType.STATION;
  const stations = opts.stations ?? [
    { id: "st1", name: "Base", type: StationType.TRADE_POST },
  ];
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
    needsRepair: opts.needsRepair,
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
    armUpCost: opts.armUpCost,
    bestHullPrice: opts.bestHullPrice ?? null,
  };
}

describe("reserve-gated arm-up (pure ladder)", () => {
  it("declines an arm-up that would dip the wallet below the trade reserve", () => {
    const here = obs({
      canArmUp: true,
      armUpCost: 800,
      player: { credits: RESERVE + 800 - 1 }, // surplus 1 short of the reserve
    });
    expect(here.legalActions).toContain("arm-up"); // legal, but not worth it
    const action = decideWithMemory(here, createMemory());
    expect(action.kind).not.toBe("arm-up");
  });

  it("arms up from genuine surplus (reserve stays intact after the buy)", () => {
    const here = obs({
      canArmUp: true,
      armUpCost: 800,
      player: { credits: RESERVE + 800 + 500 },
    });
    const action = decideWithMemory(here, createMemory());
    expect(action.kind).toBe("arm-up");
  });

  it("fires exactly at the boundary: credits − cost === reserve", () => {
    const here = obs({
      canArmUp: true,
      armUpCost: 800,
      player: { credits: RESERVE + 800 },
    });
    const action = decideWithMemory(here, createMemory());
    expect(action.kind).toBe("arm-up");
  });

  it("a free refit (fielding an owned spare, cost 0) fires at reserve-level credits", () => {
    const here = obs({
      canArmUp: true, // armUpCost absent ⇒ defaults to 0 (owned spare gun)
      player: { credits: RESERVE },
    });
    const action = decideWithMemory(here, createMemory());
    expect(action.kind).toBe("arm-up");
  });

  it("gates the hull upgrade on the same reserve", () => {
    const tooTight = obs({
      bestHullPrice: 2000,
      player: { credits: 2000 + RESERVE - 1 },
    });
    expect(tooTight.legalActions).toContain("upgrade-hull"); // affordable, but…
    expect(decideWithMemory(tooTight, createMemory()).kind).not.toBe(
      "upgrade-hull",
    );

    const surplus = obs({
      bestHullPrice: 2000,
      player: { credits: 2000 + RESERVE },
    });
    expect(decideWithMemory(surplus, createMemory()).kind).toBe("upgrade-hull");
  });

  it("does not dock-to-refit from flight when the refit would break the reserve", () => {
    const flight = (credits: number) =>
      obs({
        scene: SceneType.SPACE_FLIGHT,
        connections: 1,
        canArmUp: true,
        armUpCost: 800,
        player: { credits },
      });
    const broke = decideWithMemory(flight(RESERVE + 800 - 1), createMemory());
    expect(broke.reason).not.toContain("go-battle-ready");

    const flush = decideWithMemory(flight(RESERVE + 800 + 500), createMemory());
    expect(flush.kind).toBe("dock");
    expect(flush.reason).toContain("go-battle-ready");
  });
});

describe("STATION repair no-op gate (pure)", () => {
  it("removes `repair` from the legal set when the hull is already full", () => {
    const actions = legalActionsForScene(SceneType.STATION, {
      hasPlayer: true,
      planetCount: 0,
      stationCount: 1,
      hostileCount: 0,
      connectionCount: 0,
      availableQuestCount: 0,
      needsRepair: false,
    });
    expect(actions).not.toContain("repair");
    expect(actions).toContain("move"); // undocking stays available
  });

  it("keeps `repair` legal while damaged, and by default (fixture back-compat)", () => {
    const base = {
      hasPlayer: true,
      planetCount: 0,
      stationCount: 1,
      hostileCount: 0,
      connectionCount: 0,
      availableQuestCount: 0,
    };
    expect(
      legalActionsForScene(SceneType.STATION, { ...base, needsRepair: true }),
    ).toContain("repair");
    expect(legalActionsForScene(SceneType.STATION, base)).toContain("repair");
  });

  it("a docked full-hull agent undocks instead of soft-locking on no-op repair", () => {
    const here = obs({ needsRepair: false, player: { weaponDamage: 40 } });
    expect(here.legalActions).not.toContain("repair");
    const action = decideWithMemory(here, createMemory());
    expect(action.kind).toBe("move"); // "leave" — the ladder falls through
  });
});

describe("real engine: observe() surfaces the gates, executor honors the reserve", () => {
  let harness: RealEngineHarness;

  beforeEach(async () => {
    localStorage.clear();
    harness = await RealEngineHarness.boot({ seed: "RESERVE-GATE" });
    await harness.newGame();
    const sys = currentSystem(harness.engine)!;
    sys.techLevel = 6;
    sys.stations.push(
      new Station(
        "craft-1",
        "Крафт-центр",
        StationType.CRAFT_CENTER,
        Faction.INDEPENDENT,
        100,
        0,
      ),
    );
  });

  afterEach(() => {
    harness?.dispose();
    vi.clearAllMocks();
    localStorage.clear();
  });

  function setCredits(target: number): void {
    const engine = harness.engine;
    adjustPlayerCredits(
      engine.bank,
      engine.player!,
      target - engine.player!.credits,
      GL_COUNTERPARTY.REWARDS,
      "test: set credits",
    );
  }

  it("full hull docks without `repair`; damage brings it back", async () => {
    const sys = currentSystem(harness.engine)!;
    await harness.goTo(SceneType.STATION, { station: sys.stations[0] });

    const fullHull = observe(harness.engine);
    expect(fullHull.scene).toBe(SceneType.STATION);
    expect(fullHull.player!.hull).toBe(fullHull.player!.maxHull);
    expect(fullHull.legalActions).not.toContain("repair");
    const action = decideWithMemory(fullHull, createMemory());
    expect(action.kind).not.toBe("repair");

    const ship = harness.engine.player!.ship;
    ship.hullHP = ship.maxHull - 50;
    expect(observe(harness.engine).legalActions).toContain("repair");
  });

  it("observe() exposes the arm-up price the executor would actually pay", async () => {
    const sys = currentSystem(harness.engine)!;
    await harness.goTo(SceneType.STATION, { station: sys.stations[0] });
    setCredits(500_000); // deep pockets: strongest gun affordable

    const plan = planArmUp(harness.engine);
    expect(plan).not.toBeNull();
    const here = observe(harness.engine);
    expect(here.canArmUp).toBe(true);
    expect(here.armUpCost).toBe(plan!.buyPrice ?? 0);
  });

  it("policy declines a reserve-breaking arm-up, accepts with surplus, and the refit never bankrupts", async () => {
    const engine = harness.engine;
    const sys = currentSystem(engine)!;
    await harness.goTo(SceneType.STATION, { station: sys.stations[0] });

    setCredits(500_000);
    const price = planArmUp(engine)!.buyPrice;
    expect(price).toBeGreaterThan(0); // fresh ship owns no spare gun

    setCredits(price! + RESERVE - 1);
    const tight = observe(engine);
    expect(tight.canArmUp).toBe(true);
    expect(tight.armUpCost).toBe(price);
    expect(decideWithMemory(tight, createMemory()).kind).not.toBe("arm-up");

    setCredits(price! + RESERVE + 1);
    const flush = observe(engine);
    const action = decideWithMemory(flush, createMemory());
    expect(action.kind).toBe("arm-up");

    const damageBefore = flush.player!.weaponDamage ?? 0;
    executeArmUp(engine);
    expect(engine.player!.credits).toBeGreaterThanOrEqual(RESERVE);
    const after = observe(engine);
    expect(after.player!.weaponDamage ?? 0).toBeGreaterThan(damageBefore);
    expect(harness.errors()).toEqual([]);
  });

  it("battle-ready weapon threshold is reachable within the reserve discipline", async () => {
    const engine = harness.engine;
    const sys = currentSystem(engine)!;
    await harness.goTo(SceneType.STATION, { station: sys.stations[0] });
    setCredits(500_000);
    const price = planArmUp(engine)!.buyPrice!;
    setCredits(price + RESERVE + 1);
    executeArmUp(engine);
    expect(observe(engine).player!.weaponDamage ?? 0).toBeGreaterThanOrEqual(
      BATTLE_READY_WEAPON_DAMAGE,
    );
    expect(engine.player!.credits).toBeGreaterThanOrEqual(RESERVE);
  });
});
