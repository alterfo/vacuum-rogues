/**
 * Task 2 (plan 20260618-scrollable-list-design-and-planet-rotation): the quest
 * journal must surface EVERY active quest through a scrollable region instead of
 * the old `slice(0, maxVisible)` + non-interactive "+N ещё..." dead-end.
 *
 * These tests drive the real QuestJournalUI against a pixi.js mock (no WebGL):
 *  - few quests (<= fit count) still render directly, no scroll region;
 *  - many quests overflow into a `ScrollableList` that holds ALL of them;
 *  - the "+N ещё..." label is gone;
 *  - scrolling reaches the bottom (offset clamps to a positive maxOffset);
 *  - destroy() detaches the list's window-level wheel listener.
 *
 * Unlike the existing questJournalUI mock this one also provides `Rectangle`,
 * which `ScrollableList` constructs for its tracking hit area.
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
      mask: null,
      hitArea: null,
      anchor: { set: vi.fn() },
      on: vi.fn(function (this: unknown) {
        return this;
      }),
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
    Rectangle: vi
      .fn()
      .mockImplementation((x: number, y: number, w: number, h: number) => ({
        x,
        y,
        width: w,
        height: h,
      })),
  };
});

type TextNode = { text: string; children: TextNode[] };

function collectTexts(node: TextNode): string[] {
  const out: string[] = [];
  if (typeof node.text === "string" && node.text) out.push(node.text);
  for (const child of node.children ?? []) out.push(...collectTexts(child));
  return out;
}

function makeActiveQuest(n: number) {
  return {
    id: `q-${n}`,
    title: `Активный квест ${n}`,
    type: "DELIVERY",
    isCompleted: false,
    isFailed: false,
    objectives: [
      {
        type: "VISIT_LOCATION",
        description: "Прибыть",
        completed: false,
        currentAmount: 0,
        targetAmount: 1,
        locationId: `planet-${n}`,
      },
    ],
    reward: { credits: 100 * n, experience: 10 * n, items: [] },
  };
}

function makeQuestService(count: number): IQuestService {
  const quests = Array.from({ length: count }, (_, i) =>
    makeActiveQuest(i + 1),
  );
  return {
    getActiveQuests: vi.fn().mockReturnValue(quests),
    getCompletedQuestIds: vi.fn().mockReturnValue([]),
  } as unknown as IQuestService;
}

// panelHeight 500, active section starts at y=60 → floor((500-60-30)/140) = 2.
const FIT_COUNT = 2;

describe("QuestJournalUI active-quest scrolling (Task 2)", () => {
  it("renders few quests directly with no scroll region and no '+N ещё'", async () => {
    const { QuestJournalUI } = await import("@/presentation/QuestJournalUI");
    const ui = new QuestJournalUI(
      makeQuestService(FIT_COUNT),
      1280,
      720,
      vi.fn(),
    );

    // No scrollable list is created while everything fits.
    expect((ui as unknown as { activeList: unknown }).activeList).toBeNull();

    const texts = collectTexts(ui.container as unknown as TextNode);
    expect(texts.some((t) => /\+\d+\s*ещё/.test(t))).toBe(false);
    // Both quests rendered.
    expect(texts).toContain("Активный квест 1");
    expect(texts).toContain("Активный квест 2");
  });

  it("wraps overflowing quests in a ScrollableList holding ALL of them (no truncation)", async () => {
    const { QuestJournalUI } = await import("@/presentation/QuestJournalUI");
    const COUNT = 5;
    const ui = new QuestJournalUI(makeQuestService(COUNT), 1280, 720, vi.fn());

    const list = (
      ui as unknown as {
        activeList: {
          itemCount: number;
          overflows: boolean;
          content: { children: unknown[] };
        } | null;
      }
    ).activeList;
    expect(list).toBeTruthy();
    expect(list!.overflows).toBe(true);
    // Every quest is rendered into the scroll content — not just the first 2.
    expect(list!.itemCount).toBe(COUNT);
    expect(list!.content.children).toHaveLength(COUNT);

    // Every quest title is present in the rendered tree (reachable by scroll).
    const texts = collectTexts(ui.container as unknown as TextNode);
    for (let n = 1; n <= COUNT; n++) {
      expect(texts).toContain(`Активный квест ${n}`);
    }
  });

  it("removes the dead '+N ещё...' label when quests overflow", async () => {
    const { QuestJournalUI } = await import("@/presentation/QuestJournalUI");
    const ui = new QuestJournalUI(makeQuestService(6), 1280, 720, vi.fn());
    const texts = collectTexts(ui.container as unknown as TextNode);
    expect(texts.some((t) => /\+\d+\s*ещё/.test(t))).toBe(false);
    expect(texts.some((t) => t.includes("ещё"))).toBe(false);
  });

  it("scrolls to the bottom (offset clamps to a positive maxOffset)", async () => {
    const { QuestJournalUI } = await import("@/presentation/QuestJournalUI");
    const ui = new QuestJournalUI(makeQuestService(6), 1280, 720, vi.fn());
    const list = (
      ui as unknown as {
        activeList: {
          offset: number;
          maxOffset: number;
          scrollTo: (n: number) => void;
        };
      }
    ).activeList;

    expect(list.offset).toBe(0);
    expect(list.maxOffset).toBeGreaterThan(0);
    list.scrollTo(list.maxOffset + 9999);
    expect(list.offset).toBe(list.maxOffset);
    list.scrollTo(-50);
    expect(list.offset).toBe(0);
  });

  it("detaches the list's window wheel listener on destroy()", async () => {
    const { QuestJournalUI } = await import("@/presentation/QuestJournalUI");
    const removeSpy = vi.spyOn(window, "removeEventListener");
    try {
      const ui = new QuestJournalUI(makeQuestService(6), 1280, 720, vi.fn());
      expect(
        (ui as unknown as { activeList: unknown }).activeList,
      ).toBeTruthy();
      ui.destroy();
      expect(removeSpy).toHaveBeenCalledWith("wheel", expect.any(Function));
      expect((ui as unknown as { activeList: unknown }).activeList).toBeNull();
    } finally {
      removeSpy.mockRestore();
    }
  });
});
