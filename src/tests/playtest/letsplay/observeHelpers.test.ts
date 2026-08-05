import { describe, it, expect } from "vitest";
import { StationType } from "@/types";
import { AccountType, INTERNAL_ACCOUNTS } from "@/domain/banking/Ledger";
import { BankBus } from "@/systems/banking/bus";
import { BankingService } from "@/systems/banking/BankingService";
import { takeLoan, repayLoan } from "@/systems/banking/products";
import {
  hasStationOfType,
  hasBankAccess,
  isNearOvermindCore,
  overmindShareOf,
  isQuestDeliveryHere,
  loanStatusOf,
  systemShopPrices,
} from "./observeHelpers";

describe("hasStationOfType", () => {
  it("true when a station of the given type is present", () => {
    expect(
      hasStationOfType(
        [{ type: StationType.CRAFT_CENTER }, { type: StationType.TRADE_POST }],
        StationType.CRAFT_CENTER,
      ),
    ).toBe(true);
  });

  it("false when no station matches, or the list is empty", () => {
    expect(
      hasStationOfType(
        [{ type: StationType.TRADE_POST }],
        StationType.CRAFT_CENTER,
      ),
    ).toBe(false);
    expect(hasStationOfType([], StationType.CRAFT_CENTER)).toBe(false);
  });
});

describe("hasBankAccess", () => {
  it("always true when landed on a planet, regardless of stations", () => {
    expect(hasBankAccess(true, [])).toBe(true);
    expect(hasBankAccess(true, [{ type: StationType.CRAFT_CENTER }])).toBe(
      true,
    );
  });

  it("off-planet: true only via a TRADE_POST or MILITARY_BASE station", () => {
    expect(hasBankAccess(false, [{ type: StationType.TRADE_POST }])).toBe(true);
    expect(hasBankAccess(false, [{ type: StationType.MILITARY_BASE }])).toBe(
      true,
    );
    expect(hasBankAccess(false, [{ type: StationType.CRAFT_CENTER }])).toBe(
      false,
    );
    expect(hasBankAccess(false, [{ type: StationType.REPAIR_DOCK }])).toBe(
      false,
    );
    expect(hasBankAccess(false, [])).toBe(false);
  });
});

describe("isNearOvermindCore", () => {
  const core = "sys-core";

  it("true when the system IS the core", () => {
    expect(isNearOvermindCore({ id: core, connections: [] }, core)).toBe(true);
  });

  it("true when the system has a direct warp connection to the core", () => {
    expect(
      isNearOvermindCore(
        { id: "sys-a", connections: [{ toSystemId: core }] },
        core,
      ),
    ).toBe(true);
  });

  it("false when neither the system nor its connections touch the core", () => {
    expect(
      isNearOvermindCore(
        { id: "sys-a", connections: [{ toSystemId: "sys-b" }] },
        core,
      ),
    ).toBe(false);
  });

  it("false for a null system or an empty core id", () => {
    expect(isNearOvermindCore(null, core)).toBe(false);
    expect(isNearOvermindCore({ id: "sys-a", connections: [] }, "")).toBe(
      false,
    );
  });
});

describe("overmindShareOf", () => {
  it("computes the captured fraction", () => {
    expect(overmindShareOf(0, 10)).toBe(0);
    expect(overmindShareOf(5, 10)).toBe(0.5);
    expect(overmindShareOf(10, 10)).toBe(1);
  });

  it("is 0 for an empty/degenerate galaxy (no divide-by-zero)", () => {
    expect(overmindShareOf(0, 0)).toBe(0);
  });
});

describe("isQuestDeliveryHere", () => {
  it("true when a carried quest's target system matches", () => {
    expect(
      isQuestDeliveryHere(
        [{ targetSystemId: "sys-a" }, { targetSystemId: "sys-b" }],
        "sys-b",
      ),
    ).toBe(true);
  });

  it("false when no quest targets the current system (including null targets)", () => {
    expect(
      isQuestDeliveryHere(
        [{ targetSystemId: "sys-a" }, { targetSystemId: null }],
        "sys-c",
      ),
    ).toBe(false);
    expect(isQuestDeliveryHere([], "sys-c")).toBe(false);
  });
});

describe("loanStatusOf", () => {
  function makeBank(currentSeed = 0) {
    const bus = new BankBus();
    const service = new BankingService(bus, {
      startDate: 1,
      loanDailyRate: 0.02,
    });
    bus.dispatch({
      kind: "OpenAccount",
      account: {
        id: "cur:player",
        type: AccountType.CURRENT,
        label: "Игрок",
        ownerId: "player",
      },
    });
    if (currentSeed > 0) {
      bus.dispatch({
        kind: "Transfer",
        fromAccountId: INTERNAL_ACCOUNTS.CASH,
        toAccountId: "cur:player",
        amount: currentSeed,
        reason: "Seed",
      });
    }
    return { bus, service };
  }

  it("inactive when the player has no loan account at all", () => {
    const { service } = makeBank();
    expect(loanStatusOf(service, "player")).toEqual({
      active: false,
      balance: 0,
      missedPayments: 0,
    });
  });

  it("active with the outstanding balance once a loan is taken", () => {
    const { bus, service } = makeBank();
    takeLoan(bus, service, "player", "cur:player", {
      principal: 1000,
      dailyRate: 0.02,
      periods: 5,
    });
    const status = loanStatusOf(service, "player");
    expect(status.active).toBe(true);
    expect(status.balance).toBe(1000);
    expect(status.missedPayments).toBe(0);
  });

  it("inactive again once the loan is fully repaid", () => {
    const { bus, service } = makeBank(2000);
    const grant = takeLoan(bus, service, "player", "cur:player", {
      principal: 1000,
      dailyRate: 0,
      periods: 1,
    });
    repayLoan(bus, "cur:player", grant.loanAccountId, 1000);
    expect(loanStatusOf(service, "player")).toEqual({
      active: false,
      balance: 0,
      missedPayments: 0,
    });
  });
});

describe("systemShopPrices", () => {
  it("prices a single-planet system deterministically (matches generateShop directly)", () => {
    const ctx = {
      seed: "seed1",
      day: 0,
      system: {
        id: "sys1",
        techLevel: 8,
        planets: [{ id: "planetA" }],
        stations: [],
      },
    };
    const result = systemShopPrices(ctx);
    expect(result.cheapestGearPrice).toBe(604);
    expect(result.bestHullPrice).toBe(1235);
    expect(systemShopPrices(ctx)).toEqual(result);
  });

  it("station-only systems price gear but never a hull (hull trade-in is planet-only)", () => {
    const result = systemShopPrices({
      seed: "seed1",
      day: 0,
      system: {
        id: "sys1",
        techLevel: 8,
        planets: [],
        stations: [{ id: "stationA" }],
      },
    });
    expect(result.cheapestGearPrice).toBe(643);
    expect(result.bestHullPrice).toBeNull();
  });

  it("both null for a system with no planets and no stations", () => {
    const result = systemShopPrices({
      seed: "seed1",
      day: 0,
      system: { id: "sys1", techLevel: 8, planets: [], stations: [] },
    });
    expect(result.cheapestGearPrice).toBeNull();
    expect(result.bestHullPrice).toBeNull();
  });
});
