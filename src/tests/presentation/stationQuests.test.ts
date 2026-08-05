import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Renderer } from "@/presentation/Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import type { Station } from "@/domain/Station";
import { StationType, QuestType } from "@/types";
import type { GeneratedQuest } from "@/systems/quests/QuestGenerator";

interface FakeNode {
  text: string;
  handlers: Record<string, (e: unknown) => void>;
}

const created: FakeNode[] = [];

vi.mock("pixi.js", () => {
  class FakeBase {
    handlers: Record<string, (e: unknown) => void> = {};
    children: unknown[] = [];
    x = 0;
    y = 0;
    width = 50;
    height = 14;
    alpha = 1;
    tint = 0xffffff;
    eventMode = "auto";
    cursor = "default";
    hitArea: unknown = null;
    mask: unknown = null;
    style: Record<string, unknown> = {};
    anchor = { set: () => {} };
    on(ev: string, cb: (e: unknown) => void) {
      this.handlers[ev] = cb;
      return this;
    }
    addChild(c: unknown) {
      this.children.push(c);
      return c;
    }
    removeChild() {}
    removeChildren() {
      const c = this.children;
      this.children = [];
      return c;
    }
    destroy() {}
  }
  class Container extends FakeBase {}
  class Graphics extends FakeBase {
    rect() {
      return this;
    }
    roundRect() {
      return this;
    }
    moveTo() {
      return this;
    }
    lineTo() {
      return this;
    }
    fill() {
      return this;
    }
    stroke() {
      return this;
    }
    clear() {
      return this;
    }
  }
  class Text extends FakeBase {
    text = "";
    constructor(opts?: { text?: string; style?: Record<string, unknown> }) {
      super();
      this.text = opts?.text ?? "";
      this.style = opts?.style ?? {};
      created.push(this as unknown as FakeNode);
    }
  }
  class Rectangle {
    constructor(
      public x = 0,
      public y = 0,
      public w = 0,
      public h = 0,
    ) {}
  }
  return {
    Container,
    Graphics,
    Text,
    Rectangle,
    FederatedPointerEvent: class {},
  };
});

import { StationScene } from "@/presentation/StationScene";

const renderer = {
  app: {
    screen: { width: 1280, height: 800 },
    stage: { eventMode: "auto", on: vi.fn(), off: vi.fn() },
  },
  uiLayer: { addChild: vi.fn(), removeChild: vi.fn(), children: [] },
  gameLayer: { addChild: vi.fn(), removeChild: vi.fn(), children: [] },
  clearGameLayer: vi.fn(),
  clearUILayer: vi.fn(),
} as unknown as Renderer;

function makeQuest(id: string): GeneratedQuest {
  return {
    template: {
      id,
      title: `Задание ${id}`,
      description: "Тест",
      type: QuestType.DELIVERY,
      objectives: [],
      reward: { credits: 100, experience: 10, items: [] },
      dialogueAnchors: [],
    },
    targetSystemId: "sys2",
    targetPlanetId: null,
    jumps: 1,
    issuerName: "Тест",
    issuerTitle: "Командир",
    targetNpcName: null,
    highlights: [],
    issuerPlanetId: "base-1",
  } as unknown as GeneratedQuest;
}

interface PendingQuestStub {
  id: string;
  title: string;
  planetId: string;
  reward: { credits: number };
}

function makeEngine(opts?: {
  pendingReturn?: PendingQuestStub[];
  claimReturnReward?: (questId: string, player: unknown) => boolean;
}) {
  return {
    player: {
      rank: 0,
      credits: 1000,
      ship: { hullHP: 100, maxHull: 100, energy: 50, maxEnergy: 50 },
      isHostileTo: () => false,
    },
    galaxy: { id: "g1", gameDays: 0, systems: [] },
    audio: { playSfx: vi.fn(() => Promise.resolve()) },
    getQuestBoard: vi.fn((_id: string) => [makeQuest("q1"), makeQuest("q2")]),
    acceptBoardQuest: vi.fn(() => ({ id: "q1" })),
    questManager: {
      getActiveQuests: () => [],
      getCompletedQuestIds: () => [],
      getPendingReturnQuests: () => opts?.pendingReturn ?? [],
      claimReturnReward: opts?.claimReturnReward ?? vi.fn(() => true),
    },
  } as unknown as GameEngine;
}

function makeStation(type: StationType): Station {
  return { id: "base-1", name: "Тест-база", type } as unknown as Station;
}

function quests(scene: StationScene): Promise<void> {
  return (
    scene as unknown as { executeService: (s: string) => Promise<void> }
  ).executeService("quests");
}

function jobBoard(scene: StationScene): unknown {
  return (scene as unknown as { jobBoardPanel: unknown }).jobBoardPanel;
}

function toastText(scene: StationScene): string {
  const toast = (scene as unknown as { toast: { text: string } | null }).toast;
  return toast?.text ?? "";
}

describe("StationScene — «Задания» action", () => {
  beforeEach(() => {
    created.length = 0;
    vi.clearAllMocks();
  });

  it("opens the quest board at a MILITARY_BASE (no wrong-place toast)", async () => {
    const engine = makeEngine();
    const scene = new StationScene(renderer);
    scene.initialize({
      gameEngine: engine,
      station: makeStation(StationType.MILITARY_BASE),
    });

    await quests(scene);

    expect(jobBoard(scene)).not.toBeNull();
    expect(engine.getQuestBoard).toHaveBeenCalledWith("base-1");
    expect(toastText(scene)).not.toBe(
      "Задания выдаются только на военных базах",
    );

    scene.destroy();
    expect(jobBoard(scene)).toBeNull();
  });

  it("shows the wrong-place toast at a non-military station", async () => {
    const engine = makeEngine();
    const scene = new StationScene(renderer);
    scene.initialize({
      gameEngine: engine,
      station: makeStation(StationType.REPAIR_DOCK),
    });

    await quests(scene);

    expect(toastText(scene)).toBe("Задания выдаются только на военных базах");
    expect(jobBoard(scene)).toBeNull();
    expect(engine.getQuestBoard).not.toHaveBeenCalled();

    scene.destroy();
  });

  it("claims a pending-return quest issued at THIS station on dock", () => {
    const claim = vi.fn(() => true);
    const engine = makeEngine({
      pendingReturn: [
        {
          id: "q-bounty",
          title: "Охота",
          planetId: "base-1",
          reward: { credits: 500 },
        },
      ],
      claimReturnReward: claim,
    });
    const scene = new StationScene(renderer);
    scene.initialize({
      gameEngine: engine,
      station: makeStation(StationType.MILITARY_BASE),
    });

    expect(claim).toHaveBeenCalledWith("q-bounty", expect.anything());
    scene.destroy();
  });

  it("does NOT claim a pending-return quest issued at a DIFFERENT station/planet", () => {
    const claim = vi.fn(() => true);
    const engine = makeEngine({
      pendingReturn: [
        {
          id: "q-elsewhere",
          title: "Чужое",
          planetId: "other-base",
          reward: { credits: 500 },
        },
      ],
      claimReturnReward: claim,
    });
    const scene = new StationScene(renderer);
    scene.initialize({
      gameEngine: engine,
      station: makeStation(StationType.MILITARY_BASE),
    });

    expect(claim).not.toHaveBeenCalled();
    scene.destroy();
  });
});
