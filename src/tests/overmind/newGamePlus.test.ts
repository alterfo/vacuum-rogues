import { describe, it, expect } from "vitest";
import {
  newGamePlusCarry,
  nextCycleGameMode,
  DEFAULT_NEW_GAME_PLUS_CONFIG,
  type NewGamePlusSource,
} from "@/systems/overmind/newGamePlus";
import { FactionType } from "@/types";

function source(over: Partial<NewGamePlusSource> = {}): NewGamePlusSource {
  return {
    credits: 10000,
    rank: 2,
    faction: FactionType.OUTLANDERS,
    gameMode: "NORMAL",
    ...over,
  };
}

describe("nextCycleGameMode — difficulty escalates one notch toward HARD", () => {
  it("NORMAL → HARD", () => {
    expect(nextCycleGameMode("NORMAL")).toBe("HARD");
  });
  it("GOD → NORMAL (a sandbox graduates to a real run)", () => {
    expect(nextCycleGameMode("GOD")).toBe("NORMAL");
  });
  it("HARD stays HARD (the ceiling)", () => {
    expect(nextCycleGameMode("HARD")).toBe("HARD");
  });
});

describe("newGamePlusCarry", () => {
  it("carries a capped fraction of credits (a head-start, not the full pile)", () => {
    const carry = newGamePlusCarry(source({ credits: 10000 }));
    expect(carry.credits).toBe(5000);
  });

  it("caps the carried credits at the configured ceiling", () => {
    const carry = newGamePlusCarry(source({ credits: 1_000_000 }));
    expect(carry.credits).toBe(DEFAULT_NEW_GAME_PLUS_CONFIG.creditCarryCap);
  });

  it("floors fractional credit shares to whole credits", () => {
    const carry = newGamePlusCarry(source({ credits: 999 }));
    expect(carry.credits).toBe(499);
    expect(Number.isInteger(carry.credits)).toBe(true);
  });

  it("never carries negative credits (a bankrupt/edge player starts at 0)", () => {
    const carry = newGamePlusCarry(source({ credits: -5000 }));
    expect(carry.credits).toBe(0);
  });

  it("carries the won captain's rank and faction verbatim", () => {
    const carry = newGamePlusCarry(
      source({ rank: 4, faction: FactionType.BASTIONS }),
    );
    expect(carry.rank).toBe(4);
    expect(carry.factionType).toBe(FactionType.BASTIONS);
  });

  it("escalates difficulty for the next cycle", () => {
    expect(newGamePlusCarry(source({ gameMode: "NORMAL" })).gameMode).toBe(
      "HARD",
    );
    expect(newGamePlusCarry(source({ gameMode: "GOD" })).gameMode).toBe(
      "NORMAL",
    );
  });

  it("honours a custom config (fraction + cap)", () => {
    const carry = newGamePlusCarry(source({ credits: 10000 }), {
      creditCarryFraction: 0.25,
      creditCarryCap: 2000,
    });
    expect(carry.credits).toBe(2000);
  });
});
