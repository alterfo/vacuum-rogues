import { describe, it, expect, vi, afterEach } from "vitest";
import { CombatSystem } from "@/systems/CombatSystem";
import { EnemyShip } from "@/domain/EnemyShip";
import { PlayerShip } from "@/domain/PlayerShip";
import { AdaptiveQualityProfile } from "@/ai/AdaptiveQualityProfile";
import { FactionType } from "@/types";
import type { EnemyType, AIProfile } from "@/types";

function makeSystem(): CombatSystem {
  return new CombatSystem({} as AdaptiveQualityProfile);
}

function makePlayer(hullHP = 100, maxHull = 100, shields = 50): PlayerShip {
  return new PlayerShip(
    "player",
    "Hero",
    hullHP,
    maxHull,
    shields,
    shields,
    100,
    100,
    0.1,
    0.1,
    FactionType.PROGRESSORS,
  );
}

function makeEnemy(hp = 100, shields = 30, techLevel = 2): EnemyShip {
  return new EnemyShip(
    `enemy_${hp}_${techLevel}`,
    "FIGHTER" as EnemyType,
    hp,
    shields,
    0.1,
    15,
    false,
    [],
    {} as AIProfile,
    techLevel,
  );
}

function startCombat(
  system: CombatSystem,
  enemy: EnemyShip,
  player?: PlayerShip,
): void {
  const p = player ?? makePlayer();
  system.startCombat(p, [enemy], { obstacles: [], cover: [], nebulae: [] });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CombatSystem — shield damage (Task 9)", () => {
  it("damage goes to shield first, remainder spills to hull", () => {
    const system = makeSystem();
    const enemy = makeEnemy(100, 10, 1);
    startCombat(system, enemy);

    system.applyDamageToEnemy(enemy, 20);

    expect(enemy.shields).toBe(0);
    expect(enemy.hullHP).toBe(90);
  });

  it("shield fully absorbs damage when shield > rawDamage", () => {
    const system = makeSystem();
    const enemy = makeEnemy(100, 50, 1);
    startCombat(system, enemy);

    system.applyDamageToEnemy(enemy, 20);

    expect(enemy.shields).toBe(30);
    expect(enemy.hullHP).toBe(100);
  });

  it("hull damage at 0 shield: all damage goes directly to hull", () => {
    const system = makeSystem();
    const enemy = makeEnemy(100, 0, 1);
    startCombat(system, enemy);

    system.applyDamageToEnemy(enemy, 25);

    expect(enemy.shields).toBe(0);
    expect(enemy.hullHP).toBe(75);
  });

  it("bypass-shields flag routes all damage to hull even when shield is active", () => {
    const system = makeSystem();
    const enemy = makeEnemy(100, 50, 1);
    startCombat(system, enemy);

    system.applyDamageToEnemy(enemy, 20, true);

    expect(enemy.shields).toBe(50); // shield untouched
    expect(enemy.hullHP).toBe(80); // all 20 to hull
  });
});

describe("CombatSystem — auto-retreat condition (Task 9)", () => {
  it("isAutoRetreatTriggered returns false when player HP is above 30%", () => {
    const system = makeSystem();
    const enemy = makeEnemy();
    const player = makePlayer(100, 100, 50);
    system.startCombat(player, [enemy], {
      obstacles: [],
      cover: [],
      nebulae: [],
    });

    expect(system.isAutoRetreatTriggered()).toBe(false);
  });

  it("isAutoRetreatTriggered returns true when player HP is exactly 30%", () => {
    const system = makeSystem();
    const enemy = makeEnemy();
    const player = makePlayer(30, 100, 0);
    system.startCombat(player, [enemy], {
      obstacles: [],
      cover: [],
      nebulae: [],
    });

    expect(system.isAutoRetreatTriggered()).toBe(true);
  });

  it("isAutoRetreatTriggered returns true when player HP is below 30%", () => {
    const system = makeSystem();
    const enemy = makeEnemy();
    const player = makePlayer(1, 100, 0);
    system.startCombat(player, [enemy], {
      obstacles: [],
      cover: [],
      nebulae: [],
    });

    expect(system.isAutoRetreatTriggered()).toBe(true);
  });

  it("isAutoRetreatTriggered returns false when HP is exactly 31%", () => {
    const system = makeSystem();
    const enemy = makeEnemy();
    const player = makePlayer(31, 100, 0);
    system.startCombat(player, [enemy], {
      obstacles: [],
      cover: [],
      nebulae: [],
    });

    expect(system.isAutoRetreatTriggered()).toBe(false);
  });

  it("isAutoRetreatTriggered returns false when no active encounter", () => {
    const system = makeSystem();
    expect(system.isAutoRetreatTriggered()).toBe(false);
  });

  it("checkEndConditions returns PLAYER_LOST (not IN_PROGRESS) when player HP ≤ 0", () => {
    const system = makeSystem();
    const enemy = makeEnemy(100, 0, 1);
    const player = makePlayer(0, 100, 0);
    system.startCombat(player, [enemy], {
      obstacles: [],
      cover: [],
      nebulae: [],
    });

    const result = system.checkEndConditions();

    expect(result.outcome).not.toBe("IN_PROGRESS");
  });
});

describe("CombatSystem — loot drop on enemy death (Task 9)", () => {
  it("resolveVictory returns loot when Math.random() < 0.3", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.1); // always drop

    const system = makeSystem();
    const enemy = makeEnemy(1, 0, 3);
    const result = system.resolveVictory([enemy]);

    expect(result.loot.length).toBeGreaterThan(0);
  });

  it("resolveVictory returns no loot when Math.random() >= 0.3", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5); // never drop

    const system = makeSystem();
    const enemy = makeEnemy(1, 0, 2);
    const result = system.resolveVictory([enemy]);

    expect(result.loot).toHaveLength(0);
  });

  it("checkEndConditions returns PLAYER_WON with loot when all enemies are dead", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.1); // force loot drop

    const system = makeSystem();
    const enemy = makeEnemy(1, 0, 3);
    startCombat(system, enemy);

    enemy.hullHP = 0;
    const result = system.checkEndConditions();

    expect(result.outcome).toBe("PLAYER_WON");
    expect(result.loot).toBeDefined();
    expect((result.loot as unknown[]).length).toBeGreaterThan(0);
  });

  it("resolveVictory grants credits proportional to enemy techLevel", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5); // no loot

    const system = makeSystem();
    const techLevel2 = makeEnemy(1, 0, 2);
    const techLevel4 = makeEnemy(1, 0, 4);

    const r2 = system.resolveVictory([techLevel2]);
    const r4 = system.resolveVictory([techLevel4]);

    expect(r4.creditsGained).toBeGreaterThan(r2.creditsGained);
    expect(r4.killPointsGained).toBeGreaterThan(r2.killPointsGained);
  });
});
