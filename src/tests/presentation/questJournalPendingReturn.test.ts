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

type TextNode = { text: string; children: TextNode[] };

function collectTexts(node: TextNode): string[] {
  const out: string[] = [];
  if (typeof node.text === "string" && node.text) out.push(node.text);
  for (const child of node.children ?? []) out.push(...collectTexts(child));
  return out;
}

function makePendingReturnQuest(overrides: Record<string, unknown> = {}) {
  return {
    id: "q-pending-1",
    title: "Охота за головой",
    type: "BOUNTY",
    isCompleted: false,
    isPendingReturn: true,
    isFailed: false,
    planetId: "planet-alpha",
    deadline: 10,
    issuedDay: 0,
    objectives: [],
    reward: { credits: 1500, experience: 300, items: [] },
    getRemainingDays: () => 8,
    ...overrides,
  };
}

function makeQuestServiceWithPending(pendingQuests: unknown[]): IQuestService {
  return {
    getActiveQuests: vi.fn().mockReturnValue([]),
    getCompletedQuestIds: vi.fn().mockReturnValue([]),
    getExpiredQuests: vi.fn().mockReturnValue([]),
    getPendingReturnQuests: vi.fn().mockReturnValue(pendingQuests),
  } as unknown as IQuestService;
}

describe("QuestJournalUI pending-return section", () => {
  it("shows 'ВЫПОЛНЕНО — ЗАБРАТЬ НАГРАДУ' section header for pending-return quests", async () => {
    const { QuestJournalUI } = await import("@/presentation/QuestJournalUI");

    const qs = makeQuestServiceWithPending([makePendingReturnQuest()]);
    const ui = new QuestJournalUI(qs, 1280, 720, vi.fn());
    const texts = collectTexts(ui.container as unknown as TextNode);

    const header = texts.find(
      (t) => t.includes("ВЫПОЛНЕНО") && t.includes("ЗАБРАТЬ НАГРАДУ"),
    );
    expect(header).toBeDefined();
  });

  it("shows '↩ Вернитесь в' return prompt with issuer planet id", async () => {
    const { QuestJournalUI } = await import("@/presentation/QuestJournalUI");

    const qs = makeQuestServiceWithPending([
      makePendingReturnQuest({ planetId: "planet-alpha" }),
    ]);
    const ui = new QuestJournalUI(qs, 1280, 720, vi.fn());
    const texts = collectTexts(ui.container as unknown as TextNode);

    const returnPrompt = texts.find(
      (t) =>
        t.includes("↩") &&
        t.includes("Вернитесь") &&
        t.includes("planet-alpha"),
    );
    expect(returnPrompt).toBeDefined();
  });

  it("resolves the issuer planet id to a readable name in the return prompt", async () => {
    const { QuestJournalUI } = await import("@/presentation/QuestJournalUI");

    const qs = makeQuestServiceWithPending([
      makePendingReturnQuest({ planetId: "planet_Альдебаран_0" }),
    ]);
    const resolveName = (id: string) =>
      id === "planet_Альдебаран_0" ? "Альдебаран" : id;
    const ui = new QuestJournalUI(
      qs,
      1280,
      720,
      vi.fn(),
      undefined,
      0,
      resolveName,
    );
    const texts = collectTexts(ui.container as unknown as TextNode);

    const returnPrompt = texts.find(
      (t) => t.includes("Вернитесь") && t.includes("Альдебаран"),
    );
    expect(returnPrompt).toBeDefined();
    expect(returnPrompt).not.toContain("planet_Альдебаран_0");
  });

  it("renders 'Выдан: X' tag in the pending-return card", async () => {
    const { QuestJournalUI } = await import("@/presentation/QuestJournalUI");

    const qs = makeQuestServiceWithPending([
      makePendingReturnQuest({ planetId: "orbit-7" }),
    ]);
    const ui = new QuestJournalUI(qs, 1280, 720, vi.fn());
    const texts = collectTexts(ui.container as unknown as TextNode);

    const issuedTag = texts.find(
      (t) => t.includes("Выдан") && t.includes("orbit-7"),
    );
    expect(issuedTag).toBeDefined();
  });

  it("shows quest title in the pending-return card", async () => {
    const { QuestJournalUI } = await import("@/presentation/QuestJournalUI");

    const qs = makeQuestServiceWithPending([
      makePendingReturnQuest({ title: "Охота за головой" }),
    ]);
    const ui = new QuestJournalUI(qs, 1280, 720, vi.fn());
    const texts = collectTexts(ui.container as unknown as TextNode);

    expect(texts.some((t) => t.includes("Охота за головой"))).toBe(true);
  });

  it("does not show pending-return section when getPendingReturnQuests returns empty", async () => {
    const { QuestJournalUI } = await import("@/presentation/QuestJournalUI");

    const qs = makeQuestServiceWithPending([]);
    const ui = new QuestJournalUI(qs, 1280, 720, vi.fn());
    const texts = collectTexts(ui.container as unknown as TextNode);

    const header = texts.find((t) => t.includes("ЗАБРАТЬ НАГРАДУ"));
    expect(header).toBeUndefined();
  });

  it("does not show empty-state message when there are pending-return quests", async () => {
    const { QuestJournalUI } = await import("@/presentation/QuestJournalUI");

    const qs = makeQuestServiceWithPending([makePendingReturnQuest()]);
    const ui = new QuestJournalUI(qs, 1280, 720, vi.fn());
    const texts = collectTexts(ui.container as unknown as TextNode);

    const emptyMsg = texts.find((t) => t.includes("пока нет квестов"));
    expect(emptyMsg).toBeUndefined();
  });

  it("names the issuer planet's system in the return prompt when a galaxy is wired", async () => {
    const { QuestJournalUI } = await import("@/presentation/QuestJournalUI");

    const galaxy = {
      systems: [
        {
          id: "sys-home",
          name: "Сириус",
          planets: [{ id: "planet-alpha", name: "Альфа" }],
        },
      ],
    };
    const qs = makeQuestServiceWithPending([
      makePendingReturnQuest({ planetId: "planet-alpha" }),
    ]);
    const ui = new QuestJournalUI(
      qs,
      1280,
      720,
      vi.fn(),
      undefined,
      0,
      undefined,
      undefined,
      galaxy,
      "sys-elsewhere", // player is in a different system
    );
    const texts = collectTexts(ui.container as unknown as TextNode);

    const returnPrompt = texts.find(
      (t) => t.includes("Вернитесь") && t.includes("система"),
    );
    expect(returnPrompt).toBeDefined();
    expect(returnPrompt).toContain("Сириус");
  });

  it("omits the system suffix when no galaxy is wired (graceful fallback)", async () => {
    const { QuestJournalUI } = await import("@/presentation/QuestJournalUI");

    const qs = makeQuestServiceWithPending([
      makePendingReturnQuest({ planetId: "planet-alpha" }),
    ]);
    const ui = new QuestJournalUI(qs, 1280, 720, vi.fn());
    const texts = collectTexts(ui.container as unknown as TextNode);

    const returnPrompt = texts.find((t) => t.includes("Вернитесь"));
    expect(returnPrompt).toBeDefined();
    expect(returnPrompt).not.toContain("система");
  });

  it("grows the card box for a long title (no overflow) but keeps a short card at the historical 80 px", async () => {
    const { QuestJournalUI } = await import("@/presentation/QuestJournalUI");

    type GfxNode = {
      rect?: { mock: { calls: unknown[][] } };
      fill?: { mock: { calls: unknown[][] } };
      children?: GfxNode[];
    };
    const pendingCardHeight = (root: GfxNode): number | null => {
      const isPendingBg = root.fill?.mock?.calls?.some(
        (c) => (c[0] as { color?: number } | undefined)?.color === 0x1a1500,
      );
      if (isPendingBg && root.rect) {
        return root.rect.mock.calls[0]?.[3] as number;
      }
      for (const child of root.children ?? []) {
        const h = pendingCardHeight(child);
        if (h != null) return h;
      }
      return null;
    };

    const shortUi = new QuestJournalUI(
      makeQuestServiceWithPending([makePendingReturnQuest({ title: "Охота" })]),
      1280,
      720,
      vi.fn(),
    );
    const shortHeight = pendingCardHeight(
      shortUi.container as unknown as GfxNode,
    );

    const longTitle =
      "Чрезвычайно длинное название задания, которое непременно " +
      "перенесётся на несколько строк и не должно вылезать за край карточки";
    const longUi = new QuestJournalUI(
      makeQuestServiceWithPending([
        makePendingReturnQuest({ title: longTitle }),
      ]),
      1280,
      720,
      vi.fn(),
    );
    const longHeight = pendingCardHeight(
      longUi.container as unknown as GfxNode,
    );

    expect(shortHeight).toBe(80); // historical compact box unchanged
    expect(longHeight).not.toBeNull();
    expect(longHeight!).toBeGreaterThan(80); // grew to fit the wrapped title
  });

  it("shows reward summary in pending-return card", async () => {
    const { QuestJournalUI } = await import("@/presentation/QuestJournalUI");

    const qs = makeQuestServiceWithPending([
      makePendingReturnQuest({
        reward: { credits: 2000, experience: 400, items: [] },
      }),
    ]);
    const ui = new QuestJournalUI(qs, 1280, 720, vi.fn());
    const texts = collectTexts(ui.container as unknown as TextNode);

    const rewardLine = texts.find(
      (t) => t.startsWith("Награда:") && t.includes("2000 кр"),
    );
    expect(rewardLine).toBeDefined();
  });
});

type ClickNode = {
  text?: string;
  eventMode?: string;
  on?: { mock: { calls: unknown[][] } };
  children?: ClickNode[];
};

function findNode(
  node: ClickNode,
  pred: (n: ClickNode) => boolean,
): ClickNode | null {
  if (pred(node)) return node;
  for (const child of node.children ?? []) {
    const found = findNode(child, pred);
    if (found) return found;
  }
  return null;
}

function findPlotRouteButton(root: ClickNode): ClickNode | null {
  return findNode(
    root,
    (n) =>
      n.eventMode === "static" &&
      (n.children ?? []).some(
        (c) =>
          typeof c.text === "string" && c.text.includes("Проложить маршрут"),
      ),
  );
}

function clickPointerdown(node: ClickNode): void {
  const call = node.on!.mock.calls.find((c) => c[0] === "pointerdown");
  expect(call).toBeDefined();
  (call![1] as (e: { stopPropagation: () => void }) => void)({
    stopPropagation: vi.fn(),
  });
}

const galaxyHosting = (planetId: string) => ({
  systems: [
    {
      id: "sys-home",
      name: "Сириус",
      planets: [{ id: planetId, name: "Альфа" }],
    },
  ],
});

describe("QuestJournalUI plot-route button (Task 3)", () => {
  it("warps toward the issuer system when the player is in another system", async () => {
    const { QuestJournalUI } = await import("@/presentation/QuestJournalUI");

    const navigate = vi.fn();
    const qs = makeQuestServiceWithPending([
      makePendingReturnQuest({ planetId: "planet-alpha" }),
    ]);
    const ui = new QuestJournalUI(
      qs,
      1280,
      720,
      vi.fn(),
      navigate,
      0,
      undefined,
      undefined,
      galaxyHosting("planet-alpha"),
      "sys-elsewhere", // player is NOT in the issuer system
    );

    const btn = findPlotRouteButton(ui.container as unknown as ClickNode);
    expect(btn).not.toBeNull();
    clickPointerdown(btn!);

    expect(navigate).toHaveBeenCalledWith("sys-home");
  });

  it("approaches the issuer planet when the player is in the same system", async () => {
    const { QuestJournalUI } = await import("@/presentation/QuestJournalUI");

    const navigate = vi.fn();
    const qs = makeQuestServiceWithPending([
      makePendingReturnQuest({ planetId: "planet-alpha" }),
    ]);
    const ui = new QuestJournalUI(
      qs,
      1280,
      720,
      vi.fn(),
      navigate,
      0,
      undefined,
      undefined,
      galaxyHosting("planet-alpha"),
      "sys-home", // player IS in the issuer system
    );

    const btn = findPlotRouteButton(ui.container as unknown as ClickNode);
    expect(btn).not.toBeNull();
    clickPointerdown(btn!);

    expect(navigate).toHaveBeenCalledWith("planet-alpha");
  });

  it("closes the journal after plotting the route", async () => {
    const { QuestJournalUI } = await import("@/presentation/QuestJournalUI");

    const onClose = vi.fn();
    const qs = makeQuestServiceWithPending([
      makePendingReturnQuest({ planetId: "planet-alpha" }),
    ]);
    const ui = new QuestJournalUI(
      qs,
      1280,
      720,
      onClose,
      vi.fn(),
      0,
      undefined,
      undefined,
      galaxyHosting("planet-alpha"),
      "sys-home",
    );

    const btn = findPlotRouteButton(ui.container as unknown as ClickNode);
    clickPointerdown(btn!);

    expect(onClose).toHaveBeenCalled();
  });

  it("hides the plot-route button when no galaxy is wired (no resolvable target)", async () => {
    const { QuestJournalUI } = await import("@/presentation/QuestJournalUI");

    const qs = makeQuestServiceWithPending([
      makePendingReturnQuest({ planetId: "planet-alpha" }),
    ]);
    const ui = new QuestJournalUI(qs, 1280, 720, vi.fn(), vi.fn());

    const btn = findPlotRouteButton(ui.container as unknown as ClickNode);
    expect(btn).toBeNull();
    const texts = collectTexts(ui.container as unknown as TextNode);
    expect(texts.some((t) => t.includes("Проложить маршрут"))).toBe(false);
  });

  it("hides the plot-route button when no navigate hook is supplied", async () => {
    const { QuestJournalUI } = await import("@/presentation/QuestJournalUI");

    const qs = makeQuestServiceWithPending([
      makePendingReturnQuest({ planetId: "planet-alpha" }),
    ]);
    const ui = new QuestJournalUI(
      qs,
      1280,
      720,
      vi.fn(),
      undefined,
      0,
      undefined,
      undefined,
      galaxyHosting("planet-alpha"),
      "sys-home",
    );

    const btn = findPlotRouteButton(ui.container as unknown as ClickNode);
    expect(btn).toBeNull();
    const texts = collectTexts(ui.container as unknown as TextNode);
    expect(texts.some((t) => t.includes("Проложить маршрут"))).toBe(false);
  });

  it("omits the system suffix and the button when the issuer planet is not in the wired galaxy", async () => {
    const { QuestJournalUI } = await import("@/presentation/QuestJournalUI");

    const qs = makeQuestServiceWithPending([
      makePendingReturnQuest({ planetId: "planet-ghost" }),
    ]);
    const ui = new QuestJournalUI(
      qs,
      1280,
      720,
      vi.fn(),
      vi.fn(),
      0,
      undefined,
      undefined,
      galaxyHosting("planet-alpha"), // hosts a different planet
      "sys-home",
    );

    const texts = collectTexts(ui.container as unknown as TextNode);
    const returnPrompt = texts.find((t) => t.includes("Вернитесь"));
    expect(returnPrompt).toBeDefined();
    expect(returnPrompt).not.toContain("система");
    expect(
      findPlotRouteButton(ui.container as unknown as ClickNode),
    ).toBeNull();
  });
});
