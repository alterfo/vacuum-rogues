---
# Bank: Loan Terms Display & Default Sanctions

## Overview
The Galactic Bank (ABS prototype) lets the player take a loan, but **the loan terms are never
shown** ("в банке не описаны условия по кредитам") and **there is no consequence for not repaying**
— `repayLoan`/EOD interest exist, plus a `forgiveLoanResidual` write-off, but a player can borrow,
spend, and ignore the debt with no sanction. This plan (1) surfaces the loan terms (principal,
per-day interest rate, periods, total repayable, outstanding balance, next scheduled payment) in
`BankScene`, and (2) adds a **thin** default mechanic: a missed end-of-day payment applies a
penalty interest bump + a bank-faction reputation loss; persistent default blocks new loans and
auto-seizes from the current account when credits arrive. Kept generic and minimal, consistent with
the ABS prototype's "thin core-banking" guardrail.

## Context
- **Bank UI:** `src/presentation/BankScene.ts` — `takeLoan` at ~L517 (uses `LOAN_PRINCIPAL`),
  `repayLoan` at ~L553, outstanding read via `bankingService.balanceOf(loanAccountId(player.id))`
  (negative = in debt). No terms shown, no due/penalty surface.
- **Products:** `src/systems/banking/products.ts` — `LoanTerms { principal, dailyRate, periods }`,
  `takeLoan`, `amortizationSchedule` (pure planning artifact), `LoanGrant { loanAccountId, schedule }`,
  `forgiveLoanResidual`.
- **Core + EOD:** `src/systems/banking/BankingService.ts` (EOD accrues loan interest, rolls business
  date) dispatched from `GameEngine.advanceGalaxyDay`; `src/systems/banking/bus.ts` (commands/events).
- **Money & reputation:** payments/seizure go through the banking bus (transfer), never direct
  `credits` writes (ABS contract — net deltas must stay correct). Reputation via
  `Player.adjustReputation` against the bank's faction.
- **Persistence:** `src/validation/schemas.ts` + save flow already persist accounts + ledger (ABS
  Task 8). New loan-default state (missed-payment count, penalty-active, defaulted flag, next-due
  business date) must persist alongside.
- **Decision (confirmed):** default sanction = **penalty interest bump + reputation loss + block
  new loans + auto-seizure on funds** (not asset repossession).

## Development Approach
- **TDD.** Penalty math and the default state machine are pure and must be tested hard (a banking
  rule lives or dies on the numbers). Write failing tests first.
- **ABS contract is binding:** every credit move (payment, seizure) goes through the bus as a
  balanced posting; the GL stays balanced (Σ postings == 0); existing banking/economy tests assert
  deltas and **must stay green** — if any reds, STOP and fix the posting, do not weaken the test.
- **Schema lockstep:** any new persisted loan-state field updates `src/validation/schemas.ts` in the
  same task (CLAUDE.md rule); add a migration default for old saves (no default state = not in debt).
- One concern per task; full suite green between tasks.

## Testing Strategy
- Unit: a pure `loanTermsSummary(terms)` (total repayable, per-period payment, due dates);
  default state machine — on-time payment clears due, missed payment increments misses + flips
  penalty rate, N misses sets `defaulted`; seizure posts a balanced transfer capped at funds
  available; reputation delta applied once per default event.
- Integration: EOD with an unpaid loan applies penalty + rep loss and keeps the GL balanced;
  defaulted player is blocked from `takeLoan`; persistence round-trips the loan-default state.

## Progress Tracking
- `[x]` when done; ➕ new tasks; ⚠️ blockers (esp. any banking/economy test that reds). Keep in sync.

## Implementation Steps

### Task 1: Loan terms summary (pure)
**Files:**
- Modify: src/systems/banking/products.ts (`loanTermsSummary(terms)` → total repayable, per-period
  payment, total interest, due-date list)
- Create: src/tests/banking/loanTermsSummary.test.ts

- [x] pure helper deriving the human-readable terms from `LoanTerms` + the amortization schedule
- [x] write unit tests: total repayable > principal; per-period payment retires the loan over N periods
- [x] run affected tests — must pass before next task

### Task 2: Surface loan terms + outstanding in BankScene
**Files:**
- Modify: src/presentation/BankScene.ts (show rate/periods/total/next-payment before borrowing;
  show outstanding + next-due for an active loan; route dark-panel text through `scaledText`)

- [x] display terms at the "Взять кредит" action and the live outstanding/next-due for an active loan
- [x] visually verify via screenshot that terms + outstanding read clearly
- [x] (no new logic — covered by Task 1 tests; add a render smoke test only if a helper is extracted) — extracted pure `loanPanelLines`/`formatDailyRate` in bankSceneView.ts with unit tests
- [x] run affected tests — must pass before next task

### Task 3: Default state machine + penalty rate (pure)
**Files:**
- Create: src/systems/banking/loanDefault.ts (missed-payment tracking, penalty-rate bump, defaulted
  flag, next-due business date — pure transitions)
- Create: src/tests/banking/loanDefault.test.ts

- [x] model: on-time payment clears the due period; a missed due increments misses and activates the
      penalty rate; ≥ N consecutive misses sets `defaulted`
- [x] write unit tests for every transition (on-time, one miss, penalty active, defaulted, recovery)
- [x] run affected tests — must pass before next task

### Task 4: Wire default into EOD — penalty accrual, reputation, seizure
**Files:**
- Modify: src/systems/banking/BankingService.ts (EOD: detect missed due, apply penalty rate, post
  balanced reputation/seizure effects), src/systems/GameEngine.ts (apply bank-faction reputation
  loss; auto-seize from current account when funds arrive — via the bus)
- Create: src/tests/banking/loanDefaultEod.test.ts

- [x] EOD applies the penalty rate to an overdue loan and triggers reputation loss once per default
- [x] seizure posts a balanced transfer (current → loan) capped at available funds; never makes
      `player.credits` negative; GL stays balanced
- [x] ⚠️ existing banking/economy tests must stay green — if any reds, STOP and fix the posting
- [x] write tests: EOD penalty math; seizure capped + balanced; books balanced after default EOD
- [x] run affected tests + full banking suite — must pass before next task

### Task 5: Block new loans on default + persist loan-default state
**Files:**
- Modify: src/presentation/BankScene.ts (block "Взять кредит" + explain when defaulted/penalty active),
  src/validation/schemas.ts (persist loan-default state; migration default for old saves),
  src/systems/banking save flow
- Create: src/tests/banking/loanDefaultPersistence.test.ts

- [x] defaulted player cannot take a new loan; the block + active penalty are explained in the UI
- [x] loan-default state persists and reloads; old saves migrate (no state ⇒ not in debt, not defaulted)
- [x] write tests: persistence round-trip; old-save migration; blocked-borrow path
- [x] run affected tests — must pass before next task

### Task 6: Verify acceptance criteria
- [x] verify Overview: terms shown, missed payment penalized, reputation + block + seizure work, GL balanced
      — confirmed wired in production: `loanPanelLines`/`loanTermsSummary` (BankScene terms),
      `penaltyDailyRate`/`loanDefault` in BankingService EOD (penalty), `adjustReputation` on default
      event (GameEngine), `borrowBlockReason` (new-loan block), `seizeTowardLoan` balanced transfer
- [x] run full unit suite — all green (227 files / 1961 tests); `npm run test:e2e:regression`
      (23/23 passed incl. balanced-posting banking smoke); `npm run lint` clean (0 errors)
- [x] confirm no existing banking/economy test assertions changed — only `bankSceneView.test.ts`
      touched among existing tests, and that change is purely additive (Task 2 helper cases; 0 lines removed)

## Technical Details
- **Penalty rate:** a multiplier on `dailyRate` while overdue (e.g. ×1.5), reverting once caught up.
- **Default threshold:** N consecutive missed dues (config constant) flips `defaulted`.
- **Seizure:** a bus `Transfer(current → loan)` for `min(currentBalance, outstanding)` — opportunistic
  recovery, balanced, never negative. No asset repossession (out of scope by decision).
- **Reputation:** a one-time bank-faction hit per default event (not per EOD), via `adjustReputation`.

## Post-Completion
**Manual verification:** take a loan, read the terms; skip repayment across several days and confirm
the penalty rate, reputation loss, the new-loan block, and auto-seizure when credits arrive; confirm
the bank's books stay balanced throughout.
