import { describe, it, expect } from "vitest";
import { Container, Graphics } from "pixi.js";
import { CombatHud } from "@/presentation/flight/CombatHud";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import type { NpcShipSprite } from "@/presentation/NpcShipSprite";

/**
 * Real-time combat HUD (Task 2): the modal weapon-selection panel and
 * Атаковать/Отступить buttons are gone — this is now a compact top-right status
 * overlay (target name + red hull bar, player green hull bar) plus the dashed
 * range circle. These tests replace the old freeze-model panel tests.
 */

/** NpcShipSprite stand-in with just the fields the HUD reads. */
function makeSprite(name: string, hullHP = 100, maxHull = 100): NpcShipSprite {
  return {
    x: 0,
    y: 0,
    npc: { id: name, name, hullHP, maxHull },
  } as unknown as NpcShipSprite;
}

/** A loadout with two weapons: wpn_pulse (range 240) then wpn_railgun (range 360). */
function twoWeaponLoadout(): ShipLoadout {
  const loadout = new ShipLoadout("hull_warden");
  loadout.install("wpn_pulse");
  loadout.install("wpn_railgun");
  return loadout;
}

function makeHud(loadout: ShipLoadout | null = twoWeaponLoadout()): {
  hud: CombatHud;
  uiLayer: Container;
  gameLayer: Container;
} {
  const uiLayer = new Container();
  const gameLayer = new Container();
  const hud = new CombatHud(uiLayer, gameLayer, {
    getShipPos: () => ({ x: 100, y: 100 }),
    getScreenSize: () => ({ width: 800, height: 600 }),
    getPlayerLoadout: () => loadout,
  });
  return { hud, uiLayer, gameLayer };
}

function rangeCircles(layer: Container): Graphics[] {
  return layer.children.filter((c): c is Graphics => c instanceof Graphics);
}

describe("CombatHud overlay lifecycle (Task 2)", () => {
  it("open() mounts the overlay on the UI layer and the range circle on the game layer", () => {
    const { hud, uiLayer, gameLayer } = makeHud();
    expect(hud.isOpen).toBe(false);

    hud.open(makeSprite("Пират"));
    expect(hud.isOpen).toBe(true);
    expect(uiLayer.children.length).toBe(1); // single overlay panel
    expect(rangeCircles(gameLayer).length).toBe(1); // one dashed range circle
  });

  it("close() removes every display object from both layers and resets state", () => {
    const { hud, uiLayer, gameLayer } = makeHud();
    hud.open(makeSprite("Пират"));
    expect(uiLayer.children.length).toBeGreaterThan(0);
    expect(gameLayer.children.length).toBeGreaterThan(0);

    hud.close();
    expect(hud.isOpen).toBe(false);
    expect(hud.rangeRadius).toBe(0);
    expect(uiLayer.children.length).toBe(0);
    expect(gameLayer.children.length).toBe(0);
  });
});

describe("CombatHud auto-selected weapon + range (Task 2)", () => {
  it("selectedWeapon always returns the first equipped weapon", () => {
    const { hud } = makeHud();
    expect(hud.selectedWeapon?.id).toBe("wpn_pulse");
  });

  it("open() draws the range circle at the auto-selected weapon's range", () => {
    const { hud, gameLayer } = makeHud();
    hud.open(makeSprite("Пират"));
    expect(hud.rangeRadius).toBe(240); // wpn_pulse range
    expect(rangeCircles(gameLayer).length).toBe(1);
  });

  it("syncRangeCircle reuses the single circle (radius kept, no leak)", () => {
    const { hud, gameLayer } = makeHud();
    hud.open(makeSprite("Пират"));
    hud.syncRangeCircle();
    expect(hud.rangeRadius).toBe(240);
    expect(rangeCircles(gameLayer).length).toBe(1);
  });

  it("no loadout → no weapon → range radius 0", () => {
    const { hud } = makeHud(null);
    hud.open(makeSprite("Пират"));
    expect(hud.selectedWeapon).toBeNull();
    expect(hud.rangeRadius).toBe(0);
  });
});

describe("CombatHud HP bars (Task 2)", () => {
  it("open(target) seeds the target bar from the target's hull and fills the player bar", () => {
    const { hud } = makeHud();
    hud.open(makeSprite("Пират", 60, 120));
    expect(hud.targetHpRatio).toBeCloseTo(0.5);
    expect(hud.playerHpRatio).toBe(1);
  });

  it("updateTargetHP / updatePlayerHP clamp the fill into [0,1]", () => {
    const { hud } = makeHud();
    hud.open(makeSprite("Пират"));
    hud.updateTargetHP(25, 100);
    hud.updatePlayerHP(150, 100); // over-full clamps
    expect(hud.targetHpRatio).toBe(0.25);
    expect(hud.playerHpRatio).toBe(1);
    hud.updateTargetHP(-5, 100); // negative clamps to 0
    expect(hud.targetHpRatio).toBe(0);
  });

  it("setTarget(null) zeroes the target bar; setTarget(sprite) reseeds it", () => {
    const { hud } = makeHud();
    hud.open(makeSprite("Пират", 100, 100));
    hud.setTarget(null);
    expect(hud.targetHpRatio).toBe(0);
    hud.setTarget(makeSprite("Линкор", 40, 80));
    expect(hud.targetHpRatio).toBeCloseTo(0.5);
  });
});

// ---------------------------------------------------------------------------
// Engaged-enemy reticles (Task 4): a world-space bracket per combatant so the
// auto-mode fight reads at a glance; the selected target is drawn distinct.
// ---------------------------------------------------------------------------
describe("CombatHud engaged-enemy markers (Task 4)", () => {
  it("syncMarkers draws one reticle per combatant", () => {
    const { hud } = makeHud();
    const a = makeSprite("a");
    const b = makeSprite("b");
    hud.open(a);
    hud.syncMarkers([a, b], a);
    expect(hud.engagedMarkerCount).toBe(2);
  });

  it("syncMarkers removes the reticle for a combatant that left the fight", () => {
    const { hud } = makeHud();
    const a = makeSprite("a");
    const b = makeSprite("b");
    hud.open(a);
    hud.syncMarkers([a, b], a);
    hud.syncMarkers([a], a); // b destroyed / fled
    expect(hud.engagedMarkerCount).toBe(1);
  });

  it("syncMarkers before open() is a no-op (no render context yet)", () => {
    const { hud } = makeHud();
    hud.syncMarkers([makeSprite("a")], null);
    expect(hud.engagedMarkerCount).toBe(0);
  });

  it("close() disposes every reticle", () => {
    const { hud } = makeHud();
    const a = makeSprite("a");
    hud.open(a);
    hud.syncMarkers([a], a);
    expect(hud.engagedMarkerCount).toBe(1);
    hud.close();
    expect(hud.engagedMarkerCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Per-turn fire flashes (Task 4): a fading beam per shot so each exchanged "ход"
// reads as a discrete event; advanced/cleared by update().
// ---------------------------------------------------------------------------
describe("CombatHud fire flashes (Task 4)", () => {
  it("flashShot spawns a beam that update() fades and removes", () => {
    const { hud } = makeHud();
    hud.open(makeSprite("a"));
    hud.flashShot(0, 0, 100, 0, true);
    expect(hud.activeFlashCount).toBe(1);
    hud.update(150); // partway through the 220 ms lifetime
    expect(hud.activeFlashCount).toBe(1);
    hud.update(100); // crosses the lifetime → removed
    expect(hud.activeFlashCount).toBe(0);
  });

  it("flashShot before open() is a no-op (no render context yet)", () => {
    const { hud } = makeHud();
    hud.flashShot(0, 0, 10, 10, false);
    expect(hud.activeFlashCount).toBe(0);
  });

  it("close() clears any live flashes", () => {
    const { hud } = makeHud();
    hud.open(makeSprite("a"));
    hud.flashShot(0, 0, 50, 50, true);
    hud.flashShot(0, 0, -50, 50, false);
    expect(hud.activeFlashCount).toBe(2);
    hud.close();
    expect(hud.activeFlashCount).toBe(0);
  });
});
