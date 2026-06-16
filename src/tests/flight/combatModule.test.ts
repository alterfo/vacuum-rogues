import { describe, it, expect } from "vitest";
import { Container } from "pixi.js";
import {
  CombatModule,
  resolveMultiRound,
  type CombatModuleDeps,
} from "@/presentation/flight/CombatModule";
import type { NpcShipSprite } from "@/presentation/NpcShipSprite";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import type { ShipPhysics } from "@/systems/ShipPhysics";
import { GAME_BALANCE } from "@/config/balance";

const FIRE = GAME_BALANCE.combatFireIntervalMs; // 2500 ms

/** ShipPhysics stand-in carrying the fields CombatModule reads. */
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

/** NpcShipSprite stand-in with just the position + npc fields CombatModule touches. */
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
  };
  return { module: new CombatModule(deps), ship, destroyed, messages, physics };
}

// ---------------------------------------------------------------------------
// resolveMultiRound — pure synchronized-round helper
// ---------------------------------------------------------------------------
describe("resolveMultiRound (Task 1)", () => {
  it("player takes the summed incoming damage; target (index 0) takes player damage", () => {
    const r = resolveMultiRound(
      14,
      [
        { id: "a", damage: 20, hullHP: 100 },
        { id: "b", damage: 15, hullHP: 100 },
      ],
      100,
    );
    expect(r.newPlayerHP).toBe(65); // 100 - (20 + 15)
    expect(r.npcs[0]).toEqual({ id: "a", hullHP: 86, dead: false }); // 100 - 14
    expect(r.npcs[1]).toEqual({ id: "b", hullHP: 100, dead: false }); // untouched
  });

  it("floors player HP at 0 — the death threshold (no negative hull)", () => {
    const r = resolveMultiRound(
      14,
      [
        { id: "a", damage: 60, hullHP: 100 },
        { id: "b", damage: 60, hullHP: 100 },
      ],
      100,
    );
    expect(r.newPlayerHP).toBe(0);
  });

  it("flags a target dead when player damage drops its hull to 0", () => {
    const r = resolveMultiRound(14, [{ id: "a", damage: 5, hullHP: 10 }], 100);
    expect(r.npcs[0]).toEqual({ id: "a", hullHP: 0, dead: true });
  });
});

// ---------------------------------------------------------------------------
// CombatModule — engagement lifecycle
// ---------------------------------------------------------------------------
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
});

// ---------------------------------------------------------------------------
// CombatModule — timer-driven firing
// ---------------------------------------------------------------------------
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
    module.update(FIRE);
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

// ---------------------------------------------------------------------------
// CombatModule — death + removal
// ---------------------------------------------------------------------------
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
});

// ---------------------------------------------------------------------------
// CombatModule — lifecycle robustness with a render context
// ---------------------------------------------------------------------------
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
