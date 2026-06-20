/**
 * The **loan-default state machine** (pure): how an outstanding loan slides into,
 * and recovers from, arrears as scheduled payments are met or missed. It holds no
 * money and touches no ledger — Task 4 wires these transitions into the EOD batch
 * (penalty accrual, reputation, seizure) and Task 5 persists the state — so every
 * rule here is a plain, deterministic function over the small {@link LoanDefaultState}.
 *
 * The model tracks a single loan per owner (the АБС grants one {@link loanAccountId}
 * per owner). Each scheduled installment falls due one EOD day after the last
 * ({@link LoanTerms.periods} of them, see `amortizationSchedule`). The machine cares
 * only about *whether* the due was met, not the amount:
 *
 *   - **On time** ({@link recordScheduledPayment}) — the borrower paid the due that
 *     fell on (or before) {@link LoanDefaultState.nextDueDate}. Arrears clear: the
 *     miss count resets to 0, the penalty rate switches off, and a prior default is
 *     lifted (the recovery path). The next installment's due date advances one day.
 *   - **Missed** ({@link recordMissedDue}) — EOD reached the due date with no payment.
 *     The consecutive-miss count climbs, the penalty interest rate switches on, and
 *     at {@link LoanDefaultPolicy.defaultThreshold} consecutive misses the loan is
 *     flagged `defaulted`. The next installment's due date still advances one day
 *     (the schedule keeps marching; the unpaid balance simply keeps accruing).
 *
 * Both transitions advance {@link LoanDefaultState.nextDueDate} by exactly one period
 * so the caller can drive the machine straight off the EOD business-date clock.
 */

/** Multiplier applied to the loan's daily rate while a payment is overdue (×1.5). */
export const LOAN_PENALTY_MULTIPLIER = 1.5;

/** Consecutive missed dues that flip a loan into {@link LoanDefaultState.defaulted}. */
export const LOAN_DEFAULT_THRESHOLD = 3;

/** Tunables governing the default machine. Defaults: {@link DEFAULT_LOAN_DEFAULT_POLICY}. */
export interface LoanDefaultPolicy {
  /** Factor the daily loan rate is multiplied by while overdue (e.g. `1.5`). */
  readonly penaltyMultiplier: number;
  /** Consecutive missed dues at which the loan is flagged `defaulted` (e.g. `3`). */
  readonly defaultThreshold: number;
}

/** The shipped policy: a ×1.5 penalty rate, default at 3 consecutive misses. */
export const DEFAULT_LOAN_DEFAULT_POLICY: LoanDefaultPolicy = {
  penaltyMultiplier: LOAN_PENALTY_MULTIPLIER,
  defaultThreshold: LOAN_DEFAULT_THRESHOLD,
};

/**
 * The persisted per-loan default state (Task 5 mirrors this in the save schema).
 * Plain primitives only, so it round-trips through JSON unchanged.
 */
export interface LoanDefaultState {
  /** Consecutive missed scheduled payments. `0` ⇒ current / up to date. */
  readonly missedPayments: number;
  /** `true` while overdue — the penalty interest rate ({@link penaltyDailyRate}) applies. */
  readonly penaltyActive: boolean;
  /** `true` once {@link missedPayments} reached the policy threshold (blocks new loans). */
  readonly defaulted: boolean;
  /** Business date the next scheduled installment falls due. */
  readonly nextDueDate: number;
}

/**
 * The default state of a freshly granted loan: current (no misses, no penalty, not
 * defaulted), with the first installment due on `firstDueDate` — the business date
 * the loan was taken plus one period (period 1 of the amortization schedule).
 */
export function newLoanDefaultState(firstDueDate: number): LoanDefaultState {
  return {
    missedPayments: 0,
    penaltyActive: false,
    defaulted: false,
    nextDueDate: firstDueDate,
  };
}

/**
 * Whether the next scheduled payment is overdue as of `businessDate` — the due
 * date has been reached with no payment recorded for it. EOD asks this to decide
 * between {@link recordScheduledPayment} (paid) and {@link recordMissedDue} (missed).
 */
export function isPaymentOverdue(
  state: LoanDefaultState,
  businessDate: number,
): boolean {
  return businessDate >= state.nextDueDate;
}

/**
 * Record the current installment **paid** (on time, or a catch-up that clears
 * arrears). Resets the miss count and switches off the penalty rate, lifts any
 * prior default (the recovery transition), and advances {@link LoanDefaultState.nextDueDate}
 * to the following period. Money movement is the caller's job (a balanced bus
 * `Transfer`); this only updates the arrears bookkeeping.
 */
export function recordScheduledPayment(
  state: LoanDefaultState,
): LoanDefaultState {
  return {
    missedPayments: 0,
    penaltyActive: false,
    defaulted: false,
    nextDueDate: state.nextDueDate + 1,
  };
}

/**
 * Record the current installment **missed** (the due date passed unpaid). Increments
 * the consecutive-miss count, switches the penalty rate on, flips `defaulted` once
 * the count reaches {@link LoanDefaultPolicy.defaultThreshold}, and advances
 * {@link LoanDefaultState.nextDueDate} to the following period. Once `defaulted` it
 * stays set until a payment recovers it ({@link recordScheduledPayment}).
 */
export function recordMissedDue(
  state: LoanDefaultState,
  policy: LoanDefaultPolicy = DEFAULT_LOAN_DEFAULT_POLICY,
): LoanDefaultState {
  const missedPayments = state.missedPayments + 1;
  return {
    missedPayments,
    penaltyActive: true,
    defaulted: state.defaulted || missedPayments >= policy.defaultThreshold,
    nextDueDate: state.nextDueDate + 1,
  };
}

/**
 * The effective daily interest rate given the arrears state: the base loan rate,
 * bumped by {@link LoanDefaultPolicy.penaltyMultiplier} while {@link LoanDefaultState.penaltyActive},
 * otherwise unchanged. Task 4's EOD accrual reads this so an overdue loan grows faster.
 */
export function penaltyDailyRate(
  baseRate: number,
  state: LoanDefaultState,
  policy: LoanDefaultPolicy = DEFAULT_LOAN_DEFAULT_POLICY,
): number {
  return state.penaltyActive ? baseRate * policy.penaltyMultiplier : baseRate;
}

/**
 * Whether stepping from `before` to `after` crossed into default for the first
 * time (false → true) — the one moment Task 4 applies the one-off bank-faction
 * reputation hit. A recover-then-default cycle reports `true` again on the second
 * fall, which is intended (a fresh default event).
 */
export function enteredDefault(
  before: LoanDefaultState,
  after: LoanDefaultState,
): boolean {
  return !before.defaulted && after.defaulted;
}
