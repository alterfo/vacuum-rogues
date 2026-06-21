import { describe, it, expect } from "vitest";
import { NpcShip } from "@/domain/NpcShip";
import {
  shipCombatStrength,
  shakedownChance,
  wantsToShakedown,
  SHAKEDOWN,
} from "@/systems/npc/NpcBrain";
import { SeededRNG } from "@/utils/seededRNG";
import { NpcState, NpcRole, FactionType } from "@/types";
import { Faction } from "@/types/faction";

/**
 * Build a pirate NPC with the given combat stats. Hostile by default (pirates
 * spawn hostile in NpcSimulator), so it is a valid shakedown candidate.
 */
function makePirate(
  stats: { hullHP?: number; shields?: number; damage?: number } = {},
  hostile = true,
  role: NpcRole = NpcRole.PIRATE,
): NpcShip {
  return new NpcShip({
    id: "p1",
    name: "Пират",
    race: FactionType.SYNDICATE,
    faction: Faction.SYNDICATE,
    role,
    hullHP: stats.hullHP ?? 100,
    maxHull: stats.hullHP ?? 100,
    shields: stats.shields ?? 50,
    speed: 0.1,
    damage: stats.damage ?? 20,
    currentSystemId: "sys_a",
    state: NpcState.PATROLLING,
    goal: null,
    destinationSystemId: null,
    daysToArrival: 0,
    credits: 500,
    reputation: 0,
    hostile,
  });
}

describe("shipCombatStrength", () => {
  it("combines survivability (hull + shields) with weighted offence", () => {
    // 100 hull + 50 shields + 20 damage * 4 = 230
    expect(shipCombatStrength({ hullHP: 100, shields: 50, damage: 20 })).toBe(
      150 + 20 * SHAKEDOWN.damageWeight,
    );
  });

  it("floors negative inputs at zero (a wreck is not negative-strength)", () => {
    expect(shipCombatStrength({ hullHP: -50, shields: -10, damage: -5 })).toBe(
      0,
    );
  });
});

describe("shakedownChance — relative-strength gating", () => {
  it("is zero when the pirate is clearly weaker than the player", () => {
    const weak = makePirate({ hullHP: 20, shields: 0, damage: 5 });
    const playerStrength = shipCombatStrength({
      hullHP: 200,
      shields: 100,
      damage: 40,
    });
    expect(shakedownChance(weak, playerStrength)).toBe(0);
  });

  it("saturates at maxChance once the pirate is strong enough", () => {
    const pirate = makePirate({ hullHP: 100, shields: 50, damage: 20 });
    const pirateStrength = shipCombatStrength(pirate);
    // Player so weak the ratio is past strongRatio.
    const playerStrength = pirateStrength / (SHAKEDOWN.strongRatio + 0.5);
    expect(shakedownChance(pirate, playerStrength)).toBeCloseTo(
      SHAKEDOWN.maxChance,
      5,
    );
  });

  it("returns maxChance against a helpless (zero-strength) player", () => {
    const pirate = makePirate();
    expect(shakedownChance(pirate, 0)).toBe(SHAKEDOWN.maxChance);
  });

  it("ramps monotonically between minRatio and strongRatio", () => {
    const pirate = makePirate({ hullHP: 100, shields: 50, damage: 20 });
    const ps = shipCombatStrength(pirate);
    // Three player strengths giving increasing pirate:player ratios.
    const weakPlayer = shakedownChance(pirate, ps / 1.5);
    const evenPlayer = shakedownChance(pirate, ps / 1.0);
    const strongPlayer = shakedownChance(pirate, ps / 0.85);
    expect(weakPlayer).toBeGreaterThan(evenPlayer);
    expect(evenPlayer).toBeGreaterThan(strongPlayer);
    expect(strongPlayer).toBeGreaterThanOrEqual(0);
  });
});

describe("wantsToShakedown — decision gating", () => {
  it("never demands from a non-pirate role", () => {
    const trader = makePirate({}, true, NpcRole.TRADER);
    // Helpless player → maxChance, yet a trader still never shakes down.
    for (let i = 0; i < 20; i++) {
      expect(wantsToShakedown(trader, 0, new SeededRNG(`t${i}`))).toBe(false);
    }
  });

  it("never demands from a non-hostile pirate", () => {
    const calm = makePirate({}, false);
    for (let i = 0; i < 20; i++) {
      expect(wantsToShakedown(calm, 0, new SeededRNG(`c${i}`))).toBe(false);
    }
  });

  it("never demands when the pirate is too weak (chance 0)", () => {
    const weak = makePirate({ hullHP: 10, shields: 0, damage: 2 });
    const playerStrength = shipCombatStrength({
      hullHP: 300,
      shields: 150,
      damage: 60,
    });
    for (let i = 0; i < 50; i++) {
      expect(
        wantsToShakedown(weak, playerStrength, new SeededRNG(`w${i}`)),
      ).toBe(false);
    }
  });

  it("is deterministic for a given seed", () => {
    const pirate = makePirate();
    const a = wantsToShakedown(pirate, 0, new SeededRNG("same-seed"));
    const b = wantsToShakedown(pirate, 0, new SeededRNG("same-seed"));
    expect(a).toBe(b);
  });

  it("demands at roughly the expected rate against a helpless player", () => {
    // chance == maxChance (0.5). Over many seeds the positive rate should land
    // near 0.5 — proves the RNG actually gates the decision.
    const pirate = makePirate();
    let yes = 0;
    const N = 400;
    for (let i = 0; i < N; i++) {
      if (wantsToShakedown(pirate, 0, new SeededRNG(`seed-${i}`))) yes++;
    }
    const rate = yes / N;
    expect(rate).toBeGreaterThan(0.35);
    expect(rate).toBeLessThan(0.65);
  });

  it("demands more often as the player gets weaker (strength sweep)", () => {
    const pirate = makePirate();
    const ps = shipCombatStrength(pirate);
    const N = 300;
    const rateFor = (playerStrength: number): number => {
      let yes = 0;
      for (let i = 0; i < N; i++) {
        if (wantsToShakedown(pirate, playerStrength, new SeededRNG(`s-${i}`)))
          yes++;
      }
      return yes / N;
    };
    // Stronger player (smaller ratio) → fewer demands than a weaker player.
    const vsStrong = rateFor(ps / 0.9); // ratio ~0.9, just above minRatio
    const vsWeak = rateFor(ps / 1.6); // ratio ~1.6, saturated
    expect(vsWeak).toBeGreaterThan(vsStrong);
  });
});
