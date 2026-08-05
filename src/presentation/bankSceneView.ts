import {
  AccountType,
  type JournalEntry,
  type Ledger,
} from "@/domain/banking/Ledger";
import type { BankCommand } from "@/systems/banking/bus";
import type { LoanTermsSummary } from "@/systems/banking/products";

export interface AccountRow {
  readonly id: string;
  readonly label: string;
  readonly type: AccountType;
  readonly balance: number;
}

export interface StatementRow {
  readonly date: number;
  readonly reason: string;
  readonly delta: number;
  readonly balanceAfter: number;
}

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

export function formatCredits(amount: number): string {
  const rounded = Math.round(amount);
  const grouped = Math.abs(rounded)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${rounded < 0 ? "−" : ""}${grouped} ₡`;
}

export const BANK_TOAST = {
  success: 0x66ddaa,
  info: 0x66ddff,
  warn: 0xffcc44,
  error: 0xff8866,
} as const;

export function showBankBusPanel(debug: boolean): boolean {
  return debug;
}

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

export function wholeCreditsToCurrent(...limits: number[]): number {
  return Math.max(0, Math.floor(Math.min(...limits)));
}

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

export function describePosting(entry: JournalEntry): string {
  const legs = entry.postings.length;
  return `✓ ГК: ${entry.reason} (${legs} пров.)`;
}

export function formatDailyRate(dailyRate: number): string {
  const pct = dailyRate * 100;
  const str = Number.isInteger(pct)
    ? String(pct)
    : pct.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return `${str.replace(".", ",")} %/день`;
}

export interface LoanPanelLine {
  readonly label: string;
  readonly value: string;
  readonly tone?: "debt" | "muted" | "plain";
}

export interface LoanArrears {
  readonly penaltyActive: boolean;
  readonly defaulted: boolean;
  readonly nextDueDate?: number;
}

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
