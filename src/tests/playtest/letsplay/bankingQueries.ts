/**
 * Letsplay engine — bank-loan query + action helpers (dev-only).
 *
 * The standard loan offer mirrors `BankScene`'s player-facing terms
 * (`LOAN_PRINCIPAL`/`LOAN_PERIODS`) so a headless `take-loan` behaves exactly like
 * the UI action, and the balance/eligibility reads reuse `observeHelpers.loanStatusOf`
 * — the same source of truth the `activeLoans`/`loanBalance` observation signals use
 * — so "can I borrow" and "what do I owe" never diverge from what the agent perceives.
 *
 * Dev-only: lives under `src/tests/`, imported by no production module.
 */
import type { GameEngine } from "@/systems/GameEngine";
import {
  loanAccountId,
  takeLoan,
  repayLoan,
  type LoanTerms,
} from "@/systems/banking/products";
import { loanStatusOf } from "./observeHelpers";

/** Standard loan principal, mirroring `BankScene`'s `LOAN_PRINCIPAL`. */
export const STANDARD_LOAN_PRINCIPAL = 5000;
/** Standard repayment term (EOD days), mirroring `BankScene`'s `LOAN_PERIODS`. */
export const STANDARD_LOAN_PERIODS = 10;

/** The player's current outstanding loan balance (0 when there is none). */
export function playerLoanBalance(engine: GameEngine): number {
  const player = engine.player;
  if (!player) return 0;
  return loanStatusOf(engine.bankingService, player.id).balance;
}

/** Whether the player may take a new loan — no outstanding balance owed. */
export function canTakeLoan(engine: GameEngine): boolean {
  const player = engine.player;
  if (!player) return false;
  return !loanStatusOf(engine.bankingService, player.id).active;
}

/** The standard loan offer, at the bank's live accrual rate. `null` with no player. */
export function standardLoanTerms(engine: GameEngine): LoanTerms | null {
  if (!engine.player) return null;
  return {
    principal: STANDARD_LOAN_PRINCIPAL,
    dailyRate: engine.bankingService.loanRate,
    periods: STANDARD_LOAN_PERIODS,
  };
}

/**
 * Take the standard loan, disbursed to the player's current account through the
 * canonical {@link takeLoan} seam. A no-op when a loan is already outstanding.
 */
export function executeTakeLoan(engine: GameEngine): void {
  const player = engine.player;
  if (!player || !canTakeLoan(engine)) return;
  const terms = standardLoanTerms(engine);
  if (!terms) return;
  takeLoan(
    engine.bankBus,
    engine.bankingService,
    player.id,
    player.currentAccountId,
    terms,
  );
}

/**
 * Repay as much of the outstanding loan as current credits allow (whole credits
 * only — the current account is integer-only) through the canonical
 * {@link repayLoan} seam. A no-op when there is no outstanding loan or no funds.
 */
export function executeRepayLoan(engine: GameEngine): void {
  const player = engine.player;
  if (!player) return;
  const owed = playerLoanBalance(engine);
  if (owed <= 0) return;
  const amount = Math.max(0, Math.floor(Math.min(owed, player.credits)));
  if (amount <= 0) return;
  repayLoan(
    engine.bankBus,
    player.currentAccountId,
    loanAccountId(player.id),
    amount,
  );
}
