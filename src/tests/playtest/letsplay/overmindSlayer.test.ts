import { describe, it, expect } from "vitest";
import { SceneType, FactionType, QuestType } from "@/types";
import {
  legalActionsForScene,
  type Observation,
  type PlayerSnapshot,
  type SystemSnapshot,
  type NpcSnapshot,
  type QuestSnapshot,
} from "./observe";
import { createMemory } from "./AgentMemory";
import {
  decideWithMemory,
  isBattleReady,
  BATTLE_READY_MAX_HULL,
  BATTLE_READY_WEAPON_DAMAGE,
  SLAYER_RETREAT_HULL_FRACTION,
  REFUEL_THRESHOLD,
  FRONT_CYCLE_STREAK_LIMIT,
} from "./MemoryHeuristicPolicy";
import { overmindFrontHopDistances } from "./engineQueries";

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
  scene?: SceneType;
  player?: Partial<PlayerSnapshot>;
  planets?: { id: string; name: string; availableQuests: number }[];
  connections?: number;
  hostiles?: NpcSnapshot[];
  neighbors?: SystemSnapshot["neighbors"];
  overmindHeldHere?: boolean;
  overmindShare?: number;
  nearOvermindCore?: boolean;
  canLiberate?: boolean;
  quests?: QuestSnapshot[];
}

function obs(opts: Opts = {}): Observation {
  const scene = opts.scene ?? SceneType.SPACE_FLIGHT;
  const planets = opts.planets ?? [];
  const hostiles = opts.hostiles ?? [];
  const neighbors = opts.neighbors;
  const connections = opts.connections ?? (neighbors ? neighbors.length : 1);
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
    hostileCount: hostiles.length,
    connectionCount: connections,
    availableQuestCount: 0,
    credits: p.credits,
    canLiberate: opts.canLiberate,
  });

  return {
    scene,
    hasPlayer: true,
    player: p,
    system,
    currentPlanet: null,
    npcs: hostiles,
    hostiles,
    quests: opts.quests ?? [],
    legalActions,
    overmindHeldHere: opts.overmindHeldHere,
    overmindShare: opts.overmindShare,
    nearOvermindCore: opts.nearOvermindCore,
  };
}

function garrisonHostile(over: Partial<NpcSnapshot> = {}): NpcSnapshot {
  return {
    id: "overmind-1",
    name: "capture-fleet",
    faction: FactionType.SYNDICATE,
    hostile: true,
    hullHP: 500,
    ...over,
  };
}

describe("overmindFrontHopDistances (multi-source BFS toward the front)", () => {
  const systems = [
    { id: "A", connections: [{ toSystemId: "B" }] },
    { id: "B", connections: [{ toSystemId: "C" }] },
    { id: "C", connections: [{ toSystemId: "D" }] },
    { id: "D", connections: [] },
  ];

  it("held systems read 0, and distance grows outward over the UNDIRECTED graph", () => {
    const dist = overmindFrontHopDistances(systems, ["D"]);
    expect(dist.get("D")).toBe(0);
    expect(dist.get("C")).toBe(1);
    expect(dist.get("B")).toBe(2);
    expect(dist.get("A")).toBe(3);
  });

  it("multi-source: each system takes the distance to its NEAREST held seed", () => {
    const dist = overmindFrontHopDistances(systems, ["A", "D"]);
    expect(dist.get("A")).toBe(0);
    expect(dist.get("B")).toBe(1);
    expect(dist.get("C")).toBe(1);
    expect(dist.get("D")).toBe(0);
  });

  it("empty seed set yields an empty map (no front to route toward)", () => {
    expect(overmindFrontHopDistances(systems, []).size).toBe(0);
  });
});

describe("decideWithMemory — Overmind-slayer close-in (Task 3)", () => {
  it("battle-ready + in a held system + an over-HP'd garrison ⇒ STANDS AND FIGHTS (overrides flee-outmatched)", () => {
    const here = obs({
      overmindHeldHere: true,
      hostiles: [garrisonHostile()],
      player: {
        hullFraction: 0.9,
        hull: Math.floor(BATTLE_READY_MAX_HULL * 0.9),
      },
    });
    expect(isBattleReady(here)).toBe(true);

    const action = decideWithMemory(here, createMemory());

    expect(action.kind).toBe("attack");
    expect(action.reason).toContain("slayer-clear-garrison");
  });

  it("NOT battle-ready + in a held system + an over-HP'd garrison ⇒ still FLEES (no death regression)", () => {
    const here = obs({
      overmindHeldHere: true,
      hostiles: [garrisonHostile()],
      player: { maxHull: 140, hull: 140, weaponDamage: 14, hullFraction: 1 },
    });
    expect(isBattleReady(here)).toBe(false);

    const action = decideWithMemory(here, createMemory());

    expect(action.kind).toBe("flee");
    expect(action.reason).toContain("flee-outmatched");
    expect(action.reason).not.toContain("slayer");
  });

  it("battle-ready but genuinely hurt below the retreat floor ⇒ breaks off, survive block reclaims", () => {
    const hurt = SLAYER_RETREAT_HULL_FRACTION - 0.1; // below the floor
    const here = obs({
      overmindHeldHere: true,
      hostiles: [garrisonHostile()],
      player: {
        hullFraction: hurt,
        hull: Math.floor(BATTLE_READY_MAX_HULL * hurt),
      },
    });

    const action = decideWithMemory(here, createMemory());

    expect(action.reason).not.toContain("slayer-clear-garrison");
    expect(action.kind).toBe("flee");
  });

  it("a garrison-cleared held system ⇒ LIBERATE wins outright (downside-free step toward share 0)", () => {
    const here = obs({
      overmindHeldHere: true,
      hostiles: [], // garrison cleared
      canLiberate: true,
    });
    expect(here.legalActions).toContain("liberate");

    const action = decideWithMemory(here, createMemory());

    expect(action.kind).toBe("liberate");
    expect(action.reason).toContain("slayer-liberate");
  });

  it("liberate is ungated by battle-ready — even a starter ship frees a cleared system", () => {
    const here = obs({
      overmindHeldHere: true,
      hostiles: [],
      canLiberate: true,
      player: { maxHull: 140, hull: 140, weaponDamage: 14 },
    });
    expect(isBattleReady(here)).toBe(false);

    const action = decideWithMemory(here, createMemory());

    expect(action.kind).toBe("liberate");
  });
});

describe("decideWithMemory — Overmind-slayer advance (Task 3)", () => {
  it("battle-ready, no local fight, a reachable front ⇒ warps TOWARD the nearest held system", () => {
    const here = obs({
      neighbors: [
        {
          systemId: "far",
          visited: false,
          overmindHeld: false,
          hopsToOvermindFront: 3,
        },
        {
          systemId: "near",
          visited: false,
          overmindHeld: false,
          hopsToOvermindFront: 1,
        },
      ],
    });

    const action = decideWithMemory(here, createMemory());

    expect(action.kind).toBe("warp");
    expect(action.reason).toContain("slayer-advance");
    expect(action.targetId).toBe("near");
  });

  it("an Overmind-held neighbour is the front itself — it wins the frontward pick outright", () => {
    const here = obs({
      neighbors: [
        {
          systemId: "held",
          visited: false,
          overmindHeld: true,
          hopsToOvermindFront: 0,
        },
        {
          systemId: "near",
          visited: false,
          overmindHeld: false,
          hopsToOvermindFront: 1,
        },
      ],
    });

    const action = decideWithMemory(here, createMemory());

    expect(action.kind).toBe("warp");
    expect(action.reason).toContain("slayer-advance");
    expect(action.targetId).toBe("held");
  });

  it("no neighbour has a known route to the front ⇒ does NOT advance (falls to the ordinary ladder)", () => {
    const here = obs({
      neighbors: [
        { systemId: "B", visited: false, overmindHeld: false },
        { systemId: "C", visited: true, overmindHeld: false },
      ],
    });

    const action = decideWithMemory(here, createMemory());

    expect(action.reason).not.toContain("slayer-advance");
  });

  it("NOT battle-ready ⇒ never advances toward the front (avoidance behaviour preserved)", () => {
    const here = obs({
      neighbors: [
        {
          systemId: "near",
          visited: false,
          overmindHeld: false,
          hopsToOvermindFront: 1,
        },
      ],
      player: { maxHull: 140, hull: 140, weaponDamage: 14 },
    });

    const action = decideWithMemory(here, createMemory());

    expect(action.reason).not.toContain("slayer-advance");
  });
});

describe("decideWithMemory — survival tiers outrank the advance (Task 3)", () => {
  it("fuel-critical ⇒ refuels first rather than marching to the front on an empty tank", () => {
    const here = obs({
      neighbors: [
        {
          systemId: "near",
          visited: false,
          overmindHeld: false,
          hopsToOvermindFront: 1,
        },
      ],
      planets: [{ id: "P", name: "P", availableQuests: 0 }],
      player: { fuelFraction: REFUEL_THRESHOLD - 0.05 },
    });

    const action = decideWithMemory(here, createMemory());

    expect(action.kind).toBe("land");
    expect(action.reason).toContain("refuel-critical");
  });

  it("a present hostile between engagements ⇒ the survive block reacts before any advance", () => {
    const here = obs({
      neighbors: [
        {
          systemId: "near",
          visited: false,
          overmindHeld: false,
          hopsToOvermindFront: 1,
        },
      ],
      hostiles: [garrisonHostile()],
    });

    const action = decideWithMemory(here, createMemory());

    expect(action.reason).not.toContain("slayer-advance");
    expect(["attack", "flee"]).toContain(action.kind);
  });
});

describe("decideWithMemory — slayer-advance anti-ping-pong (Task 16b / F1)", () => {
  it("recentSystemIds (not just the single previous system) breaks a tied hop count toward the neighbour NOT recently visited", () => {
    const here = obs({
      neighbors: [
        {
          systemId: "B",
          visited: true,
          overmindHeld: false,
          hopsToOvermindFront: 2,
        },
        {
          systemId: "C",
          visited: true,
          overmindHeld: false,
          hopsToOvermindFront: 2,
        },
      ],
    });
    const mem = { ...createMemory(), recentSystemIds: ["B"] };

    const action = decideWithMemory(here, mem);

    expect(action.reason).toContain("slayer-advance");
    expect(action.targetId).toBe("C");
  });

  it("a 3-system hub cycle (sys_22↔14↔23, the live-session finding) never repeats the same pick twice in a row", () => {
    const here = obs({
      neighbors: [
        {
          systemId: "sys_22",
          visited: true,
          overmindHeld: false,
          hopsToOvermindFront: 2,
        },
        {
          systemId: "sys_23",
          visited: true,
          overmindHeld: false,
          hopsToOvermindFront: 2,
        },
      ],
    });
    const mem = { ...createMemory(), recentSystemIds: ["sys_23", "sys_22"] };

    const action = decideWithMemory(here, mem);

    expect(action.targetId).toBe("sys_22");
  });

  it("a front-cycle streak at the limit stands slayer-advance down (treats the front as unreachable this tick)", () => {
    const here = obs({
      neighbors: [
        {
          systemId: "near",
          visited: false,
          overmindHeld: false,
          hopsToOvermindFront: 1,
        },
      ],
      planets: [{ id: "P", name: "P", availableQuests: 0 }],
    });
    const mem = {
      ...createMemory(),
      frontCycleStreak: FRONT_CYCLE_STREAK_LIMIT,
    };

    const action = decideWithMemory(here, mem);

    expect(action.reason).not.toContain("slayer-advance");
  });

  it("a front-cycle streak below the limit still allows the advance", () => {
    const here = obs({
      neighbors: [
        {
          systemId: "near",
          visited: false,
          overmindHeld: false,
          hopsToOvermindFront: 1,
        },
      ],
    });
    const mem = {
      ...createMemory(),
      frontCycleStreak: FRONT_CYCLE_STREAK_LIMIT - 1,
    };

    const action = decideWithMemory(here, mem);

    expect(action.reason).toContain("slayer-advance");
  });

  it("does NOT preempt a loaded, ready-to-turn-in delivery for a multi-hop trek to the front", () => {
    const here = obs({
      neighbors: [
        {
          systemId: "near",
          visited: false,
          overmindHeld: false,
          hopsToOvermindFront: 3,
        },
      ],
      quests: [
        {
          id: "q1",
          title: "Delivery",
          type: QuestType.DELIVERY,
          targetSystemId: "elsewhere",
        },
      ],
    });

    const action = decideWithMemory(here, createMemory());

    expect(action.reason).not.toContain("slayer-advance");
  });

  it("STILL advances when the front is genuinely adjacent, even with a ready delivery elsewhere", () => {
    const here = obs({
      neighbors: [
        {
          systemId: "held",
          visited: true,
          overmindHeld: true,
          hopsToOvermindFront: 0,
        },
      ],
      quests: [
        {
          id: "q1",
          title: "Delivery",
          type: QuestType.DELIVERY,
          targetSystemId: "elsewhere",
        },
      ],
    });

    const action = decideWithMemory(here, createMemory());

    expect(action.reason).toContain("slayer-advance");
    expect(action.targetId).toBe("held");
  });
});
