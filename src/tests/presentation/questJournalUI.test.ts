import { describe, it, expect, vi } from "vitest";
import type { IQuestService } from "@/core/ports/IQuestService";

vi.mock("pixi.js", () => {
  const makeContainer = () => {
    const node: Record<string, unknown> = {
      children: [] as unknown[],
      eventMode: "auto",
      cursor: "pointer",
      x: 0,
      y: 0,
      text: "",
      anchor: { set: vi.fn() },
      on: vi.fn(),
      destroy: vi.fn(),
      destroyed: false,
      parent: null,
    };
    node.addChild = vi.fn((...kids: unknown[]) => {
      (node.children as unknown[]).push(...kids);
      return kids[0];
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
    Text: vi.fn().mockImplementation((opts?: { text?: unknown }) => {
      const node = makeContainer();
      node.text = opts?.text != null ? String(opts.text) : "";
      return node;
    }),
  };
});

type MockNode = {
  eventMode: string;
  on: ReturnType<typeof vi.fn>;
  children: MockNode[];
};

function makeQuestService(): IQuestService {
  return {
    getActiveQuests: vi.fn().mockReturnValue([]),
    getCompletedQuestIds: vi.fn().mockReturnValue([]),
  } as unknown as IQuestService;
}

function makeQuestServiceWithQuest(): IQuestService {
  const quest = {
    id: "q-1",
    title: "Доставить груз",
    type: "DELIVERY",
    isCompleted: false,
    objectives: [
      {
        type: "VISIT_LOCATION",
        description: "Прибыть на станцию",
        completed: false,
        currentAmount: 0,
        targetAmount: 1,
        locationId: "planet-1",
      },
    ],
  };
  return {
    getActiveQuests: vi.fn().mockReturnValue([quest]),
    getCompletedQuestIds: vi.fn().mockReturnValue([]),
  } as unknown as IQuestService;
}

function collectLeakyLeaves(node: MockNode): MockNode[] {
  const leaks: MockNode[] = [];
  for (const child of node.children ?? []) {
    if (child.eventMode === "static") continue; // backdrop or a button — allowed
    if (Array.isArray(child.children) && child.children.length > 0) {
      leaks.push(...collectLeakyLeaves(child));
    } else if (child.eventMode !== "none") {
      leaks.push(child);
    }
  }
  return leaks;
}

describe("QuestJournalUI backdrop (playtest3 F6)", () => {
  it("backdrop is a static hit target with a stopPropagation pointerdown handler", async () => {
    const { QuestJournalUI } = await import("@/presentation/QuestJournalUI");
    const ui = new QuestJournalUI(makeQuestService(), 1280, 720, vi.fn());

    const backdrop = (ui.container as unknown as MockNode).children[0];
    expect(backdrop).toBeDefined();
    expect(backdrop.eventMode).toBe("static");

    const pointerdown = backdrop.on.mock.calls.find(
      (c: unknown[]) => c[0] === "pointerdown",
    );
    expect(pointerdown).toBeDefined();

    const stopPropagation = vi.fn();
    (pointerdown![1] as (e: { stopPropagation: () => void }) => void)({
      stopPropagation,
    });
    expect(stopPropagation).toHaveBeenCalledTimes(1);
  });

  it("panel and label content are eventMode='none' so clicks fall through to the backdrop (empty state)", async () => {
    const { QuestJournalUI } = await import("@/presentation/QuestJournalUI");
    const ui = new QuestJournalUI(makeQuestService(), 1280, 720, vi.fn());
    const root = ui.container as unknown as MockNode;

    expect(root.children[1].eventMode).toBe("none");

    expect(collectLeakyLeaves(root)).toEqual([]);
  });

  it("populated quest cards and their labels are eventMode='none' (only the buttons stay interactive)", async () => {
    const { QuestJournalUI } = await import("@/presentation/QuestJournalUI");
    const ui = new QuestJournalUI(
      makeQuestServiceWithQuest(),
      1280,
      720,
      vi.fn(),
      vi.fn(),
    );
    const root = ui.container as unknown as MockNode;

    const card = root.children.find(
      (c) =>
        c.eventMode !== "static" &&
        Array.isArray(c.children) &&
        c.children.length > 1,
    );
    expect(card).toBeDefined();

    const navButton = card!.children.find((c) => c.eventMode === "static");
    expect(navButton).toBeDefined();

    expect(collectLeakyLeaves(root)).toEqual([]);
  });
});

type TextNode = { text: string; children: TextNode[] };

function collectTexts(node: TextNode): string[] {
  const out: string[] = [];
  if (typeof node.text === "string" && node.text) out.push(node.text);
  for (const child of node.children ?? []) out.push(...collectTexts(child));
  return out;
}

describe("QuestJournalUI reward detail", () => {
  it("renders 'Награда:' line with credits, xp, and reputation", async () => {
    const { QuestJournalUI } = await import("@/presentation/QuestJournalUI");

    const questWithReward = {
      id: "q-r1",
      title: "Доставка с наградой",
      type: "DELIVERY",
      isCompleted: false,
      objectives: [
        {
          type: "VISIT_LOCATION",
          description: "Прилететь",
          completed: false,
          currentAmount: 0,
          targetAmount: 1,
          locationId: "planet-x",
        },
      ],
      reward: { credits: 750, experience: 200, items: [], reputationDelta: 3 },
    };

    const qs = {
      getActiveQuests: vi.fn().mockReturnValue([questWithReward]),
      getCompletedQuestIds: vi.fn().mockReturnValue([]),
    } as unknown as import("@/core/ports/IQuestService").IQuestService;

    const ui = new QuestJournalUI(qs, 1280, 720, vi.fn());
    const root = ui.container as unknown as TextNode;
    const texts = collectTexts(root);

    const rewardLine = texts.find((t) => t.startsWith("Награда:"));
    expect(rewardLine).toBeDefined();
    expect(rewardLine).toContain("750 кр");
    expect(rewardLine).toContain("200 опыт");
    expect(rewardLine).toContain("+3 реп");
  });

  it("shows '—' when quest has no reward", async () => {
    const { QuestJournalUI } = await import("@/presentation/QuestJournalUI");

    const questNoReward = {
      id: "q-nr1",
      title: "Квест без награды",
      type: "COMBAT",
      isCompleted: false,
      objectives: [
        {
          type: "KILL_ENEMIES",
          description: "Уничтожить",
          completed: false,
          currentAmount: 0,
          targetAmount: 3,
        },
      ],
    };

    const qs = {
      getActiveQuests: vi.fn().mockReturnValue([questNoReward]),
      getCompletedQuestIds: vi.fn().mockReturnValue([]),
    } as unknown as import("@/core/ports/IQuestService").IQuestService;

    const ui = new QuestJournalUI(qs, 1280, 720, vi.fn());
    const texts = collectTexts(ui.container as unknown as TextNode);

    const rewardLine = texts.find((t) => t.startsWith("Награда:"));
    expect(rewardLine).toBe("Награда: —");
  });
});

describe("QuestJournalUI expired quests section", () => {
  it("shows 'ПРОВАЛЕНО' section when getExpiredQuests returns failed quests", async () => {
    const { QuestJournalUI } = await import("@/presentation/QuestJournalUI");

    const expiredQuest = {
      id: "q-expired-1",
      title: "Доставка медикаментов",
      type: "DELIVERY",
      isCompleted: false,
      isFailed: true,
      deadline: 5,
      issuedDay: 0,
      objectives: [],
      getRemainingDays: () => 0,
    };

    const qs = {
      getActiveQuests: vi.fn().mockReturnValue([]),
      getCompletedQuestIds: vi.fn().mockReturnValue([]),
      getExpiredQuests: vi.fn().mockReturnValue([expiredQuest]),
    } as unknown as import("@/core/ports/IQuestService").IQuestService;

    const ui = new QuestJournalUI(qs, 1280, 720, vi.fn());
    const texts = collectTexts(ui.container as unknown as TextNode);

    const failedHeader = texts.find((t) => t.includes("ПРОВАЛЕНО"));
    expect(failedHeader).toBeDefined();

    const expiredRow = texts.find(
      (t) => t.includes("Доставка медикаментов") && t.includes("просрочено"),
    );
    expect(expiredRow).toBeDefined();
  });

  it("does not render empty state when only expired quests exist", async () => {
    const { QuestJournalUI } = await import("@/presentation/QuestJournalUI");

    const expiredQuest = {
      id: "q-exp-2",
      title: "Разведка",
      type: "EXPLORATION",
      isCompleted: false,
      isFailed: true,
      deadline: 3,
      issuedDay: 0,
      objectives: [],
      getRemainingDays: () => 0,
    };

    const qs = {
      getActiveQuests: vi.fn().mockReturnValue([]),
      getCompletedQuestIds: vi.fn().mockReturnValue([]),
      getExpiredQuests: vi.fn().mockReturnValue([expiredQuest]),
    } as unknown as import("@/core/ports/IQuestService").IQuestService;

    const ui = new QuestJournalUI(qs, 1280, 720, vi.fn());
    const texts = collectTexts(ui.container as unknown as TextNode);

    const emptyMsg = texts.find((t) => t.includes("пока нет квестов"));
    expect(emptyMsg).toBeUndefined();
  });
});

describe("QuestJournalUI live cargo progress (Местный подряд)", () => {
  function deliveryQuest() {
    return {
      id: "q-deliver",
      title: "Местный подряд",
      type: "DELIVERY",
      isCompleted: false,
      isFailed: false,
      objectives: [
        {
          id: "q-deliver_collect",
          type: "COLLECT_ITEM",
          description: "Загрузить медикаменты",
          completed: false,
          currentAmount: 0, // frozen: COLLECT_ITEM event is never emitted in prod
          targetAmount: 8,
          itemType: "MEDICINE",
        },
      ],
      reward: { credits: 150, experience: 60, items: [] },
    };
  }

  it("shows carried cargo from the resolver, not the frozen currentAmount", async () => {
    const { QuestJournalUI } = await import("@/presentation/QuestJournalUI");
    const qs = {
      getActiveQuests: vi.fn().mockReturnValue([deliveryQuest()]),
      getCompletedQuestIds: vi.fn().mockReturnValue([]),
    } as unknown as IQuestService;

    const ui = new QuestJournalUI(
      qs,
      1280,
      720,
      vi.fn(),
      undefined,
      0,
      undefined,
      (itemType: string) => (itemType === "MEDICINE" ? 5 : 0),
    );
    const objLine = collectTexts(ui.container as unknown as TextNode).find(
      (t) => t.includes("Загрузить медикаменты"),
    );
    expect(objLine).toBeDefined();
    expect(objLine).toContain("5/8");
    expect(objLine).not.toContain("0/8");
  });

  it("clamps to target and flags 'ready to deliver' once the hold meets the goal", async () => {
    const { QuestJournalUI } = await import("@/presentation/QuestJournalUI");
    const qs = {
      getActiveQuests: vi.fn().mockReturnValue([deliveryQuest()]),
      getCompletedQuestIds: vi.fn().mockReturnValue([]),
    } as unknown as IQuestService;

    const ui = new QuestJournalUI(
      qs,
      1280,
      720,
      vi.fn(),
      undefined,
      0,
      undefined,
      () => 12,
    );
    const objLine = collectTexts(ui.container as unknown as TextNode).find(
      (t) => t.includes("Загрузить медикаменты"),
    );
    expect(objLine).toBeDefined();
    expect(objLine).toContain("8/8");
    expect(objLine).toContain("✓");
    expect(objLine).toContain("сдать");
  });

  it("falls back to currentAmount when no cargo resolver is supplied", async () => {
    const { QuestJournalUI } = await import("@/presentation/QuestJournalUI");
    const qs = {
      getActiveQuests: vi.fn().mockReturnValue([deliveryQuest()]),
      getCompletedQuestIds: vi.fn().mockReturnValue([]),
    } as unknown as IQuestService;

    const ui = new QuestJournalUI(qs, 1280, 720, vi.fn());
    const objLine = collectTexts(ui.container as unknown as TextNode).find(
      (t) => t.includes("Загрузить медикаменты"),
    );
    expect(objLine).toBeDefined();
    expect(objLine).toContain("0/8");
  });
});

describe("QuestJournalUI remaining days display", () => {
  it("shows 'осталось N дн.' warning when remaining days < 5 and currentDay > 0", async () => {
    const { QuestJournalUI } = await import("@/presentation/QuestJournalUI");

    const urgentQuest = {
      id: "q-urgent",
      title: "Срочный эскорт",
      type: "ESCORT",
      isCompleted: false,
      isFailed: false,
      deadline: 3,
      issuedDay: 0,
      objectives: [],
      reward: { credits: 500, experience: 100, items: [] },
      getRemainingDays: vi.fn().mockReturnValue(2),
    };

    const qs = {
      getActiveQuests: vi.fn().mockReturnValue([urgentQuest]),
      getCompletedQuestIds: vi.fn().mockReturnValue([]),
      getExpiredQuests: vi.fn().mockReturnValue([]),
    } as unknown as import("@/core/ports/IQuestService").IQuestService;

    const ui = new QuestJournalUI(qs, 1280, 720, vi.fn(), undefined, 1);
    const texts = collectTexts(ui.container as unknown as TextNode);

    const daysWarning = texts.find(
      (t) => t.includes("осталось") && t.includes("дн."),
    );
    expect(daysWarning).toBeDefined();
    expect(daysWarning).toContain("2");
  });

  it("does not show remaining days when currentDay is 0 (default)", async () => {
    const { QuestJournalUI } = await import("@/presentation/QuestJournalUI");

    const questWithDeadline = {
      id: "q-deadline",
      title: "Квест с дедлайном",
      type: "DELIVERY",
      isCompleted: false,
      isFailed: false,
      deadline: 2,
      issuedDay: 0,
      objectives: [],
      reward: { credits: 200, experience: 50, items: [] },
      getRemainingDays: vi.fn().mockReturnValue(2),
    };

    const qs = {
      getActiveQuests: vi.fn().mockReturnValue([questWithDeadline]),
      getCompletedQuestIds: vi.fn().mockReturnValue([]),
      getExpiredQuests: vi.fn().mockReturnValue([]),
    } as unknown as import("@/core/ports/IQuestService").IQuestService;

    const ui = new QuestJournalUI(qs, 1280, 720, vi.fn());
    const texts = collectTexts(ui.container as unknown as TextNode);

    const daysWarning = texts.find(
      (t) => t.includes("осталось") && t.includes("дн."),
    );
    expect(daysWarning).toBeUndefined();
  });
});
