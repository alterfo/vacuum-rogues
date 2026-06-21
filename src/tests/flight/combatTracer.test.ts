import { describe, it, expect } from "vitest";
import { Container } from "pixi.js";
import {
  CombatHud,
  TRACER_TRAVEL_MS,
  PLAYER_FLASH_COLOR,
  NPC_FLASH_COLOR,
  tracerBoltPos,
} from "@/presentation/flight/CombatHud";
import { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import type { NpcShipSprite } from "@/presentation/NpcShipSprite";

/**
 * Task 1 — traveling tracer bolt. Each fired shot used to draw a static
 * full-length beam (ambiguous direction); it now renders as a bolt that
 * interpolates shooter→target over {@link TRACER_TRAVEL_MS}, with a muzzle flash
 * at the source and an impact flash blooming at the target on arrival. These
 * tests cover the deterministic motion/lifecycle; the *look* is verified by GIF.
 */

function makeSprite(name: string, hullHP = 100, maxHull = 100): NpcShipSprite {
  return {
    x: 0,
    y: 0,
    npc: { id: name, name, hullHP, maxHull },
  } as unknown as NpcShipSprite;
}

function loadout(): ShipLoadout {
  const l = new ShipLoadout("hull_warden");
  l.install("wpn_pulse");
  return l;
}

function makeHud(): { hud: CombatHud; gameLayer: Container } {
  const uiLayer = new Container();
  const gameLayer = new Container();
  const hud = new CombatHud(uiLayer, gameLayer, {
    getShipPos: () => ({ x: 100, y: 100 }),
    getScreenSize: () => ({ width: 800, height: 600 }),
    getPlayerLoadout: () => loadout(),
  });
  return { hud, gameLayer };
}

/** The flashLayer is the last child added in open() (after the marker layer). */
function flashLayerOf(gameLayer: Container): Container {
  return gameLayer.children[gameLayer.children.length - 1] as Container;
}

describe("traveling tracer — creation + colour", () => {
  it("flashShot registers a tracer with the correct from/to endpoints", () => {
    const { hud } = makeHud();
    hud.open(makeSprite("a"));
    hud.flashShot(10, 20, 200, 120, true);
    expect(hud.activeFlashCount).toBe(1);
    const [t] = hud.tracerStates;
    expect(t.from).toEqual({ x: 10, y: 20 });
    expect(t.to).toEqual({ x: 200, y: 120 });
  });

  it("player fire is cyan-green, enemy fire is red", () => {
    const { hud } = makeHud();
    hud.open(makeSprite("a"));
    hud.flashShot(0, 0, 100, 0, true);
    hud.flashShot(0, 0, -100, 0, false);
    const states = hud.tracerStates;
    expect(states.find((s) => s.fromPlayer)?.color).toBe(PLAYER_FLASH_COLOR);
    expect(states.find((s) => !s.fromPlayer)?.color).toBe(NPC_FLASH_COLOR);
  });
});

describe("traveling tracer — position interpolates over travel", () => {
  it("the bolt head starts at the shooter and reaches the target over TRACER_TRAVEL_MS", () => {
    const { hud } = makeHud();
    hud.open(makeSprite("a"));
    hud.flashShot(0, 0, 100, 200, false);

    // Fresh: head at the source, phase=travel.
    let [t] = hud.tracerStates;
    expect(t.pos.x).toBeCloseTo(0);
    expect(t.pos.y).toBeCloseTo(0);
    expect(t.phase).toBe("travel");

    // Halfway through travel: head at the midpoint.
    hud.update(TRACER_TRAVEL_MS / 2);
    [t] = hud.tracerStates;
    expect(t.pos.x).toBeCloseTo(50);
    expect(t.pos.y).toBeCloseTo(100);
    expect(t.phase).toBe("travel");
  });

  it("tracerBoltPos lerps and clamps to the target after arrival", () => {
    const from = { x: 0, y: 0 };
    const to = { x: 100, y: 0 };
    expect(tracerBoltPos(from, to, 0).x).toBeCloseTo(0);
    expect(tracerBoltPos(from, to, TRACER_TRAVEL_MS / 2).x).toBeCloseTo(50);
    expect(tracerBoltPos(from, to, TRACER_TRAVEL_MS).x).toBeCloseTo(100);
    // Past arrival the head stays pinned to the target (no overshoot).
    expect(tracerBoltPos(from, to, TRACER_TRAVEL_MS * 3).x).toBeCloseTo(100);
  });
});

describe("traveling tracer — impact on arrival", () => {
  it("switches from travel to an impact flash pinned at the target once it arrives", () => {
    const { hud } = makeHud();
    hud.open(makeSprite("a"));
    hud.flashShot(0, 0, 80, 60, true);

    expect(hud.tracerStates[0].phase).toBe("travel");
    hud.update(TRACER_TRAVEL_MS + 1); // bolt arrives
    const [t] = hud.tracerStates;
    expect(t.phase).toBe("impact");
    expect(t.pos.x).toBeCloseTo(80); // pinned at the target
    expect(t.pos.y).toBeCloseTo(60);
  });
});

describe("traveling tracer — lifecycle", () => {
  it("activeFlashCount tracks a tracer from spawn through travel, impact, removal", () => {
    const { hud, gameLayer } = makeHud();
    hud.open(makeSprite("a"));
    hud.flashShot(0, 0, 100, 0, true);
    expect(hud.activeFlashCount).toBe(1);
    expect(flashLayerOf(gameLayer).children.length).toBe(1);
    hud.update(TRACER_TRAVEL_MS - 10); // still traveling
    expect(hud.activeFlashCount).toBe(1);
    expect(hud.tracerStates[0].phase).toBe("travel");
    hud.update(40); // crossed into impact phase
    expect(hud.activeFlashCount).toBe(1);
    expect(hud.tracerStates[0].phase).toBe("impact");
    hud.update(1000); // well past FLASH_TTL_MS → removed
    expect(hud.activeFlashCount).toBe(0);
    expect(flashLayerOf(gameLayer).children.length).toBe(0); // Graphics disposed
  });
});

describe("traveling tracer — independence + no blur", () => {
  it("concurrent shots from different shooters render as independent tracers", () => {
    const { hud } = makeHud();
    hud.open(makeSprite("a"));
    hud.flashShot(10, 0, 200, 0, false); // enemy 1
    hud.flashShot(0, 50, 200, 50, false); // enemy 2
    hud.flashShot(100, 100, -50, 100, true); // player
    expect(hud.activeFlashCount).toBe(3);
    const froms = hud.tracerStates.map((t) => `${t.from.x},${t.from.y}`);
    expect(new Set(froms).size).toBe(3); // three distinct origins
  });

  it("tracer Graphics carry no filters (no per-frame BlurFilter)", () => {
    const { hud, gameLayer } = makeHud();
    hud.open(makeSprite("a"));
    hud.flashShot(0, 0, 100, 0, true);
    hud.update(TRACER_TRAVEL_MS + 1); // through travel into impact
    for (const child of flashLayerOf(gameLayer).children) {
      const filters = (child as { filters?: unknown }).filters;
      const noFilters =
        filters == null || (Array.isArray(filters) && filters.length === 0);
      expect(noFilters).toBe(true);
    }
  });
});
