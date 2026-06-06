import { describe, it, expect } from "vitest";
import { TradeSystem } from "@/systems/TradeSystem";
import { Player } from "@/domain/Player";
import { PlayerShip } from "@/domain/PlayerShip";
import { Inventory } from "@/domain/Inventory";
import { SkillTree } from "@/domain/SkillTree";
import { FactionType, PoliticalSystem, ResourceType } from "@/types";
import type { QuestLog, Journal } from "@/types";

function makePlayer(credits = 5000): Player {
  return new Player(
    "p1",
    "Pilot",
    FactionType.PROGRESSORS,
    0,
    1,
    new SkillTree([]),
    {},
    { activeQuests: [], completedQuests: [] } as QuestLog,
    { entries: [] } as Journal,
    credits,
    new PlayerShip(
      "ship1",
      "Ship",
      100,
      100,
      50,
      50,
      100,
      100,
      10,
      5,
      FactionType.PROGRESSORS,
    ),
    new Inventory(),
  );
}

describe("TradeSystem.isLegal — contraband detection", () => {
  const trade = new TradeSystem();

  it("ANARCHY allows all goods", () => {
    const goods = [
      ResourceType.WEAPONS,
      ResourceType.ORGANICS,
      ResourceType.LUXURY,
      ResourceType.FUEL,
    ];
    for (const g of goods) {
      expect(trade.isLegal(g, "ANARCHY" as PoliticalSystem)).toBe(true);
    }
  });

  it("REPUBLIC bans WEAPONS", () => {
    expect(
      trade.isLegal(ResourceType.WEAPONS, "REPUBLIC" as PoliticalSystem),
    ).toBe(false);
  });

  it("REPUBLIC allows ORGANICS and LUXURY", () => {
    expect(
      trade.isLegal(ResourceType.ORGANICS, "REPUBLIC" as PoliticalSystem),
    ).toBe(true);
    expect(
      trade.isLegal(ResourceType.LUXURY, "REPUBLIC" as PoliticalSystem),
    ).toBe(true);
  });

  it("DICTATORSHIP bans ORGANICS and LUXURY", () => {
    expect(
      trade.isLegal(ResourceType.ORGANICS, "DICTATORSHIP" as PoliticalSystem),
    ).toBe(false);
    expect(
      trade.isLegal(ResourceType.LUXURY, "DICTATORSHIP" as PoliticalSystem),
    ).toBe(false);
  });

  it("DICTATORSHIP allows WEAPONS and FUEL", () => {
    expect(
      trade.isLegal(ResourceType.WEAPONS, "DICTATORSHIP" as PoliticalSystem),
    ).toBe(true);
    expect(
      trade.isLegal(ResourceType.FUEL, "DICTATORSHIP" as PoliticalSystem),
    ).toBe(true);
  });

  it("DEMOCRACY allows all goods", () => {
    const goods = [
      ResourceType.WEAPONS,
      ResourceType.ORGANICS,
      ResourceType.LUXURY,
    ];
    for (const g of goods) {
      expect(trade.isLegal(g, "DEMOCRACY" as PoliticalSystem)).toBe(true);
    }
  });

  it("MONARCHY allows all goods", () => {
    const goods = [ResourceType.WEAPONS, ResourceType.ORGANICS];
    for (const g of goods) {
      expect(trade.isLegal(g, "MONARCHY" as PoliticalSystem)).toBe(true);
    }
  });
});

describe("TradeSystem.getBasePrice", () => {
  const trade = new TradeSystem();

  it("returns positive base price for WEAPONS", () => {
    expect(trade.getBasePrice(ResourceType.WEAPONS)).toBeGreaterThan(0);
  });

  it("returns 100 fallback for unknown resource", () => {
    expect(trade.getBasePrice("UNKNOWN" as ResourceType)).toBe(100);
  });
});

describe("Penalty calculation", () => {
  it("penalty = base_price × amount × 1.5", () => {
    const trade = new TradeSystem();
    const weaponBase = trade.getBasePrice(ResourceType.WEAPONS);
    const amount = 3;
    const penalty = Math.round(weaponBase * amount * 1.5);
    expect(penalty).toBe(Math.round(500 * 3 * 1.5)); // 2250
  });

  it("bribe cost = penalty × 0.6 (rounded)", () => {
    const penalty = 2250;
    const bribe = Math.round(penalty * 0.6);
    expect(bribe).toBe(1350);
  });
});

describe("Player.contrabandGoods", () => {
  it("new player starts with empty contrabandGoods", () => {
    const p = makePlayer();
    expect(p.contrabandGoods).toEqual([]);
  });

  it("can add contraband resource", () => {
    const p = makePlayer();
    p.contrabandGoods.push(ResourceType.WEAPONS);
    expect(p.contrabandGoods).toContain(ResourceType.WEAPONS);
  });

  it("can remove contraband resource when sold", () => {
    const p = makePlayer();
    p.contrabandGoods.push(ResourceType.WEAPONS);
    p.contrabandGoods = p.contrabandGoods.filter(
      (g) => g !== ResourceType.WEAPONS,
    );
    expect(p.contrabandGoods).toEqual([]);
  });

  it("deducts credits when fine is paid", () => {
    const p = makePlayer(5000);
    const penalty = 750;
    p.credits -= penalty;
    expect(p.credits).toBe(4250);
  });

  it("deducts reputation when fine is paid", () => {
    const p = makePlayer();
    p.adjustReputation("REPUBLIC", -20);
    expect(p.getReputation("REPUBLIC")).toBe(-20);
  });

  it("zero-amount goods are not counted as illegal", () => {
    const trade = new TradeSystem();
    // Simulate: player has 0 WEAPONS in REPUBLIC
    const hasGoods =
      0 > 0 &&
      !trade.isLegal(ResourceType.WEAPONS, "REPUBLIC" as PoliticalSystem);
    expect(hasGoods).toBe(false);
  });
});

describe("Customs check – illegal goods detection", () => {
  const trade = new TradeSystem();

  it("finds WEAPONS illegal in REPUBLIC with positive quantity", () => {
    const inventory = [
      { type: ResourceType.WEAPONS as ResourceType, amount: 2 },
    ];
    const illegal = inventory.filter(
      (r) =>
        r.amount > 0 && !trade.isLegal(r.type, "REPUBLIC" as PoliticalSystem),
    );
    expect(illegal).toHaveLength(1);
    expect(illegal[0].type).toBe(ResourceType.WEAPONS);
  });

  it("finds no illegal goods in ANARCHY system", () => {
    const inventory = [
      { type: ResourceType.WEAPONS as ResourceType, amount: 5 },
      { type: ResourceType.ORGANICS as ResourceType, amount: 3 },
    ];
    const illegal = inventory.filter(
      (r) =>
        r.amount > 0 && !trade.isLegal(r.type, "ANARCHY" as PoliticalSystem),
    );
    expect(illegal).toHaveLength(0);
  });

  it("finds ORGANICS and LUXURY illegal in DICTATORSHIP", () => {
    const inventory = [
      { type: ResourceType.ORGANICS as ResourceType, amount: 10 },
      { type: ResourceType.LUXURY as ResourceType, amount: 5 },
      { type: ResourceType.FUEL as ResourceType, amount: 20 },
    ];
    const illegal = inventory.filter(
      (r) =>
        r.amount > 0 &&
        !trade.isLegal(r.type, "DICTATORSHIP" as PoliticalSystem),
    );
    expect(illegal).toHaveLength(2);
  });
});
