import { describe, it, expect } from "vitest";
import {
  AccountType,
  BALANCE_EPSILON,
  INTERNAL_ACCOUNTS,
  Ledger,
  createLedger,
  isBalanced,
  journalEntry,
  seedInternalAccounts,
  sumPostings,
} from "@/domain/banking/Ledger";
import { GameValidationException } from "@/exceptions/GameValidationException";

/**
 * Task 1 — the pure double-entry ledger. These tests pin the two invariants the
 * whole АБС prototype rests on: every entry is balanced (Σ amount == 0) and an
 * account's balance is exactly the sum of its postings (value-dated when asked).
 */

const PLAYER = "cur:player";

function openPlayer(ledger: Ledger): void {
  ledger.openAccount({
    id: PLAYER,
    type: AccountType.CURRENT,
    label: "Игрок",
    ownerId: "player",
  });
}

describe("journalEntry — double-entry validation", () => {
  it("accepts a balanced two-leg entry and freezes it", () => {
    const entry = journalEntry({
      id: "e1",
      date: 1,
      reason: "Test transfer",
      postings: [
        { accountId: PLAYER, amount: 100 },
        { accountId: INTERNAL_ACCOUNTS.CASH, amount: -100 },
      ],
    });

    expect(entry.postings).toHaveLength(2);
    expect(isBalanced(entry.postings)).toBe(true);
    expect(sumPostings(entry.postings)).toBe(0);
    expect(Object.isFrozen(entry)).toBe(true);
    expect(Object.isFrozen(entry.postings)).toBe(true);
  });

  it("defaults each posting's valueDate to the entry booking date", () => {
    const entry = journalEntry({
      id: "e1",
      date: 7,
      reason: "Test",
      postings: [
        { accountId: PLAYER, amount: 50 },
        { accountId: INTERNAL_ACCOUNTS.CASH, amount: -50, valueDate: 9 },
      ],
    });

    expect(entry.postings[0].valueDate).toBe(7); // inherited from date
    expect(entry.postings[1].valueDate).toBe(9); // explicit override
  });

  it("rejects an unbalanced entry (Σ amount ≠ 0)", () => {
    expect(() =>
      journalEntry({
        id: "bad",
        date: 1,
        reason: "Money from nowhere",
        postings: [
          { accountId: PLAYER, amount: 100 },
          { accountId: INTERNAL_ACCOUNTS.CASH, amount: -90 },
        ],
      }),
    ).toThrowError(GameValidationException);
  });

  it("rejects a degenerate single-leg entry", () => {
    expect(() =>
      journalEntry({
        id: "single",
        date: 1,
        reason: "One leg",
        postings: [{ accountId: PLAYER, amount: 0 }],
      }),
    ).toThrowError(GameValidationException);
  });

  it("rejects a non-finite amount (NaN/Infinity) with a clear error", () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(() =>
        journalEntry({
          id: "nonfinite",
          date: 1,
          reason: "Bad amount",
          postings: [
            { accountId: PLAYER, amount: bad },
            { accountId: INTERNAL_ACCOUNTS.CASH, amount: -bad },
          ],
        }),
      ).toThrowError(GameValidationException);
    }
  });

  it("tolerates IEEE-754 noise within BALANCE_EPSILON", () => {
    const a = 0.1;
    const b = 0.2;
    const c = -(a + b); // -0.30000000000000004
    expect(
      isBalanced([
        { accountId: PLAYER, amount: a, valueDate: 1 },
        { accountId: INTERNAL_ACCOUNTS.CASH, amount: b, valueDate: 1 },
        { accountId: INTERNAL_ACCOUNTS.SUSPENSE, amount: c, valueDate: 1 },
      ]),
    ).toBe(true);
    expect(
      Math.abs(
        sumPostings([
          { accountId: PLAYER, amount: a, valueDate: 1 },
          { accountId: INTERNAL_ACCOUNTS.CASH, amount: b, valueDate: 1 },
          { accountId: INTERNAL_ACCOUNTS.SUSPENSE, amount: c, valueDate: 1 },
        ]),
      ),
    ).toBeLessThanOrEqual(BALANCE_EPSILON);
  });
});

describe("Ledger — accounts", () => {
  it("opens accounts of all four types", () => {
    const ledger = new Ledger();
    ledger.openAccount({
      id: "cur:p",
      type: AccountType.CURRENT,
      label: "Текущий",
    });
    ledger.openAccount({
      id: "sav:p",
      type: AccountType.SAVINGS,
      label: "Сбережения",
    });
    ledger.openAccount({
      id: "loan:p",
      type: AccountType.LOAN,
      label: "Кредит",
    });
    ledger.openAccount({
      id: "gl:x",
      type: AccountType.GL_INTERNAL,
      label: "Внутренний",
    });

    expect(ledger.listAccounts()).toHaveLength(4);
    expect(ledger.getAccount("sav:p")?.type).toBe(AccountType.SAVINGS);
    expect(ledger.hasAccount("loan:p")).toBe(true);
    expect(ledger.hasAccount("nope")).toBe(false);
  });

  it("rejects opening a duplicate account id", () => {
    const ledger = new Ledger();
    openPlayer(ledger);
    expect(() => openPlayer(ledger)).toThrowError(GameValidationException);
  });
});

describe("Ledger — posting & balances", () => {
  it("balanceOf(account) equals Σ of its postings across multiple entries", () => {
    const ledger = createLedger();
    openPlayer(ledger);

    ledger.post(
      journalEntry({
        id: "e1",
        date: 1,
        reason: "Quest reward",
        postings: [
          { accountId: PLAYER, amount: 500 },
          { accountId: INTERNAL_ACCOUNTS.CASH, amount: -500 },
        ],
      }),
    );
    ledger.post(
      journalEntry({
        id: "e2",
        date: 2,
        reason: "Refuel",
        postings: [
          { accountId: PLAYER, amount: -120 },
          { accountId: INTERNAL_ACCOUNTS.CASH, amount: 120 },
        ],
      }),
    );

    expect(ledger.balanceOf(PLAYER)).toBe(380);
    expect(ledger.balanceOf(INTERNAL_ACCOUNTS.CASH)).toBe(-380);
    expect(ledger.postingsFor(PLAYER)).toHaveLength(2);
  });

  it("keeps the global invariant: totalBalance() stays 0", () => {
    const ledger = createLedger();
    openPlayer(ledger);
    ledger.post(
      journalEntry({
        id: "e1",
        date: 1,
        reason: "Trade",
        postings: [
          { accountId: PLAYER, amount: -300 },
          { accountId: INTERNAL_ACCOUNTS.CASH, amount: 300 },
        ],
      }),
    );
    ledger.post(
      journalEntry({
        id: "e2",
        date: 1,
        reason: "Reward",
        postings: [
          { accountId: PLAYER, amount: 1000 },
          { accountId: INTERNAL_ACCOUNTS.PNL, amount: -1000 },
        ],
      }),
    );
    expect(Math.abs(ledger.totalBalance())).toBeLessThanOrEqual(
      BALANCE_EPSILON,
    );
  });

  it("respects value dates: a forward-valued posting is excluded until asOf reaches it", () => {
    const ledger = createLedger();
    openPlayer(ledger);
    ledger.post(
      journalEntry({
        id: "e1",
        date: 1,
        reason: "Deposit value-dated to day 5",
        postings: [
          { accountId: PLAYER, amount: 200, valueDate: 5 },
          { accountId: INTERNAL_ACCOUNTS.CASH, amount: -200, valueDate: 5 },
        ],
      }),
    );

    // booked, but not yet valued
    expect(ledger.balanceOf(PLAYER)).toBe(200); // no asOf → full balance
    expect(ledger.balanceOf(PLAYER, 4)).toBe(0); // value date not reached
    expect(ledger.balanceOf(PLAYER, 5)).toBe(200); // value date reached
    expect(ledger.balanceOf(PLAYER, 99)).toBe(200);
  });

  it("rejects a post referencing an unknown account", () => {
    const ledger = createLedger();
    expect(() =>
      ledger.post(
        journalEntry({
          id: "e1",
          date: 1,
          reason: "Bad account",
          postings: [
            { accountId: "cur:ghost", amount: 100 },
            { accountId: INTERNAL_ACCOUNTS.CASH, amount: -100 },
          ],
        }),
      ),
    ).toThrowError(GameValidationException);
  });
});

describe("Ledger — internal GL seeding", () => {
  it("createLedger seeds the five internal GL accounts, all GL_INTERNAL", () => {
    const ledger = createLedger();
    const ids = [
      INTERNAL_ACCOUNTS.CASH,
      INTERNAL_ACCOUNTS.INTEREST_INCOME,
      INTERNAL_ACCOUNTS.INTEREST_EXPENSE,
      INTERNAL_ACCOUNTS.SUSPENSE,
      INTERNAL_ACCOUNTS.PNL,
    ];
    for (const id of ids) {
      const acc = ledger.getAccount(id);
      expect(acc, `expected ${id} seeded`).toBeDefined();
      expect(acc?.type).toBe(AccountType.GL_INTERNAL);
    }
    expect(ledger.listAccounts()).toHaveLength(5);
  });

  it("seedInternalAccounts is the same on a bare ledger", () => {
    const ledger = new Ledger();
    seedInternalAccounts(ledger);
    expect(ledger.hasAccount(INTERNAL_ACCOUNTS.CASH)).toBe(true);
    expect(ledger.hasAccount(INTERNAL_ACCOUNTS.PNL)).toBe(true);
  });
});
