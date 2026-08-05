import { describe, it, expect, vi } from "vitest";
import { CombatAI, hexDistance } from "@/systems/combat/CombatAI";
import { CombatSystem } from "@/systems/CombatSystem";
import { EnemyShip } from "@/domain/EnemyShip";
import { PlayerShip } from "@/domain/PlayerShip";
import { HexGrid } from "@/domain/HexGrid";
import { TacticalEncounter } from "@/domain/TacticalEncounter";
import { AdaptiveQualityProfile } from "@/ai/AdaptiveQualityProfile";
import { EncounterState, FactionType } from "@/types";
import type { EnemyType, AIProfile } from "@/types";

function makePlayer(): PlayerShip {
  return new PlayerShip(
    "player",
    "Hero",
    100,
    100,
    60,
    60,
    100,
    100,
    0.1,
    0.1,
    FactionType.PROGRESSORS,
  );
}

function makeEnemy(hp: number, techLevel = 1): EnemyShip {
  return new EnemyShip(
    `enemy_${hp}`,
    "FIGHTER" as EnemyType,
    hp,
    0,
    0.1,
    15,
    false,
    [],
    {} as AIProfile,
    techLevel,
  );
}

function makeEncounterWithGrid(
  player: PlayerShip,
  enemy: EnemyShip,
  playerCoord = { q: 1, r: 4 },
  enemyCoord = { q: 7, r: 4 },
): { encounter: TacticalEncounter; grid: HexGrid } {
  const grid = new HexGrid(9, 9);
  grid.getTile(playerCoord)!.occupant = player;
  grid.getTile(enemyCoord)!.occupant = enemy;
  const encounter = new TacticalEncounter("enc", grid, player, [enemy]);
  return { encounter, grid };
}

describe("CombatAI — state machine", () => {
  it("moves toward player when healthy", () => {
    const player = makePlayer();
    const enemy = makeEnemy(100); // full HP → ATTACK state
    const { encounter, grid } = makeEncounterWithGrid(player, enemy);

    const ai = new CombatAI();
    const action = ai.decide(enemy, encounter, grid);

    expect(action.type).toBe("MOVE");
    if (action.type === "MOVE" && action.target) {
      expect(action.target.q).toBeLessThan(7);
    }
  });

  it("attacks when adjacent to player", () => {
    const player = makePlayer();
    const enemy = makeEnemy(100);
    const { encounter, grid } = makeEncounterWithGrid(
      player,
      enemy,
      { q: 2, r: 4 },
      { q: 3, r: 4 },
    );

    const ai = new CombatAI();
    const action = ai.decide(enemy, encounter, grid);

    expect(action.type).toBe("ATTACK");
    expect(action.target).toEqual({ q: 2, r: 4 });
  });

  it("retreats when HP is below 30%", () => {
    const player = makePlayer();
    const enemy = makeEnemy(100);
    enemy.hullHP = 25;
    const { encounter, grid } = makeEncounterWithGrid(player, enemy);

    const ai = new CombatAI();
    const action = ai.decide(enemy, encounter, grid);

    expect(action.type === "MOVE" || action.type === "WAIT").toBe(true);
    if (action.type === "MOVE" && action.target) {
      const distBefore = hexDistance({ q: 7, r: 4 }, { q: 1, r: 4 });
      const distAfter = hexDistance(action.target, { q: 1, r: 4 });
      expect(distAfter).toBeGreaterThan(distBefore);
    }
  });

  it("returns WAIT when entities not found on grid", () => {
    const player = makePlayer();
    const enemy = makeEnemy(100);
    const grid = new HexGrid(9, 9);
    const encounter = new TacticalEncounter("enc", grid, player, [enemy]);

    const ai = new CombatAI();
    const action = ai.decide(enemy, encounter, grid);

    expect(action.type).toBe("WAIT");
  });
});

describe("CombatSystem — victory rewards (Task 9)", () => {
  function makeSystem(): CombatSystem {
    return new CombatSystem({} as AdaptiveQualityProfile);
  }

  it("awards credits proportional to enemy tech level", () => {
    const system = makeSystem();
    const enemies = [makeEnemy(60, 3), makeEnemy(60, 5)];

    const rewards = system.resolveVictory(enemies);

    expect(rewards.creditsGained).toBe(400);
  });

  it("credits scale correctly — single enemy at default tech level 1", () => {
    const system = makeSystem();
    const rewards = system.resolveVictory([makeEnemy(60, 1)]);
    expect(rewards.creditsGained).toBe(50);
  });

  it("loot array exists (may be empty due to RNG)", () => {
    const system = makeSystem();
    vi.spyOn(Math, "random").mockReturnValue(0.1); // < 0.3 → drop
    const rewards = system.resolveVictory([makeEnemy(60, 4)]);
    expect(Array.isArray(rewards.loot)).toBe(true);
    expect(rewards.loot.length).toBeGreaterThanOrEqual(1);
    vi.restoreAllMocks();
  });

  it("no loot when RNG is above 0.3 threshold", () => {
    const system = makeSystem();
    vi.spyOn(Math, "random").mockReturnValue(0.99); // > 0.3 → no drop
    const rewards = system.resolveVictory([makeEnemy(60, 2)]);
    expect(rewards.loot).toHaveLength(0);
    vi.restoreAllMocks();
  });
});

describe("CombatSystem — defeat condition (Task 9)", () => {
  function makeSystem(): CombatSystem {
    return new CombatSystem({} as AdaptiveQualityProfile);
  }

  it("sets player HP to 1 on defeat and state to PLAYER_LOST", () => {
    const system = makeSystem();
    const player = makePlayer();
    const enemy = makeEnemy(100, 2);
    system.startCombat(player, [enemy], {
      obstacles: [],
      cover: [],
      nebulae: [],
    });

    player.hullHP = 0;

    const result = system.checkEndConditions();
    expect(result.outcome).toBe(EncounterState.PLAYER_LOST);
    expect(player.hullHP).toBe(1);
    expect(system.encounter?.state).toBe(EncounterState.PLAYER_LOST);
  });

  it("detects victory when all enemies are at 0 HP", () => {
    const system = makeSystem();
    const player = makePlayer();
    const enemy = makeEnemy(60, 2);
    system.startCombat(player, [enemy], {
      obstacles: [],
      cover: [],
      nebulae: [],
    });

    enemy.hullHP = 0;

    const result = system.checkEndConditions();
    expect(result.outcome).toBe(EncounterState.PLAYER_WON);
    expect(system.encounter?.state).toBe(EncounterState.PLAYER_WON);
  });
});

describe("hexDistance helper", () => {
  it("returns 0 for same coord", () => {
    expect(hexDistance({ q: 3, r: 3 }, { q: 3, r: 3 })).toBe(0);
  });

  it("returns 6 for opposite corners of 9×9 grid", () => {
    expect(hexDistance({ q: 1, r: 4 }, { q: 7, r: 4 })).toBe(6);
  });
});
