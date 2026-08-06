import { describe, it, expect, beforeEach } from "vitest";
import {
  AccountType,
  BALANCE_EPSILON,
  INTERNAL_ACCOUNTS,
} from "@/domain/banking/Ledger";
import { BankBus } from "@/systems/banking/bus";
import { BankingService } from "@/systems/banking/BankingService";
import {
  currentAccountId,
  openPlayerCurrentAccount,
  setupPlayerBanking,
  transfer,
} from "@/systems/banking/economy";
import { deposit, openSavings, withdraw } from "@/systems/banking/products";
import { wholeCreditsToCurrent } from "@/presentation/bankSceneView";
import { PlayerSchema } from "@/validation/schemas";
import { PlayerService } from "@/core/services/PlayerService";
import { FactionType } from "@/types";
import type { Player } from "@/domain/Player";

const NPC = currentAccountId("npc1");

interface Harness {
  bus: BankBus;
  service: BankingService;
  player: Player;
}

function makeHarness(startingMoney = 1000): Harness {
  const bus = new BankBus();
  const service = new BankingService(bus, { startDate: 1 });
  const player = new PlayerService().createPlayer({
    factionType: FactionType.OUTLANDERS,
    captainName: "Captain",
    startingMoney,
  });
  bus.dispatch({
    kind: "OpenAccount",
    account: {
      id: NPC,
      type: AccountType.CURRENT,
      label: "НПС",
      ownerId: "npc1",
    },
  });
  setupPlayerBanking(bus, service, player);
  return { bus, service, player };
}

function glCredits(h: Harness): number {
  return h.service.balanceOf(h.player.currentAccountId);
}

describe("economy projection — currentAccountId", () => {
  it("derives the player's current-account id from their id", () => {
    const h = makeHarness();
    expect(h.player.currentAccountId).toBe("cur:player");
  });
});

describe("economy projection — opening balance", () => {
  it("seeds the current account so credits equals the GL balance", () => {
    const h = makeHarness(1000);
    expect(glCredits(h)).toBe(1000);
    expect(h.player.credits).toBe(1000);
  });

  it("keeps the books balanced after seeding", () => {
    const h = makeHarness(1000);
    expect(Math.abs(h.service.getLedger().totalBalance())).toBeLessThanOrEqual(
      BALANCE_EPSILON,
    );
    expect(h.service.balanceOf(INTERNAL_ACCOUNTS.CASH)).toBe(-1000);
  });

  it("does not seed when the player starts with zero credits", () => {
    const h = makeHarness(0);
    expect(h.player.credits).toBe(0);
    expect(glCredits(h)).toBe(0);
  });
});

describe("economy projection — transfers move credits by the signed delta", () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness(1000);
  });

  it("a debit out of the player reduces credits by exactly the amount", () => {
    const before = h.player.credits;
    transfer(h.bus, h.player.currentAccountId, NPC, 300, "Paid NPC");
    expect(h.player.credits).toBe(before - 300);
    expect(h.player.credits).toBe(glCredits(h));
  });

  it("a credit into the player raises credits by exactly the amount", () => {
    const before = h.player.credits;
    transfer(
      h.bus,
      INTERNAL_ACCOUNTS.CASH,
      h.player.currentAccountId,
      500,
      "Reward",
    );
    expect(h.player.credits).toBe(before + 500);
    expect(h.player.credits).toBe(glCredits(h));
  });

  it("ignores BalanceChanged for other accounts (NPC move leaves credits unchanged)", () => {
    transfer(h.bus, INTERNAL_ACCOUNTS.CASH, NPC, 200, "NPC funded");
    const before = h.player.credits;
    transfer(h.bus, NPC, INTERNAL_ACCOUNTS.CASH, 50, "NPC spent");
    expect(h.player.credits).toBe(before);
  });
});

describe("economy projection — stays in sync over N operations", () => {
  it("credits equals the GL balance after a long mixed sequence (books balanced throughout)", () => {
    const h = makeHarness(1000);
    const moves: Array<[from: string, to: string, amount: number]> = [
      [h.player.currentAccountId, NPC, 120],
      [INTERNAL_ACCOUNTS.CASH, h.player.currentAccountId, 75],
      [h.player.currentAccountId, INTERNAL_ACCOUNTS.CASH, 40],
      [INTERNAL_ACCOUNTS.CASH, h.player.currentAccountId, 500],
      [h.player.currentAccountId, NPC, 333],
      [NPC, h.player.currentAccountId, 10],
    ];
    for (const [from, to, amount] of moves) {
      transfer(h.bus, from, to, amount, "op");
      expect(h.player.credits).toBe(glCredits(h));
      expect(
        Math.abs(h.service.getLedger().totalBalance()),
      ).toBeLessThanOrEqual(BALANCE_EPSILON);
    }
    expect(h.player.credits).toBe(1092);
  });
});

describe("economy projection — re-seeding on reload is idempotent", () => {
  it("re-opening the current account does not double-seed credits (old-save migration safety)", () => {
    const h = makeHarness(1000);
    expect(h.player.credits).toBe(1000);
    expect(h.service.balanceOf(INTERNAL_ACCOUNTS.CASH)).toBe(-1000);

    openPlayerCurrentAccount(h.bus, h.service, h.player);

    expect(h.player.credits).toBe(1000);
    expect(glCredits(h)).toBe(1000);
    expect(h.service.balanceOf(INTERNAL_ACCOUNTS.CASH)).toBe(-1000);
    expect(Math.abs(h.service.getLedger().totalBalance())).toBeLessThanOrEqual(
      BALANCE_EPSILON,
    );
  });
});

describe("economy projection — interest never leaves credits fractional (save-safe)", () => {
  it("compounded EOD interest stays whole-credit end-to-end, and a full withdrawal keeps credits integral", () => {
    const h = makeHarness(5000);
    const sav = openSavings(h.bus, h.service, h.player.id);
    deposit(h.bus, h.player.currentAccountId, sav, 3000);
    for (let day = 1; day <= 5; day++) {
      h.bus.dispatch({ kind: "RunEndOfDay", date: day });
    }
    const savBal = h.service.balanceOf(sav);
    expect(Number.isInteger(savBal)).toBe(true);
    expect(savBal).toBeGreaterThan(3000);

    const amount = wholeCreditsToCurrent(savBal);
    expect(amount).toBe(savBal);
    withdraw(h.bus, sav, h.player.currentAccountId, amount);

    expect(Number.isInteger(h.player.credits)).toBe(true);
    expect(h.player.credits).toBe(glCredits(h));
    expect(PlayerSchema.shape.credits.safeParse(h.player.credits).success).toBe(
      true,
    );
    expect(Math.abs(h.service.getLedger().totalBalance())).toBeLessThanOrEqual(
      BALANCE_EPSILON,
    );
  });
});

describe("economy projection — reads stay unaffected", () => {
  it("credits is a plain readable number usable in affordability checks", () => {
    const h = makeHarness(1000);
    const price = 250;
    expect(h.player.credits >= price).toBe(true);
    transfer(h.bus, h.player.currentAccountId, NPC, 900, "Big buy");
    expect(h.player.credits >= price).toBe(false);
  });
});
