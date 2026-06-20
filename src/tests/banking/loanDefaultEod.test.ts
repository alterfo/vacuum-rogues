import { describe, it, expect } from "vitest";
import {
  AccountType,
  BALANCE_EPSILON,
  INTERNAL_ACCOUNTS,
} from "@/domain/banking/Ledger";
import { BankBus, type BankEvent } from "@/systems/banking/bus";
import { BankingService } from "@/systems/banking/BankingService";
import { LOAN_DEFAULT_THRESHOLD } from "@/systems/banking/loanDefault";

/**
 * Task 4 — wiring the pure loan-default machine into the EOD batch: an overdue,
 * unpaid loan must accrue at the **penalty rate**, the bank must **seize** toward
 * the debt from the current account (balanced, capped, never negative), the loan
 * must **default** after the threshold of consecutive misses (publishing a single
 * `LoanDefaulted` event — the reputation trigger), and the GL must stay balanced
 * throughout. Round-number rates so the interest math reads exactly.
 */

const PLAYER = "cur:player";
const LOAN = "loan:player";
const LOAN_RATE = 0.02; // 2 %/day base
const PENALTY_RATE = 0.03; // 2 % × 1.5 penalty multiplier

interface Harness {
  bus: BankBus;
  service: BankingService;
  events: BankEvent[];
}

/** Fresh seeded bank, player current account open, explicit loan rate, day 1. */
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

/** Disburse `principal` into the current account (loan goes negative, current funded). */
function disburse(h: Harness, principal: number): void {
  h.bus.dispatch({
    kind: "DisburseLoan",
    loanAccountId: LOAN,
    toAccountId: PLAYER,
    amount: principal,
    reason: "Кредит",
  });
}

/** Drain `amount` out of the current account (simulate the player spending the loan). */
function spend(h: Harness, amount: number): void {
  h.bus.dispatch({
    kind: "Transfer",
    fromAccountId: PLAYER,
    toAccountId: INTERNAL_ACCOUNTS.CASH,
    amount,
    reason: "Траты",
  });
}

/** Top the current account up (simulate income arriving). */
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

    // Day 1 closes before the first due (firstDueDate = disburse day + 1): base rate.
    eod(h);
    expect(h.service.balanceOf(LOAN)).toBeCloseTo(-5100, 6); // −5000 × 1.02
    expect(balanced(h.service)).toBe(true);

    // Day 2 reaches the first due with no funds → missed → penalty rate (×1.5).
    eod(h);
    // Penalty, not base: −5100 × 1.03 = −5253 (base would be −5202).
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

    // One EOD per day; the first due is day 2, so the threshold-th miss lands on
    // day (1 + threshold) and not before.
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
    // Capped at available funds (200) and floored to whole credits → current emptied,
    // never negative.
    expect(h.service.balanceOf(PLAYER)).toBe(0);
    // The seizure paid 200 off the −5100 owed (→ −4900) before penalty interest:
    // −4900 × 1.03 = −5047.
    expect(h.service.balanceOf(LOAN)).toBeCloseTo(
      -4900 * (1 + PENALTY_RATE),
      6,
    );
    expect(balanced(h.service)).toBe(true);
  });

  it("a seizure that retires the loan caps at the outstanding (does not drain extra) and clears arrears", () => {
    const h = makeHarness();
    disburse(h, 5000); // current = 5000
    fund(h, 1000); // income arrives → current = 6000, more than will be owed

    eod(h); // day 1: base accrual → −5100, not yet due
    eod(h); // day 2: overdue → seize toward the −5100 debt

    // Capped at the outstanding (≈5100), not the full 6000 balance: the loan closes
    // and the borrower keeps the surplus.
    expect(h.service.balanceOf(LOAN)).toBe(0);
    expect(h.service.balanceOf(PLAYER)).toBeGreaterThan(0);
    // Loan retired by seizure → arrears clear, no default fires.
    expect(defaults(h.events)).toHaveLength(0);
    expect(balanced(h.service)).toBe(true);
  });

  it("never seizes from a borrower who services the loan on schedule (no default)", () => {
    const h = makeHarness();
    disburse(h, 3000); // current = 3000

    // Each period: close the day, then voluntarily repay 500 (more than the
    // interest) so the debt keeps falling — the bank should never need to seize.
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

    // Current dropped by exactly the four voluntary repayments (4 × 500) — no
    // seizure moved anything extra out of it.
    expect(h.service.balanceOf(PLAYER)).toBe(3000 - 4 * 500);
    // A serviced loan never goes into arrears, so it never defaults.
    expect(defaults(h.events)).toHaveLength(0);
    // Debt is well below the original principal and the books are balanced.
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
