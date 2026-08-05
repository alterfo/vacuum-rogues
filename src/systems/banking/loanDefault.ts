export const LOAN_PENALTY_MULTIPLIER = 1.5;

export const LOAN_DEFAULT_THRESHOLD = 3;

export interface LoanDefaultPolicy {
  readonly penaltyMultiplier: number;
  readonly defaultThreshold: number;
}

export const DEFAULT_LOAN_DEFAULT_POLICY: LoanDefaultPolicy = {
  penaltyMultiplier: LOAN_PENALTY_MULTIPLIER,
  defaultThreshold: LOAN_DEFAULT_THRESHOLD,
};

export interface LoanDefaultState {
  readonly missedPayments: number;
  readonly penaltyActive: boolean;
  readonly defaulted: boolean;
  readonly nextDueDate: number;
}

export function newLoanDefaultState(firstDueDate: number): LoanDefaultState {
  return {
    missedPayments: 0,
    penaltyActive: false,
    defaulted: false,
    nextDueDate: firstDueDate,
  };
}

export function isPaymentOverdue(
  state: LoanDefaultState,
  businessDate: number,
): boolean {
  return businessDate >= state.nextDueDate;
}

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

export function penaltyDailyRate(
  baseRate: number,
  state: LoanDefaultState,
  policy: LoanDefaultPolicy = DEFAULT_LOAN_DEFAULT_POLICY,
): number {
  return state.penaltyActive ? baseRate * policy.penaltyMultiplier : baseRate;
}

export function enteredDefault(
  before: LoanDefaultState,
  after: LoanDefaultState,
): boolean {
  return !before.defaulted && after.defaulted;
}
