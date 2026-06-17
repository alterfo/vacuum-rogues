/**
 * Reusable window-level mouse-wheel scroll helper.
 *
 * PixiJS dispatches `wheel` only to the object directly under the pointer, so a
 * federated handler bound to a scrollable list's backdrop never fires once the
 * rows (eventMode "static") sit on top of it and swallow the event. The proven
 * fix (used by SpaceFlightScene for camera zoom) is a window-level DOM listener,
 * which sidesteps the scene graph entirely. This extracts that pattern so every
 * scrollable scene shares one implementation instead of copying it.
 */

/**
 * Map a wheel `deltaY` to a scroll direction: scroll-down (positive deltaY) → 1,
 * scroll-up (negative deltaY) → -1, no movement → 0. Pure so it is unit-testable
 * without a DOM.
 */
export function wheelDirection(deltaY: number): 1 | -1 | 0 {
  if (deltaY > 0) return 1;
  if (deltaY < 0) return -1;
  return 0;
}

/**
 * Attach a `{ passive: false }` window-level wheel listener that calls `onScroll`
 * with the scroll direction (+1 down / -1 up). Zero-delta events are ignored.
 * `preventDefault()` is called so the page does not also scroll. Returns a detach
 * function the caller must invoke in `destroy()`/close to avoid stacked listeners
 * across scene transitions.
 */
export function attachWheelScroll(onScroll: (dir: 1 | -1) => void): () => void {
  const handler = (event: WheelEvent): void => {
    const dir = wheelDirection(event.deltaY);
    if (dir === 0) return;
    event.preventDefault();
    onScroll(dir);
  };
  window.addEventListener("wheel", handler, { passive: false });
  return () => window.removeEventListener("wheel", handler);
}
