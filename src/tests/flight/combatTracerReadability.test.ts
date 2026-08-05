import { describe, it, expect } from "vitest";
import { Container } from "pixi.js";
import {
  CombatHud,
  PLAYER_FLASH_COLOR,
  NPC_FLASH_COLOR,
} from "@/presentation/flight/CombatHud";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import type { NpcShipSprite } from "@/presentation/NpcShipSprite";

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
    expect(player.g).toBeGreaterThan(player.r);
    expect(enemy.r).toBeGreaterThan(enemy.g);
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
    const origins = [
      { x: -120, y: -80 },
      { x: 140, y: -60 },
      { x: -90, y: 110 },
      { x: 160, y: 130 },
    ];
    for (const o of origins) hud.flashShot(o.x, o.y, 100, 100, false);
    hud.flashShot(100, 100, 160, 130, true);

    expect(hud.activeFlashCount).toBe(origins.length + 1);
    const states = hud.tracerStates;
    expect(states.length).toBe(origins.length + 1);
    const froms = new Set(states.map((s) => `${s.from.x},${s.from.y}`));
    expect(froms.size).toBe(origins.length + 1);
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
    expect(enemy.pos.x).toBeGreaterThan(50);
    expect(enemy.pos.y).toBeCloseTo(0);
    expect(player.pos.x).toBeCloseTo(0);
    expect(player.pos.y).toBeGreaterThan(50);
  });
});
