import { describe, it, expect, beforeEach } from "vitest";
import {
  AccountType,
  BALANCE_EPSILON,
  INTERNAL_ACCOUNTS,
} from "@/domain/banking/Ledger";
import {
  BankBus,
  type BankCommand,
  type BankEvent,
} from "@/systems/banking/bus";
import { BankingService } from "@/systems/banking/BankingService";
import { GameSystemException } from "@/exceptions/GameSystemException";

const PLAYER = "cur:player";
const NPC = "cur:npc";
const SAVINGS = "sav:player";
const LOAN = "loan:player";

interface Harness {
  bus: BankBus;
  service: BankingService;
  events: BankEvent[];
}

function makeHarness(startDate = 1): Harness {
  const bus = new BankBus();
  const service = new BankingService(bus, { startDate });
  const events: BankEvent[] = [];
  bus.subscribe((e) => events.push(e));

  bus.dispatch({
    kind: "OpenAccount",
    account: {
      id: PLAYER,
      type: AccountType.CURRENT,
      label: "Игрок",
      ownerId: "player",
    },
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
  return { bus, service, events };
}

function balanceChanges(events: BankEvent[], accountId: string): number[] {
  return events
    .filter(
      (e): e is Extract<BankEvent, { kind: "BalanceChanged" }> =>
        e.kind === "BalanceChanged" && e.accountId === accountId,
    )
    .map((e) => e.balance);
}

describe("BankingService — Transfer", () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });

  it("debits the from-account and credits the to-account (balanced)", () => {
    h.bus.dispatch({
      kind: "Transfer",
      fromAccountId: INTERNAL_ACCOUNTS.CASH,
      toAccountId: PLAYER,
      amount: 1000,
      reason: "Opening balance",
    });

    h.bus.dispatch({
      kind: "Transfer",
      fromAccountId: PLAYER,
      toAccountId: NPC,
      amount: 300,
      reason: "Paid NPC",
    });

    expect(h.service.balanceOf(PLAYER)).toBe(700);
    expect(h.service.balanceOf(NPC)).toBe(300);
    expect(Math.abs(h.service.getLedger().totalBalance())).toBeLessThanOrEqual(
      BALANCE_EPSILON,
    );
  });

  it("emits TransactionPosted + a BalanceChanged for each touched account", () => {
    h.events.length = 0;
    h.bus.dispatch({
      kind: "Transfer",
      fromAccountId: INTERNAL_ACCOUNTS.CASH,
      toAccountId: PLAYER,
      amount: 500,
      reason: "Reward",
    });

    const kinds = h.events.map((e) => e.kind);
    expect(kinds.filter((k) => k === "TransactionPosted")).toHaveLength(1);

    const playerChanges = h.events.filter(
      (e) => e.kind === "BalanceChanged" && e.accountId === PLAYER,
    );
    expect(playerChanges).toHaveLength(1);
    expect(playerChanges[0]).toMatchObject({ balance: 500, delta: 500 });

    const cashChanges = h.events.filter(
      (e) =>
        e.kind === "BalanceChanged" && e.accountId === INTERNAL_ACCOUNTS.CASH,
    );
    expect(cashChanges).toHaveLength(1);
    expect(cashChanges[0]).toMatchObject({ balance: -500, delta: -500 });
  });

  it("uses the service business date for booking when none is given", () => {
    h.bus.dispatch({
      kind: "Transfer",
      fromAccountId: INTERNAL_ACCOUNTS.CASH,
      toAccountId: PLAYER,
      amount: 100,
      reason: "Dated",
    });
    const posted = h.events.find((e) => e.kind === "TransactionPosted");
    expect(posted?.kind === "TransactionPosted" && posted.entry.date).toBe(1);
  });
});

describe("BankingService — PostTransaction", () => {
  it("posts an arbitrary balanced multi-leg entry", () => {
    const h = makeHarness();
    h.bus.dispatch({
      kind: "PostTransaction",
      reason: "Split posting",
      postings: [
        { accountId: PLAYER, amount: 200 },
        { accountId: NPC, amount: 50 },
        { accountId: INTERNAL_ACCOUNTS.CASH, amount: -250 },
      ],
    });
    expect(h.service.balanceOf(PLAYER)).toBe(200);
    expect(h.service.balanceOf(NPC)).toBe(50);
    expect(h.service.balanceOf(INTERNAL_ACCOUNTS.CASH)).toBe(-250);
    expect(Math.abs(h.service.getLedger().totalBalance())).toBeLessThanOrEqual(
      BALANCE_EPSILON,
    );
  });

  it("rejects an unbalanced PostTransaction (the core never books money from nowhere)", () => {
    const h = makeHarness();
    expect(() =>
      h.bus.dispatch({
        kind: "PostTransaction",
        reason: "Bad",
        postings: [
          { accountId: PLAYER, amount: 200 },
          { accountId: INTERNAL_ACCOUNTS.CASH, amount: -190 },
        ],
      }),
    ).toThrow();
  });
});

describe("BankingService — OpenAccount", () => {
  it("opens a new account on the ledger via a command", () => {
    const h = makeHarness();
    expect(h.service.getLedger().hasAccount(SAVINGS)).toBe(false);
    h.bus.dispatch({
      kind: "OpenAccount",
      account: {
        id: SAVINGS,
        type: AccountType.SAVINGS,
        label: "Сбережения",
        ownerId: "player",
      },
    });
    expect(h.service.getLedger().getAccount(SAVINGS)?.type).toBe(
      AccountType.SAVINGS,
    );
  });
});

describe("BankingService — AccrueInterest", () => {
  it("credits the account and debits the interest GL leg (balanced)", () => {
    const h = makeHarness();
    h.bus.dispatch({
      kind: "OpenAccount",
      account: {
        id: SAVINGS,
        type: AccountType.SAVINGS,
        label: "Сбережения",
        ownerId: "player",
      },
    });
    h.events.length = 0;

    h.bus.dispatch({
      kind: "AccrueInterest",
      accountId: SAVINGS,
      glAccountId: INTERNAL_ACCOUNTS.INTEREST_EXPENSE,
      amount: 12.5,
      reason: "Daily savings interest",
    });

    expect(h.service.balanceOf(SAVINGS)).toBeCloseTo(12.5, 6);
    expect(h.service.balanceOf(INTERNAL_ACCOUNTS.INTEREST_EXPENSE)).toBeCloseTo(
      -12.5,
      6,
    );
    expect(balanceChanges(h.events, SAVINGS)).toEqual([12.5]);
    expect(Math.abs(h.service.getLedger().totalBalance())).toBeLessThanOrEqual(
      BALANCE_EPSILON,
    );
  });
});

describe("BankingService — DisburseLoan", () => {
  it("puts the principal in the current account and the debt on the loan account", () => {
    const h = makeHarness();
    h.bus.dispatch({
      kind: "OpenAccount",
      account: {
        id: LOAN,
        type: AccountType.LOAN,
        label: "Кредит",
        ownerId: "player",
      },
    });

    h.bus.dispatch({
      kind: "DisburseLoan",
      loanAccountId: LOAN,
      toAccountId: PLAYER,
      amount: 5000,
      reason: "Hull loan",
    });

    expect(h.service.balanceOf(PLAYER)).toBe(5000);
    expect(h.service.balanceOf(LOAN)).toBe(-5000);
    expect(Math.abs(h.service.getLedger().totalBalance())).toBeLessThanOrEqual(
      BALANCE_EPSILON,
    );
  });
});

describe("BankingService — RunEndOfDay", () => {
  it("rolls the business date and cuts statements for customer accounts only", () => {
    const h = makeHarness(3);
    const cuts: BankEvent[] = [];
    h.bus.subscribe((e) => {
      if (e.kind === "StatementCut") cuts.push(e);
    });

    h.bus.dispatch({ kind: "RunEndOfDay" });

    expect(h.service.businessDate).toBe(4);
    expect(cuts).toHaveLength(1);
    const cut = cuts[0];
    expect(cut.kind === "StatementCut" && cut.date).toBe(3);
    if (cut.kind === "StatementCut") {
      expect(cut.accountIds).toContain(PLAYER);
      expect(cut.accountIds).toContain(NPC);
      expect(cut.accountIds).not.toContain(INTERNAL_ACCOUNTS.CASH);
    }
  });
});

describe("BankBus — fan-out & wiring", () => {
  it("delivers events to multiple subscribers", () => {
    const h = makeHarness();
    const a: BankEvent[] = [];
    const b: BankEvent[] = [];
    h.bus.subscribe((e) => a.push(e));
    h.bus.subscribe((e) => b.push(e));

    h.bus.dispatch({
      kind: "Transfer",
      fromAccountId: INTERNAL_ACCOUNTS.CASH,
      toAccountId: PLAYER,
      amount: 100,
      reason: "Fan-out",
    });

    expect(a.length).toBeGreaterThan(0);
    expect(a.map((e) => e.kind)).toEqual(b.map((e) => e.kind));
  });

  it("lets observers watch command traffic without handling it", () => {
    const h = makeHarness();
    const seen: BankCommand[] = [];
    const off = h.bus.observeCommands((c) => seen.push(c));

    h.bus.dispatch({
      kind: "Transfer",
      fromAccountId: INTERNAL_ACCOUNTS.CASH,
      toAccountId: PLAYER,
      amount: 10,
      reason: "Watched",
    });
    off();
    h.bus.dispatch({
      kind: "Transfer",
      fromAccountId: INTERNAL_ACCOUNTS.CASH,
      toAccountId: PLAYER,
      amount: 10,
      reason: "Unwatched",
    });

    expect(seen).toHaveLength(1);
    expect(seen[0].kind).toBe("Transfer");
  });

  it("unsubscribing stops further event delivery", () => {
    const h = makeHarness();
    const received: BankEvent[] = [];
    const off = h.bus.subscribe((e) => received.push(e));

    h.bus.dispatch({
      kind: "Transfer",
      fromAccountId: INTERNAL_ACCOUNTS.CASH,
      toAccountId: PLAYER,
      amount: 10,
      reason: "First",
    });
    const countAfterFirst = received.length;
    off();
    h.bus.dispatch({
      kind: "Transfer",
      fromAccountId: INTERNAL_ACCOUNTS.CASH,
      toAccountId: PLAYER,
      amount: 10,
      reason: "Second",
    });

    expect(received.length).toBe(countAfterFirst);
  });

  it("dispatching with no handler throws GameSystemException", () => {
    const bus = new BankBus();
    expect(() =>
      bus.dispatch({
        kind: "Transfer",
        fromAccountId: INTERNAL_ACCOUNTS.CASH,
        toAccountId: PLAYER,
        amount: 1,
        reason: "Orphan",
      }),
    ).toThrowError(GameSystemException);
  });

  it("rejects a second core registering on the same bus", () => {
    const bus = new BankBus();
    new BankingService(bus);
    expect(() => new BankingService(bus)).toThrowError(GameSystemException);
  });

  it("keeps the global Σ(postings)==0 invariant across a mixed command sequence", () => {
    const h = makeHarness();
    h.bus.dispatch({
      kind: "OpenAccount",
      account: {
        id: SAVINGS,
        type: AccountType.SAVINGS,
        label: "Сбережения",
        ownerId: "player",
      },
    });
    h.bus.dispatch({
      kind: "Transfer",
      fromAccountId: INTERNAL_ACCOUNTS.CASH,
      toAccountId: PLAYER,
      amount: 1000,
      reason: "Open",
    });
    h.bus.dispatch({
      kind: "Transfer",
      fromAccountId: PLAYER,
      toAccountId: SAVINGS,
      amount: 400,
      reason: "Save",
    });
    h.bus.dispatch({
      kind: "AccrueInterest",
      accountId: SAVINGS,
      glAccountId: INTERNAL_ACCOUNTS.INTEREST_EXPENSE,
      amount: 4,
      reason: "Interest",
    });
    h.bus.dispatch({
      kind: "PostTransaction",
      reason: "Fee",
      postings: [
        { accountId: PLAYER, amount: -25 },
        { accountId: INTERNAL_ACCOUNTS.PNL, amount: 25 },
      ],
    });

    expect(Math.abs(h.service.getLedger().totalBalance())).toBeLessThanOrEqual(
      BALANCE_EPSILON,
    );
    expect(h.service.balanceOf(PLAYER)).toBe(575);
    expect(h.service.balanceOf(SAVINGS)).toBe(404);
  });
});
