import { GameValidationException } from "@/exceptions/GameValidationException";

/**
 * Pure double-entry general ledger — the authoritative book of record for the
 * in-game "АБС" (core banking system). It lives in the domain layer, so it has
 * NO PixiJS / ONNX / DOM dependencies: just data + the two invariants a banking
 * core lives or dies on:
 *
 *   1. Every {@link JournalEntry} is *balanced*: Σ(postings.amount) == 0.
 *   2. `balanceOf(account)` == Σ(amount) of every posting that touches it.
 *
 * Amounts are *signed* against the account: a positive posting increases that
 * account's balance, a negative one decreases it. A "transfer of X from A to B"
 * is therefore a single entry with `{A: -X, B: +X}` whose legs sum to zero. The
 * net effect on a player's current account equals the old `credits` delta, which
 * is how the later economy migration stays backward-compatible.
 */

/** The four account flavours the prototype models (generic core-banking kinds). */
export enum AccountType {
  /** A customer's spendable current/checking account (the player or an NPC). */
  CURRENT = "CURRENT",
  /** An interest-bearing savings deposit. */
  SAVINGS = "SAVINGS",
  /** A loan account (a negative balance the customer owes). */
  LOAN = "LOAN",
  /** An internal general-ledger account (cash, P&L, suspense, …) — the bank's own books. */
  GL_INTERNAL = "GL_INTERNAL",
}

export interface Account {
  /** Stable account id, e.g. `"cur:player"` or `"gl:cash"`. */
  readonly id: string;
  readonly type: AccountType;
  /** Human-readable label for statements / the Bank UI (Russian, UI-facing). */
  readonly label: string;
  /**
   * The customer this account belongs to (player id / npc id / faction id).
   * `undefined` for {@link AccountType.GL_INTERNAL} accounts, which are the
   * bank's own.
   */
  readonly ownerId?: string;
}

/** One leg of a {@link JournalEntry}: a signed movement on a single account. */
export interface Posting {
  readonly accountId: string;
  /** Signed amount: `>0` increases the account balance, `<0` decreases it. */
  readonly amount: number;
  /**
   * The business day this posting takes *value* (drives interest accrual). May
   * differ from the entry's booking `date` — a back- or forward-valued posting
   * is only counted by `balanceOf(account, asOf)` once `asOf >= valueDate`.
   */
  readonly valueDate: number;
}

/** A balanced set of postings booked together — the atomic unit of the ledger. */
export interface JournalEntry {
  readonly id: string;
  /** Booking / business date the entry was posted. */
  readonly date: number;
  /** Short narrative for the statement ("Trade: bought Metals", …). */
  readonly reason: string;
  readonly postings: readonly Posting[];
}

/**
 * Tolerance for the balanced-entry check. Amounts are plain numbers (the game's
 * credits are integers, but interest accrual produces fractions), so a tiny
 * epsilon absorbs IEEE-754 summation noise while still rejecting any real
 * imbalance.
 */
export const BALANCE_EPSILON = 1e-6;

/** Σ of a set of postings' signed amounts. Exact-ish; see {@link BALANCE_EPSILON}. */
export function sumPostings(postings: readonly Posting[]): number {
  let sum = 0;
  for (const p of postings) sum += p.amount;
  return sum;
}

/** True when the postings net to (approximately) zero — the double-entry rule. */
export function isBalanced(postings: readonly Posting[]): boolean {
  return Math.abs(sumPostings(postings)) <= BALANCE_EPSILON;
}

/** Input shape for {@link journalEntry}; `valueDate` defaults to the entry date. */
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

/**
 * Build a validated, frozen {@link JournalEntry}. Rejects anything that violates
 * double-entry: fewer than two legs, or postings that don't sum to zero. Each
 * posting's `valueDate` defaults to the entry's booking `date` when omitted.
 *
 * @throws GameValidationException `LEDGER_DEGENERATE_ENTRY` / `LEDGER_UNBALANCED`
 */
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

/** Canonical ids for the bank's internal GL accounts (seeded on every ledger). */
export const INTERNAL_ACCOUNTS = {
  /** Cash / settlement account — the money source/sink of the bank. */
  CASH: "gl:cash",
  /** Interest the bank earns (e.g. on loans). */
  INTEREST_INCOME: "gl:interest_income",
  /** Interest the bank pays out (e.g. on savings). */
  INTEREST_EXPENSE: "gl:interest_expense",
  /** Suspense / unmatched holding account. */
  SUSPENSE: "gl:suspense",
  /** Profit & loss roll-up. */
  PNL: "gl:pnl",
} as const;

/** Open the five standard internal GL accounts on a ledger. Idempotent-safe to call once. */
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

/**
 * The general ledger: a registry of accounts plus an append-only journal. All
 * money in the prototype lives here; `player.credits` becomes a projection of
 * `balanceOf(playerCurrentAccount)`.
 */
export class Ledger {
  private readonly accounts = new Map<string, Account>();
  private readonly entries: JournalEntry[] = [];

  /**
   * Register a new account.
   * @throws GameValidationException `LEDGER_ACCOUNT_EXISTS` on a duplicate id.
   */
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

  /**
   * Post a balanced journal entry. Re-validates the double-entry invariant
   * (defensively, in case the entry was hand-built rather than via
   * {@link journalEntry}) and that every referenced account exists, then appends
   * it to the journal.
   *
   * @throws GameValidationException `LEDGER_DEGENERATE_ENTRY` / `LEDGER_UNBALANCED` / `LEDGER_UNKNOWN_ACCOUNT`
   */
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

  /**
   * Current balance of an account = Σ of every posting that touches it. When
   * `asOf` is supplied, only postings with `valueDate <= asOf` are counted
   * (value-dated balance — the figure interest accrual uses).
   */
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

  /** Every posting that touches an account, oldest first (for statements). */
  postingsFor(accountId: string): Posting[] {
    const out: Posting[] = [];
    for (const e of this.entries) {
      for (const p of e.postings) {
        if (p.accountId === accountId) out.push(p);
      }
    }
    return out;
  }

  /**
   * Σ of *all* postings across the whole ledger. The global double-entry
   * invariant guarantees this is always (approximately) zero.
   */
  totalBalance(): number {
    let sum = 0;
    for (const e of this.entries) sum += sumPostings(e.postings);
    return sum;
  }
}

/** Construct a fresh ledger with the five internal GL accounts already open. */
export function createLedger(): Ledger {
  const ledger = new Ledger();
  seedInternalAccounts(ledger);
  return ledger;
}
