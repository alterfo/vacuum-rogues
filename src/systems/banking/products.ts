import { GameValidationException } from "@/exceptions/GameValidationException";
import { AccountType } from "@/domain/banking/Ledger";
import type { BankBus } from "./bus";
import type { BankingService } from "./BankingService";
import { transfer } from "./economy";

/**
 * Thin retail banking **products** layered over the core (Tasks 1–5): a savings
 * deposit and an amortizing loan. Like {@link transfer}, every operation here is a
 * consumer of the bus — it dispatches a balanced command and never pokes the
 * ledger. Nothing in this file holds money of its own; the products are just named
 * customer accounts on the same general ledger:
 *
 *   - **Savings** is a {@link AccountType.SAVINGS} account. A deposit is a
 *     `Transfer` from the customer's current account into it; the daily EOD batch
 *     ({@link BankingService}) already accrues interest on SAVINGS accounts, which
 *     *capitalizes* (the interest credit lands on the savings balance itself).
 *   - **Loan** is a {@link AccountType.LOAN} account that carries a *negative*
 *     balance (the customer owes the principal). Disbursing funds the current
 *     account; EOD accrues interest (growing the debt); a repayment is a `Transfer`
 *     from current back into the loan account, moving the balance toward zero.
 *
 * The {@link amortizationSchedule} is a pure planning artifact — the fixed level
 * payment that retires a loan over N periods when each period accrues `dailyRate`
 * interest. Driving one EOD + one scheduled payment per period walks the loan
 * balance down exactly that schedule.
 */

/** Ledger account id for an owner's savings deposit, e.g. `"sav:player"`. */
export function savingsAccountId(ownerId: string): string {
  return `sav:${ownerId}`;
}

/** Ledger account id for an owner's loan, e.g. `"loan:player"`. */
export function loanAccountId(ownerId: string): string {
  return `loan:${ownerId}`;
}

// ─── Savings ─────────────────────────────────────────────────────────────────

/**
 * Open (idempotently) an owner's savings account and return its id. A no-op if it
 * already exists, so it is safe to call before every deposit.
 */
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

/**
 * Deposit `amount` from a current account into a savings account (a balanced
 * `Transfer`). A non-positive amount is a no-op (no empty entry is booked).
 */
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

/**
 * Withdraw `amount` from a savings account back to a current account (a balanced
 * `Transfer`). A non-positive amount is a no-op.
 */
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

// ─── Loan ────────────────────────────────────────────────────────────────────

/**
 * Open (idempotently) an owner's loan account and return its id. A no-op if it
 * already exists.
 */
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

/** Terms a loan is taken on. `dailyRate` should match the bank's loan accrual rate. */
export interface LoanTerms {
  /** Principal disbursed to the current account (positive). */
  readonly principal: number;
  /** Per-period (per-EOD-day) interest rate, e.g. `0.02` for 2 %/day. */
  readonly dailyRate: number;
  /** Number of scheduled repayment periods (EOD days). */
  readonly periods: number;
}

/** A taken loan: the account it lives on plus its planned repayment schedule. */
export interface LoanGrant {
  readonly loanAccountId: string;
  readonly schedule: readonly AmortizationPeriod[];
}

/**
 * Take out a loan: open the owner's loan account (if needed), disburse the
 * principal into `toAccountId`, and return the planned {@link amortizationSchedule}.
 * The disbursement is the {@link BankingService}'s `DisburseLoan` (loan account
 * goes negative; current account is funded) — a balanced entry.
 */
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

/**
 * Repay `amount` from a current account into a loan account (a balanced
 * `Transfer`). Crediting the loan account moves its negative balance toward zero
 * (debt reduction). A non-positive amount is a no-op.
 */
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

/**
 * Write off a **sub-credit loan residual** the customer cannot repay. A repayment
 * is a `Transfer` from the current account, but `player.credits` is whole-number
 * currency (its save schema rejects a fraction), so only whole credits can move
 * onto the current account — and EOD interest leaves the loan balance fractional.
 * A debt smaller than one credit therefore can never be retired by a transfer; if
 * the bank didn't forgive it, the loan would stay permanently negative and block
 * any future loan. The dust is written off against the interest income the bank
 * accrued, a balanced 2-leg entry on the loan + a GL account only — the current
 * account is untouched, so the `player.credits` projection stays whole. A
 * non-positive residual is a no-op.
 */
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
      // Credit the loan account toward zero…
      { accountId: loanId, amount: residual },
      // …reversing the sliver of interest income that produced the residual.
      { accountId: glIncomeId, amount: -residual },
    ],
  });
}

// ─── Amortization (pure) ──────────────────────────────────────────────────────

/** One row of a repayment plan: how a fixed payment splits into interest + principal. */
export interface AmortizationPeriod {
  /** 1-based period index. */
  readonly period: number;
  /** The fixed level payment due this period. */
  readonly payment: number;
  /** Portion of the payment covering this period's accrued interest. */
  readonly interest: number;
  /** Portion of the payment reducing the outstanding principal. */
  readonly principal: number;
  /** Principal still owed after this payment (0 on the final period). */
  readonly remaining: number;
}

/**
 * The fixed level payment that fully amortizes `principal` over `periods` periods
 * at per-period `dailyRate`:
 *
 *   A = P · r · (1+r)^n / ((1+r)^n − 1)      (r > 0)
 *   A = P / n                                 (r == 0, straight-line)
 *
 * @throws GameValidationException `LOAN_BAD_TERMS` for a non-positive period count
 * or a negative rate.
 */
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

/** Human-readable terms a loan is offered on, derived purely from {@link LoanTerms}. */
export interface LoanTermsSummary {
  /** Principal disbursed up-front to the current account. */
  readonly principal: number;
  /** Per-period (per-EOD-day) interest rate — mirrors the bank's loan accrual. */
  readonly dailyRate: number;
  /** Number of scheduled repayment periods (EOD days). */
  readonly periods: number;
  /** The fixed level payment due each period (the annuity payment). */
  readonly perPeriodPayment: number;
  /** Sum of every scheduled payment — always ≥ `principal` (interest is charged). */
  readonly totalRepayable: number;
  /** `totalRepayable − principal`: the cost of borrowing. */
  readonly totalInterest: number;
  /**
   * The business date each period's payment falls due, i.e.
   * `[startBusinessDate + 1 … startBusinessDate + periods]` (one EOD day apart).
   */
  readonly dueDates: readonly number[];
  /** The amortization schedule this summary was derived from. */
  readonly schedule: readonly AmortizationPeriod[];
}

/**
 * Derive the human-readable {@link LoanTermsSummary} a borrower needs to decide on
 * a loan — the per-period payment, the total repayable (and the interest it implies),
 * and when each payment falls due — from the {@link amortizationSchedule}. Pure: it
 * books nothing and reads no live ledger state, so the Bank UI (and tests) can show
 * the terms before the loan is taken.
 *
 * `startBusinessDate` is the business date the loan is taken on; period `i` falls due
 * one EOD day later, on `startBusinessDate + i`. Defaults to `0` (relative dates).
 *
 * @throws GameValidationException `LOAN_BAD_TERMS` (inherited from {@link loanPayment})
 * for a non-positive period count or a negative rate.
 */
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

/**
 * Build the full amortization schedule for a loan. Each period accrues `dailyRate`
 * interest on the outstanding balance, then the fixed {@link loanPayment} is
 * applied; the final period is squared off so `remaining` lands exactly at 0
 * (absorbing float drift). Σ(period.principal) == `principal`, and the books stay
 * balanced when these payments are driven against matching EOD accrual.
 */
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
      // Final period clears whatever principal is left (the level payment may be
      // a few float-ulps off); pay exactly remaining + its interest.
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
