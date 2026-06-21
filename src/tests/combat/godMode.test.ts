import { describe, it, expect } from "vitest";
import {
  hullFloorFor,
  applyDamageWithMode,
  isDowned,
} from "@/systems/combat/godMode";
import { GOD_MODE_HULL_FLOOR_FRACTION } from "@/config/balance";
import { Player } from "@/domain/Player";
import { PlayerShip } from "@/domain/PlayerShip";
import { Inventory } from "@/domain/Inventory";
import { SkillTree } from "@/domain/SkillTree";
import { FactionType, type GameMode } from "@/types";

function makePlayer(mode: GameMode, hullHP: number, maxHull = 100): Player {
  const player = new Player(
    "player",
    "Captain",
    FactionType.OUTLANDERS,
    0,
    1,
    new SkillTree([]),
    {},
    { activeQuests: [], completedQuests: [] },
    { entries: [] },
    1000,
    new PlayerShip(
      "Ranger-1",
      "Ranger-1",
      hullHP,
      maxHull,
      50,
      50,
      100,
      100,
      1.0,
      0.8,
      FactionType.OUTLANDERS,
    ),
    new Inventory(),
    "",
  );
  player.setGameMode(mode);
  return player;
}

describe("hullFloorFor", () => {
  it("GOD floor is a small positive fraction of maxHull (always > 0)", () => {
    expect(hullFloorFor("GOD", 100)).toBe(
      Math.ceil(100 * GOD_MODE_HULL_FLOOR_FRACTION),
    );
    expect(hullFloorFor("GOD", 100)).toBeGreaterThan(0);
  });

  it("GOD floor is at least 1 HP even for a tiny hull", () => {
    expect(hullFloorFor("GOD", 1)).toBeGreaterThanOrEqual(1);
    expect(hullFloorFor("GOD", 0)).toBe(1);
  });

  it("NORMAL and HARD have no floor (0)", () => {
    expect(hullFloorFor("NORMAL", 100)).toBe(0);
    expect(hullFloorFor("HARD", 100)).toBe(0);
  });
});

describe("applyDamageWithMode", () => {
  it("GOD: a lethal hit floors hull above 0 and marks downed", () => {
    const floor = hullFloorFor("GOD", 100);
    const result = applyDamageWithMode("GOD", 100, 9999, 100);
    expect(result.hull).toBe(floor);
    expect(result.hull).toBeGreaterThan(0);
    expect(result.downed).toBe(true);
  });

  it("GOD: a non-lethal hit reduces hull normally and is not downed", () => {
    const result = applyDamageWithMode("GOD", 100, 30, 100);
    expect(result.hull).toBe(70);
    expect(result.downed).toBe(false);
  });

  it("GOD: damage that exactly reaches the floor marks downed", () => {
    const floor = hullFloorFor("GOD", 100);
    const result = applyDamageWithMode("GOD", 100, 100 - floor, 100);
    expect(result.hull).toBe(floor);
    expect(result.downed).toBe(true);
  });

  it("NORMAL: a lethal hit reaches 0 and is never downed", () => {
    const result = applyDamageWithMode("NORMAL", 100, 9999, 100);
    expect(result.hull).toBe(0);
    expect(result.downed).toBe(false);
  });

  it("HARD: a lethal hit reaches 0 and is never downed", () => {
    const result = applyDamageWithMode("HARD", 100, 9999, 100);
    expect(result.hull).toBe(0);
    expect(result.downed).toBe(false);
  });

  it("NORMAL: a non-lethal hit matches the old Math.max(0, hull - dmg)", () => {
    const result = applyDamageWithMode("NORMAL", 100, 40, 100);
    expect(result.hull).toBe(60);
    expect(result.downed).toBe(false);
  });
});

describe("isDowned", () => {
  it("GOD: true when hull is at the floor", () => {
    const floor = hullFloorFor("GOD", 100);
    expect(isDowned(makePlayer("GOD", floor))).toBe(true);
  });

  it("GOD: true when hull is below the floor", () => {
    const floor = hullFloorFor("GOD", 100);
    expect(isDowned(makePlayer("GOD", Math.max(0, floor - 1)))).toBe(true);
  });

  it("GOD: false when hull is above the floor (repaired)", () => {
    const floor = hullFloorFor("GOD", 100);
    expect(isDowned(makePlayer("GOD", floor + 1))).toBe(false);
    expect(isDowned(makePlayer("GOD", 100))).toBe(false);
  });

  it("GOD: repairing above the floor clears downed", () => {
    const floor = hullFloorFor("GOD", 100);
    const player = makePlayer("GOD", floor);
    expect(isDowned(player)).toBe(true);
    player.ship.repair();
    expect(isDowned(player)).toBe(false);
  });

  it("NORMAL: never downed, even at 0 hull", () => {
    expect(isDowned(makePlayer("NORMAL", 0))).toBe(false);
    expect(isDowned(makePlayer("NORMAL", 1))).toBe(false);
  });

  it("HARD: never downed, even at 0 hull", () => {
    expect(isDowned(makePlayer("HARD", 0))).toBe(false);
    expect(isDowned(makePlayer("HARD", 1))).toBe(false);
  });
});
