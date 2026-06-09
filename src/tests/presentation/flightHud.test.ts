/**
 * Task 10 (SOLID refactor): FlightHud owns the in-flight HUD (turn/speed/settings
 * buttons, day counter, mini-map, mini-log, toasts and tooltips) extracted from
 * SpaceFlightScene. These exercise the module directly with mocked pixi.js +
 * UiButton/SystemMiniMap/QuestJournalUI so no WebGL/texture context is needed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("pixi.js", () => {
  const makeContainer = () => {
    const node: Record<string, unknown> = {
      children: [] as unknown[],
      eventMode: "auto",
      cursor: "pointer",
      alpha: 1,
      x: 0,
      y: 0,
      anchor: { set: vi.fn() },
      text: "",
      width: 50,
      style: {},
      on: vi.fn(),
      destroy: vi.fn(),
    };
    node.addChild = vi.fn((c: unknown) => {
      (node.children as unknown[]).push(c);
      return c;
    });
    node.removeChild = vi.fn();
    return node;
  };
  return {
    Container: vi.fn().mockImplementation(makeContainer),
    Graphics: vi.fn().mockImplementation(() => ({
      ...makeContainer(),
      roundRect: vi.fn().mockReturnThis(),
      circle: vi.fn().mockReturnThis(),
      fill: vi.fn().mockReturnThis(),
      stroke: vi.fn().mockReturnThis(),
    })),
    Text: vi.fn().mockImplementation(() => makeContainer()),
  };
});

vi.mock("@/presentation/ui/UiButton", () => ({
  UiButton: vi
    .fn()
    .mockImplementation(
      (
        icon: string,
        label: string,
        accent: unknown,
        onClick: (e: { stopPropagation: () => void }) => void,
      ) => ({
        icon,
        label,
        accent,
        onClick,
        x: 0,
        y: 0,
        container: {
          cursor: "pointer",
          children: [],
          addChild: vi.fn(),
          on: vi.fn(),
        },
        setLabel: vi.fn(),
        setAccentColor: vi.fn(),
        on: vi.fn(),
      }),
    ),
}));

vi.mock("@/presentation/SystemMiniMap", () => ({
  SystemMiniMap: vi.fn().mockImplementation(() => ({
    container: { addChild: vi.fn() },
    setPanHandler: vi.fn(),
    setReturnCameraHandler: vi.fn(),
    reposition: vi.fn(),
    updateWithSprites: vi.fn(),
    updateCenterButton: vi.fn(),
    destroy: vi.fn(),
  })),
}));

vi.mock("@/presentation/QuestJournalUI", () => ({
  QuestJournalUI: vi.fn().mockImplementation((_qm, _w, _h, _onClose) => ({
    container: { visible: true, addChild: vi.fn() },
    destroy: vi.fn(),
  })),
}));

import { FlightHud } from "@/presentation/flight/FlightHud";
import { UiButton } from "@/presentation/ui/UiButton";
import type { Renderer } from "@/presentation/Renderer";
import type { GameEngine } from "@/systems/GameEngine";

type Layer = {
  addChild: ReturnType<typeof vi.fn>;
  removeChild: ReturnType<typeof vi.fn>;
  children: unknown[];
};

function makeMockRenderer(): { renderer: Renderer; uiLayer: Layer } {
  const uiLayer: Layer = {
    children: [],
    addChild: vi.fn((c: unknown) => {
      uiLayer.children.push(c);
      return c;
    }),
    removeChild: vi.fn(),
  };
  const renderer = {
    app: { screen: { width: 800, height: 600 } },
    uiLayer,
  } as unknown as Renderer;
  return { renderer, uiLayer };
}

function makeGameEngine(): GameEngine {
  return {
    audio: {
      playUiClick: vi.fn(),
      playUiHover: vi.fn(),
      playToast: vi.fn(),
    },
    galaxy: { gameDays: 0 },
    questManager: {},
  } as unknown as GameEngine;
}

/** Find a created UiButton mock instance by its constructor label. */
function findButton(label: string): { onClick: (e: unknown) => void } {
  const mock = vi.mocked(UiButton);
  const hit = mock.mock.results.find(
    (r) => (r.value as { label: string }).label === label,
  );
  return hit!.value as { onClick: (e: unknown) => void } & {
    setLabel: ReturnType<typeof vi.fn>;
  };
}

describe("FlightHud", () => {
  let hud: FlightHud;
  let uiLayer: Layer;

  beforeEach(() => {
    vi.clearAllMocks();
    const m = makeMockRenderer();
    uiLayer = m.uiLayer;
    hud = new FlightHud(m.renderer, makeGameEngine(), m.renderer.uiLayer);
  });

  it("builds the HUD: a populated container + Play button + mini-map", () => {
    expect(hud.miniMap).toBeNull();
    hud.initialize();

    // The UI container is the first thing mounted on the UI layer, and it holds
    // the instruction text, date, quest/back buttons and the Play button.
    expect(uiLayer.addChild).toHaveBeenCalled();
    const uiContainer = uiLayer.addChild.mock.calls[0][0] as {
      children: unknown[];
    };
    expect(uiContainer.children.length).toBeGreaterThan(0);

    // The Play/Pause button was created.
    expect(findButton("▶ ХОД")).toBeDefined();
    // The radar object now exists and is exposed for the scene's refresh.
    expect(hud.miniMap).not.toBeNull();
  });

  it("fans the Play button press out to onPlayPause", () => {
    hud.initialize();
    const onPlayPause = vi.fn();
    hud.onPlayPause = onPlayPause;
    findButton("▶ ХОД").onClick({ stopPropagation: vi.fn() });
    expect(onPlayPause).toHaveBeenCalledTimes(1);
  });

  it("setTurnRunning flips the Play/Pause label", () => {
    hud.initialize();
    const play = findButton("▶ ХОД") as unknown as {
      setLabel: ReturnType<typeof vi.fn>;
    };
    hud.setTurnRunning(true);
    expect(play.setLabel).toHaveBeenCalledWith("⏸ ПАУЗА");
    hud.setTurnRunning(false);
    expect(play.setLabel).toHaveBeenCalledWith("▶ ХОД");
  });

  it("showMessage mounts a toast and never throws", () => {
    hud.initialize();
    const before = uiLayer.addChild.mock.calls.length;
    expect(() => hud.showMessage("привет", 0x00ff00)).not.toThrow();
    expect(uiLayer.addChild.mock.calls.length).toBeGreaterThan(before);
  });

  it("toggles the quest journal open and closed", () => {
    hud.initialize();
    expect(hud.isQuestJournalOpen()).toBe(false);
    hud.toggleQuestJournal();
    expect(hud.isQuestJournalOpen()).toBe(true);
    hud.toggleQuestJournal();
    expect(hud.isQuestJournalOpen()).toBe(false);
  });

  it("update() and destroy() run cleanly; destroy clears the mini-map", () => {
    hud.initialize();
    expect(() => hud.update(1 / 60, 100)).not.toThrow();
    hud.destroy();
    expect(hud.miniMap).toBeNull();
    expect(hud.isQuestJournalOpen()).toBe(false);
    expect(hud.isSettingsPanelOpen()).toBe(false);
  });
});
