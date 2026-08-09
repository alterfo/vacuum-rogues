import { describe, it, expect, beforeEach } from "vitest";
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
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import {
  gearById,
  GearKind,
  type HullSpec,
} from "@/systems/equipment/GearCatalog";
import { applyLoadoutHullToShip } from "@/systems/equipment/GearBridge";
import {
  hullTradeInPrice,
  buyHullWithTradeIn,
  HULL_TRADE_IN_RATE,
} from "@/systems/equipment/sellHull";

function hull(id: string): HullSpec {
  const g = gearById(id);
  if (!g || g.kind !== GearKind.HULL) throw new Error(`not a hull: ${id}`);
  return g as HullSpec;
}

interface Harness {
  service: BankingService;
  player: Player;
  access: BankAccess;
  loadout: ShipLoadout;
}

function makeHarness(
  startingMoney = 20000,
  startHullId = "hull_scout",
): Harness {
  const bus = new BankBus();
  const service = new BankingService(bus, { startDate: 1 });
  const player = new PlayerService().createPlayer({
    factionType: FactionType.OUTLANDERS,
    captainName: "Captain",
    startingMoney,
  });
  setupPlayerBanking(bus, service, player);
  const loadout = new ShipLoadout(startHullId);
  applyLoadoutHullToShip(player.ship, loadout);
  return { service, player, access: { bus, service }, loadout };
}

describe("hull trade-in — price", () => {
  it("refunds a fraction (40 %) of the hull's base price, floored", () => {
    expect(HULL_TRADE_IN_RATE).toBe(0.4);
    expect(hullTradeInPrice(hull("hull_scout"))).toBe(480); // 1200 × 0.4
    expect(hullTradeInPrice(hull("hull_corvette"))).toBe(1200); // 3000 × 0.4
    expect(hullTradeInPrice(hull("hull_warden"))).toBe(2800); // 7000 × 0.4
    expect(hullTradeInPrice(hull("hull_bastion"))).toBe(4800); // 12000 × 0.4
  });

  it("is a whole credit (floored) so the projected balance never goes fractional", () => {
    for (const id of [
      "hull_scout",
      "hull_corvette",
      "hull_courier",
      "hull_warden",
      "hull_freighter",
      "hull_bastion",
    ]) {
      expect(Number.isInteger(hullTradeInPrice(hull(id)))).toBe(true);
    }
  });
});

describe("hull trade-in — buy a replacement", () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness(20000, "hull_scout");
  });

  it("nets price − tradeIn off the player's credits and installs the new hull", () => {
    const before = h.player.credits;
    const price = 4000; // listing price (catalog base + shop markup)
    const tradeIn = hullTradeInPrice(hull("hull_scout")); // 480

    const result = buyHullWithTradeIn(
      h.access,
      h.player,
      h.loadout,
      hull("hull_corvette"),
      price,
    );

    expect(result.tradeIn).toBe(tradeIn);
    expect(result.netCharge).toBe(tradeIn - price); // -(price - tradeIn)
    expect(h.player.credits).toBe(before - (price - tradeIn));
    expect(h.loadout.hull.id).toBe("hull_corvette");
  });

  it("posts balanced bus transfers; the equipment GL nets the upgrade cost", () => {
    const before = h.player.credits;
    const price = 4000;
    const tradeIn = hullTradeInPrice(hull("hull_scout"));

    buyHullWithTradeIn(
      h.access,
      h.player,
      h.loadout,
      hull("hull_corvette"),
      price,
    );

    expect(h.service.balanceOf(GL_COUNTERPARTY.EQUIPMENT)).toBe(
      price - tradeIn,
    );
    expect(Math.abs(h.service.getLedger().totalBalance())).toBeLessThanOrEqual(
      BALANCE_EPSILON,
    );
    expect(h.player.credits).toBe(before - (price - tradeIn));
    expect(h.player.credits).toBe(
      h.service.balanceOf(h.player.currentAccountId),
    );
  });

  it("projects the new hull onto the live ship (never leaves the player hull-less)", () => {
    buyHullWithTradeIn(
      h.access,
      h.player,
      h.loadout,
      hull("hull_warden"),
      8000,
    );

    expect(h.loadout.hull.id).toBe("hull_warden");
    expect(h.player.ship.hullClass).toBe(hull("hull_warden").hullClass);
    expect(h.player.ship.maxHull).toBe(h.loadout.derivedStats().maxHull);
  });

  it("re-bags gear that no longer fits a smaller replacement hull (lossless)", () => {
    const big = makeHarness(50000, "hull_bastion");
    for (let i = 0; i < 3; i++) big.loadout.install("wpn_pulse");
    const bagBefore = big.player.inventory.modules.length;

    const result = buyHullWithTradeIn(
      big.access,
      big.player,
      big.loadout,
      hull("hull_scout"),
      1500,
    );

    expect(result.dropped.length).toBeGreaterThan(0);
    expect(big.player.inventory.modules.length).toBeGreaterThan(bagBefore);
    expect(big.loadout.hull.id).toBe("hull_scout");
  });

  it("trades in nothing when re-installing the same hull (no spurious refund)", () => {
    const before = h.player.credits;
    const result = buyHullWithTradeIn(
      h.access,
      h.player,
      h.loadout,
      hull("hull_scout"), // same as the current hull
      1500,
    );

    expect(result.tradeIn).toBe(0);
    expect(h.player.credits).toBe(before - 1500); // full price, no refund
    expect(h.loadout.hull.id).toBe("hull_scout");
  });
});

describe("hull trade-in — wear (износ) scales the refund", () => {
  it("a full-HP hull keeps the flat 40% rate (backward compatible)", () => {
    const scout = hull("hull_scout");
    expect(hullTradeInPrice(scout, 1200, 1200)).toBe(480);
    expect(hullTradeInPrice(scout)).toBe(480);
  });

  it("a half-HP hull refunds about half of the full trade-in", () => {
    const scout = hull("hull_scout");
    expect(hullTradeInPrice(scout, 600, 1200)).toBe(240); // 480 * 0.5
  });

  it("a near-dead hull is floored at HULL_TRADE_IN_CONDITION_FLOOR, not zero", () => {
    const scout = hull("hull_scout");
    expect(hullTradeInPrice(scout, 1, 1200)).toBe(96); // 480 * 0.2 floor
    expect(hullTradeInPrice(scout, 0, 1200)).toBe(96);
  });

  it("buyHullWithTradeIn uses the ship's current HP for the refund", () => {
    const h = makeHarness(20000, "hull_scout");
    h.player.ship.hullHP = Math.round(h.player.ship.maxHull * 0.5);
    const before = h.player.credits;
    const price = 4000;
    const expectedTradeIn = hullTradeInPrice(
      hull("hull_scout"),
      h.player.ship.hullHP,
      h.player.ship.maxHull,
    );

    const result = buyHullWithTradeIn(
      h.access,
      h.player,
      h.loadout,
      hull("hull_corvette"),
      price,
    );

    expect(expectedTradeIn).toBeLessThan(480);
    expect(result.tradeIn).toBe(expectedTradeIn);
    expect(h.player.credits).toBe(before - (price - expectedTradeIn));
    expect(h.loadout.hull.id).toBe("hull_corvette");
  });
});
