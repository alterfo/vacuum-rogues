/** Minimal structural view of a display object for recursive filter disposal. */
export interface FilterableNode {
  filters?:
    | ReadonlyArray<{ destroy?: () => void }>
    | { destroy?: () => void }
    | null;
  children?: ReadonlyArray<unknown>;
}

/**
 * Recursively destroy every filter attached to a display-object subtree.
 * PixiJS v8 `Container.destroy({children})` removes display objects but does NOT
 * dispose their `filters` — each BlurFilter holds a GPU render texture that leaks
 * on every scene teardown otherwise. Call this before tearing a layer down.
 *
 * Extracted from `SpaceFlightScene` (pure, no scene state) so the controller
 * stays under its line-count guard.
 */
export function disposeFiltersDeep(obj: FilterableNode): void {
  const fs = obj.filters;
  const arr = Array.isArray(fs) ? fs : fs ? [fs] : [];
  for (const f of arr) f.destroy?.();
  for (const child of obj.children ?? []) {
    disposeFiltersDeep(child as FilterableNode);
  }
}
