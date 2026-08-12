import { describe, it, expect, beforeEach } from "vitest";
import {
  shakedownTribute,
  fleeEscapeChance,
  attemptFlee,
  grappleHoldFraction,
  SHAKEDOWN_OUTCOME,
} from "@/systems/npc/NpcBrain";
import { GRAPPLE_HOLD } from "@/config/balance";
import { SeededRNG } from "@/utils/seededRNG";
import { BALANCE_EPSILON } from "@/domain/banking/Ledger";
import { BankBus } from "@/systems/banking/bus";
import { BankingService } from "@/systems/banking/BankingService";
import {
  setupPlayerBanking,
  payTribute,
  type NpcAccountHolder,
} from "@/systems/banking/economy";
import { PlayerService } from "@/core/services/PlayerService";
import { FactionType } from "@/types";
import type { Player } from "@/domain/Player";

describe("shakedownTribute", () => {
  it("demands the configured fraction of the player's purse", () => {
    expect(shakedownTribute(10_000)).toBe(
      Math.round(10_000 * SHAKEDOWN_OUTCOME.tributeFraction),
    );
  });

  it("floors the demand at minTribute for a modestly-funded player", () => {
    expect(shakedownTribute(200)).toBe(SHAKEDOWN_OUTCOME.minTribute);
  });

  it("caps the demand at maxTribute for a wealthy player", () => {
    expect(shakedownTribute(1_000_000)).toBe(SHAKEDOWN_OUTCOME.maxTribute);
  });

  it("never demands more than the player actually has", () => {
    expect(shakedownTribute(50)).toBe(50);
  });

  it("is zero for a penniless player", () => {
    expect(shakedownTribute(0)).toBe(0);
    expect(shakedownTribute(-100)).toBe(0);
  });

  it("returns whole credits (save-safe onto a current account)", () => {
    for (const purse of [333, 777.6, 4001.2, 12345.9]) {
      expect(Number.isInteger(shakedownTribute(purse))).toBe(true);
    }
  });
});

describe("fleeEscapeChance", () => {
  it("a dead-in-the-water player can never escape", () => {
    expect(fleeEscapeChance(0, 0.2)).toBe(0);
    expect(fleeEscapeChance(-1, 0.2)).toBe(0);
  });

  it("a motionless pirate is always escaped", () => {
    expect(fleeEscapeChance(0.1, 0)).toBe(1);
  });

  it("floors at fleeMinChance for a much slower player", () => {
    expect(fleeEscapeChance(0.1, 1.0)).toBeCloseTo(
      SHAKEDOWN_OUTCOME.fleeMinChance,
      5,
    );
  });

  it("saturates at fleeMaxChance for a much faster player", () => {
    expect(fleeEscapeChance(1.0, 0.1)).toBeCloseTo(
      SHAKEDOWN_OUTCOME.fleeMaxChance,
      5,
    );
  });

  it("ramps monotonically with the player:pirate speed ratio", () => {
    const slow = fleeEscapeChance(0.12, 0.2); // ratio 0.6
    const even = fleeEscapeChance(0.2, 0.2); // ratio 1.0
    const fast = fleeEscapeChance(0.28, 0.2); // ratio 1.4
    expect(even).toBeGreaterThan(slow);
    expect(fast).toBeGreaterThan(even);
    expect(slow).toBeGreaterThanOrEqual(SHAKEDOWN_OUTCOME.fleeMinChance);
    expect(fast).toBeLessThanOrEqual(SHAKEDOWN_OUTCOME.fleeMaxChance);
  });
});

describe("grappleHoldFraction", () => {
  it("is zero with no grapple installed", () => {
    expect(grappleHoldFraction(0, 100)).toBe(0);
  });

  it("saturates at 1 once grappleStrength reaches the enemy's threshold", () => {
    const threshold = 100 * GRAPPLE_HOLD.hullToThreshold;
    expect(grappleHoldFraction(threshold, 100)).toBe(1);
    expect(grappleHoldFraction(threshold * 2, 100)).toBe(1);
  });

  it("scales linearly below the threshold", () => {
    const threshold = 100 * GRAPPLE_HOLD.hullToThreshold;
    expect(grappleHoldFraction(threshold / 2, 100)).toBeCloseTo(0.5, 5);
  });

  it("a bigger/tougher enemy needs proportionally more grapple strength", () => {
    const weak = grappleHoldFraction(50, 100);
    const tough = grappleHoldFraction(50, 400);
    expect(weak).toBeGreaterThan(tough);
  });
});

describe("fleeEscapeChance — grapple hold", () => {
  it("no hold leaves the base chance unchanged", () => {
    const base = fleeEscapeChance(0.2, 0.2);
    expect(fleeEscapeChance(0.2, 0.2, 0)).toBeCloseTo(base, 6);
  });

  it("full hold (1) drives the escape chance to exactly zero", () => {
    expect(fleeEscapeChance(0.2, 0.2, 1)).toBe(0);
  });

  it("partial hold scales the chance down proportionally, not to zero", () => {
    const base = fleeEscapeChance(0.2, 0.2);
    const held = fleeEscapeChance(0.2, 0.2, 0.5);
    expect(held).toBeCloseTo(base * 0.5, 6);
    expect(held).toBeGreaterThan(0);
  });
});

describe("attemptFlee", () => {
  it("is deterministic for a given seed", () => {
    const a = attemptFlee(0.2, 0.2, new SeededRNG("flee-seed"));
    const b = attemptFlee(0.2, 0.2, new SeededRNG("flee-seed"));
    expect(a).toBe(b);
  });

  it("escapes at roughly the expected rate for an even match", () => {
    const expected = fleeEscapeChance(0.2, 0.2);
    let yes = 0;
    const N = 400;
    for (let i = 0; i < N; i++) {
      if (attemptFlee(0.2, 0.2, new SeededRNG(`f-${i}`))) yes++;
    }
    const rate = yes / N;
    expect(rate).toBeGreaterThan(expected - 0.12);
    expect(rate).toBeLessThan(expected + 0.12);
  });

  it("a faster player escapes more often than a slower one", () => {
    const N = 300;
    const rateFor = (playerSpeed: number): number => {
      let yes = 0;
      for (let i = 0; i < N; i++) {
        if (attemptFlee(playerSpeed, 0.2, new SeededRNG(`s-${i}`))) yes++;
      }
      return yes / N;
    };
    expect(rateFor(0.3)).toBeGreaterThan(rateFor(0.12));
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

describe("payTribute — ABS balanced transfer", () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness(8000);
  });

  it("moves player.credits by exactly -tribute", () => {
    const tribute = shakedownTribute(h.player.credits); // 2000
    const before = h.player.credits;
    const pirate: NpcAccountHolder = {
      id: "pirate1",
      name: "Бандит",
      credits: 500,
    };
    payTribute(
      { bus: h.bus, service: h.service },
      h.player,
      pirate,
      tribute,
      "tribute",
    );
    expect(h.player.credits).toBe(before - tribute);
    expect(h.player.credits).toBe(
      h.service.balanceOf(h.player.currentAccountId),
    );
  });

  it("credits the pirate by exactly the tribute (lockstep with the ledger)", () => {
    const pirate: NpcAccountHolder = {
      id: "pirate2",
      name: "Бандит",
      credits: 500,
    };
    payTribute(
      { bus: h.bus, service: h.service },
      h.player,
      pirate,
      2000,
      "tribute",
    );
    expect(pirate.credits).toBe(2500);
    expect(pirate.credits).toBe(h.service.balanceOf("cur:pirate2"));
  });

  it("keeps the global double-entry invariant balanced", () => {
    const pirate: NpcAccountHolder = {
      id: "pirate3",
      name: "Бандит",
      credits: 0,
    };
    payTribute(
      { bus: h.bus, service: h.service },
      h.player,
      pirate,
      2000,
      "tribute",
    );
    expect(Math.abs(h.service.getLedger().totalBalance())).toBeLessThanOrEqual(
      BALANCE_EPSILON,
    );
  });

  it("is a no-op for a non-positive tribute", () => {
    const before = h.player.credits;
    const pirate: NpcAccountHolder = { id: "pirate4", credits: 100 };
    payTribute(
      { bus: h.bus, service: h.service },
      h.player,
      pirate,
      0,
      "tribute",
    );
    expect(h.player.credits).toBe(before);
    expect(pirate.credits).toBe(100);
  });

  it("falls back to a direct mutation when banking is not wired", () => {
    const player = new PlayerService().createPlayer({
      factionType: FactionType.OUTLANDERS,
      captainName: "NoBank",
      startingMoney: 3000,
    });
    const pirate: NpcAccountHolder = { id: "pirate5", credits: 200 };
    payTribute(null, player, pirate, 750, "tribute");
    expect(player.credits).toBe(2250);
    expect(pirate.credits).toBe(950);
  });
});
