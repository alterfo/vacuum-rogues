import { describe, it, expect } from "vitest";
import {
  AccountType,
  BALANCE_EPSILON,
  INTERNAL_ACCOUNTS,
} from "@/domain/banking/Ledger";
import { BankBus, type BankEvent } from "@/systems/banking/bus";
import { BankingService } from "@/systems/banking/BankingService";
import { LOAN_DEFAULT_THRESHOLD } from "@/systems/banking/loanDefault";

const PLAYER = "cur:player";
const LOAN = "loan:player";
const LOAN_RATE = 0.02; // 2 %/day base
const PENALTY_RATE = 0.03; // 2 % × 1.5 penalty multiplier

interface Harness {
  bus: BankBus;
  service: BankingService;
  events: BankEvent[];
}

function makeHarness(): Harness {
  const bus = new BankBus();
  const service = new BankingService(bus, {
    startDate: 1,
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
  bus.dispatch({
    kind: "OpenAccount",
    account: {
      id: LOAN,
      type: AccountType.LOAN,
      label: "Кредит",
      ownerId: "player",
    },
  });
  return { bus, service, events };
}

function disburse(h: Harness, principal: number): void {
  h.bus.dispatch({
    kind: "DisburseLoan",
    loanAccountId: LOAN,
    toAccountId: PLAYER,
    amount: principal,
    reason: "Кредит",
  });
}

function spend(h: Harness, amount: number): void {
  h.bus.dispatch({
    kind: "Transfer",
    fromAccountId: PLAYER,
    toAccountId: INTERNAL_ACCOUNTS.CASH,
    amount,
    reason: "Траты",
  });
}

function fund(h: Harness, amount: number): void {
  h.bus.dispatch({
    kind: "Transfer",
    fromAccountId: INTERNAL_ACCOUNTS.CASH,
    toAccountId: PLAYER,
    amount,
    reason: "Доход",
  });
}

function eod(h: Harness): void {
  h.bus.dispatch({ kind: "RunEndOfDay" });
}

function balanced(service: BankingService): boolean {
  return Math.abs(service.getLedger().totalBalance()) <= BALANCE_EPSILON;
}

function defaults(
  events: BankEvent[],
): Extract<BankEvent, { kind: "LoanDefaulted" }>[] {
  return events.filter(
    (e): e is Extract<BankEvent, { kind: "LoanDefaulted" }> =>
      e.kind === "LoanDefaulted",
  );
}

describe("EOD loan default — penalty accrual", () => {
  it("accrues at the base rate before the loan is overdue, then at the penalty rate once a due is missed", () => {
    const h = makeHarness();
    disburse(h, 5000);
    spend(h, 5000); // the player spent the loan: no funds left to service it

    eod(h);
    expect(h.service.balanceOf(LOAN)).toBeCloseTo(-5100, 6); // −5000 × 1.02
    expect(balanced(h.service)).toBe(true);

    eod(h);
    expect(h.service.balanceOf(LOAN)).toBeCloseTo(
      -5100 * (1 + PENALTY_RATE),
      6,
    );
    expect(h.service.balanceOf(LOAN)).not.toBeCloseTo(
      -5100 * (1 + LOAN_RATE),
      6,
    );
    expect(balanced(h.service)).toBe(true);
  });
});

describe("EOD loan default — default event (reputation trigger)", () => {
  it("publishes LoanDefaulted exactly once, on the threshold-th consecutive miss", () => {
    const h = makeHarness();
    disburse(h, 5000);
    spend(h, 5000);

    eod(h); // day 1: not yet due → no miss
    expect(defaults(h.events)).toHaveLength(0);

    for (let i = 0; i < LOAN_DEFAULT_THRESHOLD; i++) {
      expect(defaults(h.events)).toHaveLength(0);
      eod(h);
    }

    const def = defaults(h.events);
    expect(def).toHaveLength(1);
    expect(def[0].ownerId).toBe("player");
    expect(def[0].loanAccountId).toBe(LOAN);
    expect(def[0].missedPayments).toBe(LOAN_DEFAULT_THRESHOLD);
    expect(def[0].outstanding).toBeGreaterThan(0);
    expect(balanced(h.service)).toBe(true);
  });

  it("does not re-publish LoanDefaulted on further overdue days while already defaulted", () => {
    const h = makeHarness();
    disburse(h, 5000);
    spend(h, 5000);
    for (let i = 0; i <= LOAN_DEFAULT_THRESHOLD + 3; i++) eod(h);
    expect(defaults(h.events)).toHaveLength(1); // one default event, not one per day
    expect(balanced(h.service)).toBe(true);
  });
});

describe("EOD loan default — seizure", () => {
  it("seizes whole credits toward the loan, capped at available funds; current never goes negative; GL balanced", () => {
    const h = makeHarness();
    disburse(h, 5000);
    spend(h, 4800); // leave 200 in current

    eod(h); // day 1: base accrual → −5100, not yet due
    expect(h.service.balanceOf(PLAYER)).toBe(200);

    eod(h); // day 2: overdue, unpaid → seize what little there is (200), then penalty
    expect(h.service.balanceOf(PLAYER)).toBe(0);
    expect(h.service.balanceOf(LOAN)).toBe(
      -(4900 + Math.round(4900 * PENALTY_RATE)),
    );
    expect(Number.isInteger(h.service.balanceOf(LOAN))).toBe(true);
    expect(balanced(h.service)).toBe(true);
  });

  it("interest on an odd principal rounds to whole credits and the seizure clears the debt with no residual", () => {
    const bus = new BankBus();
    const service = new BankingService(bus, {
      startDate: 1,
      loanDailyRate: 0.025, // 2.5 %/day → 100 → −103 (2.5 rounds away from zero)
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
    bus.dispatch({
      kind: "OpenAccount",
      account: {
        id: LOAN,
        type: AccountType.LOAN,
        label: "Кредит",
        ownerId: "player",
      },
    });
    const h: Harness = { bus, service, events };

    disburse(h, 100); // current = 100, loan = −100
    fund(h, 50); // current = 150 — more than the debt will be

    eod(h); // day 1: not due → base accrual → loan = −103, current = 150
    expect(service.balanceOf(LOAN)).toBe(-103);

    eod(h); // day 2: overdue → seize min(150, 103) = 103, debt retired exactly
    expect(service.balanceOf(PLAYER)).toBe(47);
    expect(Number.isInteger(service.balanceOf(PLAYER))).toBe(true);
    expect(service.balanceOf(LOAN)).toBe(0);
    expect(defaults(events)).toHaveLength(0);
    expect(balanced(service)).toBe(true);
  });

  it("a seizure that retires the loan caps at the outstanding (does not drain extra) and clears arrears", () => {
    const h = makeHarness();
    disburse(h, 5000); // current = 5000
    fund(h, 1000); // income arrives → current = 6000, more than will be owed

    eod(h); // day 1: base accrual → −5100, not yet due
    eod(h); // day 2: overdue → seize toward the −5100 debt

    expect(h.service.balanceOf(LOAN)).toBe(0);
    expect(h.service.balanceOf(PLAYER)).toBeGreaterThan(0);
    expect(defaults(h.events)).toHaveLength(0);
    expect(balanced(h.service)).toBe(true);
  });

  it("never seizes from a borrower who services the loan on schedule (no default)", () => {
    const h = makeHarness();
    disburse(h, 3000); // current = 3000

    for (let i = 0; i < 4; i++) {
      eod(h);
      h.bus.dispatch({
        kind: "Transfer",
        fromAccountId: PLAYER,
        toAccountId: LOAN,
        amount: 500,
        reason: "Погашение",
      });
    }

    expect(h.service.balanceOf(PLAYER)).toBe(3000 - 4 * 500);
    expect(defaults(h.events)).toHaveLength(0);
    expect(-h.service.balanceOf(LOAN)).toBeLessThan(3000);
    expect(balanced(h.service)).toBe(true);
  });
});

describe("EOD loan default — books stay balanced through a full default", () => {
  it("keeps Σ(all postings)==0 across penalty accrual, seizure, and default", () => {
    const h = makeHarness();
    disburse(h, 5000);
    spend(h, 5000);
    for (let i = 0; i <= LOAN_DEFAULT_THRESHOLD + 1; i++) {
      eod(h);
      expect(balanced(h.service)).toBe(true);
    }
    expect(defaults(h.events)).toHaveLength(1);
  });
});
