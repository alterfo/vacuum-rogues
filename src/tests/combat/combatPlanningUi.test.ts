/**
 * Planning-phase live UI (Task 14.5b of
 * `docs/plans/20260713-tactical-pause-combat-rework.md`): the weapon bar +
 * range rings mount on PLANNING and tear down on confirm/fight-end, the
 * two-step click-a-weapon-then-click-a-target interaction writes into the
 * planned-turn draft (out-of-range flagged, not rejected — Task 5's recorded
 * decision), a non-combatant click falls through, and the controller factory
 * wires the UI + toast + confirmed-movement side effects.
 *
 * Built against a REAL PixiJS scene graph in jsdom (mirrors
 * `flightHudCornerLayout.test.ts`); no text measurement is read.
 */
import { describe, it, expect, afterEach } from "vitest";
import { Container, type Graphics } from "pixi.js";
import {
  CombatPlanningUi,
  createCombatPlanningController,
} from "@/presentation/flight/combatPlanningUi";
import { CombatPlanningController } from "@/presentation/flight/combatPlanning";
import type { WeaponSpec } from "@/systems/equipment/GearCatalog";
import type { NpcShipSprite } from "@/presentation/NpcShipSprite";
import { t } from "@/i18n/i18n";
import { setFontScale } from "@/utils/fontScale";

afterEach(() => setFontScale("M")); // never leak a scale into other tests

/** Minimal catalog-shaped weapon (only the surfaces the UI reads). */
function weapon(id: string, name: string, range: number): WeaponSpec {
  return { id, name, range } as WeaponSpec;
}

/** Minimal enemy sprite (position + npc identity). */
function enemy(id: string, x: number, y: number): NpcShipSprite {
  return { x, y, npc: { id, name: id } } as unknown as NpcShipSprite;
}

function makeHarness(weapons: WeaponSpec[]) {
  const uiLayer = new Container();
  const gameLayer = new Container();
  const combatants = new Set<NpcShipSprite>();
  const messages: string[] = [];
  const planning = new CombatPlanningController<NpcShipSprite, WeaponSpec>();
  const ui = new CombatPlanningUi({
    getUiLayer: () => uiLayer,
    getGameLayer: () => gameLayer,
    getScreenSize: () => ({ width: 800, height: 600 }),
    getShipPos: () => ({ x: 100, y: 100 }),
    getFittedWeapons: () => weapons,
    isCombatant: (s) => combatants.has(s),
    planning,
    showMessage: (text) => messages.push(text),
  });
  planning.beginCombat(); // draft mutations require PLANNING
  return { ui, uiLayer, gameLayer, combatants, messages, planning };
}

const bar = (uiLayer: Container): Container | null =>
  uiLayer.getChildByLabel("combat-planning-bar") as Container | null;

describe("CombatPlanningUi — planning-phase weapon bar + range rings (14.5b)", () => {
  it("mounts one bar button per fitted weapon and a range-rings graphic on the game layer", () => {
    const guns = [weapon("wpn_a", "Пульсар", 240), weapon("wpn_b", "Луч", 360)];
    const h = makeHarness(guns);
    h.ui.enterPlanning();

    expect(h.ui.isOpen).toBe(true);
    const mounted = bar(h.uiLayer);
    expect(mounted).not.toBeNull();
    expect(mounted!.children.length).toBe(2); // one UiButton container per gun
    expect(mounted!.getChildByLabel("cpw-0")).not.toBeNull();
    expect(mounted!.getChildByLabel("cpw-1")).not.toBeNull();
    expect(h.gameLayer.children.length).toBe(1); // the rings Graphics
  });

  it('weapon-bar button spacing grows with the font scale (real-play report 2026-07-18: text overran a fixed-width box at "L")', () => {
    const guns = [weapon("wpn_a", "Пульсар", 240), weapon("wpn_b", "Луч", 360)];

    setFontScale("M");
    const hM = makeHarness(guns);
    hM.ui.enterPlanning();
    const barM = bar(hM.uiLayer)!;
    const spacingM =
      (barM.children[1] as Container).x - (barM.children[0] as Container).x;

    setFontScale("L");
    const hL = makeHarness(guns);
    hL.ui.enterPlanning();
    const barL = bar(hL.uiLayer)!;
    const spacingL =
      (barL.children[1] as Container).x - (barL.children[0] as Container).x;

    expect(spacingL).toBeGreaterThan(spacingM); // button box widened, not just the label text
    // Only the button width scales (168 → 210 at 1.25×); the inter-button gap (8px) doesn't.
    expect(spacingL - spacingM).toBeCloseTo(42, 0);
  });

  it("mounts no bar for a weaponless ship (nothing to assign)", () => {
    const h = makeHarness([]);
    h.ui.enterPlanning();
    expect(bar(h.uiLayer)).toBeNull();
    expect(h.ui.isOpen).toBe(false);
  });

  it("re-entering planning rebuilds the surface idempotently (no stacking)", () => {
    const h = makeHarness([weapon("wpn_a", "Пульсар", 240)]);
    h.ui.enterPlanning();
    h.ui.enterPlanning();
    expect(h.uiLayer.children.length).toBe(1);
    expect(h.gameLayer.children.length).toBe(1);
  });

  it("arms a weapon on first click and toggles it off on a second click", () => {
    const gun = weapon("wpn_a", "Пульсар", 240);
    const h = makeHarness([gun]);
    h.ui.enterPlanning();

    h.ui.armWeapon(gun);
    expect(h.ui.armedWeapon).toBe(gun);
    expect(h.messages).toContain(
      t("combat.planning.armWeapon", { name: gun.name }),
    );

    h.ui.armWeapon(gun); // toggle off
    expect(h.ui.armedWeapon).toBeNull();
  });

  it("assigns the armed weapon to a clicked combatant (in range) and consumes the click", () => {
    const gun = weapon("wpn_a", "Пульсар", 240);
    const h = makeHarness([gun]);
    const foe = enemy("foe-1", 200, 100); // 100px away, inside 240 range
    h.combatants.add(foe);
    h.ui.enterPlanning();
    h.ui.armWeapon(gun);

    expect(h.ui.handleTargetClick(foe)).toBe(true);
    expect(h.planning.plan.weaponTargets.get(gun)).toBe(foe);
    expect(h.ui.armedWeapon).toBeNull(); // selection consumed
    expect(h.messages).toContain(
      t("combat.planning.assigned", { weapon: gun.name, target: foe.npc.name }),
    );
  });

  it("flags (not rejects) an out-of-range assignment — Task 5's recorded decision", () => {
    const gun = weapon("wpn_a", "Пульсар", 240);
    const h = makeHarness([gun]);
    const far = enemy("foe-far", 900, 100); // 800px away, beyond 240 range
    h.combatants.add(far);
    h.ui.enterPlanning();
    h.ui.armWeapon(gun);

    expect(h.ui.handleTargetClick(far)).toBe(true);
    expect(h.planning.plan.weaponTargets.get(gun)).toBe(far); // accepted anyway
    expect(h.messages).toContain(
      t("combat.planning.assignedFar", {
        weapon: gun.name,
        target: far.npc.name,
      }),
    );
  });

  it("does not consume a click with no weapon armed (falls through to legacy re-target)", () => {
    const gun = weapon("wpn_a", "Пульсар", 240);
    const h = makeHarness([gun]);
    const foe = enemy("foe-1", 200, 100);
    h.combatants.add(foe);
    h.ui.enterPlanning();

    expect(h.ui.handleTargetClick(foe)).toBe(false);
    expect(h.planning.plan.weaponTargets.size).toBe(0);
  });

  it("does not assign to a non-combatant (a passing neutral is never a fire target)", () => {
    const gun = weapon("wpn_a", "Пульсар", 240);
    const h = makeHarness([gun]);
    const neutral = enemy("bystander", 200, 100); // NOT added to combatants
    h.ui.enterPlanning();
    h.ui.armWeapon(gun);

    expect(h.ui.handleTargetClick(neutral)).toBe(false);
    expect(h.planning.plan.weaponTargets.size).toBe(0);
    expect(h.ui.armedWeapon).toBe(gun); // still armed for a valid pick
  });

  it("re-assignment overwrites cleanly (spread → focus back onto one target)", () => {
    const gun = weapon("wpn_a", "Пульсар", 240);
    const h = makeHarness([gun]);
    const foe1 = enemy("foe-1", 200, 100);
    const foe2 = enemy("foe-2", 100, 200);
    h.combatants.add(foe1);
    h.combatants.add(foe2);
    h.ui.enterPlanning();

    h.ui.armWeapon(gun);
    h.ui.handleTargetClick(foe1);
    h.ui.armWeapon(gun);
    h.ui.handleTargetClick(foe2);

    expect(h.planning.plan.weaponTargets.get(gun)).toBe(foe2);
    expect(h.planning.plan.weaponTargets.size).toBe(1);
  });

  it("exitPlanning tears the whole surface down and drops the armed selection", () => {
    const gun = weapon("wpn_a", "Пульсар", 240);
    const h = makeHarness([gun]);
    h.ui.enterPlanning();
    h.ui.armWeapon(gun);

    h.ui.exitPlanning();

    expect(h.ui.isOpen).toBe(false);
    expect(h.uiLayer.children.length).toBe(0);
    expect(h.gameLayer.children.length).toBe(0);
    expect(h.ui.armedWeapon).toBeNull();
  });

  it("draws the rings at the live ship position with each weapon's own catalog range", () => {
    const guns = [weapon("wpn_a", "Пульсар", 240)];
    const h = makeHarness(guns);
    h.ui.enterPlanning();
    const rings = h.gameLayer.children[0] as Graphics;
    // A dashed 240px ring around (100,100) must extend to x≈340 — assert via
    // the Graphics bounds rather than re-testing the (unit-tested) draw seam.
    const bounds = rings.getLocalBounds();
    expect(bounds.maxX).toBeGreaterThan(330);
    expect(bounds.minX).toBeLessThan(-130);
  });
});

describe("createCombatPlanningController — factory side effects (14.5b)", () => {
  function makeFactoryHarness() {
    const messages: string[] = [];
    const paths: { x: number; y: number }[][] = [];
    const uiCalls: string[] = [];
    const fakeUi = {
      enterPlanning: () => uiCalls.push("enter"),
      exitPlanning: () => uiCalls.push("exit"),
    } as unknown as CombatPlanningUi;
    let fightEnded = 0;
    const controller = createCombatPlanningController({
      getShipPhysics: () => ({ setPath: (p) => paths.push(p) }),
      getUi: () => fakeUi,
      showMessage: (text) => messages.push(text),
      onFightEnd: () => {
        fightEnded += 1;
      },
    });
    return {
      controller,
      messages,
      paths,
      uiCalls,
      fightEnded: () => fightEnded,
    };
  }

  it("mounts the UI + shows the planning toast on entering PLANNING", () => {
    const h = makeFactoryHarness();
    h.controller.beginCombat();
    expect(h.uiCalls).toEqual(["enter"]);
    expect(h.messages).toContain(t("combat.planning.enter"));
  });

  it("on confirm: applies the planned destination via setPath, unmounts the UI, toasts executing", () => {
    const h = makeFactoryHarness();
    h.controller.beginCombat();
    h.controller.setDestination({ x: 400, y: 500 });
    h.controller.confirm();
    expect(h.paths).toEqual([[{ x: 400, y: 500 }]]);
    expect(h.uiCalls).toEqual(["enter", "exit"]);
    expect(h.messages).toContain(t("combat.planning.executing"));
  });

  it("an empty confirm holds position (no setPath call) — empty draft is legal", () => {
    const h = makeFactoryHarness();
    h.controller.beginCombat();
    h.controller.confirm();
    expect(h.paths).toEqual([]);
  });

  it("fight end unmounts the UI and fires the route-restore hook", () => {
    const h = makeFactoryHarness();
    h.controller.beginCombat();
    h.controller.endCombat();
    expect(h.uiCalls).toEqual(["enter", "exit"]);
    expect(h.fightEnded()).toBe(1);
  });
});
