import { describe, it, expect } from "vitest";
import {
  AccountType,
  BALANCE_EPSILON,
  INTERNAL_ACCOUNTS,
  createLedger,
  journalEntry,
  restoreLedger,
  type BankingSnapshot,
} from "@/domain/banking/Ledger";
import { BankBus } from "@/systems/banking/bus";
import { BankingService } from "@/systems/banking/BankingService";
import { openPlayerCurrentAccount } from "@/systems/banking/economy";
import { BankingSnapshotSchema, validateSaveState } from "@/validation/schemas";
import { MigrationPipeline } from "@/data/MigrationPipeline";
import { SaveState } from "@/domain/SaveState";
import type { Galaxy } from "@/domain/Galaxy";
import type { Player } from "@/domain/Player";

/**
 * Task 8 — persistence. The АБС book of record (accounts + journal + EOD
 * cursors) must survive a save/reload verbatim: a `toSnapshot()` round-tripped
 * through `restore()` reproduces every balance and keeps the books balanced.
 * Old saves (no banking snapshot) migrate by re-seeding the player current
 * account from `player.credits` — exercised by `openPlayerCurrentAccount`
 * elsewhere; here we prove the snapshot path is faithful and well-validated.
 */

const PLAYER = "cur:player";
const SAVINGS = "sav:player";
const LOAN = "loan:player";

/** A bank with a current + savings + loan account and a few posted moves on it. */
function makePopulatedService(): { bus: BankBus; service: BankingService } {
  const bus = new BankBus();
  const service = new BankingService(bus, {
    startDate: 5,
    savingsDailyRate: 0.01,
    loanDailyRate: 0.02,
  });
  const open = (id: string, type: AccountType, label: string) =>
    bus.dispatch({
      kind: "OpenAccount",
      account: { id, type, label, ownerId: "player" },
    });
  open(PLAYER, AccountType.CURRENT, "Игрок");
  open(SAVINGS, AccountType.SAVINGS, "Вклад");
  open(LOAN, AccountType.LOAN, "Кредит");
  bus.dispatch({
    kind: "Transfer",
    fromAccountId: INTERNAL_ACCOUNTS.CASH,
    toAccountId: PLAYER,
    amount: 1200,
    reason: "Seed",
  });
  bus.dispatch({
    kind: "Transfer",
    fromAccountId: PLAYER,
    toAccountId: SAVINGS,
    amount: 500,
    reason: "Вклад",
  });
  bus.dispatch({
    kind: "DisburseLoan",
    loanAccountId: LOAN,
    toAccountId: PLAYER,
    amount: 3000,
    reason: "Кредит на корпус",
  });
  bus.dispatch({ kind: "RunEndOfDay" }); // accrue + roll the business date
  return { bus, service };
}

function balanced(service: BankingService): boolean {
  return Math.abs(service.getLedger().totalBalance()) <= BALANCE_EPSILON;
}

describe("banking persistence — snapshot/restore round-trip", () => {
  it("reproduces every account balance and the business date after restore", () => {
    const { service } = makePopulatedService();
    const snapshot = service.toSnapshot();

    const fresh = new BankingService(new BankBus());
    fresh.restore(snapshot);

    for (const id of [
      PLAYER,
      SAVINGS,
      LOAN,
      INTERNAL_ACCOUNTS.CASH,
      INTERNAL_ACCOUNTS.INTEREST_INCOME,
      INTERNAL_ACCOUNTS.INTEREST_EXPENSE,
    ]) {
      expect(fresh.balanceOf(id)).toBeCloseTo(service.balanceOf(id), 6);
    }
    expect(fresh.businessDate).toBe(service.businessDate);
    expect(balanced(fresh)).toBe(true);
  });

  it("preserves every account and every journal entry", () => {
    const { service } = makePopulatedService();
    const snapshot = service.toSnapshot();

    const fresh = new BankingService(new BankBus());
    fresh.restore(snapshot);

    expect(
      fresh
        .getLedger()
        .listAccounts()
        .map((a) => a.id)
        .sort(),
    ).toEqual(
      service
        .getLedger()
        .listAccounts()
        .map((a) => a.id)
        .sort(),
    );
    expect(fresh.getLedger().listEntries().length).toBe(
      service.getLedger().listEntries().length,
    );
  });

  it("continues the journal-id sequence so post-restore entries stay unique", () => {
    const { service } = makePopulatedService();
    const snapshot = service.toSnapshot();
    const existingIds = new Set(
      service
        .getLedger()
        .listEntries()
        .map((e) => e.id),
    );

    const bus = new BankBus();
    const fresh = new BankingService(bus);
    fresh.restore(snapshot);
    bus.dispatch({
      kind: "Transfer",
      fromAccountId: INTERNAL_ACCOUNTS.CASH,
      toAccountId: PLAYER,
      amount: 10,
      reason: "После загрузки",
    });

    const newest = fresh.getLedger().listEntries().at(-1)!;
    expect(existingIds.has(newest.id)).toBe(false);
  });

  it("a restored bank keeps accruing EOD interest correctly (cursors restored)", () => {
    const { service } = makePopulatedService();
    const snapshot = service.toSnapshot();
    const savingsBefore = service.balanceOf(SAVINGS);

    const bus = new BankBus();
    const fresh = new BankingService(bus, {
      savingsDailyRate: 0.01,
      loanDailyRate: 0.02,
    });
    fresh.restore(snapshot);
    bus.dispatch({ kind: "RunEndOfDay" });

    // Next day's interest compounds on the restored savings balance.
    expect(fresh.balanceOf(SAVINGS)).toBeCloseTo(savingsBefore * 1.01, 6);
    expect(balanced(fresh)).toBe(true);
    // Re-running the already-closed prior date is still a no-op (lastEodDate kept).
    const after = fresh.balanceOf(SAVINGS);
    bus.dispatch({ kind: "RunEndOfDay", date: snapshot.businessDate - 1 });
    expect(fresh.balanceOf(SAVINGS)).toBeCloseTo(after, 6);
  });
});

describe("restoreLedger — integrity on load", () => {
  it("rebuilds the same balances from a ledger snapshot", () => {
    const { service } = makePopulatedService();
    const snap = service.getLedger().snapshot();

    const ledger = restoreLedger(snap);
    expect(ledger.balanceOf(SAVINGS)).toBeCloseTo(
      service.balanceOf(SAVINGS),
      6,
    );
    expect(Math.abs(ledger.totalBalance())).toBeLessThanOrEqual(
      BALANCE_EPSILON,
    );
  });

  it("rejects a tampered snapshot whose entry is unbalanced", () => {
    const ledger = createLedger();
    ledger.openAccount({
      id: PLAYER,
      type: AccountType.CURRENT,
      label: "Игрок",
    });
    ledger.post(
      journalEntry({
        id: "je:1",
        date: 0,
        reason: "Seed",
        postings: [
          { accountId: INTERNAL_ACCOUNTS.CASH, amount: -100, valueDate: 0 },
          { accountId: PLAYER, amount: 100, valueDate: 0 },
        ],
      }),
    );
    const snap = ledger.snapshot();
    // Corrupt one leg so the entry no longer nets to zero.
    const tampered = {
      accounts: snap.accounts,
      entries: snap.entries.map((e) => ({
        ...e,
        postings: e.postings.map((p) =>
          p.accountId === INTERNAL_ACCOUNTS.CASH ? { ...p, amount: -50 } : p,
        ),
      })),
    };

    expect(() => restoreLedger(tampered)).toThrow(
      /unbalanced|LEDGER_UNBALANCED/i,
    );
  });
});

describe("banking snapshot — schema validation", () => {
  it("validates a real snapshot against BankingSnapshotSchema", () => {
    const { service } = makePopulatedService();
    const snapshot: BankingSnapshot = service.toSnapshot();
    // Round-trip through JSON the way the save flow does.
    const json = JSON.parse(JSON.stringify(snapshot));
    expect(() => BankingSnapshotSchema.parse(json)).not.toThrow();
  });

  it("rejects a malformed snapshot (bad account type)", () => {
    const bad = {
      businessDate: 0,
      lastEodDate: null,
      seq: 0,
      ledger: {
        accounts: [{ id: "x", type: "NOPE", label: "x" }],
        entries: [],
      },
    };
    expect(() => BankingSnapshotSchema.parse(bad)).toThrow();
  });
});

describe("SaveState — banking field survives serialize/deserialize", () => {
  it("round-trips the banking snapshot through the save payload", () => {
    const { service } = makePopulatedService();
    const snapshot = service.toSnapshot();
    // SaveState.serialize only JSON-stringifies galaxy/player, so minimal stubs
    // are enough to prove the banking field rides along unchanged.
    const state = new SaveState(
      23,
      {} as Galaxy,
      { id: "player" } as Player,
      [],
      Date.now(),
      undefined,
      undefined,
      snapshot,
    );

    const restored = SaveState.deserialize(state.serialize());
    expect(restored.banking).toBeDefined();
    expect(restored.banking).toEqual(snapshot);
  });

  it("leaves banking undefined for a save without it (old-save shape)", () => {
    const state = new SaveState(
      23,
      {} as Galaxy,
      { id: "player" } as Player,
      [],
      Date.now(),
    );
    const restored = SaveState.deserialize(state.serialize());
    expect(restored.banking).toBeUndefined();
  });
});

describe("BankingService.resetLedger — pre-banking save load is leak-free", () => {
  it("discards a prior game's ledger so the re-seed reflects only the loaded credits", () => {
    // An earlier game in the same page session left accounts + journal behind.
    const bus = new BankBus();
    const service = new BankingService(bus, { startDate: 5 });
    bus.dispatch({
      kind: "OpenAccount",
      account: {
        id: PLAYER,
        type: AccountType.CURRENT,
        label: "Игрок",
        ownerId: "player",
      },
    });
    bus.dispatch({
      kind: "Transfer",
      fromAccountId: INTERNAL_ACCOUNTS.CASH,
      toAccountId: PLAYER,
      amount: 9999,
      reason: "Прошлая игра",
    });
    expect(service.getLedger().listEntries().length).toBeGreaterThan(0);

    // Loading a pre-banking save (no snapshot) resets the book of record first.
    service.resetLedger();
    expect(service.businessDate).toBe(0);
    expect(service.getLedger().listEntries()).toHaveLength(0);
    expect(service.getLedger().hasAccount(PLAYER)).toBe(false);
    // The internal GL accounts are re-seeded, so the migration re-seed can post.
    expect(service.getLedger().hasAccount(INTERNAL_ACCOUNTS.CASH)).toBe(true);

    // Re-seeding from the loaded player now reflects only that player's credits —
    // none of the previous game's 9999 leaks through.
    const player = {
      id: "player",
      credits: 1000,
      currentAccountId: PLAYER,
    } as unknown as Player;
    openPlayerCurrentAccount(bus, service, player);
    expect(service.balanceOf(PLAYER)).toBe(1000);
  });
});

/** A minimal but schema-valid pre-banking save (version 1, no `banking` field). */
function makeOldSaveWithoutBanking(): Record<string, unknown> {
  return {
    version: 1,
    timestamp: 1_000_000,
    persistentDialogs: [],
    galaxy: {
      id: "galaxy-test",
      gameDays: 3,
      systems: [
        {
          id: "sys-1",
          name: "Alpha",
          coordinates: { q: 0, r: 0 },
          starType: "YELLOW_DWARF",
          explored: true,
          fogOfWar: false,
          planets: [],
          connections: [],
        },
      ],
      npcShips: [],
    },
    player: {
      id: "player-1",
      name: "Tester",
      experience: 0,
      level: 1,
      credits: 1000,
      reputation: {},
      questLog: { activeQuests: [], completedQuests: [] },
      journal: { entries: [] },
      currentSystemId: "sys-1",
      ship: {
        id: "Ranger-1",
        name: "Ranger-1",
        hullHP: 100,
        maxHull: 100,
        shields: 50,
        maxShields: 50,
        energy: 100,
        maxEnergy: 100,
        speed: 1.0,
        evasion: 0.8,
        modules: [null, null, null],
      },
      inventory: { modules: [], resources: [], cosmetics: [] },
    },
  };
}

describe("SaveStateSchema — banking is optional (old saves validate)", () => {
  it("accepts a migrated pre-banking save that carries no banking snapshot", () => {
    const migrated = MigrationPipeline.migrate(
      makeOldSaveWithoutBanking() as never,
    );
    // The migration deliberately does NOT add a banking snapshot (those saves
    // re-seed from `credits` on load), so the validated shape must still lack it…
    expect((migrated as { banking?: unknown }).banking).toBeUndefined();
    // …and the production save schema must accept it (banking is `.optional()`).
    expect(() => validateSaveState(migrated)).not.toThrow();
  });

  it("still accepts the save once a banking snapshot is attached", () => {
    const migrated = MigrationPipeline.migrate(
      makeOldSaveWithoutBanking() as never,
    ) as unknown as Record<string, unknown>;
    const { service } = makePopulatedService();
    expect(() =>
      validateSaveState({ ...migrated, banking: service.toSnapshot() }),
    ).not.toThrow();
  });

  it("BankingSnapshotSchema is itself optional-safe (a missing snapshot parses)", () => {
    expect(BankingSnapshotSchema.optional().safeParse(undefined).success).toBe(
      true,
    );
  });
});
