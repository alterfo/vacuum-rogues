import { describe, it, expect, beforeEach } from "vitest";
import {
  AccountType,
  BALANCE_EPSILON,
  INTERNAL_ACCOUNTS,
} from "@/domain/banking/Ledger";
import { BankBus, type BankEvent } from "@/systems/banking/bus";
import { BankingService } from "@/systems/banking/BankingService";

const PLAYER = "cur:player";
const SAVINGS = "sav:player";
const LOAN = "loan:player";

const SAVINGS_RATE = 0.01; // 1 %/day
const LOAN_RATE = 0.02; // 2 %/day

interface Harness {
  bus: BankBus;
  service: BankingService;
  events: BankEvent[];
}

function makeHarness(startDate = 1): Harness {
  const bus = new BankBus();
  const service = new BankingService(bus, {
    startDate,
    savingsDailyRate: SAVINGS_RATE,
    loanDailyRate: LOAN_RATE,
  });
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
  return { bus, service, events };
}

function openSavings(bus: BankBus): void {
  bus.dispatch({
    kind: "OpenAccount",
    account: {
      id: SAVINGS,
      type: AccountType.SAVINGS,
      label: "Вклад",
      ownerId: "player",
    },
  });
}

function openLoan(bus: BankBus): void {
  bus.dispatch({
    kind: "OpenAccount",
    account: {
      id: LOAN,
      type: AccountType.LOAN,
      label: "Кредит",
      ownerId: "player",
    },
  });
}

function fund(bus: BankBus, accountId: string, amount: number): void {
  bus.dispatch({
    kind: "Transfer",
    fromAccountId: INTERNAL_ACCOUNTS.CASH,
    toAccountId: accountId,
    amount,
    reason: "Seed",
  });
}

function statementCuts(
  events: BankEvent[],
): Extract<BankEvent, { kind: "StatementCut" }>[] {
  return events.filter(
    (e): e is Extract<BankEvent, { kind: "StatementCut" }> =>
      e.kind === "StatementCut",
  );
}

function balanced(service: BankingService): boolean {
  return Math.abs(service.getLedger().totalBalance()) <= BALANCE_EPSILON;
}

describe("EOD — savings interest accrual", () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
    openSavings(h.bus);
    fund(h.bus, SAVINGS, 1000);
  });

  it("credits balance × daily rate to savings and debits the interest-expense GL leg", () => {
    h.bus.dispatch({ kind: "RunEndOfDay" });

    expect(h.service.balanceOf(SAVINGS)).toBeCloseTo(1010, 6);
    expect(h.service.balanceOf(INTERNAL_ACCOUNTS.INTEREST_EXPENSE)).toBeCloseTo(
      -10,
      6,
    );
    expect(balanced(h.service)).toBe(true);
  });

  it("compounds across successive days in whole credits (10.1 rounds to 10)", () => {
    h.bus.dispatch({ kind: "RunEndOfDay" }); // day 1 → 1000 → 1010
    h.bus.dispatch({ kind: "RunEndOfDay" }); // day 2 → 1010 → 1020 (10.1 → 10)

    expect(h.service.balanceOf(SAVINGS)).toBe(1020);
    expect(Number.isInteger(h.service.balanceOf(SAVINGS))).toBe(true);
    expect(balanced(h.service)).toBe(true);
  });
});

describe("EOD — interest stays whole-credit (fractional-loan regression)", () => {
  it("a small odd loan balance never drifts into fractions (282 @ default 0.2%/day)", () => {
    const bus = new BankBus();
    const service = new BankingService(bus, { startDate: 1 });
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
        id: LOAN,
        type: AccountType.LOAN,
        label: "Кредит",
        ownerId: "player",
      },
    });
    bus.dispatch({
      kind: "DisburseLoan",
      loanAccountId: LOAN,
      toAccountId: PLAYER,
      amount: 282,
      reason: "Small loan",
    });

    for (let d = 0; d < 60; d++) bus.dispatch({ kind: "RunEndOfDay" });

    const balance = service.balanceOf(LOAN);
    expect(Number.isInteger(balance)).toBe(true);
    expect(balance).toBeLessThan(0);
  });

  it("a loan too small for a whole-credit day of interest stays flat, never fractional", () => {
    const bus = new BankBus();
    const service = new BankingService(bus, { startDate: 1 });
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
        id: LOAN,
        type: AccountType.LOAN,
        label: "Кредит",
        ownerId: "player",
      },
    });
    bus.dispatch({
      kind: "DisburseLoan",
      loanAccountId: LOAN,
      toAccountId: PLAYER,
      amount: 100,
      reason: "Tiny loan",
    });

    for (let d = 0; d < 10; d++) bus.dispatch({ kind: "RunEndOfDay" });

    expect(Number.isInteger(service.balanceOf(LOAN))).toBe(true);
  });
});

describe("EOD — loan interest accrual", () => {
  it("grows the outstanding debt and books interest income (balanced)", () => {
    const h = makeHarness();
    openLoan(h.bus);
    h.bus.dispatch({
      kind: "DisburseLoan",
      loanAccountId: LOAN,
      toAccountId: PLAYER,
      amount: 5000,
      reason: "Hull loan",
    });

    h.bus.dispatch({ kind: "RunEndOfDay" });

    expect(h.service.balanceOf(LOAN)).toBeCloseTo(-5100, 6);
    expect(h.service.balanceOf(INTERNAL_ACCOUNTS.INTEREST_INCOME)).toBeCloseTo(
      100,
      6,
    );
    expect(balanced(h.service)).toBe(true);
  });
});

describe("EOD — interest accrual flows on the bus (teaching panel visibility)", () => {
  it("dispatches each accrual as an observable AccrueInterest command", () => {
    const h = makeHarness();
    openSavings(h.bus);
    openLoan(h.bus);
    fund(h.bus, SAVINGS, 1000);
    h.bus.dispatch({
      kind: "DisburseLoan",
      loanAccountId: LOAN,
      toAccountId: PLAYER,
      amount: 5000,
      reason: "Loan",
    });

    const accruals: string[] = [];
    h.bus.observeCommands((c) => {
      if (c.kind === "AccrueInterest") accruals.push(c.accountId);
    });

    h.bus.dispatch({ kind: "RunEndOfDay" });

    expect(accruals).toContain(SAVINGS);
    expect(accruals).toContain(LOAN);
    expect(accruals).toHaveLength(2);
  });
});

describe("EOD — scope", () => {
  it("never accrues interest on a plain current account", () => {
    const h = makeHarness();
    fund(h.bus, PLAYER, 1000);

    h.bus.dispatch({ kind: "RunEndOfDay" });

    expect(h.service.balanceOf(PLAYER)).toBe(1000);
  });

  it("books no entry when there is nothing to accrue (empty interest skipped)", () => {
    const h = makeHarness();
    openSavings(h.bus); // zero balance
    const before = h.service.getLedger().listEntries().length;

    h.bus.dispatch({ kind: "RunEndOfDay" });

    expect(h.service.getLedger().listEntries().length).toBe(before);
  });

  it("keeps Σ(all postings)==0 after a mixed-account EOD", () => {
    const h = makeHarness();
    openSavings(h.bus);
    openLoan(h.bus);
    fund(h.bus, SAVINGS, 1000);
    h.bus.dispatch({
      kind: "DisburseLoan",
      loanAccountId: LOAN,
      toAccountId: PLAYER,
      amount: 5000,
      reason: "Loan",
    });

    h.bus.dispatch({ kind: "RunEndOfDay" });

    expect(balanced(h.service)).toBe(true);
  });
});

describe("EOD — business date roll + statement", () => {
  it("rolls the business date and cuts a statement for customer accounts only", () => {
    const h = makeHarness(1);
    openSavings(h.bus);
    h.events.length = 0;

    h.bus.dispatch({ kind: "RunEndOfDay" });

    expect(h.service.businessDate).toBe(2);
    const cuts = statementCuts(h.events);
    expect(cuts).toHaveLength(1);
    expect(cuts[0].date).toBe(1);
    expect(cuts[0].accountIds).toContain(PLAYER);
    expect(cuts[0].accountIds).toContain(SAVINGS);
    expect(cuts[0].accountIds).not.toContain(INTERNAL_ACCOUNTS.CASH);
  });
});

describe("EOD — idempotency per business date", () => {
  it("re-closing the same date is a no-op (no double interest, no second statement, no extra roll)", () => {
    const h = makeHarness(1);
    openSavings(h.bus);
    fund(h.bus, SAVINGS, 1000);
    h.events.length = 0;

    h.bus.dispatch({ kind: "RunEndOfDay", date: 1 });
    const afterFirst = h.service.balanceOf(SAVINGS);
    h.bus.dispatch({ kind: "RunEndOfDay", date: 1 });

    expect(afterFirst).toBeCloseTo(1010, 6);
    expect(h.service.balanceOf(SAVINGS)).toBeCloseTo(1010, 6); // unchanged
    expect(h.service.businessDate).toBe(2); // rolled once, not twice
    expect(statementCuts(h.events)).toHaveLength(1); // one statement only
    expect(balanced(h.service)).toBe(true);
  });

  it("skips a business date earlier than the last one closed", () => {
    const h = makeHarness(1);
    openSavings(h.bus);
    fund(h.bus, SAVINGS, 1000);

    h.bus.dispatch({ kind: "RunEndOfDay" }); // closes day 1 → date 2
    h.bus.dispatch({ kind: "RunEndOfDay" }); // closes day 2 → date 3
    const balance = h.service.balanceOf(SAVINGS);

    h.bus.dispatch({ kind: "RunEndOfDay", date: 1 }); // already closed → no-op

    expect(h.service.businessDate).toBe(3);
    expect(h.service.balanceOf(SAVINGS)).toBeCloseTo(balance, 6);
  });
});
