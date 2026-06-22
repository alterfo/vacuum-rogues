import { describe, it, expect } from "vitest";
import { Container } from "pixi.js";
import {
  NpcShipManager,
  type NpcShipManagerDeps,
} from "@/presentation/flight/NpcShipManager";
import { CombatModule } from "@/presentation/flight/CombatModule";
import type { NpcShipSprite } from "@/presentation/NpcShipSprite";
import type { Renderer } from "@/presentation/Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import type { Galaxy } from "@/domain/Galaxy";
import { ShipPhysics } from "@/systems/ShipPhysics";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import { NpcShip } from "@/domain/NpcShip";
import { NpcRole, NpcState, FactionType } from "@/types";
import { Faction } from "@/types/faction";
import { GAME_BALANCE } from "@/config/balance";

// ---------------------------------------------------------------------------
// Task 2: the Overmind ("Предтечи") will attack the player. A live (hostile)
// Overmind craft hunts the player wherever it is present — including a neutral
// border system it is besieging *before* it falls — not only inside an already-
// captured (hostile-flagged) system. The player's "Атаковать" engages it, and an
// in-range Overmind trades fire with the player. (The contact-panel attack
// affordance is covered in overmindContactPanel.test.ts.)
// ---------------------------------------------------------------------------

type NpcOpts = {
  role?: NpcRole;
  faction?: Faction;
  hull?: number;
  damage?: number;
  hostile?: boolean;
};

function makeNpc(id: string, opts: NpcOpts = {}): NpcShip {
  const hull = opts.hull ?? 100;
  const npc = new NpcShip({
    id,
    name: id,
    race: FactionType.OUTLANDERS,
    faction: opts.faction ?? Faction.INDEPENDENT,
    role: opts.role ?? NpcRole.TRADER,
    hullHP: hull,
    maxHull: hull,
    shields: 0,
    speed: 0.1,
    damage: opts.damage ?? 20,
    currentSystemId: "sys_a",
    state: NpcState.PATROLLING,
    goal: null,
    destinationSystemId: null,
    daysToArrival: 0,
    credits: 0,
    reputation: 0,
  });
  // A live Overmind / pirate spawns hostile; let callers opt in.
  if (opts.hostile) npc.markHostile();
  return npc;
}

function makeRenderer(): Renderer {
  return {
    app: { screen: { width: 800, height: 600 } },
    stage: new Container(),
    uiLayer: new Container(),
    gameLayer: new Container(),
  } as unknown as Renderer;
}

/** Sprites are private; expose them for white-box assertions (test-only seam). */
function sprites(manager: NpcShipManager): Array<{
  npc: NpcShip;
  aggressive: boolean;
  x: number;
  y: number;
}> {
  return (
    manager as unknown as {
      npcSprites: Array<{
        npc: NpcShip;
        aggressive: boolean;
        x: number;
        y: number;
      }>;
    }
  ).npcSprites;
}

function makeManager(
  npcs: NpcShip[],
  opts: { hostile: boolean; physics?: ShipPhysics },
): NpcShipManager {
  const renderer = makeRenderer();
  const galaxy = {
    npcShips: npcs,
    isHostileSystem: (id: string) => opts.hostile && id === "sys_a",
  } as unknown as Galaxy;
  const gameEngine = {
    galaxy,
    player: { currentSystemId: "sys_a" },
  } as unknown as GameEngine;

  const deps: NpcShipManagerDeps = {
    getShipPhysics: () => opts.physics ?? null,
    getPlanetSprites: () => [],
    getStarCenter: () => ({ x: 400, y: 300 }),
    isTurnRunning: () => true,
    showMessage: () => {},
    showTooltip: () => {},
    hideTooltip: () => {},
    executeRouteTo: () => {},
    clearRouteTarget: () => {},
    endTurn: () => {},
  };

  return new NpcShipManager(
    renderer,
    gameEngine,
    (renderer as unknown as { gameLayer: Container }).gameLayer,
    (renderer as unknown as { uiLayer: Container }).uiLayer,
    deps,
  );
}

describe("Overmind hunts the player even in a not-yet-captured system", () => {
  it("flags a live (hostile) Overmind aggressive while besieging a neutral system", () => {
    const ov = makeNpc("ov_siege", {
      role: NpcRole.PATROL,
      faction: Faction.OVERMIND,
      hostile: true,
    });
    const manager = makeManager([ov], { hostile: false });
    manager.initialize();
    // The system is NOT captured (isHostileSystem false), yet the besieging
    // Overmind must still hunt the player.
    manager.checkGarrisonAggro("sys_a", false);

    expect(sprites(manager)[0].aggressive).toBe(true);
    manager.destroy();
  });

  it("a passive (non-hostile) Overmind stays in orbit in a neutral system", () => {
    const ov = makeNpc("ov_calm", {
      role: NpcRole.PATROL,
      faction: Faction.OVERMIND,
      hostile: false,
    });
    const manager = makeManager([ov], { hostile: false });
    manager.initialize();
    manager.checkGarrisonAggro("sys_a", false);

    expect(sprites(manager)[0].aggressive).toBe(false);
    manager.destroy();
  });

  it("a besieging Overmind pursues the player ship in update()", () => {
    const physics = new ShipPhysics(0, 0, 0.3);
    const ov = makeNpc("ov_chase", {
      role: NpcRole.PATROL,
      faction: Faction.OVERMIND,
      hostile: true,
    });
    const manager = makeManager([ov], { hostile: false, physics });
    manager.initialize();
    manager.checkGarrisonAggro("sys_a", false);

    const sprite = sprites(manager)[0];
    sprite.x = 500;
    sprite.y = 0;
    const before = sprite.x;
    for (let i = 0; i < 20; i++) manager.update(100, 0);

    expect(sprite.x).toBeLessThan(before);
    manager.destroy();
  });
});

// ---------------------------------------------------------------------------
// End-to-end: a besieging Overmind engages + trades fire, and the player's
// "Атаковать" engages an Overmind — both routed through a real CombatModule.
// ---------------------------------------------------------------------------
function makeOvermindArena(opts: { hostileSystem: boolean }): {
  manager: NpcShipManager;
  combat: CombatModule;
  ship: { hullHP: number; maxHull: number };
  npc: NpcShip;
  sprite: NpcShipSprite & { x: number; y: number };
} {
  const renderer = makeRenderer();
  const npc = makeNpc("ov_arena", {
    role: NpcRole.PATROL,
    faction: Faction.OVERMIND,
    hostile: true,
    hull: 100,
    damage: 20,
  });
  const galaxy = {
    npcShips: [npc],
    isHostileSystem: (id: string) => opts.hostileSystem && id === "sys_a",
  } as unknown as Galaxy;
  const gameEngine = {
    galaxy,
    player: { currentSystemId: "sys_a" },
  } as unknown as GameEngine;

  const physics = new ShipPhysics(0, 0, 0.3);
  const ship = { hullHP: 1000, maxHull: 1000 };
  const loadout = new ShipLoadout("hull_warden");
  loadout.install("wpn_pulse"); // dmg 14, range 240

  const combat = new CombatModule({
    getShipPhysics: () => physics,
    getPlayerLoadout: () => loadout,
    getPlayerShip: () => ship,
    onNpcDestroyed: () => {},
    showMessage: () => {},
  });

  const deps: NpcShipManagerDeps = {
    getShipPhysics: () => physics,
    getPlanetSprites: () => [],
    getStarCenter: () => ({ x: 400, y: 300 }),
    isTurnRunning: () => true,
    showMessage: () => {},
    showTooltip: () => {},
    hideTooltip: () => {},
    executeRouteTo: () => {},
    clearRouteTarget: () => {},
    endTurn: () => {},
    startInFlightCombat: (s) => combat.addCombatant(s),
    isInCombat: () => combat.isActive,
    selectCombatTarget: (s) => combat.selectTarget(s),
  };

  const manager = new NpcShipManager(
    renderer,
    gameEngine,
    (renderer as unknown as { gameLayer: Container }).gameLayer,
    (renderer as unknown as { uiLayer: Container }).uiLayer,
    deps,
  );
  manager.initialize();
  const sprite = (manager as unknown as { npcSprites: NpcShipSprite[] })
    .npcSprites[0] as NpcShipSprite & { x: number; y: number };
  return { manager, combat, ship, npc, sprite };
}

describe("Overmind two-way in-flight combat", () => {
  it("a besieging Overmind within weapon range engages and both ships fire", () => {
    const { manager, combat, ship, npc, sprite } = makeOvermindArena({
      hostileSystem: false, // neutral border system under siege
    });
    manager.checkGarrisonAggro("sys_a", false); // not captured — still hunts
    sprite.x = 100; // within weaponRange (240) of the player at the origin
    sprite.y = 0;

    manager.update(16, 0); // close → engage
    expect(combat.isActive).toBe(true);
    expect(combat.combatants.has(sprite)).toBe(true);

    sprite.x = 100;
    sprite.y = 0;
    combat.update(GAME_BALANCE.combatFireIntervalMs); // one turn

    expect(ship.hullHP).toBeLessThan(1000); // Overmind fired at the player
    expect(npc.hullHP).toBeLessThan(100); // player fired back
    manager.destroy();
  });

  it("the player's Атаковать engages an in-range Overmind", () => {
    const { manager, combat, sprite } = makeOvermindArena({
      hostileSystem: false,
    });
    sprite.x = 100; // within weapon range
    sprite.y = 0;

    // Drive the panel's onAttack pathway (private — exercised via the test seam).
    (manager as unknown as { onAttackNpc(npc: NpcShip): void }).onAttackNpc(
      sprite.npc,
    );

    expect(combat.isActive).toBe(true);
    expect(combat.combatants.has(sprite)).toBe(true);
    expect(combat.selectedTarget).toBe(sprite);
    manager.destroy();
  });
});
