import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("pixi.js", () => {
  const makeContainer = () => ({
    addChild: vi.fn(),
    removeChild: vi.fn(),
    children: [] as unknown[],
    eventMode: "auto",
    cursor: "pointer",
    x: 0,
    y: 0,
    alpha: 1,
    destroyed: false,
    on: vi.fn().mockReturnThis(),
    destroy: vi.fn(),
  });
  return {
    Container: vi.fn().mockImplementation(makeContainer),
    Graphics: vi.fn().mockImplementation(() => ({
      ...makeContainer(),
      rect: vi.fn().mockReturnThis(),
      roundRect: vi.fn().mockReturnThis(),
      circle: vi.fn().mockReturnThis(),
      fill: vi.fn().mockReturnThis(),
      stroke: vi.fn().mockReturnThis(),
      clear: vi.fn().mockReturnThis(),
    })),
    Text: vi.fn().mockImplementation(() => ({
      ...makeContainer(),
      anchor: { set: vi.fn() },
      text: "",
      style: {},
      width: 100,
      height: 20,
    })),
  };
});

import { DialogueScene } from "@/presentation/DialogueScene";
import { NpcContactPanel } from "@/presentation/NpcContactPanel";
import { NpcShip } from "@/domain/NpcShip";
import { SceneType, NpcRole, NpcState, FactionType } from "@/types";
import { Faction } from "@/types/faction";
import type { Renderer } from "@/presentation/Renderer";

function press(init: KeyboardEventInit): void {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }),
  );
}

function makeRenderer(): Renderer {
  return {
    app: { screen: { width: 800, height: 600 } },
    uiLayer: { addChild: vi.fn(), removeChild: vi.fn() },
    gameLayer: { addChild: vi.fn() },
    clearGameLayer: vi.fn(),
    clearUILayer: vi.fn(),
  } as unknown as Renderer;
}

function makeGameEngine(): {
  transitionTo: ReturnType<typeof vi.fn>;
} & Record<string, unknown> {
  return {
    questManager: {
      getActiveQuests: () => [],
      acceptQuest: vi.fn(),
      completeQuest: vi.fn(),
    },
    galaxy: { gameDays: 0 },
    player: { currentSystemId: "sys" },
    transitionTo: vi.fn().mockResolvedValue(undefined),
  };
}

function makeNpc(): NpcShip {
  return new NpcShip({
    id: "npc_1",
    name: "Купец",
    race: FactionType.OUTLANDERS,
    faction: Faction.INDEPENDENT,
    role: NpcRole.TRADER,
    hullHP: 100,
    maxHull: 100,
    shields: 50,
    speed: 0.1,
    damage: 20,
    currentSystemId: "sys",
    state: NpcState.TRAVELING,
    goal: null,
    destinationSystemId: null,
    daysToArrival: 0,
    credits: 0,
    reputation: 0,
  });
}

describe("modal keys integration (Enter confirm / Esc cancel)", () => {
  const scenes: DialogueScene[] = [];
  const panels: NpcContactPanel[] = [];

  beforeEach(() => {
    scenes.length = 0;
    panels.length = 0;
  });

  afterEach(() => {
    scenes.forEach((s) => s.destroy());
    panels.forEach((p) => p.destroy());
    document.body.innerHTML = "";
  });

  describe("DialogueScene", () => {
    function mountDialogue(): {
      scene: DialogueScene;
      gameEngine: ReturnType<typeof makeGameEngine>;
    } {
      const scene = new DialogueScene(makeRenderer());
      scenes.push(scene);
      const gameEngine = makeGameEngine();
      scene.initialize({
        gameEngine,
        npc: { id: "governor_1", name: "Губернатор" },
        returnScene: SceneType.SPACE_FLIGHT,
      });
      return { scene, gameEngine };
    }

    it("confirms the primary (first) response on Enter", () => {
      const { scene } = mountDialogue();
      const s = scene as unknown as Record<string, unknown>;
      const primary = (s.currentNode as { responses: unknown[] }).responses[0];
      const onResponseSelected = vi.fn();
      s.onResponseSelected = onResponseSelected;

      press({ key: "Enter" });

      expect(onResponseSelected).toHaveBeenCalledTimes(1);
      expect(onResponseSelected).toHaveBeenCalledWith(primary);
    });

    it("closes (returns to the previous scene) on Esc", () => {
      const { scene, gameEngine } = mountDialogue();
      void scene; // retained for teardown

      press({ key: "Escape" });

      expect(gameEngine.transitionTo).toHaveBeenCalledTimes(1);
      expect(gameEngine.transitionTo).toHaveBeenCalledWith(
        SceneType.SPACE_FLIGHT,
        expect.objectContaining({ gameEngine }),
      );
    });

    it("detaches its key listener on destroy (no further confirm)", () => {
      const { scene } = mountDialogue();
      const s = scene as unknown as Record<string, unknown>;
      const onResponseSelected = vi.fn();

      scene.destroy();
      s.onResponseSelected = onResponseSelected;
      press({ key: "Enter" });

      expect(onResponseSelected).not.toHaveBeenCalled();
    });
  });

  describe("NpcContactPanel", () => {
    function mountPanel(): {
      panel: NpcContactPanel;
      onClose: ReturnType<typeof vi.fn>;
    } {
      const onClose = vi.fn();
      const panel = new NpcContactPanel(makeNpc(), 800, 600, {
        onHail: vi.fn(),
        onTrade: vi.fn(),
        onAttack: vi.fn(),
        onApproach: vi.fn(),
        onClose,
      });
      panels.push(panel);
      return { panel, onClose };
    }

    it("closes on Esc via the shared helper", () => {
      const { onClose } = mountPanel();

      press({ key: "Escape" });

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("does not confirm on Enter (multi-button panel has no single primary)", () => {
      const { onClose } = mountPanel();

      press({ key: "Enter" });

      expect(onClose).not.toHaveBeenCalled();
    });

    it("detaches its Esc listener on destroy (no leak)", () => {
      const { panel, onClose } = mountPanel();

      panel.destroy();
      press({ key: "Escape" });

      expect(onClose).not.toHaveBeenCalled();
    });
  });
});
