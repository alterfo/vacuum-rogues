import { GameValidationException } from "@/exceptions/GameValidationException";
import { AccountType } from "@/domain/banking/Ledger";
import type { BankBus } from "./bus";
import type { BankingService } from "./BankingService";
import { transfer } from "./economy";

export function savingsAccountId(ownerId: string): string {
  return `sav:${ownerId}`;
}

export function loanAccountId(ownerId: string): string {
  return `loan:${ownerId}`;
}

export function openSavings(
  bus: BankBus,
  service: BankingService,
  ownerId: string,
  label = "Сберегательный вклад",
): string {
  const id = savingsAccountId(ownerId);
  if (!service.getLedger().hasAccount(id)) {
    bus.dispatch({
      kind: "OpenAccount",
      account: { id, type: AccountType.SAVINGS, label, ownerId },
    });
  }
  return id;
}

export function deposit(
  bus: BankBus,
  fromAccountId: string,
  savingsId: string,
  amount: number,
  reason = "Пополнение вклада",
): void {
  if (amount <= 0) return;
  transfer(bus, fromAccountId, savingsId, amount, reason);
}

export function withdraw(
  bus: BankBus,
  savingsId: string,
  toAccountId: string,
  amount: number,
  reason = "Снятие со вклада",
): void {
  if (amount <= 0) return;
  transfer(bus, savingsId, toAccountId, amount, reason);
}

export function openLoanAccount(
  bus: BankBus,
  service: BankingService,
  ownerId: string,
  label = "Кредит",
): string {
  const id = loanAccountId(ownerId);
  if (!service.getLedger().hasAccount(id)) {
    bus.dispatch({
      kind: "OpenAccount",
      account: { id, type: AccountType.LOAN, label, ownerId },
    });
  }
  return id;
}

export interface LoanTerms {
  readonly principal: number;
  readonly dailyRate: number;
  readonly periods: number;
}

export interface LoanGrant {
  readonly loanAccountId: string;
  readonly schedule: readonly AmortizationPeriod[];
}

export function takeLoan(
  bus: BankBus,
  service: BankingService,
  ownerId: string,
  toAccountId: string,
  terms: LoanTerms,
  reason = "Выдача кредита",
): LoanGrant {
  const id = openLoanAccount(bus, service, ownerId);
  bus.dispatch({
    kind: "DisburseLoan",
    loanAccountId: id,
    toAccountId,
    amount: terms.principal,
    reason,
  });
  return {
    loanAccountId: id,
    schedule: amortizationSchedule(
      terms.principal,
      terms.dailyRate,
      terms.periods,
    ),
  };
}

export function repayLoan(
  bus: BankBus,
  fromAccountId: string,
  loanId: string,
  amount: number,
  reason = "Погашение кредита",
): void {
  if (amount <= 0) return;
  transfer(bus, fromAccountId, loanId, amount, reason);
}

export function forgiveLoanResidual(
  bus: BankBus,
  loanId: string,
  glIncomeId: string,
  residual: number,
  reason = "Списание остатка по кредиту",
): void {
  if (residual <= 0) return;
  bus.dispatch({
    kind: "PostTransaction",
    reason,
    postings: [
      { accountId: loanId, amount: residual },
      { accountId: glIncomeId, amount: -residual },
    ],
  });
}

export interface AmortizationPeriod {
  readonly period: number;
  readonly payment: number;
  readonly interest: number;
  readonly principal: number;
  readonly remaining: number;
}

export function loanPayment(
  principal: number,
  dailyRate: number,
  periods: number,
): number {
  if (periods <= 0 || !Number.isFinite(periods)) {
    throw new GameValidationException(
      "LOAN_BAD_TERMS",
      `A loan needs at least one repayment period; got ${periods}.`,
      { periods },
    );
  }
  if (dailyRate < 0) {
    throw new GameValidationException(
      "LOAN_BAD_TERMS",
      `Loan rate must be non-negative; got ${dailyRate}.`,
      { dailyRate },
    );
  }
  if (dailyRate === 0) return principal / periods;
  const factor = Math.pow(1 + dailyRate, periods);
  return (principal * dailyRate * factor) / (factor - 1);
}

export interface LoanTermsSummary {
  readonly principal: number;
  readonly dailyRate: number;
  readonly periods: number;
  readonly perPeriodPayment: number;
  readonly totalRepayable: number;
  readonly totalInterest: number;
  readonly dueDates: readonly number[];
  readonly schedule: readonly AmortizationPeriod[];
}

export function loanTermsSummary(
  terms: LoanTerms,
  startBusinessDate = 0,
): LoanTermsSummary {
  const { principal, dailyRate, periods } = terms;
  const schedule = amortizationSchedule(principal, dailyRate, periods);
  const perPeriodPayment = loanPayment(principal, dailyRate, periods);
  const totalRepayable = schedule.reduce((sum, p) => sum + p.payment, 0);
  return {
    principal,
    dailyRate,
    periods,
    perPeriodPayment,
    totalRepayable,
    totalInterest: totalRepayable - principal,
    dueDates: schedule.map((p) => startBusinessDate + p.period),
    schedule,
  };
}

export function amortizationSchedule(
  principal: number,
  dailyRate: number,
  periods: number,
): AmortizationPeriod[] {
  const payment = loanPayment(principal, dailyRate, periods);
  const schedule: AmortizationPeriod[] = [];
  let remaining = principal;
  for (let i = 1; i <= periods; i++) {
    const interest = remaining * dailyRate;
    if (i === periods) {
      schedule.push({
        period: i,
        payment: remaining + interest,
        interest,
        principal: remaining,
        remaining: 0,
      });
      remaining = 0;
    } else {
      const principalPortion = payment - interest;
      remaining -= principalPortion;
      schedule.push({
        period: i,
        payment,
        interest,
        principal: principalPortion,
        remaining,
      });
    }
  }
  return schedule;
}
