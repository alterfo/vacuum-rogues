/**
 * Playtest3 F6 regression: the QuestJournalUI full-screen backdrop must swallow
 * pointer events. Without a stopPropagation handler, a click on the empty
 * journal area bubbles to the stage route-planning handler and plans a route
 * behind the modal (CLAUDE.md Rule 2 — eventMode="static" is a hit target, not
 * a bubble blocker). Mocks pixi.js so no WebGL/texture context is needed.
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

/** A quest service with one active quest carrying a VISIT_LOCATION objective so
 * the journal renders a populated card AND a "→ Лететь к цели" navigate button. */
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

/**
 * Walk the journal tree and collect every NON-button leaf whose eventMode is not
 * "none". A "button" (and the catch-all backdrop) is an eventMode="static" node;
 * its subtree is interactive by design and stops propagation itself, so we skip
 * it. Any OTHER leaf that is not "none" is a click that would bubble to the
 * stage route handler behind the modal (the F6 leak).
 */
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

    // The backdrop is the first child added to the journal container.
    const backdrop = (ui.container as unknown as MockNode).children[0];
    expect(backdrop).toBeDefined();
    expect(backdrop.eventMode).toBe("static");

    // It must register a pointerdown listener (the bubble-blocker).
    const pointerdown = backdrop.on.mock.calls.find(
      (c: unknown[]) => c[0] === "pointerdown",
    );
    expect(pointerdown).toBeDefined();

    // Invoking that listener must call stopPropagation on the event.
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

    // children[0] is the catch-all backdrop (static). The panel background must
    // be non-interactive so the only hit target left for a non-button click is
    // the swallowing backdrop.
    expect(root.children[1].eventMode).toBe("none");

    // No non-button leaf anywhere in the tree may bubble (recurses, skipping the
    // backdrop and the close button — both static).
    expect(collectLeakyLeaves(root)).toEqual([]);
  });

  it("populated quest cards and their labels are eventMode='none' (only the buttons stay interactive)", async () => {
    const { QuestJournalUI } = await import("@/presentation/QuestJournalUI");
    // 5th arg (onNavigateToObjective) defined so the VISIT_LOCATION nav button
    // renders — its inner bg/text default to interactive, so this guards that
    // the recursion's button-skip is the ONLY interactive exception.
    const ui = new QuestJournalUI(
      makeQuestServiceWithQuest(),
      1280,
      720,
      vi.fn(),
      vi.fn(),
    );
    const root = ui.container as unknown as MockNode;

    // A quest card (a NON-static Container — the close button is also a
    // multi-child container but it is static) was actually created.
    const card = root.children.find(
      (c) =>
        c.eventMode !== "static" &&
        Array.isArray(c.children) &&
        c.children.length > 1,
    );
    expect(card).toBeDefined();

    // The navigate button exists and is interactive (static) — proves the card
    // path rendered and that buttons are NOT swallowed by the none-sweep.
    const navButton = card!.children.find((c) => c.eventMode === "static");
    expect(navButton).toBeDefined();

    // Every NON-button leaf across the populated tree (card bg, title, type,
    // objective text) must be eventMode="none" so the backdrop catches the click.
    expect(collectLeakyLeaves(root)).toEqual([]);
  });
});
