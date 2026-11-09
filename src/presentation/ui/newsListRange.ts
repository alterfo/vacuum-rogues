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

  const windowBottom = scrollOffset + listHeight;
  let last = first + 1;
  while (last < heights.length && offsets[last] < windowBottom - 0.5) {
    last += 1;
  }

  return { first, last };
}
