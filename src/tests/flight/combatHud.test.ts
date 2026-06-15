import { describe, it, expect } from "vitest";
import { Container, Graphics, type FederatedPointerEvent } from "pixi.js";
import { CombatHud } from "@/presentation/flight/CombatHud";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";

/** A fake pointer event carrying just the field UiButton's handler touches. */
const fakeEvent = {
  stopPropagation() {},
} as unknown as FederatedPointerEvent;

function makeHud(): {
  hud: CombatHud;
  uiLayer: Container;
  gameLayer: Container;
} {
  const uiLayer = new Container();
  const gameLayer = new Container();
  const hud = new CombatHud(uiLayer, gameLayer, {
    getShipPos: () => ({ x: 100, y: 100 }),
    getScreenSize: () => ({ width: 800, height: 600 }),
  });
  return { hud, uiLayer, gameLayer };
}

/** A loadout with two weapons: wpn_pulse (range 240) then wpn_railgun (range 360). */
function twoWeaponLoadout(): ShipLoadout {
  const loadout = new ShipLoadout("hull_warden");
  loadout.install("wpn_pulse");
  loadout.install("wpn_railgun");
  return loadout;
}

function rangeCircles(layer: Container): Graphics[] {
  return layer.children.filter((c): c is Graphics => c instanceof Graphics);
}

describe("CombatHud weapon panel (Task 12)", () => {
  it("buildWeaponPanel returns one card per equipped weapon", () => {
    const { hud } = makeHud();
    const cards = hud.buildWeaponPanel(twoWeaponLoadout());
    expect(cards.length).toBe(2);
    expect(cards.map((c) => c.weaponId)).toEqual(["wpn_pulse", "wpn_railgun"]);
  });

  it("ignores non-weapon gear when building the panel", () => {
    const { hud } = makeHud();
    const loadout = new ShipLoadout("hull_warden");
    loadout.install("eq_engine_i"); // equipment, not a weapon
    loadout.install("wpn_pulse");
    const cards = hud.buildWeaponPanel(loadout);
    expect(cards.map((c) => c.weaponId)).toEqual(["wpn_pulse"]);
  });

  it("clicking a weapon card emits onWeaponSelected(weaponId)", () => {
    const { hud } = makeHud();
    const cards = hud.buildWeaponPanel(twoWeaponLoadout());
    let emitted: string | null = null;
    hud.onWeaponSelected = (id) => {
      emitted = id;
    };
    cards[1].button.container.emit("pointerdown", fakeEvent);
    expect(emitted).toBe("wpn_railgun");
    expect(hud.selectedWeaponId).toBe("wpn_railgun");
  });

  it("open() default-selects the first weapon and draws its range circle", () => {
    const { hud, gameLayer } = makeHud();
    hud.open(twoWeaponLoadout());
    expect(hud.selectedWeaponId).toBe("wpn_pulse");
    expect(hud.rangeRadius).toBe(240);
    expect(rangeCircles(gameLayer).length).toBe(1);
  });

  it("selecting another weapon replaces the range circle (radius + no leak)", () => {
    const { hud, gameLayer } = makeHud();
    hud.open(twoWeaponLoadout());
    hud.selectWeapon("wpn_railgun");
    expect(hud.rangeRadius).toBe(360);
    // Still exactly one range circle — the previous one is reused, not leaked.
    expect(rangeCircles(gameLayer).length).toBe(1);
  });
});

describe("CombatHud action buttons (Task 12)", () => {
  it("Атаковать is disabled until a target is in range and fires onAttack only when enabled", () => {
    const { hud } = makeHud();
    hud.open(twoWeaponLoadout());
    let attacks = 0;
    hud.onAttack = () => {
      attacks++;
    };
    expect(hud.isAttackEnabled).toBe(false);

    // Disabled: a click must not fire onAttack.
    hud.attackButton!.container.emit("pointerdown", fakeEvent);
    expect(attacks).toBe(0);

    // Armed by the module once a target is within range.
    hud.setAttackEnabled(true);
    expect(hud.isAttackEnabled).toBe(true);
    hud.attackButton!.container.emit("pointerdown", fakeEvent);
    expect(attacks).toBe(1);
  });

  it("Отступить ends combat immediately via onRetreat", () => {
    const { hud } = makeHud();
    hud.open(twoWeaponLoadout());
    let retreated = false;
    hud.onRetreat = () => {
      retreated = true;
    };
    hud.retreatButton!.container.emit("pointerdown", fakeEvent);
    expect(retreated).toBe(true);
  });
});

describe("CombatHud teardown", () => {
  it("close() removes every display object from both layers", () => {
    const { hud, uiLayer, gameLayer } = makeHud();
    hud.open(twoWeaponLoadout());
    expect(uiLayer.children.length).toBeGreaterThan(0);
    expect(gameLayer.children.length).toBeGreaterThan(0);

    hud.close();
    expect(hud.selectedWeaponId).toBeNull();
    expect(hud.rangeRadius).toBe(0);
    expect(hud.isAttackEnabled).toBe(false);
    expect(uiLayer.children.length).toBe(0);
    expect(gameLayer.children.length).toBe(0);
  });
});
