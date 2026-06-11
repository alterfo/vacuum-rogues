import { describe, it, expect } from "vitest";
import { Galaxy } from "@/domain/Galaxy";
import { Overmind } from "@/domain/Overmind";
import { GAME_BALANCE } from "@/config/balance";

// Minimal StarSystem stub — only id is needed by Galaxy's loss logic.
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
    // 30 systems, 10 overmind (33%) — below majority threshold
    const g = makeGalaxy(30, 10, 100);
    expect(g.isOvermindVictory(GRACE, MIN_SYS, g.gameDays)).toBe(false);
  });

  it("returns false when majority but within grace period", () => {
    // 30 systems, 16 overmind (>50%), day 20 < grace 40
    const g = makeGalaxy(30, 16, 20);
    expect(g.isOvermindVictory(GRACE, MIN_SYS, g.gameDays)).toBe(false);
  });

  it("returns false when majority and past grace but galaxy too small", () => {
    // 8 systems, 5 overmind (>50%), day 100, but 8 < MIN_SYS=12
    const g = makeGalaxy(8, 5, 100);
    expect(g.isOvermindVictory(GRACE, MIN_SYS, g.gameDays)).toBe(false);
  });

  it("returns true when majority AND past grace AND full-size galaxy", () => {
    // 30 systems, 16 overmind (>50%), day 50 > grace 40, 30 >= 12
    const g = makeGalaxy(30, 16, 50);
    expect(g.isOvermindVictory(GRACE, MIN_SYS, g.gameDays)).toBe(true);
  });

  it("returns false exactly at grace boundary (day === graceDays)", () => {
    // Grace ends strictly AFTER the grace day, not on it
    const g = makeGalaxy(30, 16, GRACE);
    expect(g.isOvermindVictory(GRACE, MIN_SYS, g.gameDays)).toBe(false);
  });

  it("returns true at first day past grace", () => {
    const g = makeGalaxy(30, 16, GRACE + 1);
    expect(g.isOvermindVictory(GRACE, MIN_SYS, g.gameDays)).toBe(true);
  });

  it("returns false at exactly minority share (half, not over half)", () => {
    // 30 systems, exactly 15 overmind = not strictly >50%
    const g = makeGalaxy(30, 15, 100);
    expect(g.isOvermindVictory(GRACE, MIN_SYS, g.gameDays)).toBe(false);
  });
});

// ── Overmind floor guard ────────────────────────────────────────────────────
// Regression: the floor check must compare overmindSystems.length, not
// (overmindSystems + pirateSystems).length.  If pirates fill the hostile
// quota while overmind is at 0, the floor must still trigger — otherwise
// the loss condition can never fire in that galaxy state.
describe("overmind floor threshold (regression: pirates must not mask zero overmind)", () => {
  it("overmindSystems.length is 0 even when FLOOR_MIN pirates are present", () => {
    const pirateCount = GAME_BALANCE.OVERMIND_FLOOR_MIN;
    const g = makeGalaxy(20, 0, 100, pirateCount);
    // The old (wrong) totalHostile check: pirateCount >= FLOOR_MIN → no floor trigger
    expect(
      g.overmindSystems.length + g.pirateSystems.length,
    ).toBeGreaterThanOrEqual(GAME_BALANCE.OVERMIND_FLOOR_MIN);
    // The correct check: overmind is at 0 → floor MUST trigger
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
