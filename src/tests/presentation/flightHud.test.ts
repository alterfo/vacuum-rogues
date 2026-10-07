import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("pixi.js", () => {
  const makeContainer = () => {
    const anchor = {
      x: 0,
      y: 0,
      set(ax: number, ay?: number) {
        anchor.x = ax;
        anchor.y = ay ?? ax;
      },
    };
    const node: Record<string, unknown> = {
      children: [] as unknown[],
      eventMode: "auto",
      cursor: "pointer",
      alpha: 1,
      x: 0,
      y: 0,
      anchor,
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
      rect: vi.fn().mockReturnThis(),
      roundRect: vi.fn().mockReturnThis(),
      circle: vi.fn().mockReturnThis(),
      poly: vi.fn().mockReturnThis(),
      fill: vi.fn().mockReturnThis(),
      stroke: vi.fn().mockReturnThis(),
    })),
    Text: vi
      .fn()
      .mockImplementation(
        (opts?: { text?: unknown; style?: { fontSize?: number } }) => {
          const node = makeContainer();
          node.text = opts?.text != null ? String(opts.text) : "";
          node.style = opts?.style ?? {};
          const fontSize = () =>
            (node.style as { fontSize?: number }).fontSize ?? 12;
          Object.defineProperty(node, "width", {
            get: () => String(node.text).length * fontSize() * 0.6,
          });
          Object.defineProperty(node, "height", {
            get: () => fontSize() * 1.2,
          });
          return node;
        },
      ),
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

vi.mock("@/presentation/QuestJournalUI", () => ({
  QuestJournalUI: vi.fn().mockImplementation((_qm, _w, _h, _onClose) => ({
    container: { visible: true, addChild: vi.fn() },
    destroy: vi.fn(),
  })),
}));

import { Text } from "pixi.js";
import { FlightHud } from "@/presentation/flight/FlightHud";
import { UiButton } from "@/presentation/ui/UiButton";
import type { Renderer } from "@/presentation/Renderer";
import type { GameEngine } from "@/systems/GameEngine";

type Layer = {
  addChild: ReturnType<typeof vi.fn>;
  removeChild: ReturnType<typeof vi.fn>;
  children: unknown[];
};

function makeMockRenderer(
  width = 800,
  height = 600,
): { renderer: Renderer; uiLayer: Layer } {
  const uiLayer: Layer = {
    children: [],
    addChild: vi.fn((c: unknown) => {
      uiLayer.children.push(c);
      return c;
    }),
    removeChild: vi.fn(),
  };
  const renderer = {
    app: { screen: { width, height } },
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
    gameSpeedMultiplier: 1,
  } as unknown as GameEngine;
}

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

    expect(uiLayer.addChild).toHaveBeenCalled();
    const uiContainer = uiLayer.addChild.mock.calls[0][0] as {
      children: unknown[];
    };
    expect(uiContainer.children.length).toBeGreaterThan(0);

    expect(findButton("▶ ХОД")).toBeDefined();
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

  it("setMiniLogVisible hides and restores the bottom-left log so it cannot sit under the planning buttons", () => {
    hud.initialize();
    const log = (hud as unknown as { miniLogContainer: { visible: boolean } })
      .miniLogContainer;
    hud.setMiniLogVisible(false);
    expect(log.visible).toBe(false);
    hud.setMiniLogVisible(true);
    expect(log.visible).toBe(true);
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
  });
});

describe("FlightHud game-speed persistence (playtest3 F3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("cycling persists the multiplier on the GameEngine and pushes it to physics", () => {
    const m = makeMockRenderer();
    const engine = makeGameEngine();
    const hud = new FlightHud(m.renderer, engine, m.renderer.uiLayer);
    const onSpeedCycle = vi.fn();
    hud.onSpeedCycle = onSpeedCycle;
    hud.initialize();

    findButton("1×").onClick({ stopPropagation: vi.fn() });
    expect(engine.gameSpeedMultiplier).toBe(2);
    expect(onSpeedCycle).toHaveBeenLastCalledWith(2);
  });

  it("restores the persisted multiplier when the HUD is (re)built", () => {
    const m = makeMockRenderer();
    const engine = makeGameEngine();
    engine.gameSpeedMultiplier = 4; // chosen before a land/take-off
    const hud = new FlightHud(m.renderer, engine, m.renderer.uiLayer);
    const onSpeedCycle = vi.fn();
    hud.onSpeedCycle = onSpeedCycle;
    hud.initialize();

    const speed = findButton("1×") as unknown as {
      setLabel: ReturnType<typeof vi.fn>;
    };
    expect(speed.setLabel).toHaveBeenCalledWith("4×");
    expect(onSpeedCycle).toHaveBeenCalledWith(4);
  });

  it("survives a full HUD rebuild round-trip (x4 chosen, kept after re-init)", () => {
    const engine = makeGameEngine();

    const m1 = makeMockRenderer();
    const hud1 = new FlightHud(m1.renderer, engine, m1.renderer.uiLayer);
    hud1.onSpeedCycle = vi.fn();
    hud1.initialize();
    findButton("1×").onClick({ stopPropagation: vi.fn() }); // → 2×
    findButton("1×").onClick({ stopPropagation: vi.fn() }); // → 4×
    expect(engine.gameSpeedMultiplier).toBe(4);

    const m2 = makeMockRenderer();
    const hud2 = new FlightHud(m2.renderer, engine, m2.renderer.uiLayer);
    const onSpeedCycle2 = vi.fn();
    hud2.onSpeedCycle = onSpeedCycle2;
    hud2.initialize();

    expect(onSpeedCycle2).toHaveBeenCalledWith(4);
    expect(engine.gameSpeedMultiplier).toBe(4);
  });

  it("falls back to 1× for an unknown persisted multiplier", () => {
    const m = makeMockRenderer();
    const engine = makeGameEngine();
    engine.gameSpeedMultiplier = 3.7; // not a valid step
    const hud = new FlightHud(m.renderer, engine, m.renderer.uiLayer);
    hud.initialize();

    const speed = findButton("1×") as unknown as {
      setLabel: ReturnType<typeof vi.fn>;
    };
    expect(speed.setLabel).toHaveBeenCalledWith("1×");
    expect(engine.gameSpeedMultiplier).toBe(1);
  });
});

describe("FlightHud settings panel relocated to the main menu (Task 8)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not mount a ⚙ gear button (settings moved to the main menu)", () => {
    const m = makeMockRenderer();
    const hud = new FlightHud(m.renderer, makeGameEngine(), m.renderer.uiLayer);
    hud.initialize();
    const icons = vi.mocked(UiButton).mock.calls.map((c) => c[0]);
    expect(icons).not.toContain("⚙");
  });

  it("exposes no toggleSettingsPanel method", () => {
    const m = makeMockRenderer();
    const hud = new FlightHud(m.renderer, makeGameEngine(), m.renderer.uiLayer);
    expect(
      (hud as unknown as { toggleSettingsPanel?: unknown }).toggleSettingsPanel,
    ).toBeUndefined();
  });
});

describe("FlightHud help overlay and inventory button (Task 6)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normal HUD state contains no 'ЛКМ', 'Shift', or 'Колесико' text", () => {
    const m = makeMockRenderer();
    const hud = new FlightHud(m.renderer, makeGameEngine(), m.renderer.uiLayer);
    hud.initialize();
    const allTexts = vi
      .mocked(Text)
      .mock.results.map((r) => String((r.value as { text: string }).text));
    const hasHints = allTexts.some(
      (t) => t.includes("ЛКМ") || t.includes("Shift") || t.includes("Колесико"),
    );
    expect(hasHints).toBe(false);
  });

  it("toggleHelpOverlay opens and closes the help overlay", () => {
    const m = makeMockRenderer();
    const hud = new FlightHud(m.renderer, makeGameEngine(), m.renderer.uiLayer);
    hud.initialize();
    expect(hud.isHelpOverlayOpen()).toBe(false);
    hud.toggleHelpOverlay();
    expect(hud.isHelpOverlayOpen()).toBe(true);
    hud.toggleHelpOverlay();
    expect(hud.isHelpOverlayOpen()).toBe(false);
  });

  it("help overlay contains control hint text (ЛКМ) when open", () => {
    const m = makeMockRenderer();
    const hud = new FlightHud(m.renderer, makeGameEngine(), m.renderer.uiLayer);
    hud.initialize();
    hud.toggleHelpOverlay();
    const allTexts = vi
      .mocked(Text)
      .mock.results.map((r) => String((r.value as { text: string }).text));
    expect(allTexts.some((t) => t.includes("ЛКМ"))).toBe(true);
  });

  it("[?] button pointerdown opens the help overlay", () => {
    const m = makeMockRenderer();
    const hud = new FlightHud(m.renderer, makeGameEngine(), m.renderer.uiLayer);
    hud.initialize();
    const helpBtnNode = vi
      .mocked(Text)
      .mock.results.map(
        (r) => r.value as { text: string; on: ReturnType<typeof vi.fn> },
      )
      .find((t) => String(t.text) === "[?]");
    expect(
      helpBtnNode,
      "[?] Text node must be created by initialize()",
    ).toBeDefined();
    const call = helpBtnNode!.on.mock.calls.find(
      (c: unknown[]) => c[0] === "pointerdown",
    );
    expect(call, "[?] must register a pointerdown handler").toBeDefined();
    (call![1] as (e: { stopPropagation: () => void }) => void)({
      stopPropagation: vi.fn(),
    });
    expect(hud.isHelpOverlayOpen()).toBe(true);
  });

  it("[I] button pointerdown fires the onInventory callback", () => {
    const m = makeMockRenderer();
    const hud = new FlightHud(m.renderer, makeGameEngine(), m.renderer.uiLayer);
    const onInventory = vi.fn();
    hud.onInventory = onInventory;
    hud.initialize();
    const invBtnNode = vi
      .mocked(Text)
      .mock.results.map(
        (r) => r.value as { text: string; on: ReturnType<typeof vi.fn> },
      )
      .find((t) => String(t.text) === "[I]");
    expect(
      invBtnNode,
      "[I] Text node must be created by initialize()",
    ).toBeDefined();
    const call = invBtnNode!.on.mock.calls.find(
      (c: unknown[]) => c[0] === "pointerdown",
    );
    expect(call, "[I] must register a pointerdown handler").toBeDefined();
    (call![1] as (e: { stopPropagation: () => void }) => void)({
      stopPropagation: vi.fn(),
    });
    expect(onInventory).toHaveBeenCalledTimes(1);
  });
});

describe("FlightHud icon-button tooltips (Task 10)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  type TipNode = {
    text: string;
    visible: boolean;
    eventMode: string;
    on: ReturnType<typeof vi.fn>;
  };

  function findTextNode(label: string): TipNode {
    const hit = vi
      .mocked(Text)
      .mock.results.map((r) => r.value as TipNode)
      .find((t) => String(t.text) === label);
    expect(hit, `Text node ${label} must exist`).toBeDefined();
    return hit!;
  }

  function fireAll(btn: TipNode, event: string): void {
    for (const call of btn.on.mock.calls) {
      if (call[0] === event) (call[1] as () => void)();
    }
  }

  it("mounts an 'Инвентарь' tooltip that toggles with the [I] button's hover", () => {
    const m = makeMockRenderer();
    const hud = new FlightHud(m.renderer, makeGameEngine(), m.renderer.uiLayer);
    hud.initialize();

    const tip = findTextNode("Инвентарь");
    expect(tip.visible).toBe(false);
    expect(tip.eventMode).toBe("none");

    const invBtn = findTextNode("[I]");
    fireAll(invBtn, "pointerover");
    expect(tip.visible).toBe(true);
    fireAll(invBtn, "pointerout");
    expect(tip.visible).toBe(false);
  });

  it("mounts a 'Помощь' tooltip that toggles with the [?] button's hover", () => {
    const m = makeMockRenderer();
    const hud = new FlightHud(m.renderer, makeGameEngine(), m.renderer.uiLayer);
    hud.initialize();

    const tip = findTextNode("Помощь");
    expect(tip.visible).toBe(false);
    expect(tip.eventMode).toBe("none");

    const helpBtn = findTextNode("[?]");
    fireAll(helpBtn, "pointerover");
    expect(tip.visible).toBe(true);
    fireAll(helpBtn, "pointerout");
    expect(tip.visible).toBe(false);
  });
});

type Box = { left: number; top: number; right: number; bottom: number };

function intersects(a: Box, b: Box): boolean {
  return (
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
  );
}

type MockText = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  anchor: { x: number; y: number };
};

function textBox(t: MockText): Box {
  return { left: t.x, top: t.y, right: t.x + t.width, bottom: t.y + t.height };
}

function findMenuButtonText(): MockText {
  const hit = vi
    .mocked(Text)
    .mock.results.map((r) => r.value as MockText)
    .find((t) => t.text === "[МЕНЮ]");
  expect(hit, "[МЕНЮ] button text must exist").toBeDefined();
  return hit!;
}

function miniMapBox(h: FlightHud): Box {
  const mini = h.miniMap!;
  const geom = mini as unknown as { mapWidth: number; mapHeight: number };
  return {
    left: mini.container.x,
    top: mini.container.y,
    right: mini.container.x + geom.mapWidth,
    bottom: mini.container.y + geom.mapHeight,
  };
}

describe("FlightHud HUD cleanup (Bug 3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("never creates a camera zoom/pan debug text node", () => {
    const m = makeMockRenderer();
    const hud = new FlightHud(m.renderer, makeGameEngine(), m.renderer.uiLayer);
    hud.initialize();
    const hit = vi
      .mocked(Text)
      .mock.results.map((r) => r.value as MockText)
      .find((t) => String(t.text).startsWith("Камера:"));
    expect(hit).toBeUndefined();
  });

  it("has no setCameraDebug method left to call", () => {
    const m = makeMockRenderer();
    const hud = new FlightHud(m.renderer, makeGameEngine(), m.renderer.uiLayer);
    expect(
      (hud as unknown as { setCameraDebug?: unknown }).setCameraDebug,
    ).toBeUndefined();
  });

  const sizes: ReadonlyArray<readonly [number, number]> = [
    [1280, 720],
    [1920, 1080],
    [1024, 768],
  ];

  for (const [w, h] of sizes) {
    it(`[МЕНЮ] sits bottom-left clear of the radar when built at ${w}×${h}`, () => {
      const m = makeMockRenderer(w, h);
      const hud = new FlightHud(
        m.renderer,
        makeGameEngine(),
        m.renderer.uiLayer,
      );
      hud.initialize();
      const menuBox = textBox(findMenuButtonText());
      expect(menuBox.top).toBeGreaterThan(h / 2); // bottom half of the screen
      expect(intersects(menuBox, miniMapBox(hud))).toBe(false);
    });

    it(`[МЕНЮ] stays bottom-left clear of the radar after reposition to ${w}×${h}`, () => {
      const m = makeMockRenderer(800, 600);
      const hud = new FlightHud(
        m.renderer,
        makeGameEngine(),
        m.renderer.uiLayer,
      );
      hud.initialize();
      hud.reposition(w, h);
      const menuBox = textBox(findMenuButtonText());
      expect(menuBox.top).toBeGreaterThan(h / 2);
      expect(intersects(menuBox, miniMapBox(hud))).toBe(false);
    });
  }
});
