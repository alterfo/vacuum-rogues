/**
 * Off-planet base art (plan 20260624, Task 2): `PlanetManager.createStations()`
 * renders each station as a per-type SPRITE when station art resolves to a
 * cached texture, and falls back to the existing colour-coded DIAMOND otherwise.
 *
 * These pixi-mocked tests pin the contract the renderer must keep in BOTH paths:
 *  - sprite path (mocked `stationSpriteKey` + cached `tex`): an 80×80, anchor-0.5,
 *    non-interactive Sprite is mounted (no diamond `poly`);
 *  - diamond path (`stationSpriteKey` → null): the diamond Graphics is drawn (no
 *    Sprite);
 *  - and in EITHER path the marker still gets a name label, a `static`
 *    pointer hit-area that calls `onStationClick` (→ `onStationDock`), a `90`
 *    zIndex container, and a `stationMarkers` entry that `getStationAt`/docking
 *    range can still find. (The wiring that breaks docking if the rewrite drops a
 *    bookkeeping step.)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const pixi = vi.hoisted(() => ({
  sprites: [] as Array<Record<string, unknown>>,
  graphics: [] as Array<Record<string, unknown>>,
}));

vi.mock("pixi.js", () => {
  const makeBase = () => ({
    addChild: vi.fn(),
    removeChild: vi.fn(),
    children: [] as unknown[],
    eventMode: "auto",
    cursor: "pointer",
    zIndex: 0,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    anchor: { set: vi.fn() },
    on: vi.fn(),
    destroy: vi.fn(),
  });
  return {
    Container: vi.fn().mockImplementation(makeBase),
    Graphics: vi.fn().mockImplementation(() => {
      const g = {
        ...makeBase(),
        circle: vi.fn().mockReturnThis(),
        poly: vi.fn().mockReturnThis(),
        fill: vi.fn().mockReturnThis(),
        stroke: vi.fn().mockReturnThis(),
      };
      pixi.graphics.push(g);
      return g;
    }),
    Sprite: vi.fn().mockImplementation(() => {
      const s = makeBase();
      pixi.sprites.push(s);
      return s;
    }),
    Text: vi.fn().mockImplementation(() => ({
      ...makeBase(),
      text: "",
      style: {},
    })),
  };
});

vi.mock("@/presentation/PlanetSprite", () => ({
  PlanetSprite: vi.fn(),
}));

vi.mock("@/presentation/PlanetInfoPanel", () => ({
  PlanetInfoPanel: vi.fn().mockImplementation(() => ({
    container: { addChild: vi.fn() },
    destroy: vi.fn(),
  })),
}));

// Control the art resolver + texture cache so we can drive the sprite/diamond
// branch deterministically without any real `station/` art on disk.
const art = vi.hoisted(() => ({
  stationSpriteKey: vi.fn<[type: unknown, id: string], string | null>(),
  tex: vi.fn<[key: string], unknown>(),
}));

vi.mock("@/presentation/flight/stationArt", async () => {
  const actual = await vi.importActual<
    typeof import("@/presentation/flight/stationArt")
  >("@/presentation/flight/stationArt");
  return { ...actual, stationSpriteKey: art.stationSpriteKey };
});

vi.mock("@/presentation/textures", async () => {
  const actual = await vi.importActual<
    typeof import("@/presentation/textures")
  >("@/presentation/textures");
  return { ...actual, tex: art.tex };
});

import {
  PlanetManager,
  type PlanetManagerDeps,
  type StationMarker,
} from "@/presentation/flight/PlanetManager";
import type { Renderer } from "@/presentation/Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import type { ShipPhysics } from "@/systems/ShipPhysics";
import type { Station } from "@/domain/Station";
import { StationType } from "@/types";

function makeMockRenderer(): Renderer {
  const makeLayer = () => ({
    addChild: vi.fn(),
    removeChild: vi.fn(),
    children: [] as unknown[],
  });
  return {
    app: { screen: { width: 800, height: 600 } },
    gameLayer: makeLayer(),
    uiLayer: makeLayer(),
  } as unknown as Renderer;
}

// Star centre is (400,300); a station at radius 100 / angle 0 lands at (500,300).
const STATION: Station = {
  id: "sys_a-station-1",
  name: "Торговый порт «Меридиан»",
  type: StationType.TRADE_POST,
  faction: "INDEPENDENT",
  orbitRadius: 100,
  orbitAngle: 0,
} as unknown as Station;
const STATION_X = 500;
const STATION_Y = 300;

function makeHarness(): {
  manager: PlanetManager;
  gameLayer: { addChild: ReturnType<typeof vi.fn> };
} {
  const renderer = makeMockRenderer();
  const gameEngine = {
    player: { currentSystemId: "sys_a" },
    galaxy: {
      gameDays: 0,
      systems: [
        {
          id: "sys_a",
          planets: [],
          stations: [STATION],
          ownerFaction: "INDEPENDENT",
        },
      ],
    },
    questManager: { getActiveQuestLocations: () => [] },
  } as unknown as GameEngine;

  const deps: PlanetManagerDeps = {
    getShipPhysics: () => ({ shipX: 0, shipY: 0 }) as unknown as ShipPhysics,
    getStarCenter: () => ({ x: 400, y: 300 }),
    isTurnRunning: () => false,
    getOrbitalDay: () => 0,
    showPlanetTooltip: () => {},
    hideTooltip: () => {},
    clearFollow: () => {},
  };

  const manager = new PlanetManager(
    renderer,
    gameEngine,
    renderer.gameLayer,
    renderer.uiLayer,
    deps,
  );
  return {
    manager,
    gameLayer: renderer.gameLayer as unknown as {
      addChild: ReturnType<typeof vi.fn>;
    },
  };
}

/** The station container is the zIndex-90 object mounted on the game layer. */
function stationContainer(gameLayer: { addChild: ReturnType<typeof vi.fn> }) {
  const ctn = gameLayer.addChild.mock.calls
    .map((c) => c[0] as Record<string, unknown>)
    .find((o) => o.zIndex === 90);
  expect(ctn, "station container mounted on game layer").toBeTruthy();
  return ctn as {
    addChild: { mock: { calls: unknown[][] } };
    zIndex: number;
  };
}

/** The container's children, split into the interactive hit-area and the rest. */
function childrenOf(ctn: ReturnType<typeof stationContainer>) {
  const children = ctn.addChild.mock.calls.map((c) => c[0]) as Array<
    Record<string, unknown>
  >;
  const hit = children.find((ch) =>
    (ch.on as { mock: { calls: unknown[][] } }).mock.calls.some(
      (call) => call[0] === "pointerdown",
    ),
  );
  return { children, hit };
}

describe("PlanetManager.createStations — sprite-or-diamond render", () => {
  beforeEach(() => {
    pixi.sprites.length = 0;
    pixi.graphics.length = 0;
    art.stationSpriteKey.mockReset();
    art.tex.mockReset();
  });

  it("draws an 80×80 non-interactive Sprite when art resolves to a cached texture", () => {
    art.stationSpriteKey.mockReturnValue("station/trade_01");
    const fakeTexture = { __station: true };
    art.tex.mockReturnValue(fakeTexture);

    const { manager, gameLayer } = makeHarness();
    manager.initialize();

    // The resolver was consulted with this station's type + id; the resolved
    // key was looked up in the texture cache.
    expect(art.stationSpriteKey).toHaveBeenCalledWith(
      StationType.TRADE_POST,
      STATION.id,
    );
    expect(art.tex).toHaveBeenCalledWith("station/trade_01");

    // Exactly one Sprite, sized 80×80, anchored centre, click-transparent.
    expect(pixi.sprites.length).toBe(1);
    const sprite = pixi.sprites[0];
    expect(
      (sprite.anchor as { set: ReturnType<typeof vi.fn> }).set,
    ).toHaveBeenCalledWith(0.5);
    expect(sprite.width).toBe(80);
    expect(sprite.height).toBe(80);
    expect(sprite.eventMode).toBe("none");

    // No diamond was drawn (no Graphics had its `poly` called).
    expect(
      pixi.graphics.some(
        (g) => (g.poly as ReturnType<typeof vi.fn>).mock.calls.length > 0,
      ),
    ).toBe(false);

    assertMarkerWiring(manager, gameLayer);
  });

  it("falls back to the colour-coded diamond when the key resolves but is not cached", () => {
    // Sprite key present, but texture not yet preloaded → diamond, no async.
    art.stationSpriteKey.mockReturnValue("station/trade_01");
    art.tex.mockReturnValue(undefined);

    const { manager, gameLayer } = makeHarness();
    manager.initialize();

    expect(pixi.sprites.length).toBe(0);
    // Exactly one diamond Graphics (the other Graphics is the hit-area).
    expect(
      pixi.graphics.filter(
        (g) => (g.poly as ReturnType<typeof vi.fn>).mock.calls.length > 0,
      ).length,
    ).toBe(1);

    assertMarkerWiring(manager, gameLayer);
  });

  it("falls back to the diamond when no station art is committed (resolver → null)", () => {
    art.stationSpriteKey.mockReturnValue(null);

    const { manager, gameLayer } = makeHarness();
    manager.initialize();

    // No art key resolved → the texture cache is never consulted.
    expect(art.tex).not.toHaveBeenCalled();
    expect(pixi.sprites.length).toBe(0);
    expect(
      pixi.graphics.filter(
        (g) => (g.poly as ReturnType<typeof vi.fn>).mock.calls.length > 0,
      ).length,
    ).toBe(1);

    assertMarkerWiring(manager, gameLayer);
  });
});

/**
 * Both render paths must preserve the marker bookkeeping that docking/route
 * planning depend on: a name label, a working `static` hit-area that fires
 * `onStationClick`, the zIndex-90 container, and a `getStationAt`-findable entry.
 */
function assertMarkerWiring(
  manager: PlanetManager,
  gameLayer: { addChild: ReturnType<typeof vi.fn> },
): void {
  // One marker recorded, locatable by world position (docking range = 50px).
  expect(manager.stationMarkers.length).toBe(1);
  const marker = manager.stationMarkers[0] as StationMarker;
  expect(marker.station.id).toBe(STATION.id);
  expect(marker.x).toBeCloseTo(STATION_X, 3);
  expect(marker.y).toBeCloseTo(STATION_Y, 3);
  expect(marker.label).toBeTruthy();

  const found = manager.getStationAt(STATION_X, STATION_Y);
  expect(found?.station.id).toBe(STATION.id);
  expect(manager.getStationAt(5000, 5000)).toBeNull();

  // The hit-area is a `static`, click-transparent geometry whose pointerdown
  // routes through onStationClick → onStationDock(stationId).
  const ctn = stationContainer(gameLayer);
  expect(ctn.zIndex).toBe(90);
  const { hit } = childrenOf(ctn);
  expect(hit, "interactive hit-area present").toBeTruthy();
  expect((hit as Record<string, unknown>).eventMode).toBe("static");

  const dock = vi.fn();
  manager.onStationDock = dock;
  const stop = vi.fn();
  const handler = (
    (hit as { on: { mock: { calls: unknown[][] } } }).on.mock.calls.find(
      (call) => call[0] === "pointerdown",
    ) as unknown[]
  )[1] as (e: { stopPropagation: () => void }) => void;
  handler({ stopPropagation: stop });
  expect(stop).toHaveBeenCalled();
  expect(dock).toHaveBeenCalledWith(STATION.id);
}
