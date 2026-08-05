import { describe, it, expect, afterEach } from "vitest";
import { Container, Graphics, Text } from "pixi.js";
import { JobBoardPanel } from "@/presentation/JobBoardPanel";
import { setFontScale, scaledFont } from "@/utils/fontScale";
import {
  estimateWrappedLines,
  lineStepFor,
} from "@/presentation/ui/questCardLayout";
import { computeRowLayout } from "@/presentation/ui/jobBoardRowLayout";
import { QuestType } from "@/types";
import type { GeneratedQuest } from "@/systems/quests/QuestGenerator";
import type { Quest } from "@/domain/Quest";
import type { QuestTemplate } from "@/systems/QuestManager";
import { t as translate } from "@/i18n/i18n";

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

function collectTexts(node: Container): Text[] {
  const out: Text[] = [];
  const visit = (n: Container): void => {
    if (n instanceof Text) out.push(n);
    for (const c of (n.children ?? []) as Container[]) visit(c);
  };
  visit(node);
  return out;
}

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

    expect(descBottom).toBeLessThanOrEqual(rowA.y + rowA.height);
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
    expect(titleText!.text).toBe(LONG_TITLE);
  });

  it("keeps the reward badge clear of the (now word-wrapped) title line", () => {
    setFontScale("L");
    const panel = new JobBoardPanel(
      [makeQuest("q1", LONG_TITLE, "Короткое описание.")],
      800,
      900,
      { onAccept: () => {}, onClose: () => {} },
    );
    const texts = collectTexts(panel.container);
    const titleText = texts.find((t) => t.text === LONG_TITLE);
    const rewardText = texts.find((t) => t.text.includes("💰"));
    expect(titleText, "expected the title Text node").toBeTruthy();
    expect(rewardText, "expected the reward badge Text node").toBeTruthy();
    const rewardBottom = rewardText!.y + lineStepFor(scaledFont(13));
    expect(rewardBottom).toBeLessThanOrEqual(titleText!.y);
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
    expect(titleText!.text).toBe(LONG_TITLE);
  });

  it("keeps the countdown badge clear of the (now word-wrapped) title line", () => {
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
    const texts = collectTexts(panel.container);
    const titleText = texts.find((t) => t.text === LONG_TITLE);
    const countdownText = texts.find(
      (t) => t.text === translate("jobBoard.noDeadline"),
    );
    expect(titleText, "expected the active-row title Text node").toBeTruthy();
    expect(
      countdownText,
      "expected the countdown badge Text node",
    ).toBeTruthy();
    const countdownBottom = countdownText!.y + lineStepFor(scaledFont(11));
    expect(countdownBottom).toBeLessThanOrEqual(titleText!.y);
  });
});

describe("computeRowLayout gap accounting", () => {
  it("keeps a fully-empty active row at the historical MIN_ACTIVE_ROW_H floor", () => {
    setFontScale("M");
    const layout = computeRowLayout(
      {
        title: "Короткое",
        hasIssuer: false,
        description: "",
        hasHighlights: false,
      },
      {
        wrapWidth: 380,
        tagFontPx: scaledFont(11),
        metaFontPx: scaledFont(11),
        titleFontPx: scaledFont(12),
        issuerFontPx: scaledFont(10),
        descFontPx: scaledFont(13),
        highlightsFontPx: scaledFont(11),
        minHeight: 54,
      },
    );
    expect(layout.contentHeight).toBe(54);
  });
});
