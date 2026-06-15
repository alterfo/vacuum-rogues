/**
 * Task 4: minRank check in JobBoardPanel.
 * Verifies that quests with a minimum rank requirement disable the "Принять"
 * button for players who don't meet the threshold, and enable it for those who do.
 */
import { describe, it, expect, vi } from "vitest";
import type { GeneratedQuest } from "@/systems/quests/QuestGenerator";
import type { QuestTemplate } from "@/systems/QuestManager";
import { QuestType } from "@/types";

vi.mock("pixi.js", () => {
  const makeContainer = () => {
    const node: Record<string, unknown> = {
      children: [] as unknown[],
      eventMode: "auto",
      cursor: "",
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      text: "",
      anchor: { set: vi.fn() },
      on: vi.fn(),
      destroy: vi.fn(),
      destroyed: false,
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

type MockNode = {
  eventMode: string;
  cursor: string;
  text: string;
  children: MockNode[];
  on: ReturnType<typeof vi.fn>;
};

function makeQuest(minRank: number): GeneratedQuest {
  const template = {
    id: `quest-rank-${minRank}`,
    title: "Test Quest",
    description: "desc",
    type: QuestType.BOUNTY,
    reward: { credits: 500, experience: 0, items: [] },
    failurePenalty: null,
    objectives: [],
    deadline: 0,
    minReputation: 0,
    minRank,
  } as unknown as QuestTemplate;
  return {
    template,
    jumps: 1,
    issuerName: null,
    issuerTitle: null,
    targetNpcName: null,
    highlights: [],
    issuerPlanetId: "planet-1",
  } as unknown as GeneratedQuest;
}

function collectTexts(node: MockNode): string[] {
  const texts: string[] = [];
  if (node.text) texts.push(node.text);
  for (const child of node.children ?? []) {
    texts.push(...collectTexts(child));
  }
  return texts;
}

describe("JobBoardPanel minRank gating", () => {
  it("disables the accept button when playerRank < quest.minRank", async () => {
    const { JobBoardPanel } = await import("@/presentation/JobBoardPanel");
    const quest = makeQuest(3);
    const panel = new JobBoardPanel(
      [quest],
      800,
      600,
      { onAccept: vi.fn(), onClose: vi.fn() },
      0, // activeQuestCount
      new Set(),
      [],
      0,
      1, // playerRank = 1 < minRank = 3
    );

    const texts = collectTexts(panel.container as unknown as MockNode);
    // Button should show rank requirement, not "Принять"
    expect(texts).toContain("Ранг 3+");
    expect(texts).not.toContain("Принять");
  });

  it("enables the accept button when playerRank >= quest.minRank", async () => {
    const { JobBoardPanel } = await import("@/presentation/JobBoardPanel");
    const quest = makeQuest(3);
    const panel = new JobBoardPanel(
      [quest],
      800,
      600,
      { onAccept: vi.fn(), onClose: vi.fn() },
      0, // activeQuestCount
      new Set(),
      [],
      0,
      5, // playerRank = 5 >= minRank = 3
    );

    const texts = collectTexts(panel.container as unknown as MockNode);
    expect(texts).toContain("Принять");
    expect(texts.some((t) => t.startsWith("Ранг"))).toBe(false);
  });

  it("treats minRank=0 (no requirement) as always accessible", async () => {
    const { JobBoardPanel } = await import("@/presentation/JobBoardPanel");
    const quest = makeQuest(0);
    const panel = new JobBoardPanel(
      [quest],
      800,
      600,
      { onAccept: vi.fn(), onClose: vi.fn() },
      0,
      new Set(),
      [],
      0,
      0, // playerRank = 0
    );

    const texts = collectTexts(panel.container as unknown as MockNode);
    expect(texts).toContain("Принять");
  });
});
