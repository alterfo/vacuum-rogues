import { describe, it, expect, afterEach } from "vitest";
import { setFontScale, scaledFont } from "@/utils/fontScale";
import { lineStepFor } from "@/presentation/ui/questCardLayout";
import {
  boardHead,
  scrollArrowOffset,
  highlightTagXs,
  HIGHLIGHT_TAG_BASE_PX,
  BOARD_TITLE_BASE_PX,
  BOARD_NOTE_BASE_PX,
  SCROLL_HINT_BASE_PX,
  SCROLL_ARROW_BASE_PX,
} from "@/presentation/ui/jobBoardChrome";
import { MONO_CHAR_WIDTH_RATIO } from "@/presentation/ui/questCardLayout";

afterEach(() => setFontScale("M"));

describe("job board head: the quest-cap note sits clear of the title", () => {
  for (const scale of ["S", "M", "L"] as const) {
    it(`font scale ${scale}: note starts below the title and fits inside the head`, () => {
      setFontScale(scale);
      const head = boardHead(true);
      const titleBottom =
        head.titleY + lineStepFor(scaledFont(BOARD_TITLE_BASE_PX));
      expect(head.noteY).toBeGreaterThanOrEqual(titleBottom);
      const noteBottom =
        head.noteY + lineStepFor(scaledFont(BOARD_NOTE_BASE_PX));
      expect(head.height).toBeGreaterThanOrEqual(noteBottom);
    });
  }

  it("without the cap note the head keeps its compact height", () => {
    expect(boardHead(false).height).toBeLessThan(boardHead(true).height);
  });
});

describe("job board scroll controls: arrows clear the hint text", () => {
  for (const scale of ["S", "M", "L"] as const) {
    it(`font scale ${scale}: the arrow's inner edge is outside the hint's half width`, () => {
      setFontScale(scale);
      const hint = "колесо / стрелки";
      const offset = scrollArrowOffset(hint);
      const hintHalf =
        (hint.length *
          scaledFont(SCROLL_HINT_BASE_PX) *
          MONO_CHAR_WIDTH_RATIO) /
        2;
      const arrowHalf = scaledFont(SCROLL_ARROW_BASE_PX) / 2;
      expect(offset - arrowHalf).toBeGreaterThanOrEqual(hintHalf);
    });
  }

  it("a longer hint pushes the arrows further out", () => {
    expect(
      scrollArrowOffset("колесо мыши / стрелки клавиатуры"),
    ).toBeGreaterThan(scrollArrowOffset("колесо"));
  });
});

describe("job board highlight tags: tags never overlap each other", () => {
  const tags = [
    "[Груз: предметы роскоши]",
    "[Система: Бастион]",
    "[Выдан: Протон]",
  ];
  const widthOf = (text: string) =>
    text.length * scaledFont(HIGHLIGHT_TAG_BASE_PX) * MONO_CHAR_WIDTH_RATIO;

  for (const scale of ["S", "M", "L"] as const) {
    it(`font scale ${scale}: consecutive tags are separated by their full width`, () => {
      setFontScale(scale);
      const xs = highlightTagXs(tags, 20, 900);
      for (let i = 0; i + 1 < xs.length; i++) {
        expect(xs[i] + widthOf(tags[i])).toBeLessThanOrEqual(xs[i + 1]);
      }
    });

    it(`font scale ${scale}: every placed tag ends before the right limit`, () => {
      setFontScale(scale);
      const limit = 420;
      const xs = highlightTagXs(tags, 20, limit);
      xs.forEach((x, i) => {
        expect(x + widthOf(tags[i])).toBeLessThanOrEqual(limit);
      });
    });
  }

  it("the first tag starts at the left edge and a short tag set uses all tags", () => {
    expect(highlightTagXs(["[a]", "[b]"], 20, 500)).toEqual([
      20,
      expect.any(Number),
    ]);
  });

  it("tags that cannot fit are dropped instead of overlapping", () => {
    const xs = highlightTagXs(tags, 20, 200);
    expect(xs.length).toBeLessThan(tags.length);
  });
});
