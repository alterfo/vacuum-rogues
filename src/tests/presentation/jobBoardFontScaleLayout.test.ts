/**
 * Task 1 (font-scale layout & galaxy faction bug-fix pack,
 * `docs/plans/20260708-font-scale-and-faction-bugs.md`): regression test for
 * the JobBoardPanel row-height bug — `ROW_H`/`ROW_H_OFFER` are fixed pixel
 * constants independent of `scaledFont`'s taller line height at "L" scale, and
 * the title is truncated by character count instead of word-wrap. Both let a
 * long quest's rendered content overflow its own row's drawn background, or
 * lose the tail of the title outright.
 *
 * PixiJS text metrics (`.width`/`.height` on a `Text`) need a real canvas
 * backend jsdom doesn't provide (see `questCardLayout.ts`'s block comment), so
 * this test instead reads each row's drawn box via `Graphics.getLocalBounds()`
 * (geometry-derived — works without a renderer, see `planetSpriteMask.test.ts`)
 * and estimates the wrapped description height with the same
 * `estimateWrappedLines`/`lineStepFor` upper-bound math `questCardLayout.ts`
 * already uses for `QuestJournalUI`'s dynamic card height.
 */
import { describe, it, expect, afterEach } from "vitest";
import { Container, Graphics, Text } from "pixi.js";
import { JobBoardPanel } from "@/presentation/JobBoardPanel";
import { setFontScale, scaledFont } from "@/utils/fontScale";
import {
  estimateWrappedLines,
  lineStepFor,
} from "@/presentation/ui/questCardLayout";
import { QuestType } from "@/types";
import type { GeneratedQuest } from "@/systems/quests/QuestGenerator";
import type { Quest } from "@/domain/Quest";
import type { QuestTemplate } from "@/systems/QuestManager";

afterEach(() => setFontScale("M")); // never leak a scale into other tests

const PANEL_W = 520; // mirrors JobBoardPanel.W (private)
const DESC_WRAP_WIDTH = PANEL_W - 120; // mirrors addRow's description wordWrapWidth

const LONG_TITLE =
  "Очень длинное название задания которое обязательно переносится по словам";
const LONG_DESCRIPTION =
  "Это очень длинное описание задания которое обязательно должно занимать " +
  "несколько строк текста внутри карточки предложения на панели заданий " +
  "чтобы гарантированно переполнить фиксированную высоту строки при " +
  "крупном размере шрифта настройки интерфейса.";

function makeQuest(
  id: string,
  title: string,
  description: string,
): GeneratedQuest {
  const template = {
    id,
    title,
    description,
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
    issuerName: "Маклай",
    issuerTitle: "Снабженец",
    targetNpcName: null,
    highlights: [],
    issuerPlanetId: "planet-1",
  } as unknown as GeneratedQuest;
}

/** Recursively collects every descendant `Text` node. */
function collectTexts(node: Container): Text[] {
  const out: Text[] = [];
  const visit = (n: Container): void => {
    if (n instanceof Text) out.push(n);
    for (const c of (n.children ?? []) as Container[]) visit(c);
  };
  visit(node);
  return out;
}

/**
 * The offer-row list container: a plain `new Container()` with no fields of
 * its own, so `.constructor === Container` distinguishes it from `Graphics`/
 * `Text` children, which also `instanceof Container` in PixiJS 8's chain.
 */
function findOffersContainer(panel: JobBoardPanel): Container {
  const offers = panel.container.children.find(
    (c) => c.constructor === Container,
  ) as Container | undefined;
  expect(offers, "expected the offers list Container").toBeTruthy();
  return offers!;
}

describe("JobBoardPanel offer rows at L font scale", () => {
  it("keeps the description within the row's own drawn background box", () => {
    setFontScale("L");
    const quests = [
      makeQuest("q1", LONG_TITLE, LONG_DESCRIPTION),
      makeQuest("q2", "Короткое задание", "Короткое описание."),
    ];
    const panel = new JobBoardPanel(quests, 800, 900, {
      onAccept: () => {},
      onClose: () => {},
    });

    const offers = findOffersContainer(panel);
    // Row backgrounds are `roundRect(10, y, W-20, rowH)` — width ~500. The
    // narrower "Принять" button backgrounds (width 74) are filtered out.
    const rowBoxes = offers.children
      .filter((c): c is Graphics => c instanceof Graphics)
      .map((g) => g.getLocalBounds())
      .filter((b) => b.width > 400);
    expect(rowBoxes.length).toBe(2);
    const [rowA, rowB] = rowBoxes;

    const descText = collectTexts(panel.container).find(
      (t) => t.text === LONG_DESCRIPTION,
    );
    expect(descText, "expected the description Text node").toBeTruthy();

    const fontPx = scaledFont(13);
    const lines = estimateWrappedLines(
      LONG_DESCRIPTION,
      DESC_WRAP_WIDTH,
      fontPx,
    );
    const descBottom = descText!.y + lines * lineStepFor(fontPx);

    // The bug: ROW_H_OFFER is a fixed constant, so a long wrapped description
    // at "L" scale overflows past the row's own drawn background box.
    expect(descBottom).toBeLessThanOrEqual(rowA.y + rowA.height);
    // Rows must never overlap each other either.
    expect(rowB.y).toBeGreaterThanOrEqual(rowA.y + rowA.height);
  });

  it("preserves the full title instead of truncating it by character count", () => {
    setFontScale("L");
    const panel = new JobBoardPanel(
      [makeQuest("q1", LONG_TITLE, "Короткое описание.")],
      800,
      900,
      { onAccept: () => {}, onClose: () => {} },
    );
    const titleText = collectTexts(panel.container).find((t) =>
      t.text.startsWith(LONG_TITLE.slice(0, 20)),
    );
    expect(titleText, "expected the title Text node").toBeTruthy();
    // Character-count truncation (`tpl.title.length > 36 ? slice(0,35)+"…" : …`)
    // must be replaced by word-wrap that keeps the full string.
    expect(titleText!.text).toBe(LONG_TITLE);
  });
});

describe("JobBoardPanel active-quest rows at L font scale", () => {
  it("does not truncate a long active-quest title by character count", () => {
    setFontScale("L");
    const activeQuest = {
      type: QuestType.DELIVERY,
      title: LONG_TITLE,
      deadline: 0,
      getRemainingDays: () => 0,
    } as unknown as Quest;
    const panel = new JobBoardPanel(
      [],
      800,
      900,
      { onAccept: () => {}, onClose: () => {} },
      0,
      new Set(),
      [activeQuest],
      0,
    );
    const titleText = collectTexts(panel.container).find((t) =>
      t.text.startsWith(LONG_TITLE.slice(0, 20)),
    );
    expect(titleText, "expected the active-row title Text node").toBeTruthy();
    // Same character-count truncation bug (`q.title.length > 28 ? … : …`) in
    // `addActiveRow` must be replaced by word-wrap that keeps the full string.
    expect(titleText!.text).toBe(LONG_TITLE);
  });
});
