import { describe, it, expect } from "vitest";
import {
  payCustomsFine,
  standingRecoveryHint,
} from "@/systems/galaxy/landingAccess";
import { BankBus } from "@/systems/banking/bus";
import { BankingService } from "@/systems/banking/BankingService";
import { setupPlayerBanking } from "@/systems/banking/economy";
import { PlayerService } from "@/core/services/PlayerService";
import { FactionType } from "@/types";
import { PlayerSchema } from "@/validation/schemas";
import type { Player } from "@/domain/Player";

/**
 * Task 7: the customs bribe/fine is a **one-time access** path, not a reputation
 * dead-end. Paying the fine charges a meaningful credit cost through the ledger
 * but no longer docks −20 standing (recovery lives in faction quests / the
 * pirate-rep payoff), and every low-standing / denial surface carries a hint
 * telling the player *how* to climb back.
 */

function makePlayer(startingMoney = 2000): {
  bank: { bus: BankBus; service: BankingService };
  player: Player;
} {
  const bus = new BankBus();
  const service = new BankingService(bus, { startDate: 1 });
  const player = new PlayerService().createPlayer({
    factionType: FactionType.OUTLANDERS,
    captainName: "Cap",
    startingMoney,
  });
  setupPlayerBanking(bus, service, player);
  return { bank: { bus, service }, player };
}

describe("payCustomsFine — one-time access, no rep dead-end", () => {
  const FACTION = "GALACTIC_FEDERATION";

  it("charges the penalty through the ledger but never drops reputation (no −20)", () => {
    const { bank, player } = makePlayer(2000);
    player.adjustReputation(FACTION, -10);
    const repBefore = player.getReputation(FACTION);

    const ok = payCustomsFine(bank, player, 500);

    expect(ok).toBe(true);
    // Guard: the credit cost stays meaningful — smuggling is not free.
    expect(player.credits).toBe(1500);
    // The dead-end is gone: standing is untouched (the old path docked −20).
    expect(player.getReputation(FACTION)).toBe(repBefore);
    // Whole-credit projection the schema accepts (no fractional desync).
    expect(PlayerSchema.shape.credits.safeParse(player.credits).success).toBe(
      true,
    );
  });

  it("is a no-op when the player can't afford the fine (no charge, no rep change)", () => {
    const { bank, player } = makePlayer(100);
    const repBefore = player.getReputation(FACTION);

    const ok = payCustomsFine(bank, player, 500);

    expect(ok).toBe(false);
    expect(player.credits).toBe(100);
    expect(player.getReputation(FACTION)).toBe(repBefore);
  });

  it("treats a zero/negative penalty as free clearance (no booking)", () => {
    const { bank, player } = makePlayer(2000);
    expect(payCustomsFine(bank, player, 0)).toBe(true);
    expect(player.credits).toBe(2000);
  });

  it("a deeply-negative-standing player can still pay and stays exactly that negative", () => {
    const { bank, player } = makePlayer(2000);
    player.adjustReputation(FACTION, -50);
    expect(player.getReputation(FACTION)).toBe(-50);
    payCustomsFine(bank, player, 300);
    // No further decay — paying the fine never makes standing worse.
    expect(player.getReputation(FACTION)).toBe(-50);
    expect(player.credits).toBe(1700);
  });
});

describe("standingRecoveryHint — every denial surface tells you how to climb back", () => {
  it("points a normal-faction player at faction quests (localized, not a bare key)", () => {
    const hint = standingRecoveryHint(false);
    expect(hint.length).toBeGreaterThan(0);
    expect(hint).not.toBe("standing.recovery.faction");
  });

  it("points a pirate-held player at the pirate-rep payoff (distinct from the faction hint)", () => {
    const pirate = standingRecoveryHint(true);
    expect(pirate.length).toBeGreaterThan(0);
    expect(pirate).not.toBe("standing.recovery.pirate");
    expect(pirate).not.toBe(standingRecoveryHint(false));
  });
});
