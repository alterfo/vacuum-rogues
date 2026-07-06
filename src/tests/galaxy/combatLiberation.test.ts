import { describe, it, expect } from "vitest";
import { Galaxy } from "@/domain/Galaxy";
import { Overmind } from "@/domain/Overmind";
import { GAME_BALANCE } from "@/config/balance";
import { hostileScaling } from "@/systems/campaign/hostileScaling";
import type { StarSystem } from "@/domain/StarSystem";

function makeSystems(ids: string[]): StarSystem[] {
  return ids.map(
    (id) =>
      ({
        id,
        name: id,
        connections: [],
        planets: [],
        explored: false,
        fogOfWar: false,
      }) as unknown as StarSystem,
  );
}

function makeGalaxy(
  ids: string[],
  overmindSystems: string[] = [],
  pirateSystems: string[] = [],
): Galaxy {
  const g = new Galaxy(
    "g1",
    makeSystems(ids),
    new Overmind(),
    [],
    [],
    overmindSystems,
    "",
    pirateSystems,
  );
  g.gameDays = 50;
  return g;
}

// ── Liberation mechanic ─────────────────────────────────────────────────────

describe("Galaxy.tryLiberate", () => {
  it("removes an overmind system and returns true", () => {
    const g = makeGalaxy(["s_a", "s_b"], ["s_a"], []);
    const result = g.tryLiberate("s_a");
    expect(result).toBe(true);
    expect(g.isOvermindSystem("s_a")).toBe(false);
    expect(g.overmindSystems).toHaveLength(0);
  });

  it("removes a pirate system and returns true", () => {
    const g = makeGalaxy(["s_a", "s_b"], [], ["s_a"]);
    const result = g.tryLiberate("s_a");
    expect(result).toBe(true);
    expect(g.isPirateSystem("s_a")).toBe(false);
    expect(g.pirateSystems).toHaveLength(0);
  });

  it("returns false when the system is not hostile (no-op)", () => {
    const g = makeGalaxy(["s_a", "s_b"], ["s_a"], []);
    const result = g.tryLiberate("s_b"); // s_b is faction-controlled
    expect(result).toBe(false);
    expect(g.overmindSystems).toContain("s_a"); // unchanged
  });

  it("emits a SYSTEM_LIBERATED news event on liberation", () => {
    const g = makeGalaxy(["s_a"], ["s_a"], []);
    g.tryLiberate("s_a");
    expect(g.newsFeed).toHaveLength(1);
    expect(g.newsFeed[0].type).toBe("SYSTEM_LIBERATED");
    expect(g.newsFeed[0].systemId).toBe("s_a");
    expect(g.newsFeed[0].day).toBe(50);
  });

  it("does not emit a news event for a non-hostile liberation attempt", () => {
    const g = makeGalaxy(["s_a", "s_b"], ["s_a"], []);
    g.tryLiberate("s_b");
    expect(g.newsFeed).toHaveLength(0);
  });
});

// ── Difficulty scaling ──────────────────────────────────────────────────────

describe("GAME_BALANCE — overmind combat multipliers", () => {
  it("OVERMIND_COMBAT_HP_MULT is greater than 1.0", () => {
    expect(GAME_BALANCE.OVERMIND_COMBAT_HP_MULT).toBeGreaterThan(1.0);
  });

  it("OVERMIND_COMBAT_DAMAGE_MULT is greater than 1.0", () => {
    expect(GAME_BALANCE.OVERMIND_COMBAT_DAMAGE_MULT).toBeGreaterThan(1.0);
  });
});

/**
 * REWRITTEN under the three-year-campaign test-modification license (Task 4).
 *
 * The old section pinned the raw OVERMIND_COMBAT_*_MULT levers as a flat 1.5×
 * on every garrison fight. The multipliers are now the STRONG endpoint of the
 * adaptive `hostileScaling(peakPower, mode)` lerp (weak player ≈ 0.9×), so the
 * simulation evaluates the endpoints the player actually faces. The MEANING is
 * preserved: an early loadout cannot liberate a hostile system (the standing
 * garrison overwhelms the scout even at its gentle scaling), while a top
 * loadout beats a full-strength garrison ship. New intentional behaviour also
 * locked: at the weak endpoint a LONE garrison patrol is survivable 1v1 —
 * gentle early, hard late.
 */
describe("combatLiberation — adaptive difficulty simulation (Task 4)", () => {
  /**
   * Inline combat simulation vs a garrison of identical enemies: the player
   * focuses one enemy at a time (shields absorb first, hull takes overflow);
   * every living enemy returns fire each round. Returns "player_won" /
   * "player_lost".
   */
  function simulateGarrison(
    playerHp: number,
    playerShields: number,
    playerDmg: number,
    enemyCount: number,
    enemyHp: number,
    enemyShields: number,
    enemyDmg: number,
    maxRounds = 60,
  ): "player_won" | "player_lost" {
    let pHp = playerHp;
    let pSh = playerShields;
    const enemies = Array.from({ length: enemyCount }, () => ({
      hp: enemyHp,
      sh: enemyShields,
    }));

    for (let r = 0; r < maxRounds; r++) {
      // Player attacks the first living enemy
      const target = enemies.find((e) => e.hp > 0);
      if (!target) return "player_won";
      if (target.sh > 0) {
        const abs = Math.min(target.sh, playerDmg);
        target.sh -= abs;
        target.hp -= playerDmg - abs;
      } else {
        target.hp -= playerDmg;
      }
      if (!enemies.some((e) => e.hp > 0)) return "player_won";

      // Every living enemy retaliates
      for (const e of enemies) {
        if (e.hp <= 0) continue;
        if (pSh > 0) {
          const abs = Math.min(pSh, enemyDmg);
          pSh -= abs;
          pHp -= enemyDmg - abs;
        } else {
          pHp -= enemyDmg;
        }
      }
      if (pHp <= 0) return "player_lost";
    }
    return "player_lost";
  }

  // Hostile-system enemy baseline (60 HP / 20 sh / 15 dmg), scaled by the
  // adaptive endpoints the player actually faces on NORMAL.
  const baseEnemyHp = 60;
  const baseEnemyShields = 20;
  const baseEnemyDmg = 15;
  const weak = hostileScaling(0, "NORMAL"); // fresh scout's ratcheted power ≈ 0
  const strong = hostileScaling(1, "NORMAL"); // maxed veteran

  // Scout (90/20 + wpn_pulse 14) and top loadout (bastion 360/100 + plasma 55).
  const scout = { hp: 90, sh: 20, dmg: 14 };
  const top = { hp: 360, sh: 100, dmg: 55 };

  // NpcSimulator's standing-garrison floor (GARRISON_MIN) — a captured system
  // never holds fewer defenders than this.
  const GARRISON_MIN = 5;

  it("strong endpoint equals the OVERMIND_COMBAT_*_MULT levers (still > 1)", () => {
    expect(strong.hpMult).toBeCloseTo(GAME_BALANCE.OVERMIND_COMBAT_HP_MULT, 10);
    expect(strong.damageMult).toBeCloseTo(
      GAME_BALANCE.OVERMIND_COMBAT_DAMAGE_MULT,
      10,
    );
    expect(weak.hpMult).toBeLessThan(strong.hpMult);
  });

  it("early loadout cannot liberate: the standing garrison overwhelms the scout even at its gentle scaling", () => {
    const result = simulateGarrison(
      scout.hp,
      scout.sh,
      scout.dmg,
      GARRISON_MIN,
      Math.floor(baseEnemyHp * weak.hpMult),
      Math.floor(baseEnemyShields * weak.hpMult),
      Math.floor(baseEnemyDmg * weak.damageMult),
    );
    expect(result).toBe("player_lost");
  });

  it("gentle early: a LONE garrison patrol is survivable for the scout at the weak endpoint", () => {
    const result = simulateGarrison(
      scout.hp,
      scout.sh,
      scout.dmg,
      1,
      Math.floor(baseEnemyHp * weak.hpMult),
      Math.floor(baseEnemyShields * weak.hpMult),
      Math.floor(baseEnemyDmg * weak.damageMult),
    );
    expect(result).toBe("player_won");
  });

  it("top loadout wins against a full-strength hostile-system enemy (strong endpoint)", () => {
    const result = simulateGarrison(
      top.hp,
      top.sh,
      top.dmg,
      1,
      Math.floor(baseEnemyHp * strong.hpMult),
      Math.floor(baseEnemyShields * strong.hpMult),
      Math.floor(baseEnemyDmg * strong.damageMult),
    );
    expect(result).toBe("player_won");
  });
});
