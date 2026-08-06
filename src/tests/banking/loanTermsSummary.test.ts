import { describe, it, expect } from "vitest";
import {
  loanPayment,
  loanTermsSummary,
  type LoanTerms,
} from "@/systems/banking/products";
import { GameValidationException } from "@/exceptions/GameValidationException";

const POSITIVE: LoanTerms = { principal: 1000, dailyRate: 0.02, periods: 5 };

describe("loanTermsSummary (pure)", () => {
  it("echoes the input terms", () => {
    const s = loanTermsSummary(POSITIVE);
    expect(s.principal).toBe(1000);
    expect(s.dailyRate).toBe(0.02);
    expect(s.periods).toBe(5);
  });

  it("per-period payment matches the annuity payment and retires the loan over N periods in whole credits", () => {
    const s = loanTermsSummary(POSITIVE);
    expect(s.perPeriodPayment).toBe(loanPayment(1000, 0.02, 5));
    expect(Number.isInteger(s.perPeriodPayment)).toBe(true);

    let balance = POSITIVE.principal;
    for (const row of s.schedule) {
      expect(Number.isInteger(row.payment)).toBe(true);
      expect(Number.isInteger(row.interest)).toBe(true);
      balance =
        balance + Math.round(balance * POSITIVE.dailyRate) - row.payment;
    }
    expect(balance).toBe(0);

    expect(s.schedule).toHaveLength(5);
    expect(s.schedule[s.schedule.length - 1].remaining).toBe(0);
  });

  it("total repayable exceeds the principal and equals principal + total interest", () => {
    const s = loanTermsSummary(POSITIVE);
    expect(s.totalRepayable).toBeGreaterThan(s.principal);
    expect(s.totalRepayable).toBeCloseTo(s.principal + s.totalInterest, 6);

    const scheduleInterest = s.schedule.reduce((sum, p) => sum + p.interest, 0);
    expect(s.totalInterest).toBeCloseTo(scheduleInterest, 6);
    const scheduledPaid = s.schedule.reduce((sum, p) => sum + p.payment, 0);
    expect(s.totalRepayable).toBeCloseTo(scheduledPaid, 9);
  });

  it("at a zero rate the loan costs nothing: repayable == principal, payment is straight-line", () => {
    const s = loanTermsSummary({ principal: 1000, dailyRate: 0, periods: 4 });
    expect(s.perPeriodPayment).toBe(250);
    expect(s.totalRepayable).toBeCloseTo(1000, 9);
    expect(s.totalInterest).toBeCloseTo(0, 9);
  });

  it("due dates are one EOD day apart, offset from the start business date", () => {
    expect(loanTermsSummary(POSITIVE).dueDates).toEqual([1, 2, 3, 4, 5]);
    expect(loanTermsSummary(POSITIVE, 10).dueDates).toEqual([
      11, 12, 13, 14, 15,
    ]);
  });

  it("inherits term validation from loanPayment (bad terms throw)", () => {
    expect(() => loanTermsSummary({ ...POSITIVE, periods: 0 })).toThrow(
      GameValidationException,
    );
    expect(() => loanTermsSummary({ ...POSITIVE, dailyRate: -0.01 })).toThrow(
      GameValidationException,
    );
  });
});
