/**
 * Task 1 (docs/plans/20260619-keyboard-controls-turn-modals-map-jump.md):
 * "Space runs the planned turn in flight."
 *
 * Flight movement is two-step: click to plan a route, then act again to execute
 * it. Pressing Space is the keyboard equivalent of that confirming second click
 * — it executes the currently planned route (launches the turn) so the player
 * needn't click the target again. With no route planned Space is a no-op and
 * shows a "проложите маршрут" hint. It is guarded so a held key (auto-repeat),
 * a combat pause, or an already-running turn can't re-fire executeRouteTo.
 *
 * The handler is exercised by dispatching a KeyboardEvent at the bound
 * `onKeyDown` (mirrors waitTurnPause.test.ts's scene harness). The existing
 * Esc / i / j behaviours must be unaffected by the new Space branch.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock pixi.js + presentation helpers so SpaceFlightScene constructs in jsdom
// (mirrors waitTurnPause.test.ts).
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
  PlanetSprite: vi.fn().mockImplementation(() => ({})),
}));
vi.mock("@/presentation/PlanetInfoPanel", () => ({
  PlanetInfoPanel: vi.fn().mockImplementation(() => ({ destroy: vi.fn() })),
}));
vi.mock("@/presentation/SystemMiniMap", () => ({
  SystemMiniMap: vi.fn().mockImplementation(() => ({ destroy: vi.fn() })),
}));
vi.mock("@/presentation/QuestJournalUI", () => ({
  QuestJournalUI: vi.fn().mockImplementation(() => ({ destroy: vi.fn() })),
}));
vi.mock("@/presentation/NpcShipSprite", () => ({
  NpcShipSprite: vi.fn().mockImplementation(() => ({})),
}));
vi.mock("@/presentation/NpcContactPanel", () => ({
  NpcContactPanel: vi.fn().mockImplementation(() => ({ destroy: vi.fn() })),
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
        getBoundingClientRect: vi
          .fn()
          .mockReturnValue({ left: 0, top: 0, width: 800, height: 600 }),
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

describe("Space runs the planned turn in flight", () => {
  let scene: SpaceFlightScene;
  let s: Record<string, unknown>;
  let executeRouteTo: ReturnType<typeof vi.fn>;
  let showMessage: ReturnType<typeof vi.fn>;
  let toggleQuestJournal: ReturnType<typeof vi.fn>;
  let openInventory: ReturnType<typeof vi.fn>;

  const onKeyDown = (e: KeyboardEvent) =>
    (scene as unknown as { onKeyDown(e: KeyboardEvent): void }).onKeyDown(e);
  const press = (init: KeyboardEventInit) =>
    onKeyDown(new KeyboardEvent("keydown", init));

  beforeEach(() => {
    scene = new SpaceFlightScene(makeMockRenderer());
    s = scene as unknown as Record<string, unknown>;
    executeRouteTo = vi.fn();
    showMessage = vi.fn();
    toggleQuestJournal = vi.fn();
    openInventory = vi.fn();
    s.executeRouteTo = executeRouteTo;
    s.openInventory = openInventory;
    s.clearPlannedRoute = vi.fn();
    s.hud = {
      showMessage,
      toggleQuestJournal,
      isQuestJournalOpen: () => false,
      closeQuestJournal: vi.fn(),
      isSettingsPanelOpen: () => false,
    };
    s.npcManager = {
      isContactPanelOpen: false,
      closeContactPanel: vi.fn(),
    };
    s.planetManager = { hasInfoPanel: false, closeInfoPanel: vi.fn() };
    // combatPause is created by the constructor; default state is not paused.
    s.isTurnRunning = false;
    s.plannedRoute = null;
  });

  it("executes the planned route exactly once on Space", () => {
    s.plannedRoute = { x: 120, y: -45 };

    press({ key: " " });

    expect(executeRouteTo).toHaveBeenCalledTimes(1);
    expect(executeRouteTo).toHaveBeenCalledWith(120, -45);
    expect(showMessage).not.toHaveBeenCalled();
  });

  it("also recognises Space via event.code", () => {
    s.plannedRoute = { x: 10, y: 20 };

    press({ code: "Space" });

    expect(executeRouteTo).toHaveBeenCalledTimes(1);
    expect(executeRouteTo).toHaveBeenCalledWith(10, 20);
  });

  it("is a no-op with a hint when no route is planned", () => {
    s.plannedRoute = null;

    press({ key: " " });

    expect(executeRouteTo).not.toHaveBeenCalled();
    expect(showMessage).toHaveBeenCalledTimes(1); // "проложите маршрут" hint
  });

  it("does not double-fire on a held key (auto-repeat)", () => {
    s.plannedRoute = { x: 1, y: 2 };

    press({ key: " " }); // initial keydown executes
    press({ key: " ", repeat: true }); // OS auto-repeat must be ignored
    press({ key: " ", repeat: true });

    expect(executeRouteTo).toHaveBeenCalledTimes(1);
  });

  it("ignores Space while a turn is already running (execute-only, not pause)", () => {
    s.plannedRoute = { x: 5, y: 5 };
    s.isTurnRunning = true;

    press({ key: " " });

    expect(executeRouteTo).not.toHaveBeenCalled();
  });

  it("ignores Space while combat is paused", () => {
    s.plannedRoute = { x: 5, y: 5 };
    s.combatPause = { paused: true, resume: vi.fn() };

    press({ key: " " });

    expect(executeRouteTo).not.toHaveBeenCalled();
  });

  it("leaves the existing Esc handling intact (cancels a planned route)", () => {
    s.plannedRoute = { x: 9, y: 9 };

    press({ key: "Escape" });

    expect(s.clearPlannedRoute).toHaveBeenCalledTimes(1);
    expect(showMessage).toHaveBeenCalledWith("Маршрут отменён", 0xffaa00);
    expect(executeRouteTo).not.toHaveBeenCalled();
  });

  it("leaves the existing j / i handling intact", () => {
    press({ key: "j" });
    expect(toggleQuestJournal).toHaveBeenCalledTimes(1);

    press({ key: "i" });
    expect(openInventory).toHaveBeenCalledTimes(1);

    expect(executeRouteTo).not.toHaveBeenCalled();
  });
});
