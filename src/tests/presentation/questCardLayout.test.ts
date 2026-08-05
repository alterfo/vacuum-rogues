import { describe, it, expect } from "vitest";
import {
  estimateWrappedLines,
  layoutQuestCard,
  lineStepFor,
  MIN_CARD_HEIGHT,
  type QuestCardMetrics,
} from "@/presentation/ui/questCardLayout";

const METRICS: QuestCardMetrics = {
  fontSizePx: 13,
  titleWrapWidth: 600 - 160,
  bodyWrapWidth: 600 - 220,
};

const SHORT = {
  title: "Доставить груз",
  objectives: ["○ Прибыть: 0/1"],
  rewardLine: "Награда: 100 кр, 10 опыт",
  hasHighlights: false,
};

describe("estimateWrappedLines", () => {
  it("returns 1 line for empty or short text", () => {
    expect(estimateWrappedLines("", 380, 13)).toBe(1);
    expect(estimateWrappedLines("Прибыть", 380, 13)).toBe(1);
  });

  it("returns more lines as the text gets longer (monotonic upper bound)", () => {
    const short = estimateWrappedLines("Короткая цель", 380, 13);
    const long = estimateWrappedLines(
      "Очень длинное описание цели которое точно не помещается в одну строку карточки квеста и переносится",
      380,
      13,
    );
    expect(long).toBeGreaterThan(short);
    expect(long).toBeGreaterThanOrEqual(2);
  });

  it("counts hard newlines as separate lines", () => {
    expect(estimateWrappedLines("строка1\nстрока2\nстрока3", 9999, 13)).toBe(3);
  });

  it("wraps to more lines as the width shrinks", () => {
    const text =
      "Описание средней длины для проверки переноса при разной ширине";
    const wide = estimateWrappedLines(text, 1000, 13);
    const narrow = estimateWrappedLines(text, 120, 13);
    expect(narrow).toBeGreaterThan(wide);
  });
});

describe("layoutQuestCard", () => {
  it("keeps a short, single-objective card under the historical 130 px floor", () => {
    const layout = layoutQuestCard(SHORT, METRICS);
    expect(layout.contentHeight).toBeLessThan(MIN_CARD_HEIGHT);
  });

  it("grows the card when the title wraps to multiple lines", () => {
    const tallTitle = layoutQuestCard(
      {
        ...SHORT,
        title:
          "Очень длинное название квеста которое переносится на несколько строк внутри карточки журнала",
      },
      METRICS,
    );
    const short = layoutQuestCard(SHORT, METRICS);
    expect(tallTitle.contentHeight).toBeGreaterThan(short.contentHeight);
    expect(tallTitle.objectiveYs[0]).toBeGreaterThan(short.objectiveYs[0]);
  });

  it("grows the card with each additional objective and never overlaps rows", () => {
    const many = layoutQuestCard(
      {
        ...SHORT,
        objectives: [
          "○ Цель 1: 0/1",
          "○ Цель 2: 0/1",
          "○ Цель 3: 0/1",
          "○ Цель 4: 0/1",
          "○ Цель 5: 0/1",
        ],
      },
      METRICS,
    );
    const one = layoutQuestCard(SHORT, METRICS);
    expect(many.contentHeight).toBeGreaterThan(one.contentHeight);

    for (let i = 1; i < many.objectiveYs.length; i++) {
      expect(many.objectiveYs[i]).toBeGreaterThan(many.objectiveYs[i - 1]);
    }
    const lastObjY = many.objectiveYs[many.objectiveYs.length - 1];
    expect(many.rewardY).toBeGreaterThan(lastObjY);
    expect(many.rewardY).toBeLessThan(many.contentHeight);
  });

  it("grows the card when a long objective wraps to several lines", () => {
    const wrapped = layoutQuestCard(
      {
        ...SHORT,
        objectives: [
          "○ Доставить очень крупную партию редких медикаментов на дальнюю орбитальную станцию системы: 0/30",
        ],
      },
      METRICS,
    );
    const short = layoutQuestCard(SHORT, METRICS);
    expect(wrapped.contentHeight).toBeGreaterThan(short.contentHeight);
    expect(wrapped.rewardY - wrapped.objectiveYs[0]).toBeGreaterThan(
      lineStepFor(METRICS.fontSizePx),
    );
  });

  it("reserves an extra row when highlights are present", () => {
    const withTags = layoutQuestCard(
      { ...SHORT, hasHighlights: true },
      METRICS,
    );
    const without = layoutQuestCard(SHORT, METRICS);
    expect(withTags.contentHeight).toBeGreaterThan(without.contentHeight);
    expect(withTags.highlightsY).toBeGreaterThan(withTags.rewardY);
    expect(withTags.highlightsY).toBeLessThan(withTags.contentHeight);
  });
});
