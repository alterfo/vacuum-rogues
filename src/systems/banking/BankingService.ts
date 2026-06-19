import {
  AccountType,
  BALANCE_EPSILON,
  INTERNAL_ACCOUNTS,
  Ledger,
  createLedger,
  journalEntry,
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
 * EOD (`RunEndOfDay`) is intentionally thin here — it rolls the business date and
 * cuts statements; Task 5 layers accruals and fees onto the same hook.
 */
export class BankingService {
  private readonly ledger: Ledger;
  private currentDate: number;
  private seq = 0;
  private readonly savingsDailyRate: number;
  private readonly loanDailyRate: number;
  /** The last business date a full EOD batch closed — guards against re-running it. */
  private lastEodDate: number | null = null;

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

  /** Read access to the ledger for projections / statements (never mutate it directly). */
  getLedger(): Ledger {
    return this.ledger;
  }

  /** Convenience read-through to the ledger balance. */
  balanceOf(accountId: string, asOf?: number): number {
    return this.ledger.balanceOf(accountId, asOf);
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
  }

  private handleRunEndOfDay(cmd: RunEndOfDayCommand): void {
    const date = cmd.date ?? this.currentDate;
    // Idempotent per business date: a date already closed never re-accrues or
    // re-cuts — running the batch twice for the same day is a safe no-op (no
    // double interest, no spurious statement, no date roll).
    if (this.lastEodDate !== null && date <= this.lastEodDate) return;

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
        rate = this.loanDailyRate;
        glAccountId = INTERNAL_ACCOUNTS.INTEREST_INCOME;
        reason = "EOD: проценты по кредиту";
      } else {
        continue;
      }
      const interest = this.ledger.balanceOf(account.id, date) * rate;
      if (Math.abs(interest) <= BALANCE_EPSILON) continue;
      this.handleAccrueInterest({
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
