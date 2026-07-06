/**
 * God-mode wired into the live combat + jump paths (plan
 * `20260620-game-difficulty-modes-god-normal-hard.md`, Task 4).
 *
 * Three behaviours are locked here:
 *   1. CombatModule routes incoming NPC fire through `applyDamageWithMode`, so a
 *      lethal hit in GOD floors the player's hull above 0 and "downs" the ship
 *      instead of killing it — `onPlayerDestroyed` (→ GAME_OVER) never fires.
 *      NORMAL/HARD are unchanged: the hull reaches 0 and death is reported.
 *   2. A downed ship cannot fire — neither the real-time auto-fire
 *      (`advancePlayerTimer`) nor a deliberate confirmed shot (`confirmAttack`)
 *      lands — until the hull is repaired above the floor.
 *   3. The hyperjump gate both warp paths call is the derived `isDowned`
 *      predicate: true at the floor, cleared by a repair above it.
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
import { hullFloorFor, isDowned } from "@/systems/combat/godMode";
import { Player } from "@/domain/Player";
import { PlayerShip } from "@/domain/PlayerShip";
import { Inventory } from "@/domain/Inventory";
import { SkillTree } from "@/domain/SkillTree";
import { FactionType, type GameMode } from "@/types";

const FIRE = GAME_BALANCE.combatFireIntervalMs;
const MAX_HULL = 100;
const FLOOR = hullFloorFor("GOD", MAX_HULL);

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
  x: number,
  y: number,
  opts: { hullHP?: number; damage?: number } = {},
): NpcShipSprite {
  return {
    x,
    y,
    npc: {
      id,
      name: id,
      hullHP: opts.hullHP ?? 1000, // tanky by default so the fight persists
      maxHull: opts.hullHP ?? 1000,
      damage: opts.damage ?? 20,
    },
  } as unknown as NpcShipSprite;
}

/** Build a CombatModule in the given mode, counting deaths + capturing toasts. */
function makeModule(
  ship: { hullHP: number; maxHull: number },
  mode: GameMode,
): {
  module: CombatModule;
  deaths: () => number;
  messages: string[];
} {
  const loadout = new ShipLoadout("hull_warden");
  loadout.install("wpn_pulse");
  let deaths = 0;
  const messages: string[] = [];
  const deps: CombatModuleDeps = {
    getShipPhysics: () => makePhysics(),
    getPlayerLoadout: () => loadout,
    getPlayerShip: () => ship,
    getGameMode: () => mode,
    onPlayerDestroyed: () => {
      deaths++;
    },
    showMessage: (t) => messages.push(t),
  };
  return { module: new CombatModule(deps), deaths: () => deaths, messages };
}

describe("CombatModule god-mode damage routing (Task 4)", () => {
  it("GOD: a lethal hit leaves the ship alive + downed, no death", () => {
    const ship = { hullHP: 15, maxHull: MAX_HULL };
    const { module, deaths, messages } = makeModule(ship, "GOD");
    // Tanky NPC survives the player's first shot, then hits for far more than the
    // remaining hull — NORMAL would die here.
    module.addCombatant(
      makeSprite("a", 50, 0, { hullHP: 100000, damage: 9999 }),
    );
    module.update(FIRE);

    expect(ship.hullHP).toBe(FLOOR);
    expect(ship.hullHP).toBeGreaterThan(0);
    expect(deaths()).toBe(0);
    expect(messages.some((m) => m.includes("ремонт"))).toBe(true);
  });

  it("GOD: the downed warning is surfaced exactly once per fight", () => {
    const ship = { hullHP: 15, maxHull: MAX_HULL };
    const { module, messages } = makeModule(ship, "GOD");
    module.addCombatant(
      makeSprite("a", 50, 0, { hullHP: 100000, damage: 9999 }),
    );
    module.update(FIRE); // floored + downed → warn
    module.update(FIRE); // still downed, must not re-warn
    module.update(FIRE);
    expect(messages.filter((m) => m.includes("ремонт")).length).toBe(1);
  });

  it("NORMAL: a lethal hit still reaches 0 and reports death (unchanged)", () => {
    const ship = { hullHP: 15, maxHull: MAX_HULL };
    const { module, deaths } = makeModule(ship, "NORMAL");
    module.addCombatant(
      makeSprite("a", 50, 0, { hullHP: 100000, damage: 9999 }),
    );
    module.update(FIRE);
    expect(ship.hullHP).toBe(0);
    expect(deaths()).toBe(1);
  });

  it("HARD: a lethal hit still reaches 0 and reports death (unchanged)", () => {
    const ship = { hullHP: 15, maxHull: MAX_HULL };
    const { module, deaths } = makeModule(ship, "HARD");
    module.addCombatant(
      makeSprite("a", 50, 0, { hullHP: 100000, damage: 9999 }),
    );
    module.update(FIRE);
    expect(ship.hullHP).toBe(0);
    expect(deaths()).toBe(1);
  });
});

describe("CombatModule downed ship cannot fire (Task 4)", () => {
  it("auto-fire is blocked while downed (NPC hull untouched)", () => {
    const ship = { hullHP: FLOOR, maxHull: MAX_HULL }; // starts at the floor → downed
    const { module } = makeModule(ship, "GOD");
    const npc = makeSprite("a", 50, 0, { hullHP: 1000, damage: 1 });
    module.addCombatant(npc);
    module.update(FIRE);
    expect(npc.npc.hullHP).toBe(1000);
  });

  it("a deliberate confirmed shot is blocked while downed", () => {
    const ship = { hullHP: FLOOR, maxHull: MAX_HULL };
    const { module } = makeModule(ship, "GOD");
    const npc = makeSprite("a", 50, 0, { hullHP: 1000 });
    module.addCombatant(npc);
    const weapon = module.fittedWeapons()[0];
    module.confirmAttack(npc, weapon);
    expect(npc.npc.hullHP).toBe(1000);
  });

  it("repairing above the floor re-enables auto-fire", () => {
    // Rewritten under the three-year-campaign test license (Task 7), meaning
    // preserved: repair restores fight capability. A downed ship now REFUSES
    // engagement outright (same class as the weaponless no-op — it can
    // neither fire nor die, and an active fight would pin the galaxy
    // calendar forever), so the resume happens through the garrison-aggro
    // path, which re-calls addCombatant every frame and re-engages naturally
    // once the ship is repaired above the floor.
    const ship = { hullHP: FLOOR, maxHull: MAX_HULL }; // downed
    const { module } = makeModule(ship, "GOD");
    const npc = makeSprite("a", 50, 0, { hullHP: 1000, damage: 1 });
    module.addCombatant(npc); // refused while downed
    module.update(FIRE); // downed → no engagement, no fire
    expect(npc.npc.hullHP).toBe(1000);

    ship.hullHP = MAX_HULL; // repaired above the floor
    module.addCombatant(npc); // the aggro path's next-frame re-engage
    module.update(FIRE); // now fires
    expect(npc.npc.hullHP).toBeLessThan(1000);
  });

  it("NORMAL never downs, so auto-fire always lands", () => {
    const ship = { hullHP: 1, maxHull: MAX_HULL }; // 1 HP but NORMAL ⇒ not downed
    const { module } = makeModule(ship, "NORMAL");
    const npc = makeSprite("a", 50, 0, { hullHP: 1000, damage: 0 });
    module.addCombatant(npc);
    module.update(FIRE);
    expect(npc.npc.hullHP).toBeLessThan(1000);
  });
});

describe("hyperjump gate (Task 4) — the isDowned predicate both warp paths call", () => {
  function makePlayer(mode: GameMode, hullHP: number): Player {
    const player = new Player(
      "player",
      "Captain",
      FactionType.OUTLANDERS,
      0,
      1,
      new SkillTree([]),
      {},
      { activeQuests: [], completedQuests: [] },
      { entries: [] },
      1000,
      new PlayerShip(
        "Ranger-1",
        "Ranger-1",
        hullHP,
        MAX_HULL,
        50,
        50,
        100,
        100,
        1.0,
        0.8,
        FactionType.OUTLANDERS,
      ),
      new Inventory(),
      "",
    );
    player.setGameMode(mode);
    return player;
  }

  it("GOD: jump is blocked at the floor and re-enabled by a repair above it", () => {
    const player = makePlayer("GOD", FLOOR);
    expect(isDowned(player)).toBe(true); // performWarp / performWarpJump bail here
    player.ship.repair(); // planet/station repair lifts hull above the floor
    expect(isDowned(player)).toBe(false); // jump available again
  });

  it("NORMAL: jump is never gated by downed state, even at 1 HP", () => {
    expect(isDowned(makePlayer("NORMAL", 1))).toBe(false);
  });
});
