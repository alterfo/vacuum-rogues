export const DRAG_THRESHOLD = 8;

export class PanZoomController {
  private _isPanning = false;
  private _lastPanX = 0;
  private _lastPanY = 0;
  private _dragStartX = 0;
  private _dragStartY = 0;
  private _dragDistance = 0;
  private _dragTrackingActive = false;

  get isPanning(): boolean {
    return this._isPanning;
  }

  get dragDistance(): number {
    return this._dragDistance;
  }

  startPan(x: number, y: number): void {
    this._isPanning = true;
    this._lastPanX = x;
    this._lastPanY = y;
  }

  startDragTracking(x: number, y: number): void {
    this._dragStartX = x;
    this._dragStartY = y;
    this._dragDistance = 0;
    this._dragTrackingActive = true;
  }

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

  reset(): void {
    this._isPanning = false;
    this._dragDistance = 0;
    this._dragTrackingActive = false;
  }

  shouldSwallowClick(): boolean {
    return this._dragTrackingActive && this._dragDistance > DRAG_THRESHOLD;
  }
}
