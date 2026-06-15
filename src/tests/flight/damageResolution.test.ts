import { describe, it, expect } from "vitest";
import { Container, Text, type FederatedPointerEvent } from "pixi.js";
import {
  CombatModule,
  resolveCombatRound,
} from "@/presentation/flight/CombatModule";
import { CombatHud } from "@/presentation/flight/CombatHud";
import { DamageNumbers } from "@/presentation/flight/DamageNumbers";
import {
  NpcShipManager,
  type NpcShipManagerDeps,
} from "@/presentation/flight/NpcShipManager";
import { NpcShipSprite } from "@/presentation/NpcShipSprite";
import type { Renderer } from "@/presentation/Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import type { Galaxy } from "@/domain/Galaxy";
import type { ShipPhysics } from "@/systems/ShipPhysics";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import { NpcShip } from "@/domain/NpcShip";
import { NpcRole, NpcState, FactionType } from "@/types";
import { Faction } from "@/types/faction";

const fakeEvent = {
  stopPropagation() {},
} as unknown as FederatedPointerEvent;

/** Deterministic RNG cycling through a fixed sequence of [0,1) values. */
function seqRng(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

// ---------------------------------------------------------------------------
// resolveCombatRound — pure simultaneous-damage helper
// ---------------------------------------------------------------------------
describe("resolveCombatRound (Task 13)", () => {
  it("applies damage to both sides in one call", () => {
    expect(resolveCombatRound(14, 20, 100, 100)).toEqual({
      newPlayerHP: 80,
      newNpcHP: 86,
    });
  });

  it("floors hull at 0 (no negative HP)", () => {
    expect(resolveCombatRound(50, 50, 10, 10)).toEqual({
      newPlayerHP: 0,
      newNpcHP: 0,
    });
  });

  it("is simultaneous: a lethal hit on the NPC still costs the player hull", () => {
    // NPC dies (10 - 14 → 0) but the player took the round's damage from the
    // pre-round HP, proving both sides resolved at once.
    expect(resolveCombatRound(14, 20, 100, 10)).toEqual({
      newPlayerHP: 80,
      newNpcHP: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// DamageNumbers — floating combat text
// ---------------------------------------------------------------------------
describe("DamageNumbers (Task 13)", () => {
  it("spawn mounts a Text on the layer at the world position", () => {
    const layer = new Container();
    const dn = new DamageNumbers(layer);
    dn.spawn(14, 120, 80, true);
    expect(dn.activeCount).toBe(1);
    const text = layer.children[0] as Text;
    expect(text).toBeInstanceOf(Text);
    expect(text.x).toBe(120);
    expect(text.y).toBe(80);
  });

  it("floats upward and fades over its lifetime", () => {
    const layer = new Container();
    const dn = new DamageNumbers(layer);
    dn.spawn(14, 0, 100, false);
    const text = layer.children[0] as Text;
    dn.update(400); // 0.4 s — half of the 0.8 s lifetime
    expect(text.y).toBeLessThan(100); // moved up (screen-up = -Y)
    expect(text.alpha).toBeLessThan(1);
    expect(text.alpha).toBeGreaterThan(0);
  });

  it("removes itself once the lifetime elapses", () => {
    const layer = new Container();
    const dn = new DamageNumbers(layer);
    dn.spawn(14, 0, 0, true);
    dn.update(900); // > 0.8 s
    expect(dn.activeCount).toBe(0);
    expect(layer.children.length).toBe(0);
  });

  it("clear() removes every active number", () => {
    const layer = new Container();
    const dn = new DamageNumbers(layer);
    dn.spawn(1, 0, 0, true);
    dn.spawn(2, 0, 0, false);
    dn.clear();
    expect(dn.activeCount).toBe(0);
    expect(layer.children.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// CombatModule — round resolution, target selection, death, retreat
// ---------------------------------------------------------------------------
function makeSprite(id: string, x: number, y: number, npc?: Partial<NpcShip>) {
  return {
    x,
    y,
    npc: { id, name: id, hullHP: 100, damage: 20, ...npc },
  } as unknown as NpcShipSprite;
}

function makeModule(ship?: { hullHP: number; maxHull: number }): {
  module: CombatModule;
  ship: { hullHP: number; maxHull: number };
  destroyed: NpcShipSprite[];
  messages: { text: string; color?: number }[];
  hud: CombatHud;
} {
  const uiLayer = new Container();
  const gameLayer = new Container();
  const physics = {
    shipX: 0,
    shipY: 0,
    isMoving: true,
    currentSpeed: 1,
    setTarget() {},
  } as unknown as ShipPhysics;
  const loadout = new ShipLoadout("hull_warden");
  loadout.install("wpn_pulse"); // damage 14, range 240
  const playerShip = ship ?? { hullHP: 100, maxHull: 100 };
  const destroyed: NpcShipSprite[] = [];
  const messages: { text: string; color?: number }[] = [];
  const module = new CombatModule({
    getShipPhysics: () => physics,
    getPlayerLoadout: () => loadout,
    getUiLayer: () => uiLayer,
    getGameLayer: () => gameLayer,
    getScreenSize: () => ({ width: 800, height: 600 }),
    getPlayerShip: () => playerShip,
    onNpcDestroyed: (s) => destroyed.push(s),
    showMessage: (text, color) => messages.push({ text, color }),
  });
  module.initialize();
  const hud = (module as unknown as { hud: CombatHud }).hud;
  return { module, ship: playerShip, destroyed, messages, hud };
}

/** Fire "Атаковать": arm the gate via update(), then press the button. */
function attack(module: CombatModule, hud: CombatHud): void {
  module.update(16);
  hud.attackButton!.container.emit("pointerdown", fakeEvent);
}

describe("CombatModule round resolution (Task 13)", () => {
  it("startCombat selects the aggressor by default", () => {
    const { module } = makeModule();
    const sprite = makeSprite("npc_1", 50, 0);
    module.startCombat(sprite);
    expect(module.selectedTarget).toBe(sprite);
  });

  it("a round deals simultaneous damage to NPC hull and player ship hull", () => {
    const { module, ship } = makeModule();
    const sprite = makeSprite("npc_1", 50, 0, { hullHP: 100, damage: 20 });
    module.startCombat(sprite);
    attack(module, hudOf(module));
    expect(sprite.npc.hullHP).toBe(86); // 100 - 14 weapon damage
    expect(ship.hullHP).toBe(80); // 100 - 20 npc damage
  });

  it("does not fire when the target is out of weapon range", () => {
    const { module, ship } = makeModule();
    const sprite = makeSprite("npc_1", 1000, 0); // beyond range 240
    module.startCombat(sprite);
    attack(module, hudOf(module));
    expect(sprite.npc.hullHP).toBe(100);
    expect(ship.hullHP).toBe(100);
  });

  it("spawns floating damage numbers for each round", () => {
    const { module } = makeModule();
    const sprite = makeSprite("npc_1", 50, 0);
    module.startCombat(sprite);
    attack(module, hudOf(module));
    const dn = (module as unknown as { damageNumbers: DamageNumbers })
      .damageNumbers;
    // One yellow (dealt to NPC) + one red (taken by player).
    expect(dn.activeCount).toBe(2);
  });
});

describe("CombatModule target selection (Task 13)", () => {
  it("selectTarget switches the resolved target during a fight", () => {
    const { module } = makeModule();
    const a = makeSprite("a", 50, 0);
    const b = makeSprite("b", 60, 0);
    module.startCombat(a);
    module.selectTarget(b);
    expect(module.selectedTarget).toBe(b);
  });

  it("selectTarget(null) deselects so the attack gate disarms", () => {
    const { module, hud } = makeModule();
    const sprite = makeSprite("npc_1", 50, 0);
    module.startCombat(sprite);
    module.update(16);
    expect(hud.isAttackEnabled).toBe(true);
    module.selectTarget(null);
    module.update(16);
    expect(hud.isAttackEnabled).toBe(false);
  });

  it("selectTarget is a no-op outside a fight", () => {
    const { module } = makeModule();
    module.selectTarget(makeSprite("x", 0, 0));
    expect(module.selectedTarget).toBeNull();
  });
});

describe("CombatModule combat end (Task 13)", () => {
  it("destroys the NPC, fires onNpcDestroyed and ends combat on a lethal round", () => {
    const { module, destroyed, messages } = makeModule();
    const sprite = makeSprite("npc_1", 50, 0, { hullHP: 10 });
    module.startCombat(sprite);
    attack(module, hudOf(module));
    expect(destroyed).toEqual([sprite]);
    expect(module.isActive).toBe(false);
    expect(messages.some((m) => m.text.includes("уничтожена"))).toBe(true);
  });

  it("auto-retreats with a warning when the player hull drops below 30%", () => {
    const { module, ship, destroyed, messages } = makeModule({
      hullHP: 40,
      maxHull: 100,
    });
    const sprite = makeSprite("npc_1", 50, 0, { hullHP: 100, damage: 20 });
    module.startCombat(sprite);
    attack(module, hudOf(module));
    expect(ship.hullHP).toBe(20); // below 30% of 100
    expect(module.isActive).toBe(false); // combat ended
    expect(destroyed).toEqual([]); // NPC survives, stays hostile
    expect(messages.some((m) => m.text.includes("Корпус"))).toBe(true);
  });
});

/** Reach the module's private HUD (mirrors the spawn happening on initialize). */
function hudOf(module: CombatModule): CombatHud {
  return (module as unknown as { hud: CombatHud }).hud;
}

// ---------------------------------------------------------------------------
// NpcShipManager — combat-target click routing + in-flight death handling
// ---------------------------------------------------------------------------
function makeNpc(id: string): NpcShip {
  return new NpcShip({
    id,
    name: id,
    race: FactionType.OUTLANDERS,
    faction: Faction.INDEPENDENT,
    role: NpcRole.TRADER,
    hullHP: 100,
    maxHull: 100,
    shields: 0,
    speed: 0.1,
    damage: 20,
    currentSystemId: "sys_a",
    state: NpcState.PATROLLING,
    goal: null,
    destinationSystemId: null,
    daysToArrival: 0,
    credits: 0,
    reputation: 0,
  });
}

function makeManager(npcs: NpcShip[]): {
  manager: NpcShipManager;
  galaxy: Galaxy;
  gameLayer: Container;
  combatActive: { value: boolean };
  selected: NpcShipSprite[];
} {
  const stage = new Container();
  const uiLayer = new Container();
  const gameLayer = new Container();
  const renderer = {
    app: { screen: { width: 800, height: 600 } },
    stage,
    uiLayer,
    gameLayer,
  } as unknown as Renderer;
  const galaxy = {
    npcShips: [...npcs],
    isHostileSystem: () => false,
  } as unknown as Galaxy;
  const gameEngine = {
    galaxy,
    player: { currentSystemId: "sys_a" },
  } as unknown as GameEngine;
  const combatActive = { value: false };
  const selected: NpcShipSprite[] = [];
  const deps: NpcShipManagerDeps = {
    getShipPhysics: () => null,
    getPlanetSprites: () => [],
    getStarCenter: () => ({ x: 400, y: 300 }),
    isTurnRunning: () => false,
    showMessage: () => {},
    showTooltip: () => {},
    hideTooltip: () => {},
    executeRouteTo: () => {},
    clearRouteTarget: () => {},
    endTurn: () => {},
    isInCombat: () => combatActive.value,
    selectCombatTarget: (s) => selected.push(s),
  };
  const manager = new NpcShipManager(
    renderer,
    gameEngine,
    gameLayer,
    uiLayer,
    deps,
  );
  return { manager, galaxy, gameLayer, combatActive, selected };
}

function spriteList(manager: NpcShipManager): NpcShipSprite[] {
  return (manager as unknown as { npcSprites: NpcShipSprite[] }).npcSprites;
}

describe("NpcShipManager in-flight combat integration (Task 13)", () => {
  it("routes an NPC click to selectCombatTarget while in combat", () => {
    const npc = makeNpc("npc_1");
    const { manager, combatActive, selected } = makeManager([npc]);
    manager.initialize();
    combatActive.value = true;

    const sprite = spriteList(manager)[0];
    // Simulate the real pointer tap on the sprite.
    sprite.container.emit("pointerdown", fakeEvent);

    expect(selected).toEqual([sprite]);
    manager.destroy();
  });

  it("handleInFlightDeath drops loot, removes the sprite and the domain entry", () => {
    const npc = makeNpc("npc_1");
    const { manager, galaxy } = makeManager([npc]);
    manager.initialize();
    const sprite = spriteList(manager)[0];

    // rng 0.9 → 2 loot items from the default salvage pool.
    manager.handleInFlightDeath(sprite, seqRng([0.9]));

    expect(spriteList(manager).length).toBe(0);
    expect(galaxy.npcShips.length).toBe(0);
    expect(manager.spaceLoot.length).toBe(2);
    manager.destroy();
  });
});
