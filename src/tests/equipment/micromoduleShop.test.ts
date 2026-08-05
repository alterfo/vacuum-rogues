import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import { MicroModuleSchema } from "@/validation/schemas";
import { BankBus } from "@/systems/banking/bus";
import { BankingService } from "@/systems/banking/BankingService";
import {
  setupPlayerBanking,
  GL_COUNTERPARTY,
  type BankAccess,
} from "@/systems/banking/economy";
import { BALANCE_EPSILON } from "@/domain/banking/Ledger";
import { PlayerService } from "@/core/services/PlayerService";
import { FactionType } from "@/types";
import type { Player } from "@/domain/Player";
import {
  MICRO_MODULES,
  HULL_MICRO_MODULES,
} from "@/systems/equipment/GearCatalog";
import {
  micromoduleShopCatalog,
  micromodulePrice,
  buyMicromodule,
  playerOwnsMicromodule,
  MICROMODULE_TIER_PRICE,
} from "@/systems/equipment/micromoduleShop";

interface Harness {
  bus: BankBus;
  service: BankingService;
  player: Player;
  access: BankAccess;
}

function makeHarness(startingMoney = 10000): Harness {
  const bus = new BankBus();
  const service = new BankingService(bus, { startDate: 1 });
  const player = new PlayerService().createPlayer({
    factionType: FactionType.OUTLANDERS,
    captainName: "Captain",
    startingMoney,
  });
  setupPlayerBanking(bus, service, player);
  return { bus, service, player, access: { bus, service } };
}

describe("micromodule shop — catalog", () => {
  it("stocks the full catalog: gear micromodules plus the hull family", () => {
    const catalog = micromoduleShopCatalog();
    for (const mm of MICRO_MODULES) {
      expect(catalog.some((c) => c.id === mm.id)).toBe(true);
    }
    for (const mm of HULL_MICRO_MODULES) {
      expect(catalog.some((c) => c.id === mm.id)).toBe(true);
    }
    expect(catalog.length).toBe(
      MICRO_MODULES.length + HULL_MICRO_MODULES.length,
    );
  });

  it("prices each micromodule by tier (tier 1 strongest → dearest)", () => {
    for (const mm of micromoduleShopCatalog()) {
      expect(micromodulePrice(mm)).toBe(MICROMODULE_TIER_PRICE[mm.bonusTier]);
      expect(micromodulePrice(mm)).toBeGreaterThan(0);
    }
    expect(MICROMODULE_TIER_PRICE[1]).toBeGreaterThan(
      MICROMODULE_TIER_PRICE[2],
    );
    expect(MICROMODULE_TIER_PRICE[2]).toBeGreaterThan(
      MICROMODULE_TIER_PRICE[3],
    );
  });
});

describe("micromodule shop — buying", () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness(10000);
  });

  it("adds the bought micromodule to the player's owned inventory", () => {
    const mm = MICRO_MODULES[3]; // a weapon module
    expect(playerOwnsMicromodule(h.player, mm.id)).toBe(false);

    const result = buyMicromodule(h.access, h.player, mm);

    expect(result.ok).toBe(true);
    expect(playerOwnsMicromodule(h.player, mm.id)).toBe(true);
    expect(h.player.inventory.micromodules.map((m) => m.id)).toContain(mm.id);
  });

  it("can buy a hull micromodule (the expanded catalog)", () => {
    const hull = HULL_MICRO_MODULES[0];
    const result = buyMicromodule(h.access, h.player, hull);
    expect(result.ok).toBe(true);
    expect(playerOwnsMicromodule(h.player, hull.id)).toBe(true);
  });

  it("a bought hull micromodule survives save validation (regression: HULL targetCategory)", () => {
    for (const hull of HULL_MICRO_MODULES) {
      const fresh = makeHarness(10000);
      const result = buyMicromodule(fresh.access, fresh.player, hull);
      expect(result.ok).toBe(true);
      const parsed = z
        .array(MicroModuleSchema)
        .safeParse(fresh.player.inventory.micromodules);
      expect(parsed.success).toBe(true);
    }
  });

  it("posts a balanced player→equipment transfer (credits drop by exactly the price)", () => {
    const mm = MICRO_MODULES[0]; // engine tier 1, price 3200
    const price = micromodulePrice(mm);
    const before = h.player.credits;

    buyMicromodule(h.access, h.player, mm);

    expect(h.player.credits).toBe(before - price);
    expect(h.service.balanceOf(GL_COUNTERPARTY.EQUIPMENT)).toBe(price);
    expect(Math.abs(h.service.getLedger().totalBalance())).toBeLessThanOrEqual(
      BALANCE_EPSILON,
    );
    expect(h.player.credits).toBe(
      h.service.balanceOf(h.player.currentAccountId),
    );
  });

  it("rejects an already-owned micromodule without moving money", () => {
    const mm = MICRO_MODULES[0];
    buyMicromodule(h.access, h.player, mm);
    const afterFirst = h.player.credits;
    const ownedCount = h.player.inventory.micromodules.length;

    const result = buyMicromodule(h.access, h.player, mm);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("already-owned");
    expect(h.player.credits).toBe(afterFirst);
    expect(h.player.inventory.micromodules.length).toBe(ownedCount);
  });

  it("rejects an unaffordable buy without moving money or inventory", () => {
    const poor = makeHarness(100); // far below any micromodule price
    const mm = MICRO_MODULES[0];

    const result = buyMicromodule(poor.access, poor.player, mm);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("insufficient-credits");
    expect(poor.player.credits).toBe(100);
    expect(poor.player.inventory.micromodules.length).toBe(0);
    expect(poor.service.balanceOf(GL_COUNTERPARTY.EQUIPMENT)).toBe(0);
  });

  it("stays balanced across several distinct buys", () => {
    const rich = makeHarness(20000);
    const buys = [
      MICRO_MODULES[0],
      MICRO_MODULES[3],
      HULL_MICRO_MODULES[0],
      HULL_MICRO_MODULES[3],
    ];
    let expectedSpent = 0;
    for (const mm of buys) {
      const result = buyMicromodule(rich.access, rich.player, mm);
      expect(result.ok).toBe(true);
      expectedSpent += micromodulePrice(mm);
      expect(
        Math.abs(rich.service.getLedger().totalBalance()),
      ).toBeLessThanOrEqual(BALANCE_EPSILON);
    }
    expect(rich.player.credits).toBe(20000 - expectedSpent);
    expect(rich.service.balanceOf(GL_COUNTERPARTY.EQUIPMENT)).toBe(
      expectedSpent,
    );
    expect(rich.player.inventory.micromodules.length).toBe(buys.length);
  });
});
