import { describe, it, expect } from "vitest";
import {
  AccountType,
  BALANCE_EPSILON,
  INTERNAL_ACCOUNTS,
  type BankingSnapshot,
} from "@/domain/banking/Ledger";
import { BankBus, type BankEvent } from "@/systems/banking/bus";
import { BankingService } from "@/systems/banking/BankingService";
import { LOAN_DEFAULT_THRESHOLD } from "@/systems/banking/loanDefault";
import {
  borrowBlockReason,
  loanPanelLines,
} from "@/presentation/bankSceneView";
import { loanTermsSummary } from "@/systems/banking/products";
import {
  BankingSnapshotSchema,
  LoanDefaultSnapshotSchema,
} from "@/validation/schemas";

/**
 * Task 5 — the loan-default arrears state must survive a save/reload verbatim
 * (a defaulted loan stays defaulted after restore), old saves that predate the
 * field must migrate to "not in debt, not defaulted" (re-seeding lazily at the
 * next EOD), and the borrow gate must block a defaulted player from taking a new
 * loan, with the block + penalty surfaced in the (pure) loan panel.
 */

const PLAYER = "cur:player";
const LOAN = "loan:player";
const LOAN_RATE = 0.02;
const PENALTY_RATE = 0.03; // 0.02 × 1.5

interface Harness {
  bus: BankBus;
  service: BankingService;
  events: BankEvent[];
}

function makeHarness(): Harness {
  const bus = new BankBus();
  const service = new BankingService(bus, {
    startDate: 1,
    loanDailyRate: LOAN_RATE,
  });
  const events: BankEvent[] = [];
  bus.subscribe((e) => events.push(e));
  for (const [id, type, label] of [
    [PLAYER, AccountType.CURRENT, "Игрок"],
    [LOAN, AccountType.LOAN, "Кредит"],
  ] as const) {
    bus.dispatch({
      kind: "OpenAccount",
      account: { id, type, label, ownerId: "player" },
    });
  }
  return { bus, service, events };
}

function eod(h: Harness): void {
  h.bus.dispatch({ kind: "RunEndOfDay" });
}

function balanced(service: BankingService): boolean {
  return Math.abs(service.getLedger().totalBalance()) <= BALANCE_EPSILON;
}

/** Disburse a loan, drain the proceeds, then EOD past the default threshold. */
function makeDefaultedService(): Harness {
  const h = makeHarness();
  h.bus.dispatch({
    kind: "DisburseLoan",
    loanAccountId: LOAN,
    toAccountId: PLAYER,
    amount: 5000,
    reason: "Кредит",
  });
  h.bus.dispatch({
    kind: "Transfer",
    fromAccountId: PLAYER,
    toAccountId: INTERNAL_ACCOUNTS.CASH,
    amount: 5000,
    reason: "Траты",
  });
  // Day 1 is before the first due; the threshold-th miss lands on day 1+threshold.
  for (let i = 0; i <= LOAN_DEFAULT_THRESHOLD; i++) eod(h);
  return h;
}

describe("loan-default persistence — snapshot/restore round-trip", () => {
  it("a defaulted loan stays defaulted after restore", () => {
    const h = makeDefaultedService();
    const before = h.service.loanDefaultStateOf(LOAN)!;
    expect(before.defaulted).toBe(true);
    expect(before.penaltyActive).toBe(true);
    expect(before.missedPayments).toBe(LOAN_DEFAULT_THRESHOLD);

    const snapshot = h.service.toSnapshot();
    const fresh = new BankingService(new BankBus(), {
      loanDailyRate: LOAN_RATE,
    });
    fresh.restore(snapshot);

    const after = fresh.loanDefaultStateOf(LOAN);
    expect(after).toEqual(before);
    expect(fresh.balanceOf(LOAN)).toBeCloseTo(h.service.balanceOf(LOAN), 6);
    expect(balanced(fresh)).toBe(true);
  });

  it("the restored loan keeps accruing at the penalty rate (state, not just balance, persisted)", () => {
    const snapshot = makeDefaultedService().service.toSnapshot();
    const bus = new BankBus();
    const events: BankEvent[] = [];
    bus.subscribe((e) => events.push(e));
    const fresh = new BankingService(bus, { loanDailyRate: LOAN_RATE });
    fresh.restore(snapshot);

    const owedBefore = -fresh.balanceOf(LOAN);
    bus.dispatch({ kind: "RunEndOfDay" });
    // Still overdue & unpaid → accrues at the penalty rate, not the base rate.
    expect(-fresh.balanceOf(LOAN)).toBeCloseTo(
      owedBefore * (1 + PENALTY_RATE),
      6,
    );
    // Already defaulted → no fresh LoanDefaulted event (the flag survived).
    expect(events.filter((e) => e.kind === "LoanDefaulted")).toHaveLength(0);
    expect(balanced(fresh)).toBe(true);
  });

  it("the snapshot carries one loanDefaults record per tracked loan", () => {
    const snapshot = makeDefaultedService().service.toSnapshot();
    expect(snapshot.loanDefaults).toHaveLength(1);
    const rec = snapshot.loanDefaults![0];
    expect(rec.loanAccountId).toBe(LOAN);
    expect(rec.defaulted).toBe(true);
    expect(rec.owedAtLastDue).toBeGreaterThan(0);
  });
});

describe("loan-default persistence — old-save migration", () => {
  it("a snapshot without loanDefaults restores with no tracked state, then re-seeds lazily (current, not defaulted)", () => {
    const full = makeDefaultedService().service.toSnapshot();
    // Strip the field the way a pre-Task-5 save would lack it.
    const old = JSON.parse(JSON.stringify(full)) as Record<string, unknown>;
    delete old.loanDefaults;

    const bus = new BankBus();
    const events: BankEvent[] = [];
    bus.subscribe((e) => events.push(e));
    const fresh = new BankingService(bus, { loanDailyRate: LOAN_RATE });
    fresh.restore(old as unknown as BankingSnapshot);

    // No arrears state survives a pre-field save…
    expect(fresh.loanDefaultStateOf(LOAN)).toBeUndefined();

    // …and the outstanding loan re-seeds itself current (not defaulted) at EOD.
    bus.dispatch({ kind: "RunEndOfDay" });
    const state = fresh.loanDefaultStateOf(LOAN)!;
    expect(state).toBeDefined();
    expect(state.defaulted).toBe(false);
    expect(events.filter((e) => e.kind === "LoanDefaulted")).toHaveLength(0);
    expect(balanced(fresh)).toBe(true);
  });

  it("BankingSnapshotSchema accepts a snapshot both with and without loanDefaults", () => {
    const full = makeDefaultedService().service.toSnapshot();
    const json = JSON.parse(JSON.stringify(full));
    expect(() => BankingSnapshotSchema.parse(json)).not.toThrow();

    const old = JSON.parse(JSON.stringify(full));
    delete old.loanDefaults;
    expect(() => BankingSnapshotSchema.parse(old)).not.toThrow();
  });

  it("LoanDefaultSnapshotSchema rejects a malformed record", () => {
    expect(() =>
      LoanDefaultSnapshotSchema.parse({
        loanAccountId: LOAN,
        missedPayments: 1,
        penaltyActive: "yes", // should be boolean
        defaulted: false,
        nextDueDate: 3,
        owedAtLastDue: 100,
      }),
    ).toThrow();
  });
});

describe("loan-default — borrow gate", () => {
  it("blocks a defaulted player with the default message", () => {
    expect(
      borrowBlockReason(5200, { penaltyActive: true, defaulted: true }),
    ).toMatch(/дефолт/i);
  });

  it("blocks an outstanding-but-not-defaulted loan with the ordinary repay-first message", () => {
    const reason = borrowBlockReason(5200, {
      penaltyActive: false,
      defaulted: false,
    });
    expect(reason).toMatch(/погасите/i);
    expect(reason).not.toMatch(/дефолт/i);
  });

  it("allows borrowing when there is no outstanding loan", () => {
    expect(borrowBlockReason(0)).toBeNull();
    expect(
      borrowBlockReason(-1, { penaltyActive: false, defaulted: false }),
    ).toBeNull();
  });

  it("allows borrowing once a defaulted loan is fully repaid (stale flag must not lock out)", () => {
    // A defaulted loan paid down to zero keeps its `defaulted` flag (the EOD
    // recovery path skips a zero-balance loan), but with no outstanding debt the
    // borrow gate must not permanently block the player.
    expect(
      borrowBlockReason(0, { penaltyActive: true, defaulted: true }),
    ).toBeNull();
    expect(
      borrowBlockReason(-1, { penaltyActive: true, defaulted: true }),
    ).toBeNull();
  });

  it("the real defaulted service blocks a new loan", () => {
    const h = makeDefaultedService();
    const outstanding = -h.service.balanceOf(LOAN);
    const reason = borrowBlockReason(
      outstanding,
      h.service.loanDefaultStateOf(LOAN),
    );
    expect(reason).not.toBeNull();
    expect(reason).toMatch(/дефолт/i);
  });
});

describe("loan-default — panel status line", () => {
  const summary = loanTermsSummary({
    principal: 5000,
    dailyRate: LOAN_RATE,
    periods: 10,
  });

  it("appends a default status line for a defaulted loan", () => {
    const lines = loanPanelLines(summary, 5200, {
      penaltyActive: true,
      defaulted: true,
    });
    const status = lines.find((l) => l.label === "Статус");
    expect(status?.value).toMatch(/дефолт/i);
    expect(status?.tone).toBe("debt");
  });

  it("appends a penalty status line while overdue but not yet defaulted", () => {
    const lines = loanPanelLines(summary, 5200, {
      penaltyActive: true,
      defaulted: false,
    });
    expect(lines.find((l) => l.label === "Статус")?.value).toMatch(/просрочк/i);
  });

  it("adds no status line for a current loan or the offer view", () => {
    expect(
      loanPanelLines(summary, 5200, {
        penaltyActive: false,
        defaulted: false,
      }).find((l) => l.label === "Статус"),
    ).toBeUndefined();
    expect(
      loanPanelLines(summary, 0).find((l) => l.label === "Статус"),
    ).toBeUndefined();
  });
});
