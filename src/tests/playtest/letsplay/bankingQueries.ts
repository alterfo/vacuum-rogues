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
 * Take the standard loan. When docked at a scene exposing the `e2eTakeLoan`
 * seam (a live `BankScene`) it drives the real «Взять кредит» button so the
 * disbursement is watchable through the real bank UI exactly like a player tap;
 * otherwise it falls back to the canonical {@link takeLoan} bank-bus call (the
 * unchanged path every headless test double drives) — mirroring `takeQuest`'s
 * "seam when available, else domain call" shape (Task 6,
 * docs/plans/20260727-autopilot-ui-parity-fixes.md). A no-op when a loan is
 * already outstanding.
 */
export function executeTakeLoan(engine: GameEngine): void {
  const player = engine.player;
  if (!player || !canTakeLoan(engine)) return;
  const terms = standardLoanTerms(engine);
  if (!terms) return;
  const scene = engine.currentScene as { e2eTakeLoan?: () => void } | null;
  if (typeof scene?.e2eTakeLoan === "function") {
    scene.e2eTakeLoan();
    return;
  }
  takeLoan(
    engine.bankBus,
    engine.bankingService,
    player.id,
    player.currentAccountId,
    terms,
  );
}

/**
 * Repay the outstanding loan. When docked at a scene exposing the `e2eRepayLoan`
 * seam (a live `BankScene`) it drives the real «Погасить» button (one
 * `REPAY_STEP` of debt per press, exactly like a player tap) so the repayment is
 * watchable through the real bank UI; otherwise it falls back to repaying as
 * much of the balance as current credits allow (whole credits only — the current
 * account is integer-only) through the canonical {@link repayLoan} bank-bus call
 * (the unchanged path every headless test double drives). A no-op when there is
 * no outstanding loan or no funds.
 */
export function executeRepayLoan(engine: GameEngine): void {
  const player = engine.player;
  if (!player) return;
  const owed = playerLoanBalance(engine);
  if (owed <= 0) return;
  const amount = Math.max(0, Math.floor(Math.min(owed, player.credits)));
  if (amount <= 0) return;
  const scene = engine.currentScene as { e2eRepayLoan?: () => void } | null;
  if (typeof scene?.e2eRepayLoan === "function") {
    scene.e2eRepayLoan();
    return;
  }
  repayLoan(
    engine.bankBus,
    player.currentAccountId,
    loanAccountId(player.id),
    amount,
  );
}
