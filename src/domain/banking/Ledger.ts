import { GameValidationException } from "@/exceptions/GameValidationException";

export enum AccountType {
  CURRENT = "CURRENT",
  SAVINGS = "SAVINGS",
  LOAN = "LOAN",
  GL_INTERNAL = "GL_INTERNAL",
}

export interface Account {
  readonly id: string;
  readonly type: AccountType;
  readonly label: string;
  readonly ownerId?: string;
}

export interface Posting {
  readonly accountId: string;
  readonly amount: number;
  readonly valueDate: number;
}

export interface JournalEntry {
  readonly id: string;
  readonly date: number;
  readonly reason: string;
  readonly postings: readonly Posting[];
}

export const BALANCE_EPSILON = 1e-6;

export function sumPostings(postings: readonly Posting[]): number {
  let sum = 0;
  for (const p of postings) sum += p.amount;
  return sum;
}

export function isBalanced(postings: readonly Posting[]): boolean {
  return Math.abs(sumPostings(postings)) <= BALANCE_EPSILON;
}

export interface PostingInput {
  readonly accountId: string;
  readonly amount: number;
  readonly valueDate?: number;
}

export interface JournalEntryInput {
  readonly id: string;
  readonly date: number;
  readonly reason: string;
  readonly postings: readonly PostingInput[];
}

export function journalEntry(input: JournalEntryInput): JournalEntry {
  const postings: Posting[] = input.postings.map((p) =>
    Object.freeze({
      accountId: p.accountId,
      amount: p.amount,
      valueDate: p.valueDate ?? input.date,
    }),
  );

  if (postings.length < 2) {
    throw new GameValidationException(
      "LEDGER_DEGENERATE_ENTRY",
      `Journal entry "${input.id}" needs at least two postings (double-entry); got ${postings.length}.`,
      { id: input.id, count: postings.length },
    );
  }

  const badLeg = postings.find((p) => !Number.isFinite(p.amount));
  if (badLeg) {
    throw new GameValidationException(
      "LEDGER_DEGENERATE_ENTRY",
      `Journal entry "${input.id}" has a non-finite amount on ${badLeg.accountId} (${badLeg.amount}).`,
      { id: input.id, accountId: badLeg.accountId, amount: badLeg.amount },
    );
  }

  if (!isBalanced(postings)) {
    throw new GameValidationException(
      "LEDGER_UNBALANCED",
      `Journal entry "${input.id}" is unbalanced: postings sum to ${sumPostings(postings)}, expected 0.`,
      { id: input.id, sum: sumPostings(postings) },
    );
  }

  return Object.freeze({
    id: input.id,
    date: input.date,
    reason: input.reason,
    postings: Object.freeze(postings),
  });
}

export const INTERNAL_ACCOUNTS = {
  CASH: "gl:cash",
  INTEREST_INCOME: "gl:interest_income",
  INTEREST_EXPENSE: "gl:interest_expense",
  SUSPENSE: "gl:suspense",
  PNL: "gl:pnl",
} as const;

export function seedInternalAccounts(ledger: Ledger): void {
  ledger.openAccount({
    id: INTERNAL_ACCOUNTS.CASH,
    type: AccountType.GL_INTERNAL,
    label: "Касса банка",
  });
  ledger.openAccount({
    id: INTERNAL_ACCOUNTS.INTEREST_INCOME,
    type: AccountType.GL_INTERNAL,
    label: "Процентный доход",
  });
  ledger.openAccount({
    id: INTERNAL_ACCOUNTS.INTEREST_EXPENSE,
    type: AccountType.GL_INTERNAL,
    label: "Процентный расход",
  });
  ledger.openAccount({
    id: INTERNAL_ACCOUNTS.SUSPENSE,
    type: AccountType.GL_INTERNAL,
    label: "Промежуточный счёт",
  });
  ledger.openAccount({
    id: INTERNAL_ACCOUNTS.PNL,
    type: AccountType.GL_INTERNAL,
    label: "Прибыли и убытки",
  });
}

export class Ledger {
  private readonly accounts = new Map<string, Account>();
  private readonly entries: JournalEntry[] = [];

  openAccount(account: Account): Account {
    if (this.accounts.has(account.id)) {
      throw new GameValidationException(
        "LEDGER_ACCOUNT_EXISTS",
        `Account "${account.id}" is already open.`,
        { id: account.id },
      );
    }
    const frozen = Object.freeze({ ...account });
    this.accounts.set(account.id, frozen);
    return frozen;
  }

  hasAccount(id: string): boolean {
    return this.accounts.has(id);
  }

  getAccount(id: string): Account | undefined {
    return this.accounts.get(id);
  }

  listAccounts(): Account[] {
    return [...this.accounts.values()];
  }

  listEntries(): readonly JournalEntry[] {
    return this.entries;
  }

  post(entry: JournalEntry): JournalEntry {
    if (entry.postings.length < 2) {
      throw new GameValidationException(
        "LEDGER_DEGENERATE_ENTRY",
        `Journal entry "${entry.id}" needs at least two postings; got ${entry.postings.length}.`,
        { id: entry.id, count: entry.postings.length },
      );
    }
    if (!isBalanced(entry.postings)) {
      throw new GameValidationException(
        "LEDGER_UNBALANCED",
        `Journal entry "${entry.id}" is unbalanced: postings sum to ${sumPostings(entry.postings)}, expected 0.`,
        { id: entry.id, sum: sumPostings(entry.postings) },
      );
    }
    for (const p of entry.postings) {
      if (!this.accounts.has(p.accountId)) {
        throw new GameValidationException(
          "LEDGER_UNKNOWN_ACCOUNT",
          `Journal entry "${entry.id}" posts to unknown account "${p.accountId}".`,
          { id: entry.id, accountId: p.accountId },
        );
      }
    }
    this.entries.push(entry);
    return entry;
  }

  balanceOf(accountId: string, asOf?: number): number {
    let sum = 0;
    for (const e of this.entries) {
      for (const p of e.postings) {
        if (p.accountId !== accountId) continue;
        if (asOf !== undefined && p.valueDate > asOf) continue;
        sum += p.amount;
      }
    }
    return sum;
  }

  postingsFor(accountId: string): Posting[] {
    const out: Posting[] = [];
    for (const e of this.entries) {
      for (const p of e.postings) {
        if (p.accountId === accountId) out.push(p);
      }
    }
    return out;
  }

  snapshot(): LedgerSnapshot {
    return {
      accounts: this.listAccounts().map((a) => ({ ...a })),
      entries: this.entries.map((e) => ({
        id: e.id,
        date: e.date,
        reason: e.reason,
        postings: e.postings.map((p) => ({
          accountId: p.accountId,
          amount: p.amount,
          valueDate: p.valueDate,
        })),
      })),
    };
  }

  totalBalance(): number {
    let sum = 0;
    for (const e of this.entries) sum += sumPostings(e.postings);
    return sum;
  }
}

export function createLedger(): Ledger {
  const ledger = new Ledger();
  seedInternalAccounts(ledger);
  return ledger;
}

export interface LedgerSnapshot {
  readonly accounts: Account[];
  readonly entries: JournalEntry[];
}

export interface LoanDefaultSnapshot {
  readonly loanAccountId: string;
  readonly missedPayments: number;
  readonly penaltyActive: boolean;
  readonly defaulted: boolean;
  readonly nextDueDate: number;
  readonly owedAtLastDue: number;
}

export interface BankingSnapshot {
  readonly businessDate: number;
  readonly lastEodDate: number | null;
  readonly seq: number;
  readonly ledger: LedgerSnapshot;
  readonly loanDefaults?: readonly LoanDefaultSnapshot[];
}

export function restoreLedger(snapshot: LedgerSnapshot): Ledger {
  const ledger = new Ledger();
  for (const account of snapshot.accounts) {
    ledger.openAccount(account);
  }
  for (const entry of snapshot.entries) {
    ledger.post(
      journalEntry({
        id: entry.id,
        date: entry.date,
        reason: entry.reason,
        postings: entry.postings.map((p) => ({
          accountId: p.accountId,
          amount: p.amount,
          valueDate: p.valueDate,
        })),
      }),
    );
  }
  return ledger;
}
