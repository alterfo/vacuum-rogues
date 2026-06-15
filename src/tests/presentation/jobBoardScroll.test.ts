/**
 * UI bug fix (playtest, 2026-06-15): the Job Board had no scrolling, so with
 * ≥4 offers the rows ran off the bottom of the screen and the "Принять"
 * buttons were unreachable. This pins the scroll behaviour:
 *   - the panel height is capped to the screen (never overflows),
 *   - scrolling shifts the offers' visible area,
 *   - no scroll indicator appears when everything already fits.
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
      alpha: 1,
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      text: "",
      mask: null,
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
  text: string;
  children: MockNode[];
};

function collectTexts(node: MockNode): string[] {
  const texts: string[] = [];
  if (node.text) texts.push(node.text);
  for (const child of node.children ?? []) {
    texts.push(...collectTexts(child));
  }
  return texts;
}

function makeQuest(i: number): GeneratedQuest {
  const template = {
    id: `quest-${i}`,
    title: `Test Quest ${i}`,
    description: "desc",
    type: QuestType.DELIVERY,
    reward: { credits: 500, experience: 0, items: [] },
    failurePenalty: null,
    objectives: [],
    deadline: 0,
    minReputation: 0,
    minRank: 0,
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

const SCREEN_W = 800;
const SCREEN_H = 600;

describe("JobBoardPanel scrolling", () => {
  it("caps the panel height to the screen when there are many offers", async () => {
    const { JobBoardPanel } = await import("@/presentation/JobBoardPanel");
    const quests = Array.from({ length: 6 }, (_, i) => makeQuest(i));
    const panel = new JobBoardPanel(quests, SCREEN_W, SCREEN_H, {
      onAccept: vi.fn(),
      onClose: vi.fn(),
    });
    // 6 offers × 130 + chrome would be > 600; the panel must stay on-screen.
    expect(panel.panelHeight).toBeLessThanOrEqual(SCREEN_H - 16);
  });

  it("shifts the offers container when scrolled", async () => {
    const { JobBoardPanel } = await import("@/presentation/JobBoardPanel");
    const quests = Array.from({ length: 6 }, (_, i) => makeQuest(i));
    const panel = new JobBoardPanel(quests, SCREEN_W, SCREEN_H, {
      onAccept: vi.fn(),
      onClose: vi.fn(),
    });
    const offers = (
      panel as unknown as { offersContainer: { y: number } | null }
    ).offersContainer;
    expect(offers).not.toBeNull();
    expect(offers!.y).toBe(0);
    panel.scrollOffers(1, 3);
    expect(offers!.y).toBeLessThan(0);
    // Scrolling back to the top restores the original offset.
    panel.scrollOffers(-10, 3);
    expect(offers!.y).toBe(0);
  });

  it("clips offer hit-testing to the visible window as it scrolls", async () => {
    // A PixiJS mask clips RENDERING only; without a tracking hitArea the
    // scrolled-out rows' "Принять" buttons would stay clickable in their old
    // on-screen spots. The hit window must stay fixed on screen while content
    // scrolls under it.
    const { JobBoardPanel } = await import("@/presentation/JobBoardPanel");
    const quests = Array.from({ length: 6 }, (_, i) => makeQuest(i));
    const panel = new JobBoardPanel(quests, SCREEN_W, SCREEN_H, {
      onAccept: vi.fn(),
      onClose: vi.fn(),
    });
    const offers = (
      panel as unknown as {
        offersContainer: { y: number; hitArea: { y: number } | null } | null;
      }
    ).offersContainer;
    expect(offers).not.toBeNull();
    expect(offers!.hitArea).toBeTruthy();
    // On-screen top of the hit window = local hitArea.y + container offset.
    const worldTop = offers!.hitArea!.y + offers!.y;
    panel.scrollOffers(1, 5);
    expect(offers!.y).toBeLessThan(0);
    expect(offers!.hitArea!.y + offers!.y).toBeCloseTo(worldTop, 5);
  });

  it("scrolls the offers when the panel receives a wheel event", async () => {
    const { JobBoardPanel } = await import("@/presentation/JobBoardPanel");
    const quests = Array.from({ length: 6 }, (_, i) => makeQuest(i));
    const panel = new JobBoardPanel(quests, SCREEN_W, SCREEN_H, {
      onAccept: vi.fn(),
      onClose: vi.fn(),
    });
    const onCalls = (
      panel.container as unknown as {
        on: { mock: { calls: [string, (e: { deltaY: number }) => void][] } };
      }
    ).on.mock.calls;
    const wheel = onCalls.find((c) => c[0] === "wheel")?.[1];
    expect(wheel).toBeDefined();
    const offers = (
      panel as unknown as { offersContainer: { y: number } | null }
    ).offersContainer;
    expect(offers!.y).toBe(0);
    wheel!({ deltaY: 100 });
    expect(offers!.y).toBeLessThan(0);
    wheel!({ deltaY: -100 });
    expect(offers!.y).toBe(0);
  });

  it("shows scroll arrows only when content overflows", async () => {
    const { JobBoardPanel } = await import("@/presentation/JobBoardPanel");

    const many = Array.from({ length: 6 }, (_, i) => makeQuest(i));
    const big = new JobBoardPanel(many, SCREEN_W, SCREEN_H, {
      onAccept: vi.fn(),
      onClose: vi.fn(),
    });
    const bigTexts = collectTexts(big.container as unknown as MockNode);
    expect(bigTexts).toContain("▼");

    const few = [makeQuest(0)];
    const small = new JobBoardPanel(few, SCREEN_W, SCREEN_H, {
      onAccept: vi.fn(),
      onClose: vi.fn(),
    });
    const smallTexts = collectTexts(small.container as unknown as MockNode);
    expect(smallTexts).not.toContain("▼");
    expect(smallTexts).not.toContain("▲");
  });
});
