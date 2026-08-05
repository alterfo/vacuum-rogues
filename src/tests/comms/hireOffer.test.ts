import { describe, it, expect, beforeEach } from "vitest";
import { NpcShip } from "@/domain/NpcShip";
import {
  hireFee,
  acceptsHire,
  hireGoal,
  shipCombatStrength,
  HIRE,
} from "@/systems/npc/NpcBrain";
import { BALANCE_EPSILON } from "@/domain/banking/Ledger";
import { BankBus } from "@/systems/banking/bus";
import { BankingService } from "@/systems/banking/BankingService";
import {
  setupPlayerBanking,
  payHire,
  type NpcAccountHolder,
} from "@/systems/banking/economy";
import { PlayerService } from "@/core/services/PlayerService";
import { FactionType, NpcState, NpcRole, NpcGoalKind } from "@/types";
import { Faction } from "@/types/faction";
import type { Player } from "@/domain/Player";

function makeNpc(
  opts: {
    id?: string;
    faction?: Faction;
    role?: NpcRole;
    hullHP?: number;
    shields?: number;
    damage?: number;
    hostile?: boolean;
    systemId?: string;
  } = {},
): NpcShip {
  return new NpcShip({
    id: opts.id ?? "n1",
    name: "НПС",
    race: FactionType.OUTLANDERS,
    faction: opts.faction ?? Faction.OUTLANDERS,
    role: opts.role ?? NpcRole.RANGER,
    hullHP: opts.hullHP ?? 100,
    maxHull: opts.hullHP ?? 100,
    shields: opts.shields ?? 50,
    speed: 0.1,
    damage: opts.damage ?? 20,
    currentSystemId: opts.systemId ?? "sys_a",
    state: NpcState.PATROLLING,
    goal: null,
    destinationSystemId: null,
    daysToArrival: 0,
    credits: 500,
    reputation: 0,
    hostile: opts.hostile ?? false,
  });
}

describe("hireFee", () => {
  it("is the flat base fee plus a risk premium on the target's strength", () => {
    const target = makeNpc({ hullHP: 100, shields: 50, damage: 20 });
    const expected = Math.round(
      HIRE.baseFee + shipCombatStrength(target) * HIRE.riskFactor,
    );
    expect(hireFee(target)).toBe(expected);
  });

  it("costs more to hire against a tougher target", () => {
    const weak = makeNpc({ hullHP: 50, shields: 0, damage: 5 });
    const tough = makeNpc({ hullHP: 400, shields: 200, damage: 60 });
    expect(hireFee(tough)).toBeGreaterThan(hireFee(weak));
  });

  it("returns whole credits (save-safe onto a current account)", () => {
    for (const dmg of [3, 7, 11, 17]) {
      expect(Number.isInteger(hireFee(makeNpc({ damage: dmg })))).toBe(true);
    }
  });
});

describe("acceptsHire", () => {
  it("accepts an offer at or above the asking fee", () => {
    const merc = makeNpc({ id: "merc", faction: Faction.OUTLANDERS });
    const target = makeNpc({ id: "mark", faction: Faction.SYNDICATE });
    const fee = hireFee(target);
    expect(acceptsHire(merc, fee, target)).toBe(true);
    expect(acceptsHire(merc, fee + 1, target)).toBe(true);
  });

  it("declines an offer below the asking fee", () => {
    const merc = makeNpc({ id: "merc", faction: Faction.OUTLANDERS });
    const target = makeNpc({ id: "mark", faction: Faction.SYNDICATE });
    expect(acceptsHire(merc, hireFee(target) - 1, target)).toBe(false);
  });

  it("won't turn its guns on its own faction even for a rich offer", () => {
    const merc = makeNpc({ id: "merc", faction: Faction.BASTIONS });
    const ally = makeNpc({ id: "mark", faction: Faction.BASTIONS });
    expect(acceptsHire(merc, hireFee(ally) * 10, ally)).toBe(false);
  });

  it("won't accept a contract against itself", () => {
    const merc = makeNpc({ id: "merc", faction: Faction.OUTLANDERS });
    expect(acceptsHire(merc, hireFee(merc) * 10, merc)).toBe(false);
  });

  it("a ship already hostile to the player won't take the coin", () => {
    const merc = makeNpc({
      id: "merc",
      faction: Faction.OUTLANDERS,
      hostile: true,
    });
    const target = makeNpc({ id: "mark", faction: Faction.SYNDICATE });
    expect(acceptsHire(merc, hireFee(target) * 10, target)).toBe(false);
  });
});

describe("hireGoal", () => {
  it("retargets the hired ship to HUNT the target's system", () => {
    const target = makeNpc({ id: "mark", systemId: "sys_z" });
    expect(hireGoal(target)).toEqual({
      kind: NpcGoalKind.HUNT,
      targetSystemId: "sys_z",
    });
  });
});

interface Harness {
  bus: BankBus;
  service: BankingService;
  player: Player;
}

function makeHarness(startingMoney = 8000): Harness {
  const bus = new BankBus();
  const service = new BankingService(bus, { startDate: 1 });
  const player = new PlayerService().createPlayer({
    factionType: FactionType.OUTLANDERS,
    captainName: "Captain",
    startingMoney,
  });
  setupPlayerBanking(bus, service, player);
  return { bus, service, player };
}

describe("payHire — ABS balanced transfer", () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness(8000);
  });

  it("moves player.credits by exactly -fee", () => {
    const before = h.player.credits;
    const merc: NpcAccountHolder = {
      id: "merc1",
      name: "Наёмник",
      credits: 300,
    };
    payHire({ bus: h.bus, service: h.service }, h.player, merc, 1500, "hire");
    expect(h.player.credits).toBe(before - 1500);
    expect(h.player.credits).toBe(
      h.service.balanceOf(h.player.currentAccountId),
    );
  });

  it("credits the merc by exactly the fee (lockstep with the ledger)", () => {
    const merc: NpcAccountHolder = {
      id: "merc2",
      name: "Наёмник",
      credits: 300,
    };
    payHire({ bus: h.bus, service: h.service }, h.player, merc, 1500, "hire");
    expect(merc.credits).toBe(1800);
    expect(merc.credits).toBe(h.service.balanceOf("cur:merc2"));
  });

  it("keeps the global double-entry invariant balanced", () => {
    const merc: NpcAccountHolder = { id: "merc3", credits: 0 };
    payHire({ bus: h.bus, service: h.service }, h.player, merc, 1500, "hire");
    expect(Math.abs(h.service.getLedger().totalBalance())).toBeLessThanOrEqual(
      BALANCE_EPSILON,
    );
  });

  it("is a no-op for a non-positive fee", () => {
    const before = h.player.credits;
    const merc: NpcAccountHolder = { id: "merc4", credits: 100 };
    payHire({ bus: h.bus, service: h.service }, h.player, merc, 0, "hire");
    expect(h.player.credits).toBe(before);
    expect(merc.credits).toBe(100);
  });

  it("falls back to a direct mutation when banking is not wired", () => {
    const player = new PlayerService().createPlayer({
      factionType: FactionType.OUTLANDERS,
      captainName: "NoBank",
      startingMoney: 3000,
    });
    const merc: NpcAccountHolder = { id: "merc5", credits: 200 };
    payHire(null, player, merc, 750, "hire");
    expect(player.credits).toBe(2250);
    expect(merc.credits).toBe(950);
  });
});
