import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("pixi.js", () => {
  const makeContainer = () => ({
    addChild: vi.fn(),
    addChildAt: vi.fn(),
    removeChild: vi.fn(),
    children: [],
    eventMode: "auto",
    cursor: "pointer",
    sortableChildren: false,
    visible: true,
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
vi.mock("@/presentation/PlanetSprite", () => ({ PlanetSprite: vi.fn() }));
vi.mock("@/presentation/PlanetInfoPanel", () => ({ PlanetInfoPanel: vi.fn() }));
vi.mock("@/presentation/SystemMiniMap", () => ({ SystemMiniMap: vi.fn() }));
vi.mock("@/presentation/QuestJournalUI", () => ({ QuestJournalUI: vi.fn() }));
vi.mock("@/presentation/NpcShipSprite", () => ({ NpcShipSprite: vi.fn() }));
vi.mock("@/presentation/NpcContactPanel", () => ({ NpcContactPanel: vi.fn() }));
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

describe("SpaceFlightScene e2e* driver methods (Task 3)", () => {
  let scene: SpaceFlightScene;
  let s: Record<string, unknown>;
  let handlePlanetClick: ReturnType<typeof vi.fn>;
  let e2eClickNpc: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    scene = new SpaceFlightScene(makeMockRenderer());
    s = scene as unknown as Record<string, unknown>;

    handlePlanetClick = vi.fn();
    e2eClickNpc = vi.fn();

    s.planetManager = {
      planetSprites: [
        { planet: { id: "p0", name: "Alpha" } },
        { planet: { id: "p1", name: "Beta" } },
      ],
      handlePlanetClick,
    };
    s.npcManager = { npcCount: 3, e2eClickNpc };
    s.shipPhysics = { isMoving: false };
    s.gameEngine = { galaxy: { gameDays: 7 } };
  });

  it("e2eGetSceneState reflects the live module state", () => {
    const state = scene.e2eGetSceneState();
    expect(state).toEqual({
      planetsCount: 2,
      npcsCount: 3,
      isFlying: false,
      turnNumber: 7,
    });
  });

  it("e2eGetSceneState reports motion when the ship is moving", () => {
    (s.shipPhysics as { isMoving: boolean }).isMoving = true;
    expect(scene.e2eGetSceneState().isFlying).toBe(true);
  });

  it("e2eClickPlanet forwards the planet at the index to handlePlanetClick", () => {
    scene.e2eClickPlanet(1);
    expect(handlePlanetClick).toHaveBeenCalledTimes(1);
    expect(handlePlanetClick).toHaveBeenCalledWith({ id: "p1", name: "Beta" });
  });

  it("e2eClickPlanet is a no-op for an out-of-range index", () => {
    expect(() => scene.e2eClickPlanet(99)).not.toThrow();
    expect(handlePlanetClick).not.toHaveBeenCalled();
  });

  it("e2eClickNpc forwards the index to the NPC module", () => {
    scene.e2eClickNpc(2);
    expect(e2eClickNpc).toHaveBeenCalledWith(2);
  });

  it("e2eSetBackgroundVisible toggles sky + background layers", () => {
    const sky = { visible: true };
    const setVisible = vi.fn();
    s.skyContainer = sky;
    s.background = { setVisible };

    scene.e2eSetBackgroundVisible(false);
    expect(sky.visible).toBe(false);
    expect(setVisible).toHaveBeenCalledWith(false);

    scene.e2eSetBackgroundVisible(true);
    expect(sky.visible).toBe(true);
    expect(setVisible).toHaveBeenLastCalledWith(true);
  });

  it("e2eStartTurn calls onPlayPause only when no turn is running", () => {
    const onPlayPause = vi.fn();
    s.onPlayPause = onPlayPause;

    s.isTurnRunning = false;
    scene.e2eStartTurn();
    expect(onPlayPause).toHaveBeenCalledTimes(1);

    s.isTurnRunning = true;
    scene.e2eStartTurn();
    expect(onPlayPause).toHaveBeenCalledTimes(1); // not called again
  });

  it("e2ePressPause calls onPlayPause only while a turn is running", () => {
    const onPlayPause = vi.fn();
    s.onPlayPause = onPlayPause;

    s.isTurnRunning = false;
    scene.e2ePressPause();
    expect(onPlayPause).not.toHaveBeenCalled();

    s.isTurnRunning = true;
    scene.e2ePressPause();
    expect(onPlayPause).toHaveBeenCalledTimes(1);
  });

  it("read/click/background driver methods no-op safely on a bare scene", () => {
    const bare = new SpaceFlightScene(makeMockRenderer());
    expect(() => {
      const state = bare.e2eGetSceneState();
      expect(state.planetsCount).toBe(0);
      expect(state.npcsCount).toBe(0);
      bare.e2eClickPlanet(0);
      bare.e2eClickNpc(0);
      bare.e2eSetBackgroundVisible(false);
      bare.e2ePressPause();
    }).not.toThrow();
  });
});
