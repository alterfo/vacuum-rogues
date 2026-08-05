import type { GameEngine } from "@/systems/GameEngine";
import {
  loanAccountId,
  takeLoan,
  repayLoan,
  type LoanTerms,
} from "@/systems/banking/products";
import { loanStatusOf } from "./observeHelpers";

export const STANDARD_LOAN_PRINCIPAL = 5000;
export const STANDARD_LOAN_PERIODS = 10;

export function playerLoanBalance(engine: GameEngine): number {
  const player = engine.player;
  if (!player) return 0;
  return loanStatusOf(engine.bankingService, player.id).balance;
}

export function canTakeLoan(engine: GameEngine): boolean {
  const player = engine.player;
  if (!player) return false;
  return !loanStatusOf(engine.bankingService, player.id).active;
}

export function standardLoanTerms(engine: GameEngine): LoanTerms | null {
  if (!engine.player) return null;
  return {
    principal: STANDARD_LOAN_PRINCIPAL,
    dailyRate: engine.bankingService.loanRate,
    periods: STANDARD_LOAN_PERIODS,
  };
}

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
