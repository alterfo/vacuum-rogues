import { describe, expect, it } from "vitest";
import {
  AccountType,
  createLedger,
  journalEntry,
  type JournalEntry,
} from "@/domain/banking/Ledger";
import {
  accountTypeLabel,
  describeCommand,
  describePosting,
  formatCredits,
  playerAccountRows,
  statementRows,
  wholeCreditsToCurrent,
} from "@/presentation/bankSceneView";

describe("formatCredits", () => {
  it("renders small amounts without grouping", () => {
    expect(formatCredits(0)).toBe("0 ₡");
    expect(formatCredits(750)).toBe("750 ₡");
  });

  it("groups thousands and uses a real minus for debits", () => {
    expect(formatCredits(1500)).toBe("1 500 ₡");
    expect(formatCredits(1234567)).toBe("1 234 567 ₡");
    expect(formatCredits(-1500)).toBe("−1 500 ₡");
  });

  it("rounds fractional accruals", () => {
    expect(formatCredits(1000.4)).toBe("1 000 ₡");
    expect(formatCredits(999.6)).toBe("1 000 ₡");
  });
});

describe("wholeCreditsToCurrent", () => {
  it("floors a fractional balance to whole credits", () => {
    // EOD interest leaves savings/loan balances fractional; only whole credits
    // may land on a current account (player.credits is int() in the save schema).
    expect(wholeCreditsToCurrent(1000, 502.001)).toBe(502);
    expect(wholeCreditsToCurrent(3015.7)).toBe(3015);
  });

  it("caps by the smallest limit", () => {
    expect(wholeCreditsToCurrent(1000, 5000)).toBe(1000);
    expect(wholeCreditsToCurrent(1000, 250.9, 800)).toBe(250);
  });

  it("returns 0 (a no-op) when only a sub-credit remainder is left", () => {
    expect(wholeCreditsToCurrent(1000, 0.4)).toBe(0);
    expect(wholeCreditsToCurrent(1000, -5)).toBe(0);
  });

  it("always yields an integer so the projected credits stays save-safe", () => {
    for (const v of [0.1, 1.999, 999.9999, 1000.5]) {
      expect(Number.isInteger(wholeCreditsToCurrent(2000, v))).toBe(true);
    }
  });
});

describe("accountTypeLabel", () => {
  it("maps every account type to a Russian label", () => {
    expect(accountTypeLabel(AccountType.CURRENT)).toBe("Текущий счёт");
    expect(accountTypeLabel(AccountType.SAVINGS)).toBe("Вклад");
    expect(accountTypeLabel(AccountType.LOAN)).toBe("Кредит");
    expect(accountTypeLabel(AccountType.GL_INTERNAL)).toBe("ГК банка");
  });
});

describe("playerAccountRows", () => {
  it("returns balances in id order and skips accounts that aren't open", () => {
    const ledger = createLedger();
    ledger.openAccount({
      id: "cur:player",
      type: AccountType.CURRENT,
      label: "Текущий счёт",
    });
    ledger.openAccount({
      id: "sav:player",
      type: AccountType.SAVINGS,
      label: "Сберегательный вклад",
    });
    // Seed: cash → current 1000, then current → savings 300.
    ledger.post(
      journalEntry({
        id: "e1",
        date: 0,
        reason: "open",
        postings: [
          { accountId: "gl:cash", amount: -1000 },
          { accountId: "cur:player", amount: 1000 },
        ],
      }),
    );
    ledger.post(
      journalEntry({
        id: "e2",
        date: 0,
        reason: "deposit",
        postings: [
          { accountId: "cur:player", amount: -300 },
          { accountId: "sav:player", amount: 300 },
        ],
      }),
    );

    const rows = playerAccountRows(ledger, [
      "cur:player",
      "sav:player",
      "loan:player", // not open — skipped
    ]);
    expect(rows.map((r) => r.id)).toEqual(["cur:player", "sav:player"]);
    expect(rows[0]).toMatchObject({ type: AccountType.CURRENT, balance: 700 });
    expect(rows[1]).toMatchObject({ type: AccountType.SAVINGS, balance: 300 });
  });
});

describe("statementRows", () => {
  const entries: JournalEntry[] = [
    journalEntry({
      id: "e1",
      date: 1,
      reason: "Открытие счёта",
      postings: [
        { accountId: "gl:cash", amount: -1000 },
        { accountId: "cur:player", amount: 1000 },
      ],
    }),
    journalEntry({
      id: "e2",
      date: 2,
      reason: "Продажа: Металлы",
      postings: [
        { accountId: "gl:market", amount: -500 },
        { accountId: "cur:player", amount: 500 },
      ],
    }),
    journalEntry({
      id: "e3",
      date: 2,
      reason: "Ремонт корпуса",
      postings: [
        { accountId: "cur:player", amount: -200 },
        { accountId: "gl:services", amount: 200 },
      ],
    }),
    // An entry that does not touch the current account — must be skipped.
    journalEntry({
      id: "e4",
      date: 3,
      reason: "EOD: проценты по кредиту",
      postings: [
        { accountId: "gl:cash", amount: -10 },
        { accountId: "gl:interest_income", amount: 10 },
      ],
    }),
  ];

  it("lists only entries touching the account, with a running balance", () => {
    const rows = statementRows(entries, "cur:player");
    expect(rows).toEqual([
      { date: 1, reason: "Открытие счёта", delta: 1000, balanceAfter: 1000 },
      { date: 2, reason: "Продажа: Металлы", delta: 500, balanceAfter: 1500 },
      { date: 2, reason: "Ремонт корпуса", delta: -200, balanceAfter: 1300 },
    ]);
  });

  it("returns only the most recent `limit` rows but keeps running balances correct", () => {
    const rows = statementRows(entries, "cur:player", 2);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      reason: "Продажа: Металлы",
      balanceAfter: 1500,
    });
    expect(rows[1]).toMatchObject({
      reason: "Ремонт корпуса",
      balanceAfter: 1300,
    });
  });
});

describe("describeCommand / describePosting", () => {
  it("renders a one-line summary for each command kind", () => {
    expect(
      describeCommand({
        kind: "Transfer",
        fromAccountId: "a",
        toAccountId: "b",
        amount: 250,
        reason: "Продажа товара",
      }),
    ).toBe("Transfer 250 ₡ — Продажа товара");
    expect(
      describeCommand({
        kind: "OpenAccount",
        account: { id: "sav:p", type: AccountType.SAVINGS, label: "Вклад" },
      }),
    ).toBe("Открыть счёт «Вклад»");
    expect(
      describeCommand({
        kind: "DisburseLoan",
        loanAccountId: "loan:p",
        toAccountId: "cur:p",
        amount: 5000,
      }),
    ).toBe("Выдача кредита 5 000 ₡");
    expect(describeCommand({ kind: "RunEndOfDay" })).toBe("Конец дня (EOD)");
    // PostTransaction now flows through the live panel in production (loan-residual
    // write-off), and AccrueInterest is the EOD interest leg — both must render.
    expect(
      describeCommand({
        kind: "PostTransaction",
        reason: "Списание остатка по кредиту",
        postings: [
          { accountId: "loan:p", amount: 0.5 },
          { accountId: "gl:interest_income", amount: -0.5 },
        ],
      }),
    ).toBe("Проводка — Списание остатка по кредиту");
    expect(
      describeCommand({
        kind: "AccrueInterest",
        accountId: "sav:p",
        glAccountId: "gl:interest_expense",
        amount: 12,
      }),
    ).toBe("Проценты 12 ₡");
  });

  it("describes a committed posting with its leg count", () => {
    const entry = journalEntry({
      id: "e1",
      date: 0,
      reason: "Продажа: Металлы",
      postings: [
        { accountId: "gl:market", amount: -500 },
        { accountId: "cur:player", amount: 500 },
      ],
    });
    expect(describePosting(entry)).toBe("✓ ГК: Продажа: Металлы (2 пров.)");
  });
});
