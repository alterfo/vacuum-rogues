export interface FilterableNode {
  filters?:
    | ReadonlyArray<{ destroy?: () => void }>
    | { destroy?: () => void }
    | null;
  children?: ReadonlyArray<unknown>;
}

export function disposeFiltersDeep(obj: FilterableNode): void {
  const fs = obj.filters;
  const arr = Array.isArray(fs) ? fs : fs ? [fs] : [];
  for (const f of arr) f.destroy?.();
  for (const child of obj.children ?? []) {
    disposeFiltersDeep(child as FilterableNode);
  }
}
