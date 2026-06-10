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

  it("panel and label content are eventMode='none' so clicks fall through to the backdrop", async () => {
    const { QuestJournalUI } = await import("@/presentation/QuestJournalUI");
    const ui = new QuestJournalUI(makeQuestService(), 1280, 720, vi.fn());
    const children = (ui.container as unknown as MockNode).children;

    // children[0] is the catch-all backdrop (static). The panel background
    // (children[1]) and the title/empty labels must be non-interactive so the
    // only hit target left for a non-button click is the swallowing backdrop.
    const panel = children[1];
    expect(panel.eventMode).toBe("none");

    // Every direct content child other than the backdrop and the close button
    // (a Container with its own static handler) must be eventMode="none".
    const interactiveContent = children
      .slice(1)
      .filter((c) => Array.isArray(c.children) && c.children.length === 0)
      .filter((c) => c.eventMode !== "none");
    expect(interactiveContent).toEqual([]);
  });
});
