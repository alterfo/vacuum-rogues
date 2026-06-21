import type { Player } from "@/domain/Player";
import { AccountType, INTERNAL_ACCOUNTS } from "@/domain/banking/Ledger";
import { logger } from "@/utils/logger";
import type { BankBus, Unsubscribe } from "./bus";
import type { BankingService } from "./BankingService";

/**
 * The minimum a consumer site needs to move money through the АБС: the bus it
 * dispatches commands onto plus read access to the service/ledger (to check an
 * account exists before transferring). `GameEngine.bank` returns one of these and
 * scenes/systems thread it into the credit helpers below. When it is absent (unit
 * tests that never wired the bank), the helpers fall back to a direct
 * `player.credits` mutation so the legacy delta is preserved exactly.
 */
export interface BankAccess {
  readonly bus: BankBus;
  readonly service: BankingService;
}

/**
 * Named GL counterparty accounts every migrated money move books against, so a
 * trade/reward/fine/fee has a real source/sink in the ledger and reads
 * meaningfully in the Bank UI. They are opened lazily the first time they are
 * referenced (as {@link AccountType.GL_INTERNAL} accounts).
 */
export const GL_COUNTERPARTY = {
  /** Trade buy/sell (the commodity market). */
  MARKET: "gl:market",
  /** Quest rewards and combat/loot payouts. */
  REWARDS: "gl:rewards",
  /** Quest fines and customs penalties. */
  FINES: "gl:fines",
  /** Station services: repair, refuel, research, star maps. */
  SERVICES: "gl:services",
  /** Bribes paid to customs / station staff. */
  BRIBES: "gl:bribes",
  /** Gear, hull and micromodule purchases / sales. */
  EQUIPMENT: "gl:equipment",
  /** NPC pirate plunder (the destroyed ship's wreck). */
  PLUNDER: "gl:plunder",
} as const;

const GL_LABELS: Record<string, string> = {
  [GL_COUNTERPARTY.MARKET]: "Товарный рынок",
  [GL_COUNTERPARTY.REWARDS]: "Награды и трофеи",
  [GL_COUNTERPARTY.FINES]: "Штрафы",
  [GL_COUNTERPARTY.SERVICES]: "Услуги станций",
  [GL_COUNTERPARTY.BRIBES]: "Взятки",
  [GL_COUNTERPARTY.EQUIPMENT]: "Оборудование",
  [GL_COUNTERPARTY.PLUNDER]: "Трофеи пиратов",
};

/** Open a GL counterparty account on first use (idempotent). */
function ensureCounterparty(access: BankAccess, accountId: string): void {
  if (access.service.getLedger().hasAccount(accountId)) return;
  access.bus.dispatch({
    kind: "OpenAccount",
    account: {
      id: accountId,
      type: AccountType.GL_INTERNAL,
      label: GL_LABELS[accountId] ?? accountId,
    },
  });
}

/**
 * Apply a *signed* change to the player's credits through the bus: a positive
 * delta is a gain (counterparty → player), a negative one a charge (player →
 * counterparty). The `BalanceChanged` projection writes the new balance back into
 * `player.credits`, so the net effect equals the old `credits += delta`.
 *
 * Falls back to a direct mutation when banking is not wired (the player's current
 * account is not on the ledger) — keeping the legacy delta for unit tests that
 * never set up the bank. A zero delta is a no-op (no empty entry is booked).
 */
export function adjustPlayerCredits(
  access: BankAccess | null | undefined,
  player: Player,
  signedDelta: number,
  counterpartyId: string,
  reason: string,
): void {
  if (signedDelta === 0) return;
  if (
    access &&
    access.service.getLedger().hasAccount(player.currentAccountId)
  ) {
    ensureCounterparty(access, counterpartyId);
    if (signedDelta > 0) {
      transfer(
        access.bus,
        counterpartyId,
        player.currentAccountId,
        signedDelta,
        reason,
      );
    } else {
      transfer(
        access.bus,
        player.currentAccountId,
        counterpartyId,
        -signedDelta,
        reason,
      );
    }
    return;
  }
  // No bank wired (unit/pricing tests) → a direct mutation preserves the legacy
  // delta exactly. But a *present* `access` whose player account is missing means
  // money is moving before `setupPlayerBanking` opened it: the fallback then
  // silently desyncs `player.credits` from the ledger (and double-counts on
  // reload). That can only be a wiring bug, so make it loud in dev.
  if (__DEBUG__ && access) {
    logger.warn(
      `adjustPlayerCredits: "${player.currentAccountId}" is not on the ledger; ` +
        `direct-mutating credits (projection will desync — wire setupPlayerBanking first).`,
    );
  }
  player.credits += signedDelta;
}

/** Minimal NPC shape {@link creditNpc} needs — kept structural so the domain isn't imported. */
export interface NpcAccountHolder {
  readonly id: string;
  readonly name?: string;
  credits: number;
}

/**
 * Open + seed an NPC's current account on first use (idempotent), returning its
 * ledger id. NPC balances are not projected, so the account is seeded from the
 * NPC's existing `credits` (a `Transfer` out of the bank's cash GL) the first
 * time it is referenced, keeping the ledger consistent with `npc.credits`.
 */
function ensureNpcCurrentAccount(
  access: BankAccess,
  npc: NpcAccountHolder,
): string {
  const npcAccountId = currentAccountId(npc.id);
  if (!access.service.getLedger().hasAccount(npcAccountId)) {
    access.bus.dispatch({
      kind: "OpenAccount",
      account: {
        id: npcAccountId,
        type: AccountType.CURRENT,
        label: `НПС ${npc.name ?? npc.id}`,
        ownerId: npc.id,
      },
    });
    if (npc.credits !== 0) {
      transfer(
        access.bus,
        INTERNAL_ACCOUNTS.CASH,
        npcAccountId,
        npc.credits,
        "Открытие счёта НПС",
      );
    }
  }
  return npcAccountId;
}

/**
 * Credit an NPC's current account (e.g. pirate plunder) through the bus. NPC
 * balances are not projected, so this keeps `npc.credits` in lockstep with the
 * ledger: it opens + seeds the NPC's current account from its existing credits on
 * first use, books the gain from `counterpartyId`, then reads the new GL balance
 * back into `npc.credits`. Falls back to a direct mutation when banking is absent.
 */
export function creditNpc(
  access: BankAccess | null | undefined,
  npc: NpcAccountHolder,
  amount: number,
  counterpartyId: string,
  reason: string,
): void {
  if (amount === 0) return;
  if (!access) {
    npc.credits += amount;
    return;
  }
  const npcAccountId = ensureNpcCurrentAccount(access, npc);
  ensureCounterparty(access, counterpartyId);
  transfer(access.bus, counterpartyId, npcAccountId, amount, reason);
  npc.credits = access.service.balanceOf(npcAccountId);
}

/**
 * Move `amount` credits from the player to an NPC through the bus — the shared
 * primitive behind {@link payTribute} (shakedown) and {@link payHire} (merc
 * contract). A balanced `Transfer` from the player's current account → the NPC's
 * current account (the counterparty), so `player.credits` drops by exactly
 * `amount` (via the projection), the NPC's credits rise, and the GL stays
 * balanced. Opens + seeds the NPC's account on first use. Falls back to a direct
 * mutation on both sides when banking is not wired (unit tests without a bus). A
 * non-positive `amount` is a no-op.
 */
function payPlayerToNpc(
  access: BankAccess | null | undefined,
  player: Player,
  npc: NpcAccountHolder,
  amount: number,
  reason: string,
): void {
  if (amount <= 0) return;
  if (
    access &&
    access.service.getLedger().hasAccount(player.currentAccountId)
  ) {
    const npcAccountId = ensureNpcCurrentAccount(access, npc);
    transfer(access.bus, player.currentAccountId, npcAccountId, amount, reason);
    npc.credits = access.service.balanceOf(npcAccountId);
    return;
  }
  // No bank wired (unit tests) → a direct mutation preserves the legacy delta.
  // But a *present* `access` whose player account is missing means money is
  // moving before `setupPlayerBanking` opened it: the fallback then silently
  // desyncs `player.credits` from the ledger. That can only be a wiring bug, so
  // make it loud in dev (mirrors {@link adjustPlayerCredits}).
  if (__DEBUG__ && access) {
    logger.warn(
      `payPlayerToNpc: "${player.currentAccountId}" is not on the ledger; ` +
        `direct-mutating credits (projection will desync — wire setupPlayerBanking first).`,
    );
  }
  player.credits -= amount;
  npc.credits += amount;
}

/**
 * Pay a pirate-shakedown tribute ("кошелёк или жизнь") from the player to the
 * demanding pirate through the bus. A balanced player → pirate transfer (the
 * pirate is the counterparty), so `player.credits` drops by exactly `amount` and
 * the GL stays balanced. A non-positive `amount` is a no-op. See
 * {@link payPlayerToNpc}.
 */
export function payTribute(
  access: BankAccess | null | undefined,
  player: Player,
  npc: NpcAccountHolder,
  amount: number,
  reason: string,
): void {
  payPlayerToNpc(access, player, npc, amount, reason);
}

/**
 * Pay a hire/ally fee from the player to a contracted NPC through the bus — the
 * player pays a merc to attack a target or aid in a fight (Task 4). Same ABS
 * contract as {@link payTribute}: a balanced player → NPC transfer, so
 * `player.credits` drops by exactly `amount`, the NPC's credits rise, and the GL
 * stays balanced. A non-positive `amount` is a no-op. See {@link payPlayerToNpc}.
 */
export function payHire(
  access: BankAccess | null | undefined,
  player: Player,
  npc: NpcAccountHolder,
  amount: number,
  reason: string,
): void {
  payPlayerToNpc(access, player, npc, amount, reason);
}

/**
 * The economy seam between the game and the АБС core. Game code never pokes the
 * ledger directly; it moves money with the {@link transfer} facade (a thin wrapper
 * over a `Transfer` command on the bus), and `player.credits` becomes a *read
 * projection* of the player's current-account GL balance — refreshed whenever a
 * `BalanceChanged` event names that account (see {@link bindCreditsProjection}).
 *
 * The net effect on `player.credits` of a balanced transfer equals the old direct
 * `credits ±= x` delta, so the existing economy stays correct while every move now
 * has a real double-entry source/sink in the ledger.
 */

/** Ledger account id for an owner's current account, e.g. `"cur:player"`. */
export function currentAccountId(ownerId: string): string {
  return `cur:${ownerId}`;
}

/**
 * Move `amount` credits from one ledger account to another via the bus (the
 * canonical money movement). Consumers call this instead of mutating
 * `player.credits`; the projection keeps the cached number in sync.
 */
export function transfer(
  bus: BankBus,
  fromAccountId: string,
  toAccountId: string,
  amount: number,
  reason: string,
): void {
  bus.dispatch({
    kind: "Transfer",
    fromAccountId,
    toAccountId,
    amount,
    reason,
  });
}

/**
 * Bind `player.credits` to the bus: every `BalanceChanged` for the player's
 * current account writes the new balance into `player.credits`, so the cached
 * number always equals `ledger.balanceOf(player.currentAccountId)`. Returns an
 * unsubscribe to drop the binding (e.g. before re-binding a freshly loaded player).
 */
export function bindCreditsProjection(
  bus: BankBus,
  player: Player,
): Unsubscribe {
  const accountId = player.currentAccountId;
  return bus.subscribe((event) => {
    if (event.kind === "BalanceChanged" && event.accountId === accountId) {
      player.credits = event.balance;
    }
  });
}

/**
 * Open the player's current account on the ledger (idempotent — skipped if it
 * already exists) and seed it so its GL balance equals the player's current
 * `credits` (a `Transfer` out of the bank's cash GL). The seed is the difference
 * between `credits` and the account's existing balance, so calling this again
 * after a reload is a no-op.
 */
export function openPlayerCurrentAccount(
  bus: BankBus,
  service: BankingService,
  player: Player,
): void {
  const accountId = player.currentAccountId;
  if (!service.getLedger().hasAccount(accountId)) {
    bus.dispatch({
      kind: "OpenAccount",
      account: {
        id: accountId,
        type: AccountType.CURRENT,
        label: "Текущий счёт",
        ownerId: player.id,
      },
    });
  }
  const opening = player.credits - service.balanceOf(accountId);
  if (opening !== 0) {
    transfer(bus, INTERNAL_ACCOUNTS.CASH, accountId, opening, "Открытие счёта");
  }
}

/**
 * Wire a player into the bank: bind the `credits` projection first, then open +
 * seed the current account so the seed's `BalanceChanged` lands on the (now
 * bound) projection. After this, `player.credits === balanceOf(currentAccount)`
 * and every later `transfer` keeps them in lockstep. Returns an unsubscribe.
 */
export function setupPlayerBanking(
  bus: BankBus,
  service: BankingService,
  player: Player,
): Unsubscribe {
  const unsubscribe = bindCreditsProjection(bus, player);
  openPlayerCurrentAccount(bus, service, player);
  return unsubscribe;
}
