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

export const DEFAULT_SAVINGS_DAILY_RATE = 0.001;
export const DEFAULT_LOAN_DAILY_RATE = 0.002;

export interface BankingServiceOptions {
  readonly ledger?: Ledger;
  readonly startDate?: number;
  readonly savingsDailyRate?: number;
  readonly loanDailyRate?: number;
}

export class BankingService {
  private ledger: Ledger;
  private currentDate: number;
  private seq = 0;
  private readonly savingsDailyRate: number;
  private readonly loanDailyRate: number;
  private lastEodDate: number | null = null;
  private loanDefaults = new Map<string, LoanDefaultState>();
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

  get businessDate(): number {
    return this.currentDate;
  }

  get loanRate(): number {
    return this.loanDailyRate;
  }

  getLedger(): Ledger {
    return this.ledger;
  }

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

  restore(snapshot: BankingSnapshot): void {
    this.ledger = restoreLedger(snapshot.ledger);
    this.currentDate = snapshot.businessDate;
    this.lastEodDate = snapshot.lastEodDate;
    this.seq = snapshot.seq;
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

  resetLedger(): void {
    this.ledger = createLedger();
    this.currentDate = 0;
    this.lastEodDate = null;
    this.seq = 0;
    this.loanDefaults.clear();
    this.loanOwedAtLastDue.clear();
  }

  balanceOf(accountId: string, asOf?: number): number {
    return this.ledger.balanceOf(accountId, asOf);
  }

  loanDefaultStateOf(loanAccountId: string): LoanDefaultState | undefined {
    return this.loanDefaults.get(loanAccountId);
  }

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
        { accountId: cmd.loanAccountId, amount: -cmd.amount, valueDate: date },
        { accountId: cmd.toAccountId, amount: cmd.amount, valueDate: date },
      ],
    });
    this.postAndEmit(entry);
    this.loanDefaults.set(cmd.loanAccountId, newLoanDefaultState(date + 1));
    this.loanOwedAtLastDue.set(cmd.loanAccountId, cmd.amount);
  }

  private handleRunEndOfDay(cmd: RunEndOfDayCommand): void {
    const date = cmd.date ?? this.currentDate;
    if (this.lastEodDate !== null && date <= this.lastEodDate) return;

    this.processLoanDefaults(date);
    this.accrueDailyInterest(date);

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

  private processLoanDefaults(date: number): void {
    const loans = this.ledger
      .listAccounts()
      .filter((a) => a.type === AccountType.LOAN);
    for (const loan of loans) {
      let outstanding = -this.ledger.balanceOf(loan.id, date);
      if (outstanding <= BALANCE_EPSILON) continue; // nothing owed → no arrears

      let state = this.loanDefaults.get(loan.id);
      if (!state) {
        state = newLoanDefaultState(date + 1);
        this.loanDefaults.set(loan.id, state);
        this.loanOwedAtLastDue.set(loan.id, outstanding);
      }
      if (!isPaymentOverdue(state, date)) continue; // not yet due

      const prevOwed = this.loanOwedAtLastDue.get(loan.id) ?? outstanding;
      const before = state;
      let after: LoanDefaultState;
      if (outstanding < prevOwed - BALANCE_EPSILON) {
        after = recordScheduledPayment(state);
      } else {
        if (loan.ownerId) {
          this.seizeTowardLoan(loan.ownerId, loan.id, outstanding, date);
        }
        outstanding = -this.ledger.balanceOf(loan.id, date);
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
