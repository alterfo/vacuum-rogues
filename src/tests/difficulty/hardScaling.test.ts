import { describe, it, expect } from "vitest";
import {
  DIFFICULTY_HOSTILE_SCALING,
  scaledHostileSystemCount,
  scaledGarrisonRange,
  additionalHostileSeeds,
  OVERMIND_GARRISON_POWER_MAX_DISCOUNT,
} from "@/config/balance";
import { Galaxy } from "@/domain/Galaxy";
import { StarSystem } from "@/domain/StarSystem";
import { Overmind } from "@/domain/Overmind";
import { WarpPath } from "@/domain/WarpPath";
import { NpcSimulator, npcsPresentInSystem } from "@/systems/npc/NpcSimulator";
import { SeededRNG } from "@/utils/seededRNG";
import { StarType, NpcRole } from "@/types";
import { Faction } from "@/types/faction";

describe("Hard-mode hostile scaling — pure config", () => {
  it("NORMAL and GOD keep today's hostile-system counts exactly", () => {
    expect(scaledHostileSystemCount("NORMAL", 2)).toBe(2);
    expect(scaledHostileSystemCount("NORMAL", 1)).toBe(1);
    expect(scaledHostileSystemCount("GOD", 2)).toBe(2);
    expect(scaledHostileSystemCount("GOD", 1)).toBe(1);
  });

  it("HARD seeds modestly more hostile systems than NORMAL", () => {
    expect(scaledHostileSystemCount("HARD", 2)).toBeGreaterThan(
      scaledHostileSystemCount("NORMAL", 2),
    );
    expect(scaledHostileSystemCount("HARD", 1)).toBeGreaterThan(
      scaledHostileSystemCount("NORMAL", 1),
    );
    // 2 overmind + 1 pirate baseline → 3 + 2 = 5 hostile systems on HARD.
    expect(scaledHostileSystemCount("HARD", 2)).toBe(3);
    expect(scaledHostileSystemCount("HARD", 1)).toBe(2);
  });

  it("NORMAL/GOD keep today's garrison range; HARD shifts both bounds up", () => {
    expect(scaledGarrisonRange("NORMAL", 5, 10)).toEqual({ min: 5, max: 10 });
    expect(scaledGarrisonRange("GOD", 5, 10)).toEqual({ min: 5, max: 10 });

    const hard = scaledGarrisonRange("HARD", 5, 10);
    expect(hard.min).toBeGreaterThan(5);
    expect(hard.max).toBeGreaterThan(10);
    expect(hard).toEqual({ min: 7, max: 12 });
  });

  it("HARD bonus is a modest positive shift over the NORMAL baseline", () => {
    expect(DIFFICULTY_HOSTILE_SCALING.HARD.garrisonBonus).toBeGreaterThan(0);
    expect(
      DIFFICULTY_HOSTILE_SCALING.HARD.hostileSystemMultiplier,
    ).toBeGreaterThan(
      DIFFICULTY_HOSTILE_SCALING.NORMAL.hostileSystemMultiplier,
    );
    expect(DIFFICULTY_HOSTILE_SCALING.NORMAL).toEqual(
      DIFFICULTY_HOSTILE_SCALING.GOD,
    );
  });
});

describe("Hard-mode hostile scaling — additionalHostileSeeds", () => {
  const isolated = ["s0", "s1", "s2", "s3", "s4", "s5"];

  it("returns nothing for NORMAL/GOD (exactly today's seeding)", () => {
    expect(
      additionalHostileSeeds("NORMAL", isolated, ["s0", "s1"], ["s2"]),
    ).toEqual({ overmind: [], pirate: [] });
    expect(
      additionalHostileSeeds("GOD", isolated, ["s0", "s1"], ["s2"]),
    ).toEqual({ overmind: [], pirate: [] });
  });

  it("HARD adds extra hostiles from the most-isolated neutral systems", () => {
    const extra = additionalHostileSeeds(
      "HARD",
      isolated,
      ["s0", "s1"],
      ["s2"],
    );
    // baseline 2 overmind + 1 pirate → +1 overmind, +1 pirate on HARD.
    expect(extra.overmind).toHaveLength(1);
    expect(extra.pirate).toHaveLength(1);
    // Picks from the neutral frontier (s3 most isolated of the remaining).
    expect(extra.overmind).toEqual(["s3"]);
    expect(extra.pirate).toEqual(["s4"]);
  });

  it("never re-marks an already-hostile system", () => {
    const extra = additionalHostileSeeds(
      "HARD",
      isolated,
      ["s0", "s1"],
      ["s2"],
    );
    const all = [...extra.overmind, ...extra.pirate];
    expect(all).not.toContain("s0");
    expect(all).not.toContain("s1");
    expect(all).not.toContain("s2");
    // No overlap between the overmind and pirate additions.
    expect(new Set(all).size).toBe(all.length);
  });
});

function makeHostileGalaxy(): Galaxy {
  const sysA = new StarSystem(
    "sys_a",
    "Alpha",
    { q: 0, r: 0 },
    StarType.YELLOW_DWARF,
    [],
    Faction.INDEPENDENT,
    [],
  );
  const sysB = new StarSystem(
    "sys_b",
    "Beta",
    { q: 10, r: 0 },
    StarType.YELLOW_DWARF,
    [],
    Faction.INDEPENDENT,
    [],
  );
  sysA.connections.push(new WarpPath("sys_a", "sys_b", 3));
  sysB.connections.push(new WarpPath("sys_b", "sys_a", 3));
  return new Galaxy(
    "galaxy_hard_scaling",
    [sysA, sysB],
    new Overmind(),
    [],
    [],
  );
}

describe("Hard-mode hostile scaling — garrison size", () => {
  it("NORMAL garrison at zero ratcheted power is discounted below today's [5,10] baseline (win-rate-100pct plan, Task 3)", () => {
    // Superseded assertion: this test's `NpcSimulator` never attaches a
    // campaign-peak-power source, so `fillGarrison` reads peakPower=0 — the
    // pirate-garrison discount reversal (Task 3) now applies the full
    // OVERMIND_GARRISON_POWER_MAX_DISCOUNT there, same as the Overmind side.
    // See garrisonPowerScaling.test.ts for the dedicated discount coverage.
    const galaxy = makeHostileGalaxy();
    galaxy.addPirateSystem("sys_b");

    const sim = new NpcSimulator(); // default NORMAL
    sim.ensureGarrison(galaxy, new SeededRNG("hard_scaling_seed"));

    const hostile = npcsPresentInSystem(galaxy, "sys_b").filter(
      (n) => n.role === NpcRole.PIRATE,
    );
    const discount = OVERMIND_GARRISON_POWER_MAX_DISCOUNT;
    expect(hostile.length).toBeGreaterThanOrEqual(Math.max(1, 5 - discount));
    expect(hostile.length).toBeLessThanOrEqual(10 - discount);
  });

  it("HARD garrison is larger than NORMAL for the same galaxy + seed", () => {
    const seed = "hard_scaling_seed";

    const normalGalaxy = makeHostileGalaxy();
    normalGalaxy.addPirateSystem("sys_b");
    const normalSim = new NpcSimulator();
    normalSim.setGameMode("NORMAL");
    normalSim.ensureGarrison(normalGalaxy, new SeededRNG(seed));
    const normalCount = npcsPresentInSystem(normalGalaxy, "sys_b").filter(
      (n) => n.role === NpcRole.PIRATE,
    ).length;

    const hardGalaxy = makeHostileGalaxy();
    hardGalaxy.addPirateSystem("sys_b");
    const hardSim = new NpcSimulator();
    hardSim.setGameMode("HARD");
    hardSim.ensureGarrison(hardGalaxy, new SeededRNG(seed));
    const hardCount = npcsPresentInSystem(hardGalaxy, "sys_b").filter(
      (n) => n.role === NpcRole.PIRATE,
    ).length;

    expect(hardCount).toBeGreaterThan(normalCount);
  });
});
