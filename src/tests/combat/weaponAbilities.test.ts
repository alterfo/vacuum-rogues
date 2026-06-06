import { describe, it, expect } from "vitest";
import { CombatSystem } from "@/systems/CombatSystem";
import { EnemyShip } from "@/domain/EnemyShip";
import { PlayerShip } from "@/domain/PlayerShip";
import { AdaptiveQualityProfile } from "@/ai/AdaptiveQualityProfile";
import { WeaponAbility, FactionType } from "@/types";
import type { EnemyType, AIProfile } from "@/types";
import {
  GEAR_CATALOG,
  GearKind,
  type WeaponSpec,
} from "@/systems/equipment/GearCatalog";

function makeSystem(): CombatSystem {
  return new CombatSystem({} as AdaptiveQualityProfile);
}

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

function startCombat(system: CombatSystem, enemy: EnemyShip): void {
  const player = makePlayer();
  system.startCombat(player, [enemy], {
    obstacles: [],
    cover: [],
    nebulae: [],
  });
}

// --- Weapon catalog checks ---
describe("WeaponSpec catalog — Task 10", () => {
  const weapons = GEAR_CATALOG.filter(
    (g) => g.kind === GearKind.WEAPON,
  ) as WeaponSpec[];

  it("has exactly 6 weapon variants", () => {
    expect(weapons).toHaveLength(6);
  });

  it("has 2 weapons per class (energy / fragment / missile)", () => {
    const energy = weapons.filter((w) => w.weaponClass === "ENERGY");
    const fragment = weapons.filter((w) => w.weaponClass === "FRAGMENT");
    const missile = weapons.filter((w) => w.weaponClass === "MISSILE");
    expect(energy).toHaveLength(2);
    expect(fragment).toHaveLength(2);
    expect(missile).toHaveLength(2);
  });

  it("all weapons have ability and cooldownTurns fields", () => {
    for (const w of weapons) {
      expect(w.ability).toBeDefined();
      expect(typeof w.cooldownTurns).toBe("number");
      expect(w.cooldownTurns).toBeGreaterThanOrEqual(0);
    }
  });

  it("EMP weapon exists (wpn_beam)", () => {
    const emp = weapons.find((w) => w.ability === WeaponAbility.EMP);
    expect(emp).toBeDefined();
  });

  it("HOMING weapon exists (wpn_torpedo)", () => {
    const homing = weapons.find((w) => w.ability === WeaponAbility.HOMING);
    expect(homing).toBeDefined();
  });

  it("BURST weapon exists (wpn_scatter)", () => {
    const burst = weapons.find((w) => w.ability === WeaponAbility.BURST);
    expect(burst).toBeDefined();
  });
});

// --- EMP ability ---
describe("CombatSystem — EMP ability (Task 10)", () => {
  it("sets shieldDisabledTurns=2 on target after EMP hit", () => {
    const system = makeSystem();
    const enemy = makeEnemy(100, 40);
    startCombat(system, enemy);

    const empWeapon = (GEAR_CATALOG as WeaponSpec[]).find(
      (g) => g.kind === GearKind.WEAPON && g.ability === WeaponAbility.EMP,
    )!;

    const result = system.resolvePlayerAttack(empWeapon.id);
    expect(result.damage).toBeGreaterThan(0);
    expect(enemy.shieldDisabledTurns).toBe(2);
  });

  it("shield does not absorb damage when shieldDisabledTurns > 0", () => {
    const system = makeSystem();
    const enemy = makeEnemy(100, 50);
    startCombat(system, enemy);

    enemy.shieldDisabledTurns = 1;
    const hpBefore = enemy.hullHP;
    system.applyDamageToEnemy(enemy, 20);

    // Shield is disabled so hull should take full damage
    expect(enemy.hullHP).toBe(hpBefore - 20);
    expect(enemy.shields).toBe(50); // shield untouched
  });

  it("shield absorbs damage when shieldDisabledTurns == 0", () => {
    const system = makeSystem();
    const enemy = makeEnemy(100, 50);
    startCombat(system, enemy);

    const hpBefore = enemy.hullHP;
    const shieldsBefore = enemy.shields;
    system.applyDamageToEnemy(enemy, 20);

    // Shield should absorb some/all damage
    expect(enemy.shields).toBeLessThan(shieldsBefore);
    // Hull damage = max(0, rawDamage - shields)
    const expectedHullDmg = Math.max(0, 20 - 50);
    expect(enemy.hullHP).toBe(hpBefore - expectedHullDmg);
  });
});

// --- BURST ability ---
describe("CombatSystem — BURST ability (Task 10)", () => {
  it("hits adjacent enemies in 1-hex radius", () => {
    const system = makeSystem();
    const enemy1 = makeEnemy(100, 0);
    const enemy2 = makeEnemy(100, 0);
    const player = makePlayer();

    system.startCombat(player, [enemy1, enemy2], {
      obstacles: [],
      cover: [],
      nebulae: [],
    });

    // Place enemy2 adjacent to enemy1 (enemy1 at q=7,r=2; enemy2 at q=7,r=3)
    const tile1 = system.grid.getTile({ q: 7, r: 2 });
    const tile2 = system.grid.getTile({ q: 7, r: 3 });
    if (tile1 && tile2) {
      tile1.occupant = enemy1;
      tile2.occupant = enemy2;
    }

    const burstWeapon = (GEAR_CATALOG as WeaponSpec[]).find(
      (g) => g.kind === GearKind.WEAPON && g.ability === WeaponAbility.BURST,
    )!;

    const hp1Before = enemy1.hullHP;
    const hp2Before = enemy2.hullHP;

    system.resolvePlayerAttack(burstWeapon.id);

    // Both enemies should take damage
    expect(enemy1.hullHP).toBeLessThan(hp1Before);
    expect(enemy2.hullHP).toBeLessThan(hp2Before);
  });
});

// --- Cooldown tracking ---
describe("CombatSystem — weapon cooldowns (Task 10)", () => {
  it("weapon cooldown is set after firing", () => {
    const system = makeSystem();
    const enemy = makeEnemy(100, 0);
    startCombat(system, enemy);

    const weapon = (GEAR_CATALOG as WeaponSpec[]).find(
      (g) => g.kind === GearKind.WEAPON && g.cooldownTurns > 0,
    )!;

    expect(system.getWeaponCooldown(weapon.id)).toBe(0);
    system.resolvePlayerAttack(weapon.id);
    expect(system.getWeaponCooldown(weapon.id)).toBe(weapon.cooldownTurns);
  });

  it("cooldown decrements by 1 per decrementPlayerCooldowns call", () => {
    const system = makeSystem();
    const enemy = makeEnemy(100, 0);
    startCombat(system, enemy);

    const weapon = (GEAR_CATALOG as WeaponSpec[]).find(
      (g) => g.kind === GearKind.WEAPON && g.cooldownTurns >= 2,
    )!;

    system.resolvePlayerAttack(weapon.id);
    const cd = system.getWeaponCooldown(weapon.id);
    system.decrementPlayerCooldowns();
    expect(system.getWeaponCooldown(weapon.id)).toBe(cd - 1);
  });

  it("weapon on cooldown is blocked from firing", () => {
    const system = makeSystem();
    const enemy = makeEnemy(100, 0);
    startCombat(system, enemy);

    const weapon = (GEAR_CATALOG as WeaponSpec[]).find(
      (g) => g.kind === GearKind.WEAPON && g.cooldownTurns > 0,
    )!;

    system.resolvePlayerAttack(weapon.id);
    expect(system.isWeaponOnCooldown(weapon.id)).toBe(true);

    const hp = enemy.hullHP;
    const result = system.resolvePlayerAttack(weapon.id);
    expect(result.damage).toBe(0);
    expect(enemy.hullHP).toBe(hp); // no damage dealt
  });

  it("cooldown reaches 0 and weapon becomes ready", () => {
    const system = makeSystem();
    const enemy = makeEnemy(200, 0);
    startCombat(system, enemy);

    const weapon = (GEAR_CATALOG as WeaponSpec[]).find(
      (g) => g.kind === GearKind.WEAPON && g.cooldownTurns === 1,
    )!;

    system.resolvePlayerAttack(weapon.id);
    expect(system.isWeaponOnCooldown(weapon.id)).toBe(true);

    system.decrementPlayerCooldowns();
    expect(system.isWeaponOnCooldown(weapon.id)).toBe(false);
  });
});

// --- EMP disabled turns decrement ---
describe("CombatSystem — EMP timer decrement (Task 10)", () => {
  it("shieldDisabledTurns decrements each enemy phase", async () => {
    const system = makeSystem();
    const enemy = makeEnemy(200, 50);
    const player = makePlayer();
    system.startCombat(player, [enemy], {
      obstacles: [],
      cover: [],
      nebulae: [],
    });

    enemy.shieldDisabledTurns = 2;
    await system.executeEnemyTurns();
    expect(enemy.shieldDisabledTurns).toBe(1);
    await system.executeEnemyTurns();
    expect(enemy.shieldDisabledTurns).toBe(0);
  });
});
