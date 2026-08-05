import { describe, it, expect } from "vitest";
import { Container, Graphics } from "pixi.js";
import {
  CombatModule,
  type CombatModuleDeps,
} from "@/presentation/flight/CombatModule";
import type { NpcShipSprite } from "@/presentation/NpcShipSprite";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import type { ShipPhysics } from "@/systems/ShipPhysics";
import { GAME_BALANCE } from "@/config/balance";

const FIRE = GAME_BALANCE.combatFireIntervalMs; // 2500 ms

function makePhysics(
  x = 0,
  y = 0,
): ShipPhysics & { isMoving: boolean; currentSpeed: number } {
  return {
    shipX: x,
    shipY: y,
    isMoving: true,
    currentSpeed: 1,
    setTarget(_x: number, _y: number): void {},
  } as unknown as ShipPhysics & { isMoving: boolean; currentSpeed: number };
}

function makeSprite(
  id: string,
  x: number,
  y: number,
  opts: { hullHP?: number; damage?: number; name?: string } = {},
): NpcShipSprite {
  return {
    x,
    y,
    npc: {
      id,
      name: opts.name ?? id,
      hullHP: opts.hullHP ?? 100,
      damage: opts.damage ?? 20,
    },
  } as unknown as NpcShipSprite;
}

function makeModule(
  opts: {
    ship?: { hullHP: number; maxHull: number };
    weapons?: string[];
    physics?: ShipPhysics & { isMoving: boolean; currentSpeed: number };
    turnRunning?: () => boolean;
  } = {},
): {
  module: CombatModule;
  ship: { hullHP: number; maxHull: number };
  destroyed: NpcShipSprite[];
  messages: { text: string; color?: number }[];
  physics: ShipPhysics & { isMoving: boolean; currentSpeed: number };
} {
  const physics = opts.physics ?? makePhysics();
  const loadout = new ShipLoadout("hull_warden");
  for (const w of opts.weapons ?? ["wpn_pulse"]) loadout.install(w); // pulse: dmg 14, range 240
  const ship = opts.ship ?? { hullHP: 100, maxHull: 100 };
  const destroyed: NpcShipSprite[] = [];
  const messages: { text: string; color?: number }[] = [];
  const deps: CombatModuleDeps = {
    getShipPhysics: () => physics,
    getPlayerLoadout: () => loadout,
    getPlayerShip: () => ship,
    onNpcDestroyed: (s) => destroyed.push(s),
    showMessage: (text, color) => messages.push({ text, color }),
    ...(opts.turnRunning ? { isTurnRunning: opts.turnRunning } : {}),
  };
  return { module: new CombatModule(deps), ship, destroyed, messages, physics };
}

describe("CombatModule engagement (Task 1)", () => {
  it("addCombatant activates, joins the set and auto-selects the first target", () => {
    const { module } = makeModule();
    const a = makeSprite("a", 50, 0);
    module.addCombatant(a);
    expect(module.isActive).toBe(true);
    expect(module.combatants.has(a)).toBe(true);
    expect(module.selectedTarget).toBe(a);
  });

  it("addCombatant is idempotent for the same sprite", () => {
    const { module } = makeModule();
    const a = makeSprite("a", 50, 0);
    module.addCombatant(a);
    module.addCombatant(a);
    expect(module.combatants.size).toBe(1);
  });

  it("does NOT freeze the player ship on engage", () => {
    const { module, physics } = makeModule();
    module.addCombatant(makeSprite("a", 50, 0));
    expect(physics.isMoving).toBe(true); // ship stays free to keep moving
    expect(physics.currentSpeed).toBe(1);
  });

  it("a weaponless player can't engage (stays free to flee)", () => {
    const physics = makePhysics();
    const loadout = { slottedWithGear: () => [] } as unknown as ShipLoadout;
    const module = new CombatModule({
      getShipPhysics: () => physics,
      getPlayerLoadout: () => loadout,
    });
    module.addCombatant(makeSprite("a", 50, 0));
    expect(module.isActive).toBe(false);
    expect(module.combatants.size).toBe(0);
  });

  it("a weaponless engagement surfaces a clear HUD hint instead of a silent no-op", () => {
    const physics = makePhysics();
    const loadout = { slottedWithGear: () => [] } as unknown as ShipLoadout;
    const messages: { text: string; color?: number }[] = [];
    const module = new CombatModule({
      getShipPhysics: () => physics,
      getPlayerLoadout: () => loadout,
      showMessage: (text, color) => messages.push({ text, color }),
    });
    module.addCombatant(makeSprite("a", 50, 0));
    expect(module.isActive).toBe(false); // still does not engage без оружия
    expect(module.combatants.size).toBe(0);
    expect(messages.some((m) => m.text.includes("Нет оружия"))).toBe(true);
  });

  it("endCombat clears the set, target and active flag", () => {
    const { module } = makeModule();
    module.addCombatant(makeSprite("a", 50, 0));
    module.endCombat();
    expect(module.isActive).toBe(false);
    expect(module.combatants.size).toBe(0);
    expect(module.selectedTarget).toBeNull();
  });

  it("selectTarget is a no-op outside a fight", () => {
    const { module } = makeModule();
    module.selectTarget(makeSprite("x", 0, 0));
    expect(module.selectedTarget).toBeNull();
  });

  it("selectTarget ignores a non-combatant during a fight (keeps the current target)", () => {
    const { module } = makeModule();
    const a = makeSprite("a", 40, 0);
    module.addCombatant(a);
    module.selectTarget(makeSprite("stranger", 60, 0)); // never engaged
    expect(module.selectedTarget).toBe(a); // unchanged — stranger isn't a combatant
  });

  it("selectTarget switches between engaged combatants, and null deselects", () => {
    const { module } = makeModule();
    const a = makeSprite("a", 40, 0);
    const b = makeSprite("b", 60, 0);
    module.addCombatant(a);
    module.addCombatant(b);
    module.selectTarget(b);
    expect(module.selectedTarget).toBe(b);
    module.selectTarget(null);
    expect(module.selectedTarget).toBeNull();
  });
});

describe("CombatModule simultaneous-combatant cap (win-rate-100pct plan, Task 6 escalation)", () => {
  it("refuses a new joiner once the cap is reached, keeping the fight at exactly the cap", () => {
    const { module } = makeModule();
    const cap = GAME_BALANCE.combatMaxSimultaneousCombatants;
    for (let i = 0; i < cap; i++) {
      module.addCombatant(makeSprite(`ok-${i}`, 40 + i * 20, 0));
    }
    expect(module.combatants.size).toBe(cap);

    const overflow = makeSprite("overflow", 999, 0);
    module.addCombatant(overflow);
    expect(module.combatants.has(overflow)).toBe(false);
    expect(module.combatants.size).toBe(cap); // unchanged — refused, not silently dropped from a resize
  });

  it("admits a refused aggressor the instant a slot frees (the every-frame garrison-aggro re-call)", () => {
    const { module } = makeModule();
    const cap = GAME_BALANCE.combatMaxSimultaneousCombatants;
    const weak = makeSprite("weak", 40, 0, { hullHP: 10 }); // dies to one 14-dmg shot, and is the auto-selected (first-added) target
    module.addCombatant(weak);
    for (let i = 1; i < cap; i++) {
      module.addCombatant(
        makeSprite(`tank-${i}`, 40 + i * 20, 0, { hullHP: 100000 }),
      );
    }
    expect(module.combatants.size).toBe(cap);

    const overflow = makeSprite("overflow", 999, 0, { hullHP: 100000 });
    module.addCombatant(overflow); // refused — the fight is at the cap
    expect(module.combatants.has(overflow)).toBe(false);

    module.update(FIRE); // kills `weak`, freeing a slot
    expect(module.combatants.has(weak)).toBe(false);
    expect(module.combatants.size).toBe(cap - 1);

    module.addCombatant(overflow); // the aggro path's next-frame retry now succeeds
    expect(module.combatants.has(overflow)).toBe(true);
    expect(module.combatants.size).toBe(cap);
  });
});

describe("CombatModule fire timers (Task 1)", () => {
  it("the player does not fire before the interval elapses", () => {
    const { module } = makeModule();
    const a = makeSprite("a", 50, 0, { hullHP: 100 });
    module.addCombatant(a);
    module.update(FIRE - 100);
    expect(a.npc.hullHP).toBe(100);
  });

  it("player and NPC both fire once the interval elapses", () => {
    const { module, ship } = makeModule();
    const a = makeSprite("a", 50, 0, { hullHP: 100, damage: 20 });
    module.addCombatant(a);
    module.update(FIRE);
    expect(a.npc.hullHP).toBe(86); // 100 - 14 pulse damage
    expect(ship.hullHP).toBe(80); // 100 - 20 npc damage
  });

  it("two engaged NPCs both fire — the player takes their summed damage", () => {
    const { module, ship } = makeModule();
    module.addCombatant(makeSprite("a", 40, 0, { damage: 20 }));
    module.addCombatant(makeSprite("b", 60, 0, { damage: 15 }));
    module.update(FIRE + GAME_BALANCE.combatJoinFireStaggerMs);
    expect(ship.hullHP).toBe(65); // 100 - (20 + 15)
  });

  it("neither side fires while out of weapon range", () => {
    const { module, ship } = makeModule();
    const a = makeSprite("a", 1000, 0, { hullHP: 100 }); // beyond 240 range, within scanner
    module.addCombatant(a);
    module.update(FIRE);
    expect(a.npc.hullHP).toBe(100);
    expect(ship.hullHP).toBe(100);
    expect(module.isActive).toBe(true); // still engaged, just can't reach
  });
});

describe("CombatModule death & removal (Task 1)", () => {
  it("a killed NPC is removed, fires onNpcDestroyed once and ends combat when last", () => {
    const { module, destroyed, messages } = makeModule();
    const a = makeSprite("a", 50, 0, { hullHP: 10 }); // dies to one 14-dmg shot
    module.addCombatant(a);
    module.update(FIRE);
    expect(module.combatants.has(a)).toBe(false);
    expect(destroyed).toEqual([a]);
    expect(module.isActive).toBe(false); // set emptied
    expect(messages.some((m) => m.text.includes("уничтожена"))).toBe(true);
  });

  it("killing the selected target re-picks a survivor", () => {
    const { module, destroyed } = makeModule();
    const a = makeSprite("a", 40, 0, { hullHP: 10 });
    const b = makeSprite("b", 60, 0, { hullHP: 100 });
    module.addCombatant(a);
    module.addCombatant(b);
    module.update(FIRE);
    expect(destroyed).toEqual([a]);
    expect(module.combatants.has(b)).toBe(true);
    expect(module.selectedTarget).toBe(b);
    expect(module.isActive).toBe(true);
  });

  it("drops a combatant that drifts beyond scanner range", () => {
    const { module } = makeModule();
    const a = makeSprite("a", GAME_BALANCE.scannerRange + 500, 0);
    module.addCombatant(a);
    module.update(16);
    expect(module.combatants.has(a)).toBe(false);
    expect(module.isActive).toBe(false);
  });

  it("drops a combatant whose sprite was destroyed by a non-combat path (no ghost fire / re-kill)", () => {
    const { module, ship, destroyed } = makeModule();
    const a = makeSprite("a", 50, 0, { hullHP: 100, damage: 20 });
    module.addCombatant(a);
    (a as unknown as { container: { destroyed: boolean } }).container = {
      destroyed: true,
    };
    module.update(FIRE);
    expect(module.combatants.has(a)).toBe(false);
    expect(module.isActive).toBe(false);
    expect(ship.hullHP).toBe(100); // the ghost never fired at the player
    expect(destroyed).toEqual([]); // and was never re-reported as a fresh kill
  });

  it("warns once when the hull drops below the retreat threshold, without freezing", () => {
    const { module, messages, physics } = makeModule({
      ship: { hullHP: 45, maxHull: 100 },
    });
    module.addCombatant(makeSprite("a", 50, 0, { hullHP: 100, damage: 20 }));
    module.update(FIRE); // 45 - 20 = 25, below 30% of 100
    module.update(FIRE); // 25 - 20 = 5, still below — warning must not repeat
    const warnings = messages.filter((m) => m.text.includes("Корпус"));
    expect(warnings.length).toBe(1);
    expect(physics.isMoving).toBe(true); // not frozen
  });

  it("floors the player hull at 0 through the live NPC-fire path (no negative hull)", () => {
    const { module, ship } = makeModule({ ship: { hullHP: 15, maxHull: 100 } });
    module.addCombatant(makeSprite("a", 50, 0, { hullHP: 1000, damage: 20 }));
    module.update(FIRE); // 15 - 20 would be -5, must clamp to 0
    expect(ship.hullHP).toBe(0);
  });
});

describe("CombatModule turn gating", () => {
  it("does not fire while the turn is paused, then resumes once it runs", () => {
    let running = false;
    const { module, ship } = makeModule({ turnRunning: () => running });
    const a = makeSprite("a", 50, 0, { hullHP: 100, damage: 20 });
    module.addCombatant(a);

    module.update(FIRE * 2);
    expect(ship.hullHP).toBe(100);
    expect(a.npc.hullHP).toBe(100);
    expect(module.isActive).toBe(true); // the fight is still engaged, just frozen

    running = true;
    module.update(FIRE);
    expect(ship.hullHP).toBe(80); // 100 - 20 npc damage
    expect(a.npc.hullHP).toBe(86); // 100 - 14 pulse damage
  });
});

describe("CombatModule lifecycle (Task 1)", () => {
  it("runs initialize → engage → update → destroy with render layers without throwing", () => {
    const uiLayer = new Container();
    const gameLayer = new Container();
    const loadout = new ShipLoadout("hull_warden");
    loadout.install("wpn_pulse");
    const module = new CombatModule({
      getShipPhysics: () => makePhysics(),
      getPlayerLoadout: () => loadout,
      getUiLayer: () => uiLayer,
      getGameLayer: () => gameLayer,
      getScreenSize: () => ({ width: 800, height: 600 }),
      getPlayerShip: () => ({ hullHP: 100, maxHull: 100 }),
    });
    expect(() => {
      module.initialize();
      module.addCombatant(makeSprite("a", 50, 0));
      module.update(FIRE);
      module.endCombat();
      module.destroy();
    }).not.toThrow();
  });

  it("survives destroy() with no prior combat (defensive teardown)", () => {
    const module = new CombatModule({ getShipPhysics: () => null });
    expect(() => module.destroy()).not.toThrow();
  });
});

describe("CombatModule auto-mode feedback (Task 4)", () => {
  function countGraphics(node: Container): number {
    let n = 0;
    for (const child of node.children) {
      if (child instanceof Graphics) n++;
      if (child instanceof Container) n += countGraphics(child);
    }
    return n;
  }

  function moduleWithLayers(): { module: CombatModule; gameLayer: Container } {
    const uiLayer = new Container();
    const gameLayer = new Container();
    const loadout = new ShipLoadout("hull_warden");
    loadout.install("wpn_pulse");
    const module = new CombatModule({
      getShipPhysics: () => makePhysics(0, 0),
      getPlayerLoadout: () => loadout,
      getUiLayer: () => uiLayer,
      getGameLayer: () => gameLayer,
      getScreenSize: () => ({ width: 800, height: 600 }),
      getPlayerShip: () => ({ hullHP: 100, maxHull: 100 }),
    });
    module.initialize();
    return { module, gameLayer };
  }

  it("a fire round draws an engaged reticle + fire-flash beams on the game layer", () => {
    const { module, gameLayer } = moduleWithLayers();
    module.addCombatant(makeSprite("a", 50, 0, { hullHP: 100, damage: 20 }));
    expect(countGraphics(gameLayer)).toBe(1);
    module.update(FIRE); // both sides fire once → marker + two flash beams appear
    expect(countGraphics(gameLayer)).toBeGreaterThanOrEqual(3);
  });

  it("ending the fight tears every combat overlay off the game layer", () => {
    const { module, gameLayer } = moduleWithLayers();
    module.addCombatant(makeSprite("a", 50, 0));
    module.update(FIRE);
    expect(countGraphics(gameLayer)).toBeGreaterThan(0);
    module.endCombat();
    expect(countGraphics(gameLayer)).toBe(0);
  });
});

describe("CombatModule multi-NPC integration (Task 5)", () => {
  it("two engaged NPCs advance their OWN timers and fire in staggered turn, not lock-step", () => {
    const { module, ship } = makeModule();
    const a = makeSprite("a", 40, 0, { hullHP: 100, damage: 20 });
    const b = makeSprite("b", 60, 0, { hullHP: 100, damage: 15 });
    module.addCombatant(a);
    module.addCombatant(b);

    module.update(FIRE - 1);
    expect(ship.hullHP).toBe(100);
    expect(a.npc.hullHP).toBe(100);

    module.update(1);
    expect(ship.hullHP).toBe(80); // 100 - 20 ("a" only)
    expect(a.npc.hullHP).toBe(86); // selected target, 100 - 14 pulse
    expect(b.npc.hullHP).toBe(100);

    module.update(GAME_BALANCE.combatJoinFireStaggerMs);
    expect(ship.hullHP).toBe(65); // 80 - 15 ("b" joins in)
    expect(b.npc.hullHP).toBe(100); // not the selected target — untouched by player fire
  });

  it("a slain NPC leaves the combatant set and fires onNpcDestroyed exactly once", () => {
    const { module, destroyed } = makeModule();
    const a = makeSprite("a", 40, 0, { hullHP: 10, damage: 20 }); // selected, dies in one shot
    const b = makeSprite("b", 60, 0, { hullHP: 100, damage: 15 });
    module.addCombatant(a);
    module.addCombatant(b);

    module.update(FIRE);
    expect(destroyed).toEqual([a]); // reported once
    expect(module.combatants.has(a)).toBe(false);
    expect(module.combatants.has(b)).toBe(true);
    expect(module.selectedTarget).toBe(b); // re-picked from survivors
    expect(module.isActive).toBe(true); // fight continues against b

    module.update(FIRE);
    expect(destroyed.filter((s) => s === a)).toHaveLength(1);
  });

  it("isActive drops to false once the combatant set empties — last NPC killed", () => {
    const { module, destroyed } = makeModule();
    const a = makeSprite("a", 50, 0, { hullHP: 10 }); // lone NPC, dies to one shot
    module.addCombatant(a);
    module.update(FIRE);
    expect(destroyed).toEqual([a]);
    expect(module.combatants.size).toBe(0);
    expect(module.isActive).toBe(false);
    expect(module.selectedTarget).toBeNull();
  });

  it("isActive drops to false once the combatant set empties — last NPC fled", () => {
    const { module } = makeModule();
    const a = makeSprite("a", GAME_BALANCE.scannerRange + 400, 0);
    module.addCombatant(a);
    module.update(16); // pruneDisengaged drops the out-of-scanner NPC
    expect(module.combatants.size).toBe(0);
    expect(module.isActive).toBe(false);
  });

  it("warns the player below LOW_HULL_FRACTION (30%) without freezing the ship", () => {
    const { module, messages, physics } = makeModule({
      ship: { hullHP: 45, maxHull: 100 },
    });
    module.addCombatant(makeSprite("a", 50, 0, { hullHP: 1000, damage: 20 }));

    module.update(FIRE); // 45 - 20 = 25, below 30% of 100 → retreat warning
    const warning = messages.find((m) => m.text.includes("отступайте"));
    expect(warning).toBeDefined();
    expect(physics.isMoving).toBe(true); // ship is free to flee, never frozen
    expect(physics.currentSpeed).toBe(1);
  });
});
