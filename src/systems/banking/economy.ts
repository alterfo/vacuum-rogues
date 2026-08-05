import type { Player } from "@/domain/Player";
import { AccountType, INTERNAL_ACCOUNTS } from "@/domain/banking/Ledger";
import { logger } from "@/utils/logger";
import type { BankBus, Unsubscribe } from "./bus";

interface BankLike {
  getLedger(): { hasAccount(id: string): boolean };
  balanceOf(accountId: string): number;
}

export interface BankAccess {
  readonly bus: BankBus;
  readonly service: BankLike;
}

export const GL_COUNTERPARTY = {
  MARKET: "gl:market",
  REWARDS: "gl:rewards",
  FINES: "gl:fines",
  SERVICES: "gl:services",
  BRIBES: "gl:bribes",
  EQUIPMENT: "gl:equipment",
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
  if (__DEBUG__ && access) {
    logger.warn(
      `adjustPlayerCredits: "${player.currentAccountId}" is not on the ledger; ` +
        `direct-mutating credits (projection will desync — wire setupPlayerBanking first).`,
    );
  }
  player.credits += signedDelta;
}

export interface NpcAccountHolder {
  readonly id: string;
  readonly name?: string;
  credits: number;
}

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
  if (__DEBUG__ && access) {
    logger.warn(
      `payPlayerToNpc: "${player.currentAccountId}" is not on the ledger; ` +
        `direct-mutating credits (projection will desync — wire setupPlayerBanking first).`,
    );
  }
  player.credits -= amount;
  npc.credits += amount;
}

export function payTribute(
  access: BankAccess | null | undefined,
  player: Player,
  npc: NpcAccountHolder,
  amount: number,
  reason: string,
): void {
  payPlayerToNpc(access, player, npc, amount, reason);
}

export function payHire(
  access: BankAccess | null | undefined,
  player: Player,
  npc: NpcAccountHolder,
  amount: number,
  reason: string,
): void {
  payPlayerToNpc(access, player, npc, amount, reason);
}

export function currentAccountId(ownerId: string): string {
  return `cur:${ownerId}`;
}

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

export function openPlayerCurrentAccount(
  bus: BankBus,
  service: BankLike,
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

export function setupPlayerBanking(
  bus: BankBus,
  service: BankLike,
  player: Player,
): Unsubscribe {
  const unsubscribe = bindCreditsProjection(bus, player);
  openPlayerCurrentAccount(bus, service, player);
  return unsubscribe;
}
