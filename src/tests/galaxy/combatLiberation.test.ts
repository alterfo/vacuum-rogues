import { describe, it, expect } from "vitest";
import { Galaxy } from "@/domain/Galaxy";
import { Overmind } from "@/domain/Overmind";
import { GAME_BALANCE } from "@/config/balance";
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

describe("combatLiberation — difficulty simulation", () => {
  /**
   * Inline combat simulation: player and enemy trade blows, shields absorb
   * first, hull takes the overflow. Returns "player_won" / "player_lost".
   */
  function simulate(
    playerHp: number,
    playerShields: number,
    playerDmg: number,
    enemyHp: number,
    enemyShields: number,
    enemyDmg: number,
    maxRounds = 60,
  ): "player_won" | "player_lost" {
    let pHp = playerHp;
    let pSh = playerShields;
    let eHp = enemyHp;
    let eSh = enemyShields;

    for (let r = 0; r < maxRounds; r++) {
      // Player attacks first
      if (eSh > 0) {
        const abs = Math.min(eSh, playerDmg);
        eSh -= abs;
        eHp -= playerDmg - abs;
      } else {
        eHp -= playerDmg;
      }
      if (eHp <= 0) return "player_won";

      // Enemy retaliates
      if (pSh > 0) {
        const abs = Math.min(pSh, enemyDmg);
        pSh -= abs;
        pHp -= enemyDmg - abs;
      } else {
        pHp -= enemyDmg;
      }
      if (pHp <= 0) return "player_lost";
    }
    return "player_lost";
  }

  // Hostile-system enemy: default (60 HP / 20 sh / 15 dmg) scaled by 1.5
  const baseEnemyHp = 60;
  const baseEnemyShields = 20;
  const baseEnemyDmg = 15;

  it("early loadout (scout hull, pulse laser) cannot defeat a hostile-system enemy", () => {
    const hmult = GAME_BALANCE.OVERMIND_COMBAT_HP_MULT;
    const dmult = GAME_BALANCE.OVERMIND_COMBAT_DAMAGE_MULT;
    const result = simulate(
      90, // scout hull HP
      20, // scout hull shields
      14, // pulse laser damage (wpn_pulse)
      Math.floor(baseEnemyHp * hmult),
      Math.floor(baseEnemyShields * hmult),
      Math.floor(baseEnemyDmg * dmult),
    );
    expect(result).toBe("player_lost");
  });

  it("top loadout (bastion hull, plasma cannon) wins against a hostile-system enemy", () => {
    const hmult = GAME_BALANCE.OVERMIND_COMBAT_HP_MULT;
    const dmult = GAME_BALANCE.OVERMIND_COMBAT_DAMAGE_MULT;
    const result = simulate(
      360, // bastion hull HP
      100, // bastion + shield equipment
      55, // wpn_plasma (techLevel 6, damage 55)
      Math.floor(baseEnemyHp * hmult),
      Math.floor(baseEnemyShields * hmult),
      Math.floor(baseEnemyDmg * dmult),
    );
    expect(result).toBe("player_won");
  });
});
