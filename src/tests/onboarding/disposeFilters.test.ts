import { describe, it, expect, vi } from "vitest";
import {
  disposeFiltersDeep,
  type FilterableNode,
} from "@/presentation/flight/disposeFilters";

describe("disposeFiltersDeep", () => {
  it("destroys every filter in an array", () => {
    const a = vi.fn();
    const b = vi.fn();
    disposeFiltersDeep({ filters: [{ destroy: a }, { destroy: b }] });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("destroys a single (non-array) filter", () => {
    const destroy = vi.fn();
    disposeFiltersDeep({ filters: { destroy } });
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("recurses into children, destroying nested filters", () => {
    const root = vi.fn();
    const leaf = vi.fn();
    const node: FilterableNode = {
      filters: { destroy: root },
      children: [
        { children: [{ filters: [{ destroy: leaf }] }] } as FilterableNode,
      ],
    };
    disposeFiltersDeep(node);
    expect(root).toHaveBeenCalledTimes(1);
    expect(leaf).toHaveBeenCalledTimes(1);
  });

  it("is a no-op for null/undefined/empty filters and no children", () => {
    expect(() => disposeFiltersDeep({ filters: null })).not.toThrow();
    expect(() => disposeFiltersDeep({ filters: [] })).not.toThrow();
    expect(() => disposeFiltersDeep({})).not.toThrow();
  });

  it("tolerates a filter with no destroy method", () => {
    expect(() =>
      disposeFiltersDeep({ filters: [{}, { destroy: undefined }] }),
    ).not.toThrow();
  });
});
