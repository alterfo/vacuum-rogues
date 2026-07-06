/**
 * CombatModule × adaptive hostile scaling (three-year-campaign Task 4) — the
 * production consumer the OVERMIND_COMBAT_*_MULT levers lacked since the hex
 * CombatScene removal.
 *
 * Locked here:
 *  - fights inside an Overmind/pirate-held system scale incoming NPC damage by
 *    `hostileScaling(...).damageMult` and the enemy's effective HP by
 *    `hpMult` (the player's landed damage divides by it) — weak player ≈ 0.9×,
 *    maxed player = the full 1.5× levers;
 *  - fights in neutral systems, and legacy DI sites that don't wire the new
 *    deps, are byte-identical to before (neutral 1.0 scaling);
 *  - incoming damage stays routed through `applyDamageWithMode`: the GOD floor
 *    still catches a scaled lethal volley (downed, never dead);
 *  - HARD composes its config multiplier (never at the call site).
 */
import { describe, it, expect } from "vitest";
import {
  CombatModule,
  type CombatModuleDeps,
} from "@/presentation/flight/CombatModule";
import type { NpcShipSprite } from "@/presentation/NpcShipSprite";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import type { ShipPhysics } from "@/systems/ShipPhysics";
import { GAME_BALANCE } from "@/config/balance";
import { hullFloorFor } from "@/systems/combat/godMode";
import {
  hostileScaling,
  scaleHostileDamage,
} from "@/systems/campaign/hostileScaling";
import type { GameMode } from "@/types";

const FIRE = GAME_BALANCE.combatFireIntervalMs;
const MAX_HULL = 100;
const NPC_DAMAGE = 20;

function makePhysics(x = 0, y = 0): ShipPhysics {
  return {
    shipX: x,
    shipY: y,
    isMoving: true,
    currentSpeed: 1,
    setTarget(_x: number, _y: number): void {},
  } as unknown as ShipPhysics;
}

function makeSprite(
  id: string,
  opts: { hullHP?: number; damage?: number } = {},
): NpcShipSprite {
  return {
    x: 50,
    y: 0,
    npc: {
      id,
      name: id,
      hullHP: opts.hullHP ?? 1000,
      maxHull: opts.hullHP ?? 1000,
      damage: opts.damage ?? NPC_DAMAGE,
    },
  } as unknown as NpcShipSprite;
}

/** CombatModule with the campaign scaling deps wired (or omitted for legacy). */
function makeModule(
  ship: { hullHP: number; maxHull: number },
  opts: {
    mode?: GameMode;
    hostile?: boolean;
    peakPower?: number;
    omitScalingDeps?: boolean;
  } = {},
): { module: CombatModule; weaponDamage: number; deaths: () => number } {
  const loadout = new ShipLoadout("hull_warden");
  loadout.install("wpn_pulse");
  let deaths = 0;
  const deps: CombatModuleDeps = {
    getShipPhysics: () => makePhysics(),
    getPlayerLoadout: () => loadout,
    getPlayerShip: () => ship,
    getGameMode: () => opts.mode ?? "NORMAL",
    onPlayerDestroyed: () => {
      deaths++;
    },
  };
  if (!opts.omitScalingDeps) {
    deps.isHostileSystem = () => opts.hostile ?? false;
    deps.getCampaignPeakPower = () => opts.peakPower ?? 0;
  }
  const module = new CombatModule(deps);
  const weaponDamage = loadout.derivedStats().weaponDamage;
  return { module, weaponDamage, deaths: () => deaths };
}

describe("CombatModule — incoming NPC damage scales with ratcheted power (Task 4)", () => {
  it("weak player (index 0) in a hostile system takes the gentle ~0.9× hit", () => {
    const ship = { hullHP: MAX_HULL, maxHull: MAX_HULL };
    const { module } = makeModule(ship, { hostile: true, peakPower: 0 });
    module.addCombatant(makeSprite("a"));
    module.update(FIRE);
    const expected = scaleHostileDamage(
      NPC_DAMAGE,
      hostileScaling(0, "NORMAL").damageMult,
    );
    expect(expected).toBe(18); // 20 × 0.9
    expect(ship.hullHP).toBe(MAX_HULL - expected);
  });

  it("maxed player (index 1) in a hostile system takes the full 1.5× hit", () => {
    const ship = { hullHP: MAX_HULL, maxHull: MAX_HULL };
    const { module } = makeModule(ship, { hostile: true, peakPower: 1 });
    module.addCombatant(makeSprite("a"));
    module.update(FIRE);
    expect(ship.hullHP).toBe(
      MAX_HULL - NPC_DAMAGE * GAME_BALANCE.OVERMIND_COMBAT_DAMAGE_MULT,
    );
  });

  it("a neutral system applies no scaling even at max power", () => {
    const ship = { hullHP: MAX_HULL, maxHull: MAX_HULL };
    const { module } = makeModule(ship, { hostile: false, peakPower: 1 });
    module.addCombatant(makeSprite("a"));
    module.update(FIRE);
    expect(ship.hullHP).toBe(MAX_HULL - NPC_DAMAGE);
  });

  it("legacy DI sites without the scaling deps keep the exact old damage", () => {
    const ship = { hullHP: MAX_HULL, maxHull: MAX_HULL };
    const { module } = makeModule(ship, { omitScalingDeps: true });
    module.addCombatant(makeSprite("a"));
    module.update(FIRE);
    expect(ship.hullHP).toBe(MAX_HULL - NPC_DAMAGE);
  });

  it("HARD composes the config combat multiplier on incoming fire", () => {
    const ship = { hullHP: MAX_HULL, maxHull: MAX_HULL };
    const { module } = makeModule(ship, {
      mode: "HARD",
      hostile: true,
      peakPower: 1,
    });
    module.addCombatant(makeSprite("a"));
    module.update(FIRE);
    const expected = scaleHostileDamage(
      NPC_DAMAGE,
      hostileScaling(1, "HARD").damageMult,
    );
    expect(expected).toBeGreaterThan(
      NPC_DAMAGE * GAME_BALANCE.OVERMIND_COMBAT_DAMAGE_MULT,
    );
    expect(ship.hullHP).toBe(MAX_HULL - expected);
  });
});

describe("CombatModule — enemy effective HP scales with ratcheted power (Task 4)", () => {
  it("weak player's shots land harder (enemy is effectively softer at 0.9×)", () => {
    const ship = { hullHP: MAX_HULL, maxHull: MAX_HULL };
    const { module, weaponDamage } = makeModule(ship, {
      hostile: true,
      peakPower: 0,
    });
    const npc = makeSprite("a", { damage: 0 });
    module.addCombatant(npc);
    module.update(FIRE);
    const expected = scaleHostileDamage(
      weaponDamage,
      1 / hostileScaling(0, "NORMAL").hpMult,
    );
    expect(expected).toBeGreaterThan(weaponDamage);
    expect(npc.npc.hullHP).toBe(1000 - expected);
  });

  it("maxed player's shots are absorbed by the full 1.5× effective HP", () => {
    const ship = { hullHP: MAX_HULL, maxHull: MAX_HULL };
    const { module, weaponDamage } = makeModule(ship, {
      hostile: true,
      peakPower: 1,
    });
    const npc = makeSprite("a", { damage: 0 });
    module.addCombatant(npc);
    module.update(FIRE);
    const expected = scaleHostileDamage(
      weaponDamage,
      1 / GAME_BALANCE.OVERMIND_COMBAT_HP_MULT,
    );
    expect(expected).toBeLessThan(weaponDamage);
    expect(npc.npc.hullHP).toBe(1000 - expected);
  });

  it("neutral system / legacy deps: the player's raw weapon damage lands", () => {
    const ship = { hullHP: MAX_HULL, maxHull: MAX_HULL };
    const { module, weaponDamage } = makeModule(ship, {
      omitScalingDeps: true,
    });
    const npc = makeSprite("a", { damage: 0 });
    module.addCombatant(npc);
    module.update(FIRE);
    expect(npc.npc.hullHP).toBe(1000 - weaponDamage);
  });
});

describe("CombatModule — scaled damage stays on the god-mode path (Task 4)", () => {
  it("GOD: a scaled lethal volley floors the hull above 0 (downed, not dead)", () => {
    const floor = hullFloorFor("GOD", MAX_HULL);
    const ship = { hullHP: 15, maxHull: MAX_HULL };
    const { module, deaths } = makeModule(ship, {
      mode: "GOD",
      hostile: true,
      peakPower: 1,
    });
    module.addCombatant(makeSprite("a", { hullHP: 100000, damage: 9999 }));
    module.update(FIRE);
    expect(ship.hullHP).toBe(floor);
    expect(ship.hullHP).toBeGreaterThan(0);
    expect(deaths()).toBe(0);
  });

  it("NORMAL: a scaled lethal volley still reaches 0 and reports death", () => {
    const ship = { hullHP: 15, maxHull: MAX_HULL };
    const { module, deaths } = makeModule(ship, {
      hostile: true,
      peakPower: 1,
    });
    module.addCombatant(makeSprite("a", { hullHP: 100000, damage: 9999 }));
    module.update(FIRE);
    expect(ship.hullHP).toBe(0);
    expect(deaths()).toBe(1);
  });
});
