export const DRAG_THRESHOLD = 8;

/**
 * Tracks pan and drag state for the space flight camera.
 * Extracted from SpaceFlightScene so the logic can be unit-tested without a
 * PixiJS context and to keep SpaceFlightScene below the 30-line logic cap.
 */
export class PanZoomController {
  private _isPanning = false;
  private _lastPanX = 0;
  private _lastPanY = 0;
  private _dragStartX = 0;
  private _dragStartY = 0;
  private _dragDistance = 0;
  // True only when startDragTracking was called for the current pointer gesture.
  // Prevents shouldSwallowClick() from firing when pointerdown was intercepted by
  // a child (planet/NPC) and the stage handler never ran — stale _dragStartX/Y
  // would otherwise produce a large _dragDistance and clear the freshly-set route.
  private _dragTrackingActive = false;

  get isPanning(): boolean {
    return this._isPanning;
  }

  get dragDistance(): number {
    return this._dragDistance;
  }

  /** Activate pan mode (called on RMB / Shift+LMB press). */
  startPan(x: number, y: number): void {
    this._isPanning = true;
    this._lastPanX = x;
    this._lastPanY = y;
  }

  /**
   * Begin tracking how far the pointer moves from the initial LMB press.
   * Reset on each new press so that consecutive clicks don't accumulate.
   */
  startDragTracking(x: number, y: number): void {
    this._dragStartX = x;
    this._dragStartY = y;
    this._dragDistance = 0;
    this._dragTrackingActive = true;
  }

  /**
   * Call on every pointer-move event.
   * - If panning: returns the screen-space delta to apply to cameraPanX/Y.
   * - Otherwise: updates drag distance and returns null.
   */
  onMove(x: number, y: number): { dx: number; dy: number } | null {
    if (this._isPanning) {
      const dx = x - this._lastPanX;
      const dy = y - this._lastPanY;
      this._lastPanX = x;
      this._lastPanY = y;
      return { dx, dy };
    }
    this._dragDistance = Math.hypot(x - this._dragStartX, y - this._dragStartY);
    return null;
  }

  /**
   * Call on pointer-up or pointer-leave.
   * Stops panning and resets drag distance so the next gesture starts clean.
   */
  reset(): void {
    this._isPanning = false;
    this._dragDistance = 0;
    this._dragTrackingActive = false;
  }

  /**
   * Returns true when the LMB was dragged further than DRAG_THRESHOLD before
   * being released — meaning the gesture was a drag, not a click, and the
   * release should NOT trigger route planning.
   */
  shouldSwallowClick(): boolean {
    return this._dragTrackingActive && this._dragDistance > DRAG_THRESHOLD;
  }
}
