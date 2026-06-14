/**
 * Task 7: QuestJournalUI must render a "ВЫПОЛНЕНО — ЗАБРАТЬ НАГРАДУ" section
 * for quests in pending-return state (objectives done, reward not yet claimed).
 */
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

    // The readable name is shown; the raw id is not leaked to the player.
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
