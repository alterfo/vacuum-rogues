import {
  AccountType,
  BALANCE_EPSILON,
  INTERNAL_ACCOUNTS,
  Ledger,
  createLedger,
  journalEntry,
  restoreLedger,
  type BankingSnapshot,
  type JournalEntry,
} from "@/domain/banking/Ledger";
import type {
  AccrueInterestCommand,
  BankCommand,
  DisburseLoanCommand,
  OpenAccountCommand,
  PostTransactionCommand,
  RunEndOfDayCommand,
  TransferCommand,
} from "./bus";
import { BankBus } from "./bus";
import { currentAccountId } from "./economy";
import {
  enteredDefault,
  isPaymentOverdue,
  newLoanDefaultState,
  penaltyDailyRate,
  recordMissedDue,
  recordScheduledPayment,
  type LoanDefaultState,
} from "./loanDefault";

/**
 * Daily interest the bank pays on a savings deposit, as a fraction of the
 * value-dated balance (≈ 0.1 %/day). Demo-scaled so accrual is visible over a
 * normal play session, not a real APR.
 */
export const DEFAULT_SAVINGS_DAILY_RATE = 0.001;
/** Daily interest the bank charges on an outstanding loan (≈ 0.2 %/day). */
export const DEFAULT_LOAN_DAILY_RATE = 0.002;

export interface BankingServiceOptions {
  /** Reuse an existing ledger (e.g. one rehydrated from a save). Defaults to a fresh seeded ledger. */
  readonly ledger?: Ledger;
  /** Initial business date. Defaults to 0. */
  readonly startDate?: number;
  /** Daily savings interest rate (fraction of balance). Defaults to {@link DEFAULT_SAVINGS_DAILY_RATE}. */
  readonly savingsDailyRate?: number;
  /** Daily loan interest rate (fraction of outstanding principal). Defaults to {@link DEFAULT_LOAN_DAILY_RATE}. */
  readonly loanDailyRate?: number;
}

/**
 * The core of the in-game АБС: the single command handler on the {@link BankBus}.
 * It owns the general {@link Ledger} and is the *only* thing that writes to it.
 * Each command becomes one balanced {@link JournalEntry}; after committing it the
 * service publishes a `TransactionPosted` event plus a `BalanceChanged` for every
 * account the entry touched, so downstream consumers (the `player.credits`
 * projection, the HUD, the Bank UI) can react without ever reading the ledger
 * themselves.
 *
 * EOD (`RunEndOfDay`) accrues interest on the interest-bearing accounts, cuts
 * statements, and rolls the business date (idempotent per date). No fee batch.
 */
export class BankingService {
  private ledger: Ledger;
  private currentDate: number;
  private seq = 0;
  private readonly savingsDailyRate: number;
  private readonly loanDailyRate: number;
  /** The last business date a full EOD batch closed — guards against re-running it. */
  private lastEodDate: number | null = null;
  /**
   * Per-loan default state keyed by loan account id (Task 5 persists this). Holds
   * the arrears bookkeeping the EOD batch drives the {@link LoanDefaultState}
   * machine off — registered when a loan is disbursed, lazily re-seeded for a loan
   * restored without one.
   */
  private loanDefaults = new Map<string, LoanDefaultState>();
  /**
   * Balance owed at each loan's last due-check, keyed by loan account id. The
   * baseline EOD compares the new outstanding against to tell a **serviced** loan
   * (debt fell — the borrower repaid more than the interest) from one in **arrears**
   * (debt grew) without re-deriving the amortization schedule.
   */
  private loanOwedAtLastDue = new Map<string, number>();

  constructor(
    private readonly bus: BankBus,
    options: BankingServiceOptions = {},
  ) {
    this.ledger = options.ledger ?? createLedger();
    this.currentDate = options.startDate ?? 0;
    this.savingsDailyRate =
      options.savingsDailyRate ?? DEFAULT_SAVINGS_DAILY_RATE;
    this.loanDailyRate = options.loanDailyRate ?? DEFAULT_LOAN_DAILY_RATE;
    bus.setHandler((command) => this.handle(command));
  }

  /** The current business date (the EOD batch advances this). */
  get businessDate(): number {
    return this.currentDate;
  }

  /**
   * The base daily interest rate charged on a loan, *before* any overdue penalty
   * bump — the rate EOD actually accrues at ({@link accrueDailyInterest}). The Bank
   * UI reads this so the displayed loan terms match real accrual instead of
   * re-importing a default constant that silently diverges if the rate is configured.
   */
  get loanRate(): number {
    return this.loanDailyRate;
  }

  /** Read access to the ledger for projections / statements (never mutate it directly). */
  getLedger(): Ledger {
    return this.ledger;
  }

  /**
   * Capture the full persisted state of the bank — the ledger (accounts +
   * journal) plus the EOD cursors and the journal-id sequence — so it can be
   * written into a save and reloaded with {@link restore}. Everything here is
   * plain JSON-serializable data.
   */
  toSnapshot(): BankingSnapshot {
    return {
      businessDate: this.currentDate,
      lastEodDate: this.lastEodDate,
      seq: this.seq,
      ledger: this.ledger.snapshot(),
      loanDefaults: [...this.loanDefaults].map(([loanAccountId, state]) => ({
        loanAccountId,
        missedPayments: state.missedPayments,
        penaltyActive: state.penaltyActive,
        defaulted: state.defaulted,
        nextDueDate: state.nextDueDate,
        owedAtLastDue: this.loanOwedAtLastDue.get(loanAccountId) ?? 0,
      })),
    };
  }

  /**
   * Replace this service's state with a previously {@link toSnapshot}'d one (on
   * load). Rebuilds the ledger via {@link restoreLedger} — which re-validates the
   * books, so a corrupt save is rejected here — and restores the business date,
   * last-closed EOD date, and the id sequence so freshly posted entries keep
   * unique ids. The bus handler is unchanged (it still points at this service).
   */
  restore(snapshot: BankingSnapshot): void {
    this.ledger = restoreLedger(snapshot.ledger);
    this.currentDate = snapshot.businessDate;
    this.lastEodDate = snapshot.lastEodDate;
    this.seq = snapshot.seq;
    // Restore the per-loan arrears state. Clear first so nothing leaks from a
    // prior in-session game; a save made before this field existed carries none,
    // so each outstanding loan re-seeds its state lazily (current, not defaulted)
    // at the next EOD — the correct migration default.
    this.loanDefaults.clear();
    this.loanOwedAtLastDue.clear();
    for (const ld of snapshot.loanDefaults ?? []) {
      this.loanDefaults.set(ld.loanAccountId, {
        missedPayments: ld.missedPayments,
        penaltyActive: ld.penaltyActive,
        defaulted: ld.defaulted,
        nextDueDate: ld.nextDueDate,
      });
      this.loanOwedAtLastDue.set(ld.loanAccountId, ld.owedAtLastDue);
    }
  }

  /**
   * Reset the bank to a fresh, empty book of record (a newly seeded ledger,
   * business date 0, no EOD closed). Used when loading a **pre-banking save** that
   * carries no {@link BankingSnapshot}: the player's current account is re-seeded
   * from their saved `credits`, so any ledger state left over from an earlier game
   * in the same page session must be cleared first — otherwise the Bank UI would
   * show the previous game's accounts and statement. The bus handler is unchanged
   * (it still points at this service).
   */
  resetLedger(): void {
    this.ledger = createLedger();
    this.currentDate = 0;
    this.lastEodDate = null;
    this.seq = 0;
    this.loanDefaults.clear();
    this.loanOwedAtLastDue.clear();
  }

  /** Convenience read-through to the ledger balance. */
  balanceOf(accountId: string, asOf?: number): number {
    return this.ledger.balanceOf(accountId, asOf);
  }

  /**
   * The tracked arrears state of `loanAccountId`, or `undefined` if none is
   * tracked (no loan, or a loan restored from a pre-default save before its first
   * EOD re-seed). The Bank UI reads this to surface the penalty/default status and
   * to block a new loan while the current one is defaulted.
   */
  loanDefaultStateOf(loanAccountId: string): LoanDefaultState | undefined {
    return this.loanDefaults.get(loanAccountId);
  }

  /** Route a command to its handler. Exhaustive over {@link BankCommand}. */
  handle(command: BankCommand): void {
    switch (command.kind) {
      case "Transfer":
        this.handleTransfer(command);
        break;
      case "PostTransaction":
        this.handlePostTransaction(command);
        break;
      case "OpenAccount":
        this.handleOpenAccount(command);
        break;
      case "AccrueInterest":
        this.handleAccrueInterest(command);
        break;
      case "DisburseLoan":
        this.handleDisburseLoan(command);
        break;
      case "RunEndOfDay":
        this.handleRunEndOfDay(command);
        break;
      default: {
        const _exhaustive: never = command;
        void _exhaustive;
      }
    }
  }

  private nextId(): string {
    return `je:${++this.seq}`;
  }

  private handleTransfer(cmd: TransferCommand): void {
    const date = cmd.date ?? this.currentDate;
    const valueDate = cmd.valueDate ?? date;
    const entry = journalEntry({
      id: this.nextId(),
      date,
      reason: cmd.reason,
      postings: [
        { accountId: cmd.fromAccountId, amount: -cmd.amount, valueDate },
        { accountId: cmd.toAccountId, amount: cmd.amount, valueDate },
      ],
    });
    this.postAndEmit(entry);
  }

  private handlePostTransaction(cmd: PostTransactionCommand): void {
    const entry = journalEntry({
      id: this.nextId(),
      date: cmd.date ?? this.currentDate,
      reason: cmd.reason,
      postings: cmd.postings,
    });
    this.postAndEmit(entry);
  }

  private handleOpenAccount(cmd: OpenAccountCommand): void {
    this.ledger.openAccount(cmd.account);
  }

  private handleAccrueInterest(cmd: AccrueInterestCommand): void {
    const date = cmd.date ?? this.currentDate;
    const entry = journalEntry({
      id: this.nextId(),
      date,
      reason: cmd.reason ?? "Начисление процентов",
      postings: [
        { accountId: cmd.accountId, amount: cmd.amount, valueDate: date },
        { accountId: cmd.glAccountId, amount: -cmd.amount, valueDate: date },
      ],
    });
    this.postAndEmit(entry);
  }

  private handleDisburseLoan(cmd: DisburseLoanCommand): void {
    const date = cmd.date ?? this.currentDate;
    const entry = journalEntry({
      id: this.nextId(),
      date,
      reason: cmd.reason ?? "Выдача кредита",
      postings: [
        // Customer now owes the principal (loan account goes negative)…
        { accountId: cmd.loanAccountId, amount: -cmd.amount, valueDate: date },
        // …and the funds land in their current account.
        { accountId: cmd.toAccountId, amount: cmd.amount, valueDate: date },
      ],
    });
    this.postAndEmit(entry);
    // A fresh loan opens current: the first installment falls due one EOD day
    // later, and the baseline owed is the principal just disbursed (so the first
    // overdue check can tell a serviced loan from one in arrears).
    this.loanDefaults.set(cmd.loanAccountId, newLoanDefaultState(date + 1));
    this.loanOwedAtLastDue.set(cmd.loanAccountId, cmd.amount);
  }

  private handleRunEndOfDay(cmd: RunEndOfDayCommand): void {
    const date = cmd.date ?? this.currentDate;
    // Idempotent per business date: a date already closed never re-accrues or
    // re-cuts — running the batch twice for the same day is a safe no-op (no
    // double interest, no spurious statement, no date roll).
    if (this.lastEodDate !== null && date <= this.lastEodDate) return;

    // Drive each loan's default machine first (seizure + arrears bookkeeping) so a
    // freshly-missed loan accrues *this* day's interest at the penalty rate.
    this.processLoanDefaults(date);
    this.accrueDailyInterest(date);

    // Cut statements for the customer accounts, mark the day closed, and roll
    // the business date forward.
    const customerAccounts = this.ledger
      .listAccounts()
      .filter((a) => a.type !== AccountType.GL_INTERNAL)
      .map((a) => a.id);
    this.lastEodDate = date;
    this.currentDate = date + 1;
    this.bus.publish({
      kind: "StatementCut",
      date,
      accountIds: customerAccounts,
    });
  }

  /**
   * Accrue one day's interest on every interest-bearing account as of `date`:
   *
   *   interest = balanceOf(account, date) × dailyRate
   *
   * Both kinds collapse to that one signed formula because balances are signed.
   * A savings deposit (positive balance) earns a positive credit, booked against
   * the bank's interest **expense** GL leg. A loan (negative balance — the
   * customer owes principal) earns a negative posting that grows the debt,
   * booked against the bank's interest **income** GL leg. Each accrual is one
   * balanced {@link JournalEntry}; a zero (or float-noise) interest is skipped so
   * EOD never books an empty entry.
   */
  private accrueDailyInterest(date: number): void {
    for (const account of this.ledger.listAccounts()) {
      let rate: number;
      let glAccountId: string;
      let reason: string;
      if (account.type === AccountType.SAVINGS) {
        rate = this.savingsDailyRate;
        glAccountId = INTERNAL_ACCOUNTS.INTEREST_EXPENSE;
        reason = "EOD: проценты по вкладу";
      } else if (account.type === AccountType.LOAN) {
        // An overdue loan accrues at the penalty rate (the default machine flips
        // penaltyActive on a missed due); a current one at the base rate.
        const state = this.loanDefaults.get(account.id);
        rate = state
          ? penaltyDailyRate(this.loanDailyRate, state)
          : this.loanDailyRate;
        glAccountId = INTERNAL_ACCOUNTS.INTEREST_INCOME;
        reason = "EOD: проценты по кредиту";
      } else {
        continue;
      }
      const interest = this.ledger.balanceOf(account.id, date) * rate;
      if (Math.abs(interest) <= BALANCE_EPSILON) continue;
      // Dispatch the accrual onto the bus (not a direct handler call) so the EOD
      // batch is itself a visible consumer — the `AccrueInterest` command shows up
      // in `observeCommands` (the Bank UI's teaching panel) like any other.
      this.bus.dispatch({
        kind: "AccrueInterest",
        accountId: account.id,
        glAccountId,
        amount: interest,
        date,
        reason,
      });
    }
  }

  /**
   * Drive every outstanding loan's default machine one EOD step, *before* interest
   * accrues, for each loan whose scheduled payment has fallen due as of `date`:
   *
   *  - A **serviced** loan (the balance owed fell since its last due — the borrower
   *    repaid more than the period's interest) clears arrears ({@link recordScheduledPayment})
   *    and advances the due, with no seizure.
   *  - Otherwise the loan is in **arrears**: the bank seizes opportunistically
   *    ({@link seizeTowardLoan}) toward the debt. If that retires the loan the
   *    arrears clear; if not, the miss is recorded ({@link recordMissedDue}) — the
   *    penalty rate switches on and, at the policy threshold, the loan defaults and
   *    a single `LoanDefaulted` event is published for the game's reputation sanction.
   *
   * All money movement is balanced bus traffic; the GL stays balanced throughout.
   */
  private processLoanDefaults(date: number): void {
    const loans = this.ledger
      .listAccounts()
      .filter((a) => a.type === AccountType.LOAN);
    for (const loan of loans) {
      let outstanding = -this.ledger.balanceOf(loan.id, date);
      if (outstanding <= BALANCE_EPSILON) continue; // nothing owed → no arrears

      let state = this.loanDefaults.get(loan.id);
      if (!state) {
        // A loan with no tracked state (e.g. restored from a pre-default save):
        // open it current with a one-day grace, baselined at today's balance.
        state = newLoanDefaultState(date + 1);
        this.loanDefaults.set(loan.id, state);
        this.loanOwedAtLastDue.set(loan.id, outstanding);
      }
      if (!isPaymentOverdue(state, date)) continue; // not yet due

      const prevOwed = this.loanOwedAtLastDue.get(loan.id) ?? outstanding;
      const before = state;
      let after: LoanDefaultState;
      if (outstanding < prevOwed - BALANCE_EPSILON) {
        // Serviced: the borrower paid the debt down since the last due. No seizure.
        after = recordScheduledPayment(state);
      } else {
        // In arrears: seize what we can from the current account toward the loan.
        if (loan.ownerId) {
          this.seizeTowardLoan(loan.ownerId, loan.id, outstanding, date);
        }
        outstanding = -this.ledger.balanceOf(loan.id, date);
        // A sub-credit residual can't be cleared by a whole-credit seizure — write
        // it off (mirrors the Bank UI's forgiveLoanResidual) so a borrower who
        // *did* have the funds closes cleanly instead of being dinged for the dust.
        if (outstanding > BALANCE_EPSILON && outstanding < 1) {
          this.writeOffLoanResidual(loan.id, outstanding, date);
          outstanding = -this.ledger.balanceOf(loan.id, date);
        }
        after =
          outstanding <= BALANCE_EPSILON
            ? recordScheduledPayment(state) // seizure caught the loan up
            : recordMissedDue(state);
      }
      this.loanDefaults.set(loan.id, after);
      this.loanOwedAtLastDue.set(loan.id, Math.max(outstanding, 0));
      if (enteredDefault(before, after)) {
        this.bus.publish({
          kind: "LoanDefaulted",
          ownerId: loan.ownerId ?? loan.id,
          loanAccountId: loan.id,
          missedPayments: after.missedPayments,
          outstanding,
        });
      }
    }
  }

  /**
   * Seize whole credits from `ownerId`'s current account toward their overdue
   * loan: a balanced `Transfer` of `min(available, outstanding)` floored to whole
   * credits, so the integer-only current account stays whole and never goes
   * negative. A no-op when the current account is missing, empty, or under a credit.
   */
  private seizeTowardLoan(
    ownerId: string,
    loanId: string,
    outstanding: number,
    date: number,
  ): void {
    const currentId = currentAccountId(ownerId);
    if (!this.ledger.hasAccount(currentId)) return;
    const available = Math.max(this.ledger.balanceOf(currentId, date), 0);
    const seize = Math.floor(Math.min(available, outstanding));
    if (seize < 1) return;
    this.bus.dispatch({
      kind: "Transfer",
      fromAccountId: currentId,
      toAccountId: loanId,
      amount: seize,
      reason: "Списание по просроченному кредиту",
      date,
    });
  }

  /**
   * Write off a sub-credit loan residual against the bank's interest income — a
   * balanced 2-leg entry on the loan + GL only (the current account is untouched,
   * so the whole-number `player.credits` projection stays integral). Inlined here
   * (mirrors the products layer's forgiveLoanResidual) so the core need not depend
   * on the retail products above it.
   */
  private writeOffLoanResidual(
    loanId: string,
    residual: number,
    date: number,
  ): void {
    if (residual <= 0) return;
    this.bus.dispatch({
      kind: "PostTransaction",
      reason: "EOD: списание остатка по кредиту",
      date,
      postings: [
        { accountId: loanId, amount: residual },
        { accountId: INTERNAL_ACCOUNTS.INTEREST_INCOME, amount: -residual },
      ],
    });
  }

  /**
   * Commit an entry and announce it: one `TransactionPosted`, then a
   * `BalanceChanged` per distinct account with its new balance and the signed
   * delta this entry applied.
   */
  private postAndEmit(entry: JournalEntry): void {
    const accountIds = [...new Set(entry.postings.map((p) => p.accountId))];
    const before = new Map(
      accountIds.map((id) => [id, this.ledger.balanceOf(id)] as const),
    );
    this.ledger.post(entry);
    this.bus.publish({ kind: "TransactionPosted", entry });
    for (const accountId of accountIds) {
      const balance = this.ledger.balanceOf(accountId);
      this.bus.publish({
        kind: "BalanceChanged",
        accountId,
        balance,
        delta: balance - (before.get(accountId) ?? 0),
      });
    }
  }
}
