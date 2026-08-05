import { DRAG_THRESHOLD } from "@/systems/PanZoomController";

export interface PointerSample {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly t?: number;
}

export type PointerPhase = "down" | "move" | "up" | "cancel";

export interface PointerInput extends PointerSample {
  readonly phase: PointerPhase;
}

export interface PanIntent {
  readonly type: "pan";
  readonly dx: number;
  readonly dy: number;
}

export interface PinchIntent {
  readonly type: "pinch";
  readonly scale: number;
  readonly centerX: number;
  readonly centerY: number;
}

export interface TapIntent {
  readonly type: "tap";
  readonly x: number;
  readonly y: number;
}

export type GestureIntent = PanIntent | PinchIntent | TapIntent;

export const TAP_MOVE_TOLERANCE_PX = DRAG_THRESHOLD;
export const TAP_MAX_DURATION_MS = 300;

interface ActivePointer {
  id: number;
  downX: number;
  downY: number;
  downT: number | undefined;
  lastX: number;
  lastY: number;
  x: number;
  y: number;
  dragging: boolean;
  isTap: boolean;
}

export class TouchGestureInterpreter {
  private readonly pointers = new Map<number, ActivePointer>();
  private multiTouch = false;
  private prevPinchDist: number | null = null;

  get activePointers(): number {
    return this.pointers.size;
  }

  handle(evt: PointerInput): GestureIntent[] {
    switch (evt.phase) {
      case "down":
        return this.onDown(evt);
      case "move":
        return this.onMove(evt);
      case "up":
        return this.onUp(evt);
      case "cancel":
        return this.onCancel(evt);
      default:
        return [];
    }
  }

  reset(): void {
    this.pointers.clear();
    this.multiTouch = false;
    this.prevPinchDist = null;
  }

  private onDown(p: PointerInput): GestureIntent[] {
    this.pointers.set(p.id, {
      id: p.id,
      downX: p.x,
      downY: p.y,
      downT: p.t,
      lastX: p.x,
      lastY: p.y,
      x: p.x,
      y: p.y,
      dragging: false,
      isTap: true,
    });
    if (this.pointers.size >= 2) {
      this.multiTouch = true;
      for (const ap of this.pointers.values()) ap.isTap = false;
      this.prevPinchDist = this.pinchDistance();
    }
    return [];
  }

  private onMove(p: PointerInput): GestureIntent[] {
    const ap = this.pointers.get(p.id);
    if (!ap) return [];
    ap.x = p.x;
    ap.y = p.y;

    if (this.pointers.size >= 2) return this.pinchMove();

    const drift = Math.hypot(p.x - ap.downX, p.y - ap.downY);
    if (!ap.dragging && drift > TAP_MOVE_TOLERANCE_PX) {
      ap.dragging = true;
      ap.isTap = false;
    }
    if (ap.dragging) {
      const dx = p.x - ap.lastX;
      const dy = p.y - ap.lastY;
      ap.lastX = p.x;
      ap.lastY = p.y;
      return [{ type: "pan", dx, dy }];
    }
    ap.lastX = p.x;
    ap.lastY = p.y;
    return [];
  }

  private pinchMove(): GestureIntent[] {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return [];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const centerX = (a.x + b.x) / 2;
    const centerY = (a.y + b.y) / 2;
    if (this.prevPinchDist === null || this.prevPinchDist === 0 || dist === 0) {
      this.prevPinchDist = dist;
      return [];
    }
    const scale = dist / this.prevPinchDist;
    this.prevPinchDist = dist;
    if (scale === 1) return [];
    return [{ type: "pinch", scale, centerX, centerY }];
  }

  private onUp(p: PointerInput): GestureIntent[] {
    const ap = this.pointers.get(p.id);
    if (!ap) return [];
    ap.x = p.x;
    ap.y = p.y;
    this.pointers.delete(p.id);

    const intents: GestureIntent[] = [];
    if (
      !this.multiTouch &&
      !ap.dragging &&
      ap.isTap &&
      this.withinTapTime(ap, p)
    ) {
      intents.push({ type: "tap", x: ap.x, y: ap.y });
    }

    this.afterPointerRemoved();
    return intents;
  }

  private onCancel(p: PointerInput): GestureIntent[] {
    this.pointers.delete(p.id);
    this.afterPointerRemoved();
    return [];
  }

  private afterPointerRemoved(): void {
    if (this.pointers.size >= 2) {
      this.prevPinchDist = this.pinchDistance();
    } else if (this.pointers.size === 1) {
      this.prevPinchDist = null;
      const rem = [...this.pointers.values()][0];
      rem.lastX = rem.x;
      rem.lastY = rem.y;
      rem.dragging = false;
    } else {
      this.multiTouch = false;
      this.prevPinchDist = null;
    }
  }

  private pinchDistance(): number {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  private withinTapTime(ap: ActivePointer, p: PointerInput): boolean {
    if (ap.downT === undefined || p.t === undefined) return true;
    return p.t - ap.downT <= TAP_MAX_DURATION_MS;
  }
}
