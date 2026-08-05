import { describe, it, expect } from "vitest";
import { SceneType, ResourceType, QuestType } from "@/types";
import { createMemory, type PriceRecord } from "./AgentMemory";
import type {
  Observation,
  PlayerSnapshot,
  SystemSnapshot,
  QuestSnapshot,
} from "./observe";
import { MEMORY_FEATURE_LENGTH } from "./memoryFeatures";
import {
  featurize,
  FEATURE_LENGTH,
  OBS_FEATURE_LENGTH,
  CAMPAIGN_FEATURE_LENGTH,
} from "./NeuralPolicy";

function playerFixture(over: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
  return {
    credits: 5000,
    hull: 300,
    maxHull: 300,
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

function systemFixture(over: Partial<SystemSnapshot> = {}): SystemSnapshot {
  return {
    id: "sysA",
    name: "A",
    planets: [],
    stations: [],
    connections: 2,
    ...over,
  };
}

function obs(over: Partial<Observation> = {}): Observation {
  return {
    scene: SceneType.SPACE_FLIGHT,
    hasPlayer: true,
    player: playerFixture(),
    system: systemFixture(),
    currentPlanet: null,
    npcs: [],
    hostiles: [],
    quests: [],
    legalActions: ["move", "wait"],
    ...over,
  };
}

const rec = (buy: number, sell: number): PriceRecord => ({
  buy,
  sell,
  seenAt: 1,
});

describe("featurize — campaign Task 10 vector (54 = 30 obs + 20 memory + 4 campaign)", () => {
  it("is 54-wide, split 30/20/4", () => {
    expect(OBS_FEATURE_LENGTH).toBe(30);
    expect(MEMORY_FEATURE_LENGTH).toBe(20);
    expect(CAMPAIGN_FEATURE_LENGTH).toBe(4);
    expect(FEATURE_LENGTH).toBe(54);
    expect(featurize(obs())).toHaveLength(54);
  });

  it("every slot stays in [0,1] and finite across an extreme/edge mock state", () => {
    const quests: QuestSnapshot[] = [
      {
        id: "q1",
        title: "Q1",
        type: QuestType.DELIVERY,
        targetSystemId: "sysA",
      },
      {
        id: "q2",
        title: "Q2",
        type: QuestType.DELIVERY,
        targetSystemId: "sysB",
      },
    ];
    const o = obs({
      scene: SceneType.BANK,
      player: playerFixture({
        credits: 999_999_999,
        reputationBastions: 100,
        reputationSyndicate: -100,
      }),
      quests,
      hasBank: true,
      hasCraftCenter: true,
      activeLoans: true,
      loanBalance: 999_999_999,
      loanMissedPayments: 999,
      questDeliveryHere: true,
      overmindShare: 1,
      nearOvermindCore: true,
      cheapestGearPrice: 999_999_999,
      bestHullPrice: 999_999_999,
      questsCompleted: 999_999,
      warpInTransit: true,
      gameDay: 500,
    });

    const mem = createMemory();
    mem.priceBook.set(
      "p1",
      new Map([[ResourceType.METALS, rec(100, 999_999_999)]]),
    );
    mem.inventoryLots = [{ good: ResourceType.METALS, qty: 999, buyPrice: 1 }];
    mem.threatMap.set("sysA", 999);
    mem.loanState = { balance: 999_999_999, missedPayments: 999 };
    mem.deadlockDetected = true;
    mem.visitedSystemIds = new Set(
      Array.from({ length: 500 }, (_, i) => `sys${i}`),
    );
    mem.activeQuestDelivery = [
      { questId: "q1", targetSystemId: "sysA" },
      { questId: "q2", targetSystemId: "sysB" },
    ];
    mem.daysWithoutCreditGain = 9999;
    mem.overmindDaysSeen = 9999;
    mem.lastReputationBastions = 100;
    mem.lastReputationSyndicate = -100;
    mem.lastMaxHull = 999_999;

    const v = featurize(o, mem);
    expect(v).toHaveLength(FEATURE_LENGTH);
    for (const x of v) {
      expect(Number.isFinite(x)).toBe(true);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
    }
  });

  it("encodes the Task-5 scene one-hot block (indices 12-20) correctly", () => {
    const sceneIdx: [SceneType, number][] = [
      [SceneType.SPACE_FLIGHT, 12],
      [SceneType.PLANET, 13],
      [SceneType.STAR_MAP, 14],
      [SceneType.STATION, 15],
      [SceneType.EQUIPMENT_SHOP, 16],
      [SceneType.BANK, 17],
      [SceneType.TRADE, 18],
      [SceneType.TEXT_QUEST, 19],
      [SceneType.GAME_OVER, 20],
    ];
    for (const [scene, idx] of sceneIdx) {
      const v = featurize(obs({ scene }));
      for (const [, otherIdx] of sceneIdx) {
        expect(v[otherIdx]).toBe(otherIdx === idx ? 1 : 0);
      }
    }
  });

  it("encodes the bank/equipment/Overmind/quest-delivery block (indices 22-29)", () => {
    const v = featurize(
      obs({
        hasCraftCenter: true,
        hasBank: true,
        activeLoans: true,
        questDeliveryHere: true,
        overmindShare: 0.4,
        nearOvermindCore: true,
        cheapestGearPrice: 5_000,
        questsCompleted: 10,
      }),
    );
    expect(v[22]).toBe(1); // hasCraftCenter
    expect(v[23]).toBe(1); // hasBank
    expect(v[24]).toBe(1); // activeLoans
    expect(v[25]).toBe(1); // questDeliveryHere
    expect(v[26]).toBeCloseTo(0.4); // overmindShare
    expect(v[27]).toBe(1); // nearOvermindCore
    expect(v[28]).toBeCloseTo(0.5); // cheapestGearPrice / 10_000
    expect(v[29]).toBe(0.5); // questsCompleted / 20

    const off = featurize(obs());
    expect(off[22]).toBe(0);
    expect(off[23]).toBe(0);
    expect(off[24]).toBe(0);
    expect(off[25]).toBe(0);
    expect(off[26]).toBe(0);
    expect(off[27]).toBe(0);
    expect(off[28]).toBe(0); // no shop known ⇒ 0
    expect(off[29]).toBe(0);
  });

  it("encodes the new belief-block signals (indices 37-49) from AgentMemory", () => {
    const mem = createMemory();
    mem.loanState = { balance: 50_000, missedPayments: 2 };
    mem.deadlockDetected = true;
    mem.visitedSystemIds = new Set(["s1", "s2", "s3"]); // 3/30
    mem.threatMap.set("sysX", 4); // worst known threat
    mem.priceBook.set("p1", new Map([[ResourceType.METALS, rec(50, 200)]]));
    mem.inventoryLots = [{ good: ResourceType.METALS, qty: 10, buyPrice: 50 }];
    mem.daysWithoutCreditGain = 15; // 15/30
    mem.lastReputationBastions = 50; // 50/100
    mem.lastReputationSyndicate = -20; // negative ⇒ clamps to 0
    mem.overmindDaysSeen = 25; // 25/100
    mem.lastMaxHull = 300; // 300/600

    const quests: QuestSnapshot[] = [
      {
        id: "q1",
        title: "Q1",
        type: QuestType.DELIVERY,
        targetSystemId: "sysA",
      },
    ];
    mem.activeQuestDelivery = [{ questId: "q1", targetSystemId: "sysA" }];

    const o = obs({ quests });
    const v = featurize(o, mem);

    expect(v[37]).toBeCloseTo(50_000 / 100_000); // loanBalanceFraction
    expect(v[38]).toBeCloseTo(2 / 5); // debtPressure
    expect(v[39]).toBe(1); // deadlockDetected
    expect(v[40]).toBeCloseTo(3 / 30); // visitedSystemFraction
    expect(v[41]).toBe(1); // questDeliveryProgress (1 of 1 quest has a known delivery)
    expect(v[42]).toBeCloseTo(4 / 8); // nearestThreat
    expect(v[43]).toBeCloseTo((200 * 10) / 50_000); // cargoValue (sell-at-best-known-price × qty)
    expect(v[44]).toBeCloseTo(15 / 30); // daysWithoutProgress
    expect(v[45]).toBeCloseTo(0.5); // repRangerFraction
    expect(v[46]).toBe(0); // repPirateFraction — negative reputation clamps to 0
    expect(v[47]).toBeCloseTo(0.25); // overmindDaysPressure
    expect(v[48]).toBeCloseTo(0.5); // equipQuality
    expect(v[49]).toBe(0); // reserved
  });

  it("degrades every memory-block feature to 0 with a fresh notebook, even with a rich obs", () => {
    const v = featurize(obs(), createMemory());
    for (
      let i = OBS_FEATURE_LENGTH;
      i < OBS_FEATURE_LENGTH + MEMORY_FEATURE_LENGTH;
      i++
    ) {
      expect(v[i]).toBe(0);
    }
  });

  it("encodes the campaign block (indices 50-53) from the Task-10 obs signals", () => {
    const on = featurize(
      obs({
        playerPowerIndex: 0.6,
        battleReady: true,
        hopsToOvermindFront: 2,
        armUpCost: 5_000,
      }),
    );
    expect(on[50]).toBeCloseTo(0.6); // playerPowerIndex (already ∈ [0,1])
    expect(on[51]).toBe(1); // battleReady
    expect(on[52]).toBeCloseTo(2 / 10); // hops-to-front / 10
    expect(on[53]).toBeCloseTo(0.5); // armUpCost / 10_000

    const atFront = featurize(obs({ hopsToOvermindFront: 0 }));
    expect(atFront[52]).toBe(0);
    const off = featurize(obs());
    expect(off[50]).toBe(0); // playerPowerIndex absent ⇒ 0
    expect(off[51]).toBe(0); // battleReady absent ⇒ 0
    expect(off[52]).toBe(1); // hops absent ⇒ maximally far
    expect(off[53]).toBe(0); // armUpCost absent ⇒ 0
  });
});
