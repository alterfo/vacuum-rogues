import { describe, it, expect, beforeEach } from "vitest";
import {
  AccountType,
  BALANCE_EPSILON,
  INTERNAL_ACCOUNTS,
} from "@/domain/banking/Ledger";
import { BankBus } from "@/systems/banking/bus";
import { BankingService } from "@/systems/banking/BankingService";
import {
  amortizationSchedule,
  deposit,
  forgiveLoanResidual,
  loanPayment,
  openLoanAccount,
  openSavings,
  repayLoan,
  savingsAccountId,
  takeLoan,
  withdraw,
} from "@/systems/banking/products";
import { GameValidationException } from "@/exceptions/GameValidationException";

/**
 * Task 6 — thin retail products over the core: a savings deposit (EOD interest
 * capitalizes) and an amortizing loan (disburse → accrue → repay). The two
 * invariants from Task 1 must hold throughout: every operation books a balanced
 * entry, so Σ(all postings) stays 0.
 *
 * Round-number rates so the arithmetic reads exactly.
 */

const PLAYER = "cur:player";
const SAVINGS_RATE = 0.01; // 1 %/day
const LOAN_RATE = 0.02; // 2 %/day

interface Harness {
  bus: BankBus;
  service: BankingService;
}

/** Fresh seeded bank with the player's current account open and explicit rates. */
function makeHarness(currentSeed = 0): Harness {
  const bus = new BankBus();
  const service = new BankingService(bus, {
    startDate: 1,
    savingsDailyRate: SAVINGS_RATE,
    loanDailyRate: LOAN_RATE,
  });
  bus.dispatch({
    kind: "OpenAccount",
    account: {
      id: PLAYER,
      type: AccountType.CURRENT,
      label: "Игрок",
      ownerId: "player",
    },
  });
  if (currentSeed > 0) {
    bus.dispatch({
      kind: "Transfer",
      fromAccountId: INTERNAL_ACCOUNTS.CASH,
      toAccountId: PLAYER,
      amount: currentSeed,
      reason: "Seed",
    });
  }
  return { bus, service };
}

function balanced(service: BankingService): boolean {
  return Math.abs(service.getLedger().totalBalance()) <= BALANCE_EPSILON;
}

describe("products — savings", () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness(1000);
  });

  it("openSavings opens a SAVINGS account and is idempotent", () => {
    const id = openSavings(h.bus, h.service, "player");
    expect(id).toBe(savingsAccountId("player"));
    expect(h.service.getLedger().getAccount(id)?.type).toBe(
      AccountType.SAVINGS,
    );
    const before = h.service.getLedger().listAccounts().length;
    openSavings(h.bus, h.service, "player"); // again → no second account
    expect(h.service.getLedger().listAccounts().length).toBe(before);
  });

  it("deposit moves credits from current into savings (balanced)", () => {
    const sav = openSavings(h.bus, h.service, "player");
    deposit(h.bus, PLAYER, sav, 400);

    expect(h.service.balanceOf(PLAYER)).toBe(600);
    expect(h.service.balanceOf(sav)).toBe(400);
    expect(balanced(h.service)).toBe(true);
  });

  it("EOD interest capitalizes onto the savings balance and grows it", () => {
    const sav = openSavings(h.bus, h.service, "player");
    deposit(h.bus, PLAYER, sav, 1000);

    h.bus.dispatch({ kind: "RunEndOfDay" }); // 1000 → +1 % → 1010
    expect(h.service.balanceOf(sav)).toBeCloseTo(1010, 6);

    h.bus.dispatch({ kind: "RunEndOfDay" }); // 1010 → +1 % → 1020.1 (compounded)
    expect(h.service.balanceOf(sav)).toBeCloseTo(1020.1, 6);
    expect(balanced(h.service)).toBe(true);
  });

  it("withdraw returns capitalized funds (principal + interest) to current", () => {
    const sav = openSavings(h.bus, h.service, "player");
    deposit(h.bus, PLAYER, sav, 1000); // current → 0, savings → 1000
    h.bus.dispatch({ kind: "RunEndOfDay" }); // savings → 1010

    withdraw(h.bus, sav, PLAYER, 1010);
    expect(h.service.balanceOf(sav)).toBeCloseTo(0, 6);
    expect(h.service.balanceOf(PLAYER)).toBeCloseTo(1010, 6);
    expect(balanced(h.service)).toBe(true);
  });

  it("a non-positive deposit/withdraw is a no-op (no empty entry)", () => {
    const sav = openSavings(h.bus, h.service, "player");
    const before = h.service.getLedger().listEntries().length;
    deposit(h.bus, PLAYER, sav, 0);
    withdraw(h.bus, sav, PLAYER, -5);
    expect(h.service.getLedger().listEntries().length).toBe(before);
  });
});

describe("products — amortization schedule (pure)", () => {
  it("loanPayment matches the closed-form annuity formula", () => {
    // P=1000, r=0.02, n=5 → A = P·r·(1+r)^n / ((1+r)^n − 1)
    const factor = Math.pow(1.02, 5);
    const expected = (1000 * 0.02 * factor) / (factor - 1);
    expect(loanPayment(1000, 0.02, 5)).toBeCloseTo(expected, 9);
  });

  it("falls back to straight-line payments at a zero rate", () => {
    expect(loanPayment(1000, 0, 4)).toBe(250);
    const sched = amortizationSchedule(1000, 0, 4);
    expect(sched.map((p) => p.payment)).toEqual([250, 250, 250, 250]);
    expect(sched.map((p) => p.interest)).toEqual([0, 0, 0, 0]);
  });

  it("fully amortizes: remaining hits 0 and Σ principal == principal", () => {
    const sched = amortizationSchedule(1000, 0.02, 5);
    expect(sched).toHaveLength(5);
    expect(sched[sched.length - 1].remaining).toBe(0);

    const totalPrincipal = sched.reduce((s, p) => s + p.principal, 0);
    expect(totalPrincipal).toBeCloseTo(1000, 6);

    // Total paid = principal + all interest > principal (interest is charged).
    const totalPaid = sched.reduce((s, p) => s + p.payment, 0);
    expect(totalPaid).toBeGreaterThan(1000);
    const totalInterest = sched.reduce((s, p) => s + p.interest, 0);
    expect(totalPaid).toBeCloseTo(1000 + totalInterest, 6);
  });

  it("rejects bad terms", () => {
    expect(() => loanPayment(1000, 0.02, 0)).toThrow(GameValidationException);
    expect(() => loanPayment(1000, -0.01, 5)).toThrow(GameValidationException);
  });
});

describe("products — loan lifecycle through the bus", () => {
  it("takeLoan disburses principal to current and the loan account goes negative (balanced)", () => {
    const h = makeHarness();
    const grant = takeLoan(h.bus, h.service, "player", PLAYER, {
      principal: 1000,
      dailyRate: LOAN_RATE,
      periods: 5,
    });

    expect(h.service.getLedger().getAccount(grant.loanAccountId)?.type).toBe(
      AccountType.LOAN,
    );
    expect(h.service.balanceOf(PLAYER)).toBe(1000); // funded
    expect(h.service.balanceOf(grant.loanAccountId)).toBe(-1000); // owed
    expect(grant.schedule).toHaveLength(5);
    expect(balanced(h.service)).toBe(true);
  });

  it("amortizes to zero when EOD accrual + scheduled payments are driven each period", () => {
    // Fund the current account generously so repayments never run dry.
    const h = makeHarness(10_000);
    const grant = takeLoan(h.bus, h.service, "player", PLAYER, {
      principal: 1000,
      dailyRate: LOAN_RATE,
      periods: 5,
    });

    // Each period: close the day (loan accrues 2 %), then pay the scheduled
    // installment from the current account into the loan account.
    for (const row of grant.schedule) {
      h.bus.dispatch({ kind: "RunEndOfDay" });
      repayLoan(h.bus, PLAYER, grant.loanAccountId, row.payment);
      expect(balanced(h.service)).toBe(true); // books balanced every step
    }

    // Debt retired exactly.
    expect(h.service.balanceOf(grant.loanAccountId)).toBeCloseTo(0, 6);
    expect(balanced(h.service)).toBe(true);
  });

  it("a partial repayment reduces the outstanding debt (balanced)", () => {
    const h = makeHarness(5000);
    const loanId = openLoanAccount(h.bus, h.service, "player");
    h.bus.dispatch({
      kind: "DisburseLoan",
      loanAccountId: loanId,
      toAccountId: PLAYER,
      amount: 2000,
      reason: "Loan",
    });

    repayLoan(h.bus, PLAYER, loanId, 500);
    expect(h.service.balanceOf(loanId)).toBe(-1500); // 2000 owed − 500 repaid
    expect(balanced(h.service)).toBe(true);
  });

  it("forgiveLoanResidual closes a sub-credit residual no whole-credit repayment can clear", () => {
    const h = makeHarness(10000);
    const loanId = openLoanAccount(h.bus, h.service, "player");
    h.bus.dispatch({
      kind: "DisburseLoan",
      loanAccountId: loanId,
      toAccountId: PLAYER,
      amount: 4321, // odd principal so EOD interest accrues fractional dust
      reason: "Loan",
    });

    // A day passes: EOD accrues fractional interest (2 % of 4321 = 86.42), so the
    // outstanding balance is no longer a whole number.
    h.bus.dispatch({ kind: "RunEndOfDay" });
    expect(Number.isInteger(h.service.balanceOf(loanId))).toBe(false);

    // Repay in WHOLE credits only — `player.credits` is integer, so a Transfer
    // onto the current account must move a whole amount (mirrors the Bank UI's
    // wholeCreditsToCurrent flooring). Drive it down as far as whole credits allow.
    for (let i = 0; i < 20; i++) {
      const owed = -h.service.balanceOf(loanId);
      const whole = Math.floor(Math.min(1000, owed));
      if (whole <= 0) break;
      repayLoan(h.bus, PLAYER, loanId, whole);
    }

    // The soft-lock: whole-credit repayment alone can never reach 0 — a sub-credit
    // residual is stuck, leaving the loan permanently negative (which would block
    // every future loan via BankScene's `balanceOf(loanId) < 0` guard).
    const residual = -h.service.balanceOf(loanId);
    expect(residual).toBeGreaterThan(0);
    expect(residual).toBeLessThan(1);

    // The bank writes the dust off: the loan closes at exactly 0 and the books
    // stay balanced (no fractional amount ever touched the current account).
    forgiveLoanResidual(
      h.bus,
      loanId,
      INTERNAL_ACCOUNTS.INTEREST_INCOME,
      residual,
    );
    expect(h.service.balanceOf(loanId)).toBe(0);
    expect(balanced(h.service)).toBe(true);
  });

  it("a non-positive residual write-off is a no-op (no empty entry booked)", () => {
    const h = makeHarness(0);
    const loanId = openLoanAccount(h.bus, h.service, "player");
    const before = h.service.getLedger().listEntries().length;
    forgiveLoanResidual(h.bus, loanId, INTERNAL_ACCOUNTS.INTEREST_INCOME, 0);
    forgiveLoanResidual(h.bus, loanId, INTERNAL_ACCOUNTS.INTEREST_INCOME, -5);
    expect(h.service.getLedger().listEntries().length).toBe(before);
  });
});
