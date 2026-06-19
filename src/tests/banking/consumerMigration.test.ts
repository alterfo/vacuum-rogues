import { describe, it, expect } from "vitest";
import { TradeSystem } from "@/systems/TradeSystem";
import { QuestManager } from "@/systems/QuestManager";
import { TextQuestRuntime } from "@/systems/quests/TextQuestRuntime";
import { sellUninstalledGear } from "@/systems/equipment/sellGear";
import { Market } from "@/domain/Market";
import { Planet } from "@/domain/Planet";
import { Player } from "@/domain/Player";
import { PlayerShip } from "@/domain/PlayerShip";
import { Inventory } from "@/domain/Inventory";
import { SkillTree } from "@/domain/SkillTree";
import { FactionType, ResourceType, QuestType } from "@/types";
import type {
  QuestLog,
  Journal,
  Reward,
  QuestOutcome,
  PlanetType,
} from "@/types";
import type { QuestTemplate } from "@/systems/QuestManager";
import { BankBus } from "@/systems/banking/bus";
import { BankingService } from "@/systems/banking/BankingService";
import {
  setupPlayerBanking,
  adjustPlayerCredits,
  creditNpc,
  GL_COUNTERPARTY,
  type BankAccess,
  type NpcAccountHolder,
} from "@/systems/banking/economy";
import { BALANCE_EPSILON } from "@/domain/banking/Ledger";

/**
 * Task 4 — the 23 consumer sites now move money through the bus instead of poking
 * `player.credits`. The contract every migrated site keeps:
 *   1. the *net* `player.credits` delta equals the old direct mutation, and
 *   2. the global double-entry invariant holds (Σ all postings == 0).
 * The same flow run **without** a bank wired must fall back to the legacy direct
 * mutation and produce the identical delta (this is what keeps the pre-existing
 * economy/quest delta tests green).
 */

let pid = 0;
function makePlayer(credits: number, id = `p${++pid}`): Player {
  return new Player(
    id,
    "Pilot",
    FactionType.PROGRESSORS,
    0,
    1,
    new SkillTree([]),
    {},
    { activeQuests: [], completedQuests: [] } as QuestLog,
    { entries: [] } as Journal,
    credits,
    new PlayerShip(
      `${id}_ship`,
      "Ship",
      100,
      100,
      50,
      50,
      100,
      100,
      10,
      5,
      FactionType.PROGRESSORS,
    ),
    new Inventory(),
  );
}

function makePlanet(id = "pl1"): Planet {
  return new Planet(
    id,
    "TestPlanet",
    "INDUSTRIAL" as PlanetType,
    150,
    new Market(
      [
        ResourceType.FUEL,
        ResourceType.METALS,
        ResourceType.CRYSTALS,
        ResourceType.ORGANICS,
        ResourceType.ARTIFACTS,
        ResourceType.WEAPONS,
        ResourceType.MEDICINE,
        ResourceType.ELECTRONICS,
        ResourceType.LUXURY,
        ResourceType.DATA_CORES,
      ],
      Array(10).fill(1.0),
      Array(10).fill(1.0),
    ),
    [],
    [],
  );
}

interface Bank {
  bus: BankBus;
  service: BankingService;
  access: BankAccess;
  player: Player;
}

/** A player fully wired into a fresh АБС (current account opened + projection bound). */
function bankedPlayer(credits: number): Bank {
  const bus = new BankBus();
  const service = new BankingService(bus, { startDate: 1 });
  const player = makePlayer(credits);
  setupPlayerBanking(bus, service, player);
  return { bus, service, access: { bus, service }, player };
}

/** The whole-ledger double-entry invariant: every posting nets to zero. */
function booksBalanced(service: BankingService): boolean {
  return Math.abs(service.getLedger().totalBalance()) <= BALANCE_EPSILON;
}

describe("consumer migration — TradeSystem buy/sell", () => {
  it("a buy matches the legacy delta and leaves the books balanced", () => {
    const legacyPlayer = makePlayer(100_000);
    const banked = bankedPlayer(100_000);
    const legacyPlanet = makePlanet();
    const bankedPlanet = makePlanet();
    const trade = new TradeSystem();

    // Legacy path: no bank → direct mutation.
    const legacy = trade.executeTrade(
      legacyPlayer,
      legacyPlanet,
      ResourceType.CRYSTALS,
      10,
      true,
    );
    // Migrated path: bus-routed via the projection.
    const migrated = trade.executeTrade(
      banked.player,
      bankedPlanet,
      ResourceType.CRYSTALS,
      10,
      true,
      Infinity,
      banked.access,
    );

    expect(migrated.success).toBe(true);
    expect(legacy.finalPrice).toBe(migrated.finalPrice);
    // Same net delta on credits…
    expect(banked.player.credits).toBe(legacyPlayer.credits);
    // …credits mirror the GL balance…
    expect(banked.player.credits).toBe(
      banked.service.balanceOf(banked.player.currentAccountId),
    );
    // …and the ledger nets to zero.
    expect(booksBalanced(banked.service)).toBe(true);
  });

  it("a sell matches the legacy delta and leaves the books balanced", () => {
    const legacyPlayer = makePlayer(1_000);
    const banked = bankedPlayer(1_000);
    legacyPlayer.inventory.resources.push({
      type: ResourceType.METALS,
      amount: 20,
    });
    banked.player.inventory.resources.push({
      type: ResourceType.METALS,
      amount: 20,
    });
    const trade = new TradeSystem();

    const legacy = trade.executeTrade(
      legacyPlayer,
      makePlanet(),
      ResourceType.METALS,
      20,
      false,
    );
    const migrated = trade.executeTrade(
      banked.player,
      makePlanet(),
      ResourceType.METALS,
      20,
      false,
      Infinity,
      banked.access,
    );

    expect(migrated.success).toBe(true);
    expect(legacy.finalPrice).toBe(migrated.finalPrice);
    expect(banked.player.credits).toBe(legacyPlayer.credits);
    expect(banked.player.credits).toBeGreaterThan(1_000);
    expect(booksBalanced(banked.service)).toBe(true);
  });
});

describe("consumer migration — QuestManager reward + fine", () => {
  function rewardTemplate(reward: Reward): QuestTemplate {
    return {
      id: "qt_reward",
      title: "Reward Quest",
      description: "",
      type: QuestType.DELIVERY,
      objectives: [
        {
          id: "obj",
          description: "do",
          type: "VISIT_LOCATION",
          targetAmount: 1,
          locationId: "loc",
        },
      ],
      reward,
      dialogueAnchors: [],
      deadline: 10,
      failurePenalty: null,
    };
  }

  it("a granted reward credits the player and balances the books", () => {
    const banked = bankedPlayer(500);
    const qm = new QuestManager();
    qm.attachBank(banked.access);
    const quest = qm.acceptQuestFromTemplate(
      rewardTemplate({ credits: 300, experience: 50, items: [] }),
      "loc",
      0,
    );
    expect(quest).not.toBeNull();

    const ok = qm.forceCompleteQuest(quest!.id, banked.player);
    expect(ok).toBe(true);
    expect(banked.player.credits).toBe(800);
    expect(banked.player.credits).toBe(
      banked.service.balanceOf(banked.player.currentAccountId),
    );
    expect(booksBalanced(banked.service)).toBe(true);
  });

  it("a failure fine debits the player (clamped at 0) and balances the books", () => {
    const banked = bankedPlayer(200);
    const qm = new QuestManager();
    qm.attachBank(banked.access);
    const tpl = rewardTemplate({ credits: 0, experience: 0, items: [] });
    const quest = qm.acceptQuestFromTemplate(
      {
        ...tpl,
        id: "qt_fine",
        failurePenalty: {
          reputationLoss: 0,
          creditsFine: 500, // exceeds the 200 balance → clamps to 0, never negative
          jailTime: 0,
          description: "fine",
        },
      },
      "loc",
      0,
    );
    expect(quest).not.toBeNull();

    qm.checkExpiredQuests(9999, banked.player);
    // Old behaviour: Math.max(0, 200 - 500) === 0, books still balanced.
    expect(banked.player.credits).toBe(0);
    expect(banked.player.credits).toBe(
      banked.service.balanceOf(banked.player.currentAccountId),
    );
    expect(booksBalanced(banked.service)).toBe(true);
  });
});

describe("consumer migration — TextQuestRuntime.applyOutcome", () => {
  const outcome = (creditsDelta: number): QuestOutcome => ({
    creditsDelta,
    reputationDelta: 0,
    journalEntry: "",
  });

  it("a positive outcome credits the player; books balanced", () => {
    const banked = bankedPlayer(100);
    new TextQuestRuntime().applyOutcome(
      outcome(250),
      banked.player,
      banked.access,
    );
    expect(banked.player.credits).toBe(350);
    expect(booksBalanced(banked.service)).toBe(true);
  });

  it("a negative outcome larger than the balance clamps to 0 (legacy parity)", () => {
    const banked = bankedPlayer(100);
    new TextQuestRuntime().applyOutcome(
      outcome(-250),
      banked.player,
      banked.access,
    );
    expect(banked.player.credits).toBe(0);
    expect(booksBalanced(banked.service)).toBe(true);
  });
});

describe("consumer migration — sellUninstalledGear", () => {
  it("refunds into the player current account and balances the books", () => {
    const banked = bankedPlayer(0);
    banked.player.inventory.addOwnedGear("wpn_pulse"); // basePrice 800 → refund 320
    const refund = sellUninstalledGear(
      banked.player,
      "wpn_pulse",
      banked.access,
    );
    expect(refund).toBe(320);
    expect(banked.player.credits).toBe(320);
    expect(banked.player.credits).toBe(
      banked.service.balanceOf(banked.player.currentAccountId),
    );
    expect(booksBalanced(banked.service)).toBe(true);
  });
});

describe("consumer migration — NPC pirate plunder (creditNpc)", () => {
  it("opens + seeds the NPC account, credits the loot, keeps npc.credits == GL", () => {
    const bus = new BankBus();
    const service = new BankingService(bus, { startDate: 1 });
    const access: BankAccess = { bus, service };
    const pirate: NpcAccountHolder = {
      id: "npc_pirate",
      name: "Грабёж",
      credits: 150,
    };

    creditNpc(access, pirate, 200, GL_COUNTERPARTY.PLUNDER, "Пиратский трофей");

    expect(pirate.credits).toBe(350); // 150 seed + 200 loot
    expect(service.balanceOf("cur:npc_pirate")).toBe(350);
    expect(booksBalanced(service)).toBe(true);
  });

  it("seeds the NPC account once and accumulates across repeated loot (account-exists branch)", () => {
    // A pirate that destroys two victims calls creditNpc twice — the production
    // path that exercises the "account already open" branch (seed skipped, just
    // transfer + re-read). Verify no re-seed/double-count and npc.credits == GL.
    const bus = new BankBus();
    const service = new BankingService(bus, { startDate: 1 });
    const access: BankAccess = { bus, service };
    const pirate: NpcAccountHolder = { id: "npc_raider", credits: 50 };

    creditNpc(access, pirate, 120, GL_COUNTERPARTY.PLUNDER, "Трофей 1");
    creditNpc(access, pirate, 80, GL_COUNTERPARTY.PLUNDER, "Трофей 2");

    expect(pirate.credits).toBe(250); // 50 seed + 120 + 80, seeded only once
    expect(service.balanceOf("cur:npc_raider")).toBe(250);
    expect(booksBalanced(service)).toBe(true);
  });

  it("falls back to a direct mutation when no bank is wired", () => {
    const pirate: NpcAccountHolder = { id: "npc2", credits: 10 };
    creditNpc(null, pirate, 200, GL_COUNTERPARTY.PLUNDER, "loot");
    expect(pirate.credits).toBe(210);
  });
});

describe("consumer migration — fallback with no bank preserves the legacy delta", () => {
  it("adjustPlayerCredits with no access mutates credits directly", () => {
    const player = makePlayer(1_000);
    adjustPlayerCredits(undefined, player, -300, GL_COUNTERPARTY.MARKET, "buy");
    expect(player.credits).toBe(700);
    adjustPlayerCredits(null, player, 120, GL_COUNTERPARTY.REWARDS, "reward");
    expect(player.credits).toBe(820);
  });

  it("adjustPlayerCredits falls back to direct mutation when the bank is wired but the player account is not yet seeded", () => {
    // A real runtime state: a scene holds gameEngine.bank but setupPlayerBanking
    // has not opened this player's current account. The helper must NOT dispatch a
    // Transfer from a non-existent account (that throws LEDGER_UNKNOWN_ACCOUNT) —
    // it falls back to the legacy direct mutation.
    const bus = new BankBus();
    const service = new BankingService(bus, { startDate: 1 });
    const access: BankAccess = { bus, service };
    const player = makePlayer(1_000); // deliberately NOT wired via setupPlayerBanking

    expect(service.getLedger().hasAccount(player.currentAccountId)).toBe(false);
    expect(() =>
      adjustPlayerCredits(access, player, -300, GL_COUNTERPARTY.MARKET, "buy"),
    ).not.toThrow();
    expect(player.credits).toBe(700);
    // No spurious account/entry was created on the ledger for the player.
    expect(service.getLedger().hasAccount(player.currentAccountId)).toBe(false);
  });

  it("a zero delta books no entry", () => {
    const banked = bankedPlayer(500);
    const entriesBefore = banked.service.getLedger().listEntries().length;
    adjustPlayerCredits(
      banked.access,
      banked.player,
      0,
      GL_COUNTERPARTY.MARKET,
      "noop",
    );
    expect(banked.service.getLedger().listEntries().length).toBe(entriesBefore);
    expect(banked.player.credits).toBe(500);
  });
});

describe("consumer migration — global invariant over a mixed session", () => {
  it("Σ all postings stays zero through buy/sell/reward/fine/sell-gear", () => {
    const banked = bankedPlayer(5_000);
    const trade = new TradeSystem();
    const planet = makePlanet();

    trade.executeTrade(
      banked.player,
      planet,
      ResourceType.METALS,
      10,
      true,
      Infinity,
      banked.access,
    );
    trade.executeTrade(
      banked.player,
      planet,
      ResourceType.METALS,
      5,
      false,
      Infinity,
      banked.access,
    );
    adjustPlayerCredits(
      banked.access,
      banked.player,
      400,
      GL_COUNTERPARTY.REWARDS,
      "reward",
    );
    adjustPlayerCredits(
      banked.access,
      banked.player,
      -150,
      GL_COUNTERPARTY.FINES,
      "fine",
    );

    expect(booksBalanced(banked.service)).toBe(true);
    expect(banked.player.credits).toBe(
      banked.service.balanceOf(banked.player.currentAccountId),
    );
  });
});
