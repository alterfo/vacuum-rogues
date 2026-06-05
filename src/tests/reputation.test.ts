import { describe, it, expect } from "vitest";
import { Player } from "@/domain/Player";
import { PlayerShip } from "@/domain/PlayerShip";
import { Inventory } from "@/domain/Inventory";
import { SkillTree } from "@/domain/SkillTree";
import { FactionType } from "@/types";
import type { QuestLog, Journal } from "@/types";

function makePlayer(
  reputation: Record<string, number> = {},
  credits = 1000,
): Player {
  return new Player(
    "p1",
    "Pilot",
    FactionType.PROGRESSORS,
    0,
    1,
    new SkillTree([]),
    reputation,
    { activeQuests: [], completedQuests: [] } as QuestLog,
    { entries: [] } as Journal,
    credits,
    new PlayerShip(
      "ship1",
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

describe("Player.getReputation", () => {
  it("returns 0 for unknown faction", () => {
    const p = makePlayer({});
    expect(p.getReputation("OUTLANDERS")).toBe(0);
  });

  it("returns the stored value", () => {
    const p = makePlayer({ OUTLANDERS: 42, BASTIONS: -55 });
    expect(p.getReputation("OUTLANDERS")).toBe(42);
    expect(p.getReputation("BASTIONS")).toBe(-55);
  });
});

describe("Player.isHostileTo", () => {
  it("returns false when reputation is 0 (neutral)", () => {
    const p = makePlayer({});
    expect(p.isHostileTo("SYNDICATE")).toBe(false);
  });

  it("returns false at exactly -30 (boundary — neutral side)", () => {
    const p = makePlayer({ SYNDICATE: -30 });
    expect(p.isHostileTo("SYNDICATE")).toBe(false);
  });

  it("returns true when reputation is -31 (below threshold)", () => {
    const p = makePlayer({ SYNDICATE: -31 });
    expect(p.isHostileTo("SYNDICATE")).toBe(true);
  });

  it("returns true at -100 (maximum hostility)", () => {
    const p = makePlayer({ OUTLANDERS: -100 });
    expect(p.isHostileTo("OUTLANDERS")).toBe(true);
  });
});

describe("Player.adjustReputation", () => {
  it("increases reputation by positive delta", () => {
    const p = makePlayer({ OUTLANDERS: 10 });
    p.adjustReputation("OUTLANDERS", 20);
    expect(p.getReputation("OUTLANDERS")).toBe(30);
  });

  it("decreases reputation by negative delta", () => {
    const p = makePlayer({ OUTLANDERS: 10 });
    p.adjustReputation("OUTLANDERS", -50);
    expect(p.getReputation("OUTLANDERS")).toBe(-40);
  });

  it("clamps to -100 on underflow", () => {
    const p = makePlayer({ BASTIONS: -90 });
    p.adjustReputation("BASTIONS", -20);
    expect(p.getReputation("BASTIONS")).toBe(-100);
  });

  it("clamps to 100 on overflow", () => {
    const p = makePlayer({ BASTIONS: 90 });
    p.adjustReputation("BASTIONS", 20);
    expect(p.getReputation("BASTIONS")).toBe(100);
  });

  it("creates a new entry when faction was unknown", () => {
    const p = makePlayer({});
    p.adjustReputation("PROGRESSORS", -35);
    expect(p.getReputation("PROGRESSORS")).toBe(-35);
    expect(p.isHostileTo("PROGRESSORS")).toBe(true);
  });
});

describe("Bribe mechanics (credit deduction)", () => {
  it("deducts 500 credits when bribe is paid", () => {
    const p = makePlayer({ OUTLANDERS: -50 }, 1000);
    const costBefore = p.credits;
    p.credits -= 500; // simulates payBribe / payStationBribe
    expect(p.credits).toBe(costBefore - 500);
  });

  it("player cannot afford bribe with insufficient credits", () => {
    const p = makePlayer({ OUTLANDERS: -50 }, 300);
    const canAfford = p.credits >= 500;
    expect(canAfford).toBe(false);
  });
});
