import type { Player } from "@/domain/Player";
import { AccountType, INTERNAL_ACCOUNTS } from "@/domain/banking/Ledger";
import type { BankBus, Unsubscribe } from "./bus";
import type { BankingService } from "./BankingService";

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
