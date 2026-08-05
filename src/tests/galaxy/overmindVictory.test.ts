import { describe, it, expect } from "vitest";
import { Galaxy } from "@/domain/Galaxy";
import { Overmind } from "@/domain/Overmind";
import { GAME_BALANCE } from "@/config/balance";

function makeSystems(count: number): { id: string }[] {
  return Array.from({ length: count }, (_, i) => ({ id: `sys_${i}` }));
}

function makeGalaxy(
  systemCount: number,
  overmindCount: number,
  gameDays: number,
  pirateCount = 0,
): Galaxy {
  const systems = makeSystems(systemCount) as never[];
  const overmindSystems = Array.from(
    { length: overmindCount },
    (_, i) => `sys_${i}`,
  );
  const pirateSystems = Array.from(
    { length: pirateCount },
    (_, i) => `sys_${overmindCount + i}`,
  );
  const galaxy = new Galaxy(
    "g1",
    systems,
    new Overmind(),
    [],
    [],
    overmindSystems,
    "",
    pirateSystems,
  );
  galaxy.gameDays = gameDays;
  return galaxy;
}

const GRACE = 40;
const MIN_SYS = 12;

describe("Galaxy.isOvermindVictory", () => {
  it("returns false when overmind is NOT majority", () => {
    const g = makeGalaxy(30, 10, 100);
    expect(g.isOvermindVictory(GRACE, MIN_SYS, g.gameDays)).toBe(false);
  });

  it("returns false when majority but within grace period", () => {
    const g = makeGalaxy(30, 16, 20);
    expect(g.isOvermindVictory(GRACE, MIN_SYS, g.gameDays)).toBe(false);
  });

  it("returns false when majority and past grace but galaxy too small", () => {
    const g = makeGalaxy(8, 5, 100);
    expect(g.isOvermindVictory(GRACE, MIN_SYS, g.gameDays)).toBe(false);
  });

  it("returns true when majority AND past grace AND full-size galaxy", () => {
    const g = makeGalaxy(30, 16, 50);
    expect(g.isOvermindVictory(GRACE, MIN_SYS, g.gameDays)).toBe(true);
  });

  it("returns false exactly at grace boundary (day === graceDays)", () => {
    const g = makeGalaxy(30, 16, GRACE);
    expect(g.isOvermindVictory(GRACE, MIN_SYS, g.gameDays)).toBe(false);
  });

  it("returns true at first day past grace", () => {
    const g = makeGalaxy(30, 16, GRACE + 1);
    expect(g.isOvermindVictory(GRACE, MIN_SYS, g.gameDays)).toBe(true);
  });

  it("returns false at exactly minority share (half, not over half)", () => {
    const g = makeGalaxy(30, 15, 100);
    expect(g.isOvermindVictory(GRACE, MIN_SYS, g.gameDays)).toBe(false);
  });
});

describe("overmind floor threshold (regression: pirates must not mask zero overmind)", () => {
  it("overmindSystems.length is 0 even when FLOOR_MIN pirates are present", () => {
    const pirateCount = GAME_BALANCE.OVERMIND_FLOOR_MIN;
    const g = makeGalaxy(20, 0, 100, pirateCount);
    expect(
      g.overmindSystems.length + g.pirateSystems.length,
    ).toBeGreaterThanOrEqual(GAME_BALANCE.OVERMIND_FLOOR_MIN);
    expect(g.overmindSystems.length).toBeLessThan(
      GAME_BALANCE.OVERMIND_FLOOR_MIN,
    );
  });

  it("overmindSystems.length meets floor when both factions are present", () => {
    const g = makeGalaxy(20, GAME_BALANCE.OVERMIND_FLOOR_MIN, 100, 2);
    expect(g.overmindSystems.length).toBeGreaterThanOrEqual(
      GAME_BALANCE.OVERMIND_FLOOR_MIN,
    );
  });
});
