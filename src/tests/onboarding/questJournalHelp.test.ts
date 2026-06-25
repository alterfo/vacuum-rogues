import { describe, it, expect, vi } from "vitest";
import type { IQuestService } from "@/core/ports/IQuestService";

/**
 * Task 4 (onboarding): the in-flight quest journal hosts a «?» help button. When
 * an `onShowHelp` hook is wired (FlightHud mounts the shared HelpPanel for the
 * `quest-journal` key), the journal renders a «?» button whose click invokes the
 * hook; with no hook (unit tests / no help wired) the button is omitted. Mocks
 * pixi.js + captures pointer handlers so the button can be "clicked".
 */

interface FakeNode {
  text?: string;
  eventMode: string;
  handlers: Record<string, (e: unknown) => void>;
  children: FakeNode[];
}

vi.mock("pixi.js", () => {
  const makeContainer = () => {
    const node: Record<string, unknown> = {
      children: [] as unknown[],
      eventMode: "auto",
      cursor: "pointer",
      x: 0,
      y: 0,
      text: "",
      handlers: {} as Record<string, unknown>,
      anchor: { set: vi.fn() },
      destroy: vi.fn(),
      destroyed: false,
      parent: null,
    };
    node.on = vi.fn((ev: string, cb: unknown) => {
      (node.handlers as Record<string, unknown>)[ev] = cb;
      return node;
    });
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

import { QuestJournalUI } from "@/presentation/QuestJournalUI";

function makeQuestService(): IQuestService {
  return {
    getActiveQuests: vi.fn().mockReturnValue([]),
    getCompletedQuestIds: vi.fn().mockReturnValue([]),
  } as unknown as IQuestService;
}

/** Depth-first find of a node that is itself a «?» button (a static node whose
 *  children include a Text === "?"). */
function findHelpButton(root: FakeNode): FakeNode | undefined {
  for (const child of root.children) {
    if (
      child.eventMode === "static" &&
      child.children.some((c) => c.text === "?")
    ) {
      return child;
    }
    const nested = findHelpButton(child);
    if (nested) return nested;
  }
  return undefined;
}

describe("Task 4 — quest journal «?» help button", () => {
  it("renders a «?» button that invokes onShowHelp when clicked", () => {
    const onShowHelp = vi.fn();
    const journal = new QuestJournalUI(
      makeQuestService(),
      800,
      600,
      vi.fn(), // onClose
      undefined, // onNavigateToObjective
      0,
      undefined,
      undefined,
      undefined,
      "",
      onShowHelp,
    );
    const root = journal.container as unknown as FakeNode;

    const helpBtn = findHelpButton(root);
    expect(helpBtn).toBeDefined();

    helpBtn!.handlers.pointerdown({ stopPropagation: vi.fn() });
    expect(onShowHelp).toHaveBeenCalledTimes(1);
  });

  it("omits the «?» button when no onShowHelp hook is wired", () => {
    const journal = new QuestJournalUI(makeQuestService(), 800, 600, vi.fn());
    const root = journal.container as unknown as FakeNode;
    expect(findHelpButton(root)).toBeUndefined();
  });
});
