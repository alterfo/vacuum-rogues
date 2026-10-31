import { describe, expect, it } from "vitest";
import { visibleNewsRange } from "@/presentation/ui/newsListRange";

const ROW = 38;

function rowHeights(count: number): number[] {
  return Array.from({ length: count }, () => ROW);
}

function offsets(heights: readonly number[]): number[] {
  const result: number[] = [];
  let running = 0;
  for (const height of heights) {
    result.push(running);
    running += height;
  }
  return result;
}

describe("visibleNewsRange", () => {
  it("includes the final visible row when scrolled to the clamped bottom", () => {
    const heights = rowHeights(30);
    const range = visibleNewsRange(offsets(heights), heights, 200, 940);
    expect(range).toEqual({ first: 24, last: 30 });
  });

  it("reports a full window from the top", () => {
    const heights = rowHeights(30);
    const range = visibleNewsRange(offsets(heights), heights, 200, 0);
    expect(range.first).toBe(0);
    expect(range.last).toBe(6);
  });

  it("includes the partially visible middle row after one ArrowDown step", () => {
    const heights = rowHeights(30);
    const range = visibleNewsRange(offsets(heights), heights, 200, 38);
    expect(range).toEqual({ first: 1, last: 7 });
  });

  it("includes the trailing partial row at a non-boundary drag offset", () => {
    const heights = rowHeights(30);
    const range = visibleNewsRange(offsets(heights), heights, 200, 939);
    expect(range).toEqual({ first: 24, last: 30 });
  });

  it("returns an empty range for an empty list", () => {
    expect(visibleNewsRange([], [], 200, 0)).toEqual({ first: 0, last: 0 });
  });

  it("handles variable heights without skipping a partially visible row", () => {
    const heights = [120, 38, 38, 38];
    const range = visibleNewsRange(offsets(heights), heights, 150, 100);
    expect(range).toEqual({ first: 0, last: 4 });
  });
});
