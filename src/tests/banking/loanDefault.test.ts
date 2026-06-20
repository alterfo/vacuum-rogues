import { describe, it, expect } from "vitest";
import {
  DEFAULT_LOAN_DEFAULT_POLICY,
  LOAN_DEFAULT_THRESHOLD,
  LOAN_PENALTY_MULTIPLIER,
  enteredDefault,
  isPaymentOverdue,
  newLoanDefaultState,
  penaltyDailyRate,
  recordMissedDue,
  recordScheduledPayment,
  type LoanDefaultPolicy,
} from "@/systems/banking/loanDefault";

/**
 * Task 3 — the pure loan-default state machine. A banking rule lives or dies on the
 * numbers, so every transition (open, on-time, one miss, penalty active, defaulted,
 * recovery) is pinned down here. No money, no ledger — just the small state struct.
 */

describe("loanDefault state machine (pure)", () => {
  it("a freshly granted loan opens current: no misses, no penalty, not defaulted", () => {
    const s = newLoanDefaultState(11);
    expect(s).toEqual({
      missedPayments: 0,
      penaltyActive: false,
      defaulted: false,
      nextDueDate: 11,
    });
  });

  it("the next payment is overdue once the business date reaches the due date", () => {
    const s = newLoanDefaultState(11);
    expect(isPaymentOverdue(s, 10)).toBe(false); // before the due date
    expect(isPaymentOverdue(s, 11)).toBe(true); // on the due date
    expect(isPaymentOverdue(s, 12)).toBe(true); // past it
  });

  it("on-time payment keeps the loan current and advances the due date one period", () => {
    const s = recordScheduledPayment(newLoanDefaultState(11));
    expect(s).toEqual({
      missedPayments: 0,
      penaltyActive: false,
      defaulted: false,
      nextDueDate: 12,
    });
  });

  it("one missed due increments the miss count and switches the penalty rate on", () => {
    const s = recordMissedDue(newLoanDefaultState(11));
    expect(s.missedPayments).toBe(1);
    expect(s.penaltyActive).toBe(true);
    expect(s.defaulted).toBe(false); // one miss is below the threshold
    expect(s.nextDueDate).toBe(12); // schedule still marches forward
  });

  it("the penalty rate bumps the base daily rate by the policy multiplier, only while overdue", () => {
    const current = newLoanDefaultState(11);
    const overdue = recordMissedDue(current);
    // Current: rate unchanged.
    expect(penaltyDailyRate(0.002, current)).toBeCloseTo(0.002, 9);
    // Overdue: rate × penalty multiplier.
    expect(penaltyDailyRate(0.002, overdue)).toBeCloseTo(
      0.002 * LOAN_PENALTY_MULTIPLIER,
      9,
    );
  });

  it("the default flag flips at exactly the threshold of consecutive misses", () => {
    let s = newLoanDefaultState(11);
    for (let i = 1; i < LOAN_DEFAULT_THRESHOLD; i++) {
      s = recordMissedDue(s);
      expect(s.missedPayments).toBe(i);
      expect(s.defaulted).toBe(false); // not yet
      expect(s.penaltyActive).toBe(true);
    }
    // The threshold-th consecutive miss tips it into default.
    s = recordMissedDue(s);
    expect(s.missedPayments).toBe(LOAN_DEFAULT_THRESHOLD);
    expect(s.defaulted).toBe(true);
  });

  it("default stays set across further misses (it does not toggle off on its own)", () => {
    let s = newLoanDefaultState(11);
    for (let i = 0; i < LOAN_DEFAULT_THRESHOLD + 2; i++) s = recordMissedDue(s);
    expect(s.defaulted).toBe(true);
    expect(s.missedPayments).toBe(LOAN_DEFAULT_THRESHOLD + 2);
  });

  it("a payment recovers a defaulted loan: misses clear, penalty off, default lifted", () => {
    let s = newLoanDefaultState(11);
    for (let i = 0; i < LOAN_DEFAULT_THRESHOLD; i++) s = recordMissedDue(s);
    expect(s.defaulted).toBe(true);

    const recovered = recordScheduledPayment(s);
    expect(recovered.missedPayments).toBe(0);
    expect(recovered.penaltyActive).toBe(false);
    expect(recovered.defaulted).toBe(false);
    // Due date keeps advancing from where it was (one period past the last due).
    expect(recovered.nextDueDate).toBe(s.nextDueDate + 1);
  });

  it("a catch-up payment after a single miss clears the penalty (recovery before default)", () => {
    const missed = recordMissedDue(newLoanDefaultState(11));
    const caughtUp = recordScheduledPayment(missed);
    expect(caughtUp.missedPayments).toBe(0);
    expect(caughtUp.penaltyActive).toBe(false);
    expect(caughtUp.defaulted).toBe(false);
  });

  it("enteredDefault fires only on the false→true crossing (the one reputation moment)", () => {
    let s = newLoanDefaultState(11);
    // Climb to one short of default — never reports entering default.
    for (let i = 1; i < LOAN_DEFAULT_THRESHOLD; i++) {
      const next = recordMissedDue(s);
      expect(enteredDefault(s, next)).toBe(false);
      s = next;
    }
    // The crossing miss reports the default event exactly once.
    const defaulted = recordMissedDue(s);
    expect(enteredDefault(s, defaulted)).toBe(true);
    // A further miss while already defaulted does not re-report it.
    const stillDefaulted = recordMissedDue(defaulted);
    expect(enteredDefault(defaulted, stillDefaulted)).toBe(false);
  });

  it("recover-then-default reports a fresh default event on the second fall", () => {
    let s = newLoanDefaultState(11);
    for (let i = 0; i < LOAN_DEFAULT_THRESHOLD; i++) s = recordMissedDue(s);
    expect(s.defaulted).toBe(true);
    const recovered = recordScheduledPayment(s);

    // Fall into default a second time.
    let again = recovered;
    for (let i = 1; i < LOAN_DEFAULT_THRESHOLD; i++)
      again = recordMissedDue(again);
    const second = recordMissedDue(again);
    expect(enteredDefault(again, second)).toBe(true);
  });

  it("respects a custom policy (lower threshold, larger penalty multiplier)", () => {
    const policy: LoanDefaultPolicy = {
      penaltyMultiplier: 2,
      defaultThreshold: 1,
    };
    const s = recordMissedDue(newLoanDefaultState(11), policy);
    // Threshold of 1 ⇒ a single miss defaults immediately.
    expect(s.defaulted).toBe(true);
    expect(penaltyDailyRate(0.002, s, policy)).toBeCloseTo(0.004, 9);
  });

  it("ships a sane default policy", () => {
    expect(DEFAULT_LOAN_DEFAULT_POLICY).toEqual({
      penaltyMultiplier: LOAN_PENALTY_MULTIPLIER,
      defaultThreshold: LOAN_DEFAULT_THRESHOLD,
    });
    expect(LOAN_PENALTY_MULTIPLIER).toBeGreaterThan(1);
    expect(LOAN_DEFAULT_THRESHOLD).toBeGreaterThanOrEqual(1);
  });
});
