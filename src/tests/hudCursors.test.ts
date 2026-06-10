/**
 * Sprint 3 Task 3: pointer cursor on all interactive elements.
 *
 * The HUD buttons (Ход/Pause, quest, star map) must keep their "pointer" cursor
 * at all times. updateInteractiveCursors() drives the planet / NPC hover cursors
 * during a turn, and must NEVER touch the HUD buttons — so the Ход button stays
 * clickable-looking even while a turn is running.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  NpcShipManager,
  type NpcShipManagerDeps,
} from "@/presentation/flight/NpcShipManager";
import {
  PlanetManager,
  type PlanetManagerDeps,
} from "@/presentation/flight/PlanetManager";

// Mirror the pixi.js + presentation mocks from playPauseImmediate.test.ts so the
// SpaceFlightScene can be constructed in jsdom without a real renderer.
vi.mock("pixi.js", () => {
  const makeContainer = () => ({
    addChild: vi.fn(),
    addChildAt: vi.fn(),
    removeChild: vi.fn(),
    children: [],
    eventMode: "auto",
    cursor: "pointer",
    sortableChildren: false,
    x: 0,
    y: 0,
    alpha: 1,
    zIndex: 0,
    scale: { set: vi.fn() },
    filters: [],
    hitArea: null,
    on: vi.fn(),
    off: vi.fn(),
    destroy: vi.fn(),
  });
  return {
    Container: vi.fn().mockImplementation(makeContainer),
    Graphics: vi.fn().mockImplementation(() => ({
      ...makeContainer(),
      fill: vi.fn().mockReturnThis(),
      rect: vi.fn().mockReturnThis(),
      circle: vi.fn().mockReturnThis(),
      ellipse: vi.fn().mockReturnThis(),
      stroke: vi.fn().mockReturnThis(),
      poly: vi.fn().mockReturnThis(),
      moveTo: vi.fn().mockReturnThis(),
      lineTo: vi.fn().mockReturnThis(),
      clear: vi.fn().mockReturnThis(),
      mask: null,
    })),
    Text: vi.fn().mockImplementation(() => ({
      ...makeContainer(),
      anchor: { set: vi.fn() },
      text: "",
      style: { fill: 0, fontFamily: "", fontSize: 12 },
      width: 100,
      height: 20,
    })),
    Sprite: vi.fn().mockImplementation(() => ({
      ...makeContainer(),
      anchor: { set: vi.fn() },
      width: 0,
      height: 0,
      tint: 0xffffff,
      mask: null,
      texture: {},
    })),
    TilingSprite: vi.fn().mockImplementation(() => ({
      ...makeContainer(),
      tileScale: { set: vi.fn() },
      tilePosition: { x: 0, y: 0 },
      tint: 0xffffff,
      mask: null,
    })),
    BlurFilter: vi.fn().mockImplementation(() => ({
      strength: 0,
      padding: 0,
      resolution: 1,
    })),
    Circle: vi.fn().mockImplementation((x: number, y: number, r: number) => ({
      x,
      y,
      radius: r,
    })),
  };
});

vi.mock("@/presentation/sphereMesh", () => ({
  buildSphereMesh: vi.fn().mockReturnValue(null),
}));

vi.mock("@/presentation/PlanetSprite", () => ({
  PlanetSprite: vi.fn(),
}));

vi.mock("@/presentation/PlanetInfoPanel", () => ({
  PlanetInfoPanel: vi.fn(),
}));

vi.mock("@/presentation/SystemMiniMap", () => ({
  SystemMiniMap: vi.fn(),
}));

vi.mock("@/presentation/QuestJournalUI", () => ({
  QuestJournalUI: vi.fn(),
}));

vi.mock("@/presentation/NpcShipSprite", () => ({
  NpcShipSprite: vi.fn(),
}));

vi.mock("@/presentation/NpcContactPanel", () => ({
  NpcContactPanel: vi.fn(),
}));

vi.mock("@/presentation/textures", () => ({
  pickVariant: vi.fn().mockReturnValue(null),
  pickVariantKey: vi.fn().mockReturnValue(null),
  loadTextureAsync: vi.fn().mockResolvedValue(null),
  tex: vi.fn().mockReturnValue(null),
}));

vi.mock("@/presentation/cursor", () => ({
  installGameCursors: vi.fn(),
  setCanvasCursor: vi.fn(),
}));

import { SpaceFlightScene } from "@/presentation/SpaceFlightScene";
import type { Renderer } from "@/presentation/Renderer";
import { NpcRole } from "@/types";

function makeMockRenderer(): Renderer {
  const makeLayer = () => ({
    addChild: vi.fn(),
    addChildAt: vi.fn(),
    removeChild: vi.fn(),
    children: [],
    eventMode: "auto",
    sortableChildren: false,
    scale: { set: vi.fn() },
    x: 0,
    y: 0,
  });
  return {
    app: {
      screen: { width: 800, height: 600 },
      canvas: Object.assign(document.createElement("canvas"), {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        getBoundingClientRect: vi.fn().mockReturnValue({
          left: 0,
          top: 0,
          width: 800,
          height: 600,
        }),
        style: {},
      }),
      stage: {
        eventMode: "static",
        hitArea: null,
        addChild: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
      },
    },
    gameLayer: makeLayer(),
    uiLayer: makeLayer(),
    stage: { addChild: vi.fn(), addChildAt: vi.fn() },
    clearGameLayer: vi.fn(),
    clearUILayer: vi.fn(),
  } as unknown as Renderer;
}

interface CursorHost {
  cursor: string;
}

describe("hudCursors: HUD buttons keep their pointer cursor across turns", () => {
  let scene: SpaceFlightScene;
  let s: Record<string, unknown>;
  let planet: { graphics: CursorHost };
  type NpcStub = {
    container: CursorHost;
    npc: { role: NpcRole };
    restoreInteractivity: () => void;
  };
  let pirate: NpcStub;
  let trader: NpcStub;
  let playBtnContainer: CursorHost;

  beforeEach(() => {
    const renderer = makeMockRenderer();
    scene = new SpaceFlightScene(renderer);
    s = scene as unknown as Record<string, unknown>;

    planet = { graphics: { cursor: "pointer" } };
    pirate = {
      container: { cursor: "target" },
      npc: { role: NpcRole.PIRATE },
      restoreInteractivity: () => {},
    };
    trader = {
      container: { cursor: "pointer" },
      npc: { role: NpcRole.TRADER },
      restoreInteractivity: () => {},
    };
    // Sentinel value that nothing in updateInteractiveCursors should ever
    // write: if the HUD button were swept into the planet/NPC cursor loop, this
    // would flip to "default"/"pointer" and the assertions below would bite.
    playBtnContainer = { cursor: "__sentinel__" };

    // NPC cursors are owned by the NPC module now — inject a real manager
    // holding the pirate/trader stubs so updateInteractiveCursors() delegates to
    // its setCursors() exactly as it does in the live scene.
    const deps: NpcShipManagerDeps = {
      getShipPhysics: () => null,
      getPlanetSprites: () => [],
      getStarCenter: () => ({ x: 0, y: 0 }),
      isTurnRunning: () => false,
      showMessage: () => {},
      showTooltip: () => {},
      hideTooltip: () => {},
      executeRouteTo: () => {},
      clearRouteTarget: () => {},
      endTurn: () => {},
    };
    const mgr = new NpcShipManager(
      renderer,
      null,
      renderer.gameLayer,
      renderer.uiLayer,
      deps,
    );
    (mgr as unknown as { npcSprites: unknown[] }).npcSprites = [pirate, trader];

    // Planet cursors are owned by the PlanetManager module now — inject a real
    // manager holding the planet stub so updateInteractiveCursors() delegates to
    // its setCursors() exactly as it does in the live scene.
    const planetDeps: PlanetManagerDeps = {
      getShipPhysics: () => null,
      getStarCenter: () => ({ x: 0, y: 0 }),
      isTurnRunning: () => false,
      getOrbitalDay: () => 0,
      showPlanetTooltip: () => {},
      hideTooltip: () => {},
      clearFollow: () => {},
    };
    const planetMgr = new PlanetManager(
      renderer,
      null,
      renderer.gameLayer,
      renderer.uiLayer,
      planetDeps,
    );
    (planetMgr as unknown as { planetSprites: unknown[] }).planetSprites = [
      planet,
    ];
    s.planetManager = planetMgr;
    s.npcManager = mgr;
    s.playPauseButton = { container: playBtnContainer };
  });

  function updateInteractiveCursors(turnRunning: boolean): void {
    (
      scene as unknown as {
        updateInteractiveCursors(turnRunning: boolean): void;
      }
    ).updateInteractiveCursors(turnRunning);
  }

  it("does not touch the Ход/Pause button when a turn starts running", () => {
    updateInteractiveCursors(true);

    // Planet + NPC hover cursors are suppressed mid-turn...
    expect(planet.graphics.cursor).toBe("default");
    expect(pirate.container.cursor).toBe("default");
    expect(trader.container.cursor).toBe("default");

    // ...but the HUD play button is never written to (cursor untouched).
    expect(playBtnContainer.cursor).toBe("__sentinel__");
  });

  it("restores intent cursors when the turn ends (pirate=target, trader=pointer)", () => {
    updateInteractiveCursors(true);
    updateInteractiveCursors(false);

    expect(planet.graphics.cursor).toBe("pointer");
    expect(pirate.container.cursor).toBe("target");
    expect(trader.container.cursor).toBe("pointer");
    // HUD button still never touched across the full turn-start/turn-end cycle.
    expect(playBtnContainer.cursor).toBe("__sentinel__");
  });
});
