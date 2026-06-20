import {
  AccountType,
  type JournalEntry,
  type Ledger,
} from "@/domain/banking/Ledger";
import type { BankCommand } from "@/systems/banking/bus";
import type { LoanTermsSummary } from "@/systems/banking/products";

/**
 * Pure view-model for {@link BankScene} — the Galactic Bank screen reads the
 * ledger and the bus through these helpers, so the data shaping (account rows,
 * statement running balances, the live "command → posting" bus log) is testable
 * without standing up PixiJS. Nothing here imports the renderer; the scene maps
 * these rows to `Text`/`Graphics`.
 */

/** One customer account as the accounts panel renders it. */
export interface AccountRow {
  readonly id: string;
  readonly label: string;
  readonly type: AccountType;
  readonly balance: number;
}

/** One statement line for an account: the entry's net effect + running balance. */
export interface StatementRow {
  readonly date: number;
  readonly reason: string;
  /** Signed net effect of this entry on the statement's account. */
  readonly delta: number;
  /** The account's running balance after this entry. */
  readonly balanceAfter: number;
}

/** Russian label for an account type (accounts-panel sub-heading). */
export function accountTypeLabel(type: AccountType): string {
  switch (type) {
    case AccountType.CURRENT:
      return "Текущий счёт";
    case AccountType.SAVINGS:
      return "Вклад";
    case AccountType.LOAN:
      return "Кредит";
    case AccountType.GL_INTERNAL:
      return "ГК банка";
    default: {
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
}

/**
 * Format a signed credit amount for the UI: rounded, thousands grouped with a
 * space, suffixed with the credits glyph. Negative uses a real minus sign
 * (U+2212) so debit lines read cleanly, e.g. `−1 500 ₡`.
 */
export function formatCredits(amount: number): string {
  const rounded = Math.round(amount);
  const grouped = Math.abs(rounded)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${rounded < 0 ? "−" : ""}${grouped} ₡`;
}

/**
 * The customer accounts to show, in `accountIds` order, skipping any not yet
 * open on the ledger (a player may have no savings/loan). Each row carries the
 * account's current GL balance.
 */
export function playerAccountRows(
  ledger: Ledger,
  accountIds: readonly string[],
): AccountRow[] {
  const rows: AccountRow[] = [];
  for (const id of accountIds) {
    const account = ledger.getAccount(id);
    if (!account) continue;
    rows.push({
      id,
      label: account.label,
      type: account.type,
      balance: ledger.balanceOf(id),
    });
  }
  return rows;
}

/**
 * Build an account statement from the journal: one row per entry that touches
 * `accountId`, with the entry's net effect on the account and the account's
 * running balance after it. When `limit` is given, only the most recent `limit`
 * rows are returned (the running balances still reflect the full history).
 */
export function statementRows(
  entries: readonly JournalEntry[],
  accountId: string,
  limit?: number,
): StatementRow[] {
  const rows: StatementRow[] = [];
  let running = 0;
  for (const entry of entries) {
    let delta = 0;
    let touched = false;
    for (const posting of entry.postings) {
      if (posting.accountId === accountId) {
        delta += posting.amount;
        touched = true;
      }
    }
    if (!touched) continue;
    running += delta;
    rows.push({
      date: entry.date,
      reason: entry.reason,
      delta,
      balanceAfter: running,
    });
  }
  return limit !== undefined ? rows.slice(-limit) : rows;
}

/**
 * The whole-credit amount to move onto a *current* account, capped by every
 * value in `limits`. EOD interest leaves savings/loan balances fractional, but
 * `player.credits` is whole-number currency — and its save schema rejects a
 * non-integer (`PlayerSchema.credits` is `int()`), so projecting a fractional
 * current-account balance corrupts the save on reload. A withdrawal/repayment
 * must therefore move only whole credits onto the current account; any
 * sub-credit remainder stays on the savings/loan account. Returns 0 (a no-op)
 * when nothing whole can move.
 */
export function wholeCreditsToCurrent(...limits: number[]): number {
  return Math.max(0, Math.floor(Math.min(...limits)));
}

/**
 * One-line description of a command flowing onto the bus, for the live
 * "consumers → шина → проводки" panel (the teaching artifact).
 */
export function describeCommand(cmd: BankCommand): string {
  switch (cmd.kind) {
    case "Transfer":
      return `Transfer ${formatCredits(cmd.amount)} — ${cmd.reason}`;
    case "PostTransaction":
      return `Проводка — ${cmd.reason}`;
    case "OpenAccount":
      return `Открыть счёт «${cmd.account.label}»`;
    case "AccrueInterest":
      return `Проценты ${formatCredits(cmd.amount)}`;
    case "DisburseLoan":
      return `Выдача кредита ${formatCredits(cmd.amount)}`;
    case "RunEndOfDay":
      return "Конец дня (EOD)";
    default: {
      const _exhaustive: never = cmd;
      return _exhaustive;
    }
  }
}

/** One-line description of a committed journal entry (the resulting GL posting). */
export function describePosting(entry: JournalEntry): string {
  const legs = entry.postings.length;
  return `✓ ГК: ${entry.reason} (${legs} пров.)`;
}

/**
 * Format a per-day loan interest *fraction* as a Russian-locale percent string,
 * e.g. `0.002 → "0,2 %/день"`. Up to two decimals, trailing zeros trimmed, with
 * a comma decimal separator to match the rest of the UI.
 */
export function formatDailyRate(dailyRate: number): string {
  const pct = dailyRate * 100;
  const str = Number.isInteger(pct)
    ? String(pct)
    : pct.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return `${str.replace(".", ",")} %/день`;
}

/** One label/value line of the loan panel; `tone` drives the value colour. */
export interface LoanPanelLine {
  readonly label: string;
  readonly value: string;
  /** `debt` (red), `muted` (amber — totals), else the plain bright value. */
  readonly tone?: "debt" | "muted" | "plain";
}

/** The arrears flags the loan panel and the borrow gate read (a subset of `LoanDefaultState`). */
export interface LoanArrears {
  /** `true` while the loan is overdue and accruing at the penalty rate. */
  readonly penaltyActive: boolean;
  /** `true` once the loan has crossed the default threshold (blocks new loans). */
  readonly defaulted: boolean;
  /** Business date the next scheduled installment falls due (surfaced as a countdown). */
  readonly nextDueDate?: number;
}

/**
 * Why a new loan is blocked, or `null` if the player may borrow. The block is
 * gated on there being **actual outstanding debt**: a **defaulted** loan blocks
 * with its own message (погасите задолженность), an outstanding but not-yet-defaulted
 * loan with the ordinary "repay the current one first". Once the debt is settled
 * (`outstanding <= 0`) borrowing is allowed even if the `defaulted` flag is still
 * set — the flag persists on a paid-off loan (the EOD recovery path skips a
 * zero-balance loan), and the reputation hit already landed, so a settled debt
 * must not be a permanent borrowing ban. Pure, so the `doTakeLoan` gate is
 * unit-testable. `outstanding` is positive when in debt (`-balanceOf(loanAccount)`).
 */
export function borrowBlockReason(
  outstanding: number,
  arrears?: LoanArrears,
): string | null {
  if (outstanding > 0) {
    if (arrears?.defaulted) {
      return "Кредит в дефолте — сначала погасите задолженность";
    }
    return "Сначала погасите текущий кредит";
  }
  return null;
}

/**
 * The label/value lines the Bank's loan panel renders. With no outstanding debt
 * (`outstanding <= 0`) it shows the **offer** — principal, per-day rate, term,
 * the per-day payment and the total repayable — so the player reads the terms
 * before borrowing. With an active loan it shows the **live position** — the
 * outstanding debt, the per-day payment and the rate. Pure: derived entirely
 * from the (unit-tested) {@link LoanTermsSummary} + the outstanding balance, so
 * the scene only maps these rows to `Text`. `outstanding` is positive when in
 * debt (i.e. `-balanceOf(loanAccount)`). When `businessDate` is given and the loan
 * carries a tracked `nextDueDate`, the active view also shows when the next
 * installment falls due (a countdown). When the active loan is in arrears the
 * panel appends a status line explaining the penalty rate / the new-loan block.
 */
export function loanPanelLines(
  summary: LoanTermsSummary,
  outstanding: number,
  arrears?: LoanArrears,
  businessDate?: number,
): LoanPanelLine[] {
  const rate = formatDailyRate(summary.dailyRate);
  const payment = `≈ ${formatCredits(summary.perPeriodPayment)}`;
  if (outstanding > 0) {
    const lines: LoanPanelLine[] = [
      {
        label: "Текущий долг",
        value: formatCredits(outstanding),
        tone: "debt",
      },
      { label: "Платёж/день", value: payment },
      { label: "Ставка", value: rate, tone: "muted" },
    ];
    if (arrears?.nextDueDate !== undefined && businessDate !== undefined) {
      const daysUntil = arrears.nextDueDate - businessDate;
      lines.push({
        label: "След. платёж",
        value: daysUntil > 0 ? `через ${daysUntil} дн.` : "просрочен",
        tone: daysUntil > 0 ? "plain" : "debt",
      });
    }
    if (arrears?.defaulted) {
      lines.push({
        label: "Статус",
        value: "Дефолт — займы заблокированы",
        tone: "debt",
      });
    } else if (arrears?.penaltyActive) {
      lines.push({
        label: "Статус",
        value: "Просрочка — штрафная ставка",
        tone: "debt",
      });
    }
    return lines;
  }
  return [
    { label: "Сумма кредита", value: formatCredits(summary.principal) },
    { label: "Ставка", value: rate },
    { label: "Срок", value: `${summary.periods} дн.` },
    { label: "Платёж/день", value: payment },
    {
      label: "К возврату",
      value: formatCredits(summary.totalRepayable),
      tone: "muted",
    },
  ];
}
