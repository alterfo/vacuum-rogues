import { describe, it, expect } from "vitest";
import { Container } from "pixi.js";
import {
  CombatHud,
  PLAYER_FLASH_COLOR,
  NPC_FLASH_COLOR,
} from "@/presentation/flight/CombatHud";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import type { NpcShipSprite } from "@/presentation/NpcShipSprite";

/**
 * Task 2 — player/enemy distinction + multi-combatant readability. The traveling
 * tracer (Task 1) is colour-coded by shooter side; this suite locks the two
 * deterministic guarantees that make a busy fight readable: player fire and
 * enemy fire are *clearly* distinct (not just two different ints, but opposed in
 * hue), and N concurrent shots from N shooters render as N independent bolts,
 * each originating at its own shooter position. The strengthened look (wider
 * halo + white-hot core) is verified by GIF.
 */

function makeSprite(name: string): NpcShipSprite {
  return {
    x: 0,
    y: 0,
    npc: { id: name, name, hullHP: 100, maxHull: 100 },
  } as unknown as NpcShipSprite;
}

function loadout(): ShipLoadout {
  const l = new ShipLoadout("hull_warden");
  l.install("wpn_pulse");
  return l;
}

function makeHud(): CombatHud {
  return new CombatHud(new Container(), new Container(), {
    getShipPos: () => ({ x: 100, y: 100 }),
    getScreenSize: () => ({ width: 800, height: 600 }),
    getPlayerLoadout: () => loadout(),
  });
}

/** Decompose a 0xRRGGBB int into its 8-bit channels. */
function rgb(color: number): { r: number; g: number; b: number } {
  return {
    r: (color >> 16) & 0xff,
    g: (color >> 8) & 0xff,
    b: color & 0xff,
  };
}

describe("tracer readability — player vs enemy distinction", () => {
  it("player and enemy fire use different colours", () => {
    expect(PLAYER_FLASH_COLOR).not.toBe(NPC_FLASH_COLOR);
  });

  it("the two colours are opposed in hue (player green/cyan, enemy red)", () => {
    const player = rgb(PLAYER_FLASH_COLOR);
    const enemy = rgb(NPC_FLASH_COLOR);
    // Player fire reads green/cyan: its green channel dominates its red.
    expect(player.g).toBeGreaterThan(player.r);
    // Enemy fire reads red: its red channel dominates its green.
    expect(enemy.r).toBeGreaterThan(enemy.g);
    // And the sides are clearly separated, not a near-miss pair of hues.
    expect(enemy.r - player.r).toBeGreaterThan(80); // enemy much redder
    expect(player.g - enemy.g).toBeGreaterThan(80); // player much greener
  });

  it("a fired tracer reports the colour of its shooter side", () => {
    const hud = makeHud();
    hud.open(makeSprite("a"));
    hud.flashShot(0, 0, 100, 0, true); // player
    hud.flashShot(50, 50, 100, 0, false); // enemy
    const states = hud.tracerStates;
    expect(states.find((s) => s.fromPlayer)?.color).toBe(PLAYER_FLASH_COLOR);
    expect(states.find((s) => !s.fromPlayer)?.color).toBe(NPC_FLASH_COLOR);
  });
});

describe("tracer readability — multi-combatant attribution", () => {
  it("N concurrent shots from N shooters render as N independent bolts", () => {
    const hud = makeHud();
    hud.open(makeSprite("target"));
    // Four enemies firing at the player from four distinct positions.
    const origins = [
      { x: -120, y: -80 },
      { x: 140, y: -60 },
      { x: -90, y: 110 },
      { x: 160, y: 130 },
    ];
    for (const o of origins) hud.flashShot(o.x, o.y, 100, 100, false);
    // Plus the player firing back from its own ship position.
    hud.flashShot(100, 100, 160, 130, true);

    expect(hud.activeFlashCount).toBe(origins.length + 1);
    const states = hud.tracerStates;
    expect(states.length).toBe(origins.length + 1);
    // Every bolt carries a distinct origin — each attributable to one shooter.
    const froms = new Set(states.map((s) => `${s.from.x},${s.from.y}`));
    expect(froms.size).toBe(origins.length + 1);
    // Each enemy bolt originates at exactly its shooter's position.
    for (const o of origins) {
      expect(states.some((s) => s.from.x === o.x && s.from.y === o.y)).toBe(
        true,
      );
    }
  });

  it("concurrent shots advance independently (each interpolates from its own origin)", () => {
    const hud = makeHud();
    hud.open(makeSprite("target"));
    hud.flashShot(0, 0, 200, 0, false); // enemy A, horizontal
    hud.flashShot(0, 0, 0, 200, true); // player, vertical from same origin

    hud.update(65); // partway along both travels (half of 130 ms)
    const states = hud.tracerStates;
    const enemy = states.find((s) => !s.fromPlayer)!;
    const player = states.find((s) => s.fromPlayer)!;
    // Same origin, different targets → the two bolt heads diverge.
    expect(enemy.pos.x).toBeGreaterThan(50);
    expect(enemy.pos.y).toBeCloseTo(0);
    expect(player.pos.x).toBeCloseTo(0);
    expect(player.pos.y).toBeGreaterThan(50);
  });
});
