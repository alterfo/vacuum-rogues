export interface VisibleNewsRange {
  first: number;
  last: number;
}

export function visibleNewsRange(
  offsets: readonly number[],
  heights: readonly number[],
  listHeight: number,
  scrollOffset: number,
): VisibleNewsRange {
  if (heights.length === 0) return { first: 0, last: 0 };

  let first = 0;
  while (
    first + 1 < offsets.length &&
    offsets[first + 1] <= scrollOffset + 0.5
  ) {
    first += 1;
  }

  const scrolledIntoFirst = Math.max(0, scrollOffset - offsets[first]);
  let filled = Math.max(0, heights[first] - scrolledIntoFirst);
  let last = first + 1;
  while (last < heights.length && filled + heights[last] <= listHeight + 0.5) {
    filled += heights[last];
    last += 1;
  }

  return { first, last };
}
