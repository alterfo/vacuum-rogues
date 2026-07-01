import { describe, it, expect } from "vitest";
import { SceneType, ResourceType, FactionType, StationType } from "@/types";
import {
  legalActionsForScene,
  type Observation,
  type PlayerSnapshot,
  type SystemSnapshot,
  type CurrentPlanetSnapshot,
  type NpcSnapshot,
  type QuestSnapshot,
} from "./observe";
import {
  createMemory,
  detectDeadlock,
  DEADLOCK_HULL_FRACTION,
  DEADLOCK_MIN_CREDITS,
  type AgentMemory,
} from "./AgentMemory";
import { decideWithMemory } from "./MemoryHeuristicPolicy";
import type { ScenarioGoal } from "./goalBias";

/**
 * Task 4 of the letsplay expansion plan: the CJM (Customer Journey Map)
 * teacher behaviors added to `MemoryHeuristicPolicy` plus the deadlock
 * detector. Each CJM is a self-contained goal-specific bias reachable through
 * the public `decideWithMemory(obs, mem, goal)` entry point (the branches
 * themselves are private), exercised here over hand-built fixtures — mirroring
 * `MemoryHeuristicPolicy.test.ts`'s pattern for the goal-less core.
 */

const M = ResourceType.METALS;

function playerFixture(over: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
  return {
    credits: 1000,
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

function hostile(
  id = "raider-1",
  faction: FactionType = FactionType.SYNDICATE,
  hullHP = 80,
): NpcSnapshot {
  return { id, name: id, faction, hostile: true, hullHP };
}

interface ObsOpts {
  scene?: SceneType;
  player?: Partial<PlayerSnapshot>;
  planets?: { id: string; name: string; availableQuests: number }[];
  stations?: { id: string; name: string; type: StationType }[];
  connections?: number;
  currentPlanet?: CurrentPlanetSnapshot | null;
  hostiles?: NpcSnapshot[];
  quests?: QuestSnapshot[];
  hasCraftCenter?: boolean;
  activeLoans?: boolean;
  overmindShare?: number;
  nearOvermindCore?: boolean;
  questDeliveryHere?: boolean;
  cheapestGearPrice?: number | null;
  bestHullPrice?: number | null;
}

/**
 * Build a self-consistent observation whose `legalActions` come from the same
 * pure `legalActionsForScene` the real `observe()` uses, including the Task 2
 * shop/loan/sell-cargo legality context.
 */
function obs(opts: ObsOpts = {}): Observation {
  const scene = opts.scene ?? SceneType.SPACE_FLIGHT;
  const planets = opts.planets ?? [];
  const stations = opts.stations ?? [];
  const connections = opts.connections ?? 0;
  const hostiles = opts.hostiles ?? [];
  const currentPlanet = opts.currentPlanet ?? null;
  const player = playerFixture(opts.player);
  const hasCraftCenter = opts.hasCraftCenter ?? false;
  const activeLoans = opts.activeLoans ?? false;
  const cheapestGearPrice = opts.cheapestGearPrice ?? null;
  const bestHullPrice = opts.bestHullPrice ?? null;

  const system: SystemSnapshot = {
    id: "sysA",
    name: "A",
    planets,
    stations,
    connections,
  };

  const availableQuestCount =
    currentPlanet?.availableQuests ??
    planets.reduce((max, p) => Math.max(max, p.availableQuests), 0);

  const legalActions = legalActionsForScene(scene, {
    hasPlayer: true,
    planetCount: planets.length,
    stationCount: stations.length,
    hostileCount: hostiles.length,
    connectionCount: connections,
    availableQuestCount,
    credits: player.credits,
    cargoUsed: player.cargoUsed,
    hasCraftCenter,
    activeLoans,
    cheapestGearPrice,
    bestHullPrice,
  });

  return {
    scene,
    hasPlayer: true,
    player,
    system,
    currentPlanet,
    npcs: hostiles,
    hostiles,
    quests: opts.quests ?? [],
    legalActions,
    warpInTransit: false,
    hasCraftCenter,
    activeLoans,
    overmindShare: opts.overmindShare ?? 0,
    nearOvermindCore: opts.nearOvermindCore ?? false,
    questDeliveryHere: opts.questDeliveryHere ?? false,
    cheapestGearPrice,
    bestHullPrice,
  };
}

const rec = (buy: number, sell: number) => ({ buy, sell, seenAt: 1 });

describe("detectDeadlock", () => {
  const deadlockMem = (): AgentMemory => {
    const mem = createMemory();
    mem.loanState = { balance: 500, missedPayments: 1 };
    return mem;
  };

  it("true for the compound worst-case state", () => {
    const here = obs({
      player: {
        hullFraction: DEADLOCK_HULL_FRACTION,
        credits: DEADLOCK_MIN_CREDITS - 1,
      },
      hostiles: [hostile()],
    });
    expect(detectDeadlock(here, deadlockMem())).toBe(true);
  });

  it("false when the hull is above the floor", () => {
    const here = obs({
      player: { hullFraction: 0.5, credits: DEADLOCK_MIN_CREDITS - 1 },
      hostiles: [hostile()],
    });
    expect(detectDeadlock(here, deadlockMem())).toBe(false);
  });

  it("false when credits are not critically low", () => {
    const here = obs({
      player: { hullFraction: DEADLOCK_HULL_FRACTION, credits: 5000 },
      hostiles: [hostile()],
    });
    expect(detectDeadlock(here, deadlockMem())).toBe(false);
  });

  it("false with no hostile present", () => {
    const here = obs({
      player: {
        hullFraction: DEADLOCK_HULL_FRACTION,
        credits: DEADLOCK_MIN_CREDITS - 1,
      },
    });
    expect(detectDeadlock(here, deadlockMem())).toBe(false);
  });

  it("false with no outstanding loan", () => {
    const here = obs({
      player: {
        hullFraction: DEADLOCK_HULL_FRACTION,
        credits: DEADLOCK_MIN_CREDITS - 1,
      },
      hostiles: [hostile()],
    });
    expect(detectDeadlock(here, createMemory())).toBe(false);
  });

  it("false when a quest is still a fallback option", () => {
    const here = obs({
      player: {
        hullFraction: DEADLOCK_HULL_FRACTION,
        credits: DEADLOCK_MIN_CREDITS - 1,
      },
      hostiles: [hostile()],
      quests: [
        {
          id: "q1",
          title: "q1",
          type: "DELIVERY" as QuestSnapshot["type"],
          targetSystemId: null,
        },
      ],
    });
    expect(detectDeadlock(here, deadlockMem())).toBe(false);
  });

  it("decideWithMemory forces wait when deadlocked, overriding any goal", () => {
    const here = obs({
      player: {
        hullFraction: DEADLOCK_HULL_FRACTION,
        credits: DEADLOCK_MIN_CREDITS - 1,
      },
      hostiles: [hostile()],
    });
    for (const goal of [undefined, "bounty-hunter", "pirate"] as (
      | ScenarioGoal
      | undefined
    )[]) {
      const action = decideWithMemory(here, deadlockMem(), goal);
      expect(action).toEqual({ kind: "wait", reason: "mem:deadlock" });
    }
  });
});

describe("CJM-A trade-magnate", () => {
  it("repays an outstanding loan immediately when credits are on hand", () => {
    const mem = createMemory();
    mem.loanState = { balance: 2000, missedPayments: 0 };
    const here = obs({ scene: SceneType.STATION, activeLoans: true });
    const action = decideWithMemory(here, mem, "trade-magnate");
    expect(action.kind).toBe("repay-loan");
  });

  it("borrows to fund a bulk buy when the known margin clearly justifies it", () => {
    const mem = createMemory();
    mem.priceBook.set("A", new Map([[M, rec(10, 5)]]));
    mem.priceBook.set("B", new Map([[M, rec(2000, 2000)]])); // huge margin
    const here = obs({
      scene: SceneType.STATION,
      player: { cargoCapacity: 20 },
    });
    const action = decideWithMemory(here, mem, "trade-magnate");
    expect(action.kind).toBe("take-loan");
  });

  it("does not borrow when the known margin fails the loan-cost threshold", () => {
    const mem = createMemory();
    mem.priceBook.set("A", new Map([[M, rec(100, 90)]]));
    mem.priceBook.set("B", new Map([[M, rec(105, 95)]])); // tiny/negative margin
    const here = obs({
      scene: SceneType.STATION,
      player: { cargoCapacity: 20 },
    });
    const action = decideWithMemory(here, mem, "trade-magnate");
    expect(action.kind).not.toBe("take-loan");
    expect(action.reason).not.toContain("loan-for-margin");
  });
});

describe("CJM-B gear-grinder", () => {
  it("routes to a hull upgrade once credits clear the buffer", () => {
    const here = obs({
      scene: SceneType.EQUIPMENT_SHOP,
      player: { credits: 12000 },
      bestHullPrice: 10000,
      cheapestGearPrice: 500,
    });
    const action = decideWithMemory(here, createMemory(), "gear-grinder");
    expect(action.kind).toBe("upgrade-hull");
  });

  it("buys gear when it can't yet afford the hull buffer", () => {
    const here = obs({
      scene: SceneType.EQUIPMENT_SHOP,
      player: { credits: 700 },
      bestHullPrice: 10000,
      cheapestGearPrice: 500,
    });
    const action = decideWithMemory(here, createMemory(), "gear-grinder");
    expect(action.kind).toBe("buy-gear");
  });

  it("buys a micromodule at a craft center when nothing bigger is affordable", () => {
    const here = obs({
      scene: SceneType.STATION,
      player: { credits: 900 },
      hasCraftCenter: true,
    });
    const action = decideWithMemory(here, createMemory(), "gear-grinder");
    expect(action.kind).toBe("buy-module");
  });

  it("defers to accumulating credits when nothing is affordable yet", () => {
    const here = obs({
      scene: SceneType.EQUIPMENT_SHOP,
      player: { credits: 100 },
      bestHullPrice: 10000,
      cheapestGearPrice: 5000,
    });
    const action = decideWithMemory(here, createMemory(), "gear-grinder");
    expect(action.kind).not.toBe("upgrade-hull");
    expect(action.kind).not.toBe("buy-gear");
  });
});

describe("CJM-C bounty-hunter", () => {
  it("engages a present hostile while healthy", () => {
    const here = obs({
      hostiles: [hostile("rx")],
      player: { hullFraction: 0.9 },
    });
    const action = decideWithMemory(here, createMemory(), "bounty-hunter");
    expect(action.kind).toBe("attack");
    expect(action.targetId).toBe("rx");
  });

  it("disengages to repair in the 30-50% hull band", () => {
    const here = obs({
      hostiles: [hostile("rx")],
      player: { hullFraction: 0.4 },
    });
    const action = decideWithMemory(here, createMemory(), "bounty-hunter");
    expect(action.kind).toBe("flee");
  });

  it("defers to the base survive branch below the retreat floor", () => {
    const here = obs({
      hostiles: [hostile("rx")],
      player: { hullFraction: 0.2 },
    });
    const action = decideWithMemory(here, createMemory(), "bounty-hunter");
    expect(action.kind).toBe("flee");
    expect(action.reason).toContain("flee-low-hull");
  });

  it("sells looted cargo when no hostiles remain", () => {
    const here = obs({ scene: SceneType.TRADE, player: { cargoUsed: 5 } });
    const action = decideWithMemory(here, createMemory(), "bounty-hunter");
    expect(action.kind).toBe("sell-cargo");
  });

  it("hunts the most dangerous remembered system when nothing local to fight", () => {
    const mem = createMemory();
    mem.threatMap.set("sysC", 5);
    const here = obs({ connections: 2 });
    const action = decideWithMemory(here, mem, "bounty-hunter");
    expect(action.kind).toBe("warp");
    expect(action.reason).toContain("hunt-danger");
  });
});

describe("CJM-D quest-runner", () => {
  it("always takes an offered contract first", () => {
    const here = obs({
      scene: SceneType.PLANET,
      currentPlanet: { id: "p1", name: "p1", availableQuests: 2, market: [] },
    });
    const action = decideWithMemory(here, createMemory(), "quest-runner");
    expect(action.kind).toBe("take-quest");
  });

  it("routes toward a carried quest's delivery system when not already there", () => {
    const here = obs({
      connections: 2,
      quests: [
        {
          id: "q1",
          title: "q1",
          type: "DELIVERY" as QuestSnapshot["type"],
          targetSystemId: "sysB",
        },
      ],
    });
    const action = decideWithMemory(here, createMemory(), "quest-runner");
    expect(action.kind).toBe("warp");
    expect(action.reason).toContain("deliver");
  });

  it("defers at the delivery system itself so the base policy can land/dock", () => {
    const here = obs({
      connections: 2,
      planets: [{ id: "p1", name: "p1", availableQuests: 0 }],
      quests: [
        {
          id: "q1",
          title: "q1",
          type: "DELIVERY" as QuestSnapshot["type"],
          targetSystemId: "sysA",
        },
      ],
      questDeliveryHere: true,
    });
    const action = decideWithMemory(here, createMemory(), "quest-runner");
    expect(action.kind).not.toBe("warp");
  });
});

describe("CJM-E overmind-slayer", () => {
  it("retreats when hurt near the core", () => {
    const here = obs({
      hostiles: [hostile("core-drone")],
      player: { hullFraction: 0.3 },
      nearOvermindCore: true,
    });
    const action = decideWithMemory(here, createMemory(), "overmind-slayer");
    expect(action.kind).toBe("flee");
  });

  it("assaults a hostile at/adjacent to the core while battle-ready", () => {
    const here = obs({
      hostiles: [hostile("core-drone")],
      player: { hullFraction: 0.9 },
      nearOvermindCore: true,
    });
    const action = decideWithMemory(here, createMemory(), "overmind-slayer");
    expect(action.kind).toBe("attack");
    expect(action.targetId).toBe("core-drone");
  });

  it("advances toward a spreading Overmind once its share is meaningful", () => {
    const here = obs({ connections: 2, overmindShare: 0.3 });
    const action = decideWithMemory(here, createMemory(), "overmind-slayer");
    expect(action.kind).toBe("warp");
    expect(action.reason).toContain("advance");
  });

  it("does not push forward while the Overmind share is negligible", () => {
    const here = obs({ connections: 2, overmindShare: 0.02 });
    const action = decideWithMemory(here, createMemory(), "overmind-slayer");
    expect(action.reason).not.toContain("advance");
  });
});

describe("CJM-F pirate", () => {
  it("flees a lawful (bank-faction) hostile rather than raiding it", () => {
    const here = obs({
      hostiles: [hostile("patrol-1", FactionType.BASTIONS)],
      player: { hullFraction: 0.9 },
    });
    const action = decideWithMemory(here, createMemory(), "pirate");
    expect(action.kind).toBe("flee");
    expect(action.targetId).toBe("patrol-1");
  });

  it("raids a non-lawful hostile while healthy", () => {
    const here = obs({
      hostiles: [hostile("trader-1", FactionType.OUTLANDERS)],
      player: { hullFraction: 0.9 },
    });
    const action = decideWithMemory(here, createMemory(), "pirate");
    expect(action.kind).toBe("attack");
    expect(action.targetId).toBe("trader-1");
  });

  it("fences loot at the market once clear of hostiles", () => {
    const here = obs({ scene: SceneType.TRADE, player: { cargoUsed: 3 } });
    const action = decideWithMemory(here, createMemory(), "pirate");
    expect(action.kind).toBe("sell-cargo");
  });
});

describe("CJM-G explorer", () => {
  it("lands to earn first when credits run low", () => {
    const here = obs({
      connections: 2,
      planets: [{ id: "p1", name: "p1", availableQuests: 1 }],
      player: { credits: 50 },
    });
    const action = decideWithMemory(here, createMemory(), "explorer");
    expect(action.kind).toBe("land");
    expect(action.targetId).toBe("p1");
  });

  it("keeps roaming while solvent", () => {
    const here = obs({ connections: 2, player: { credits: 5000 } });
    const action = decideWithMemory(here, createMemory(), "explorer");
    expect(action.kind).toBe("warp");
  });
});

describe("CJM battery — never illegal, never throws", () => {
  const NEW_GOALS: ScenarioGoal[] = [
    "trade-magnate",
    "gear-grinder",
    "bounty-hunter",
    "quest-runner",
    "overmind-slayer",
    "pirate",
    "explorer",
  ];

  const STATES: Observation[] = [
    obs(),
    obs({ connections: 3 }),
    obs({
      scene: SceneType.PLANET,
      currentPlanet: { id: "p1", name: "p1", availableQuests: 2, market: [] },
    }),
    obs({
      scene: SceneType.STATION,
      hasCraftCenter: true,
      player: { credits: 900 },
    }),
    obs({
      scene: SceneType.EQUIPMENT_SHOP,
      player: { credits: 12000 },
      bestHullPrice: 10000,
      cheapestGearPrice: 500,
    }),
    obs({ scene: SceneType.BANK, activeLoans: true }),
    obs({ scene: SceneType.TRADE, player: { cargoUsed: 5 } }),
    obs({ scene: SceneType.STAR_MAP, connections: 4 }),
    obs({ hostiles: [hostile()], player: { hullFraction: 0.2 } }),
    obs({
      hostiles: [hostile("core", FactionType.BASTIONS)],
      nearOvermindCore: true,
      overmindShare: 0.5,
      player: { hullFraction: 0.9 },
    }),
    obs({ scene: SceneType.WIN_SCREEN }),
    obs({ scene: SceneType.DIALOGUE }),
  ];

  it("every goal returns a legal action across representative states", () => {
    for (const goal of NEW_GOALS) {
      for (const state of STATES) {
        const mem = createMemory();
        mem.threatMap.set("sysC", 5);
        const action = decideWithMemory(state, mem, goal);
        expect(state.legalActions).toContain(action.kind);
      }
    }
  });

  it("is deterministic per goal — same (obs, memory, goal) ⇒ same action", () => {
    const state = obs({ connections: 2 });
    for (const goal of NEW_GOALS) {
      const mem = createMemory();
      expect(decideWithMemory(state, mem, goal)).toEqual(
        decideWithMemory(state, mem, goal),
      );
    }
  });
});
