// Pure touch-gesture interpreter for the mobile adaptation
// (`docs/plans/20260625-mobile-adaptation.md`, Phase 2).
//
// `TouchGestureInterpreter` folds a stream of pointer events (down/move/up/cancel)
// into high-level **intents** — `pan`, `pinch`, `tap`. In the flight scene today
// the wiring (`FlightTouchController`) consumes only the **pinch** intent, driving
// `CameraController.zoomByFactor` about the finger midpoint; single-finger drags
// and taps stay on the scene's existing route/target path (a touch already fires a
// button-0 pointerdown/up there), so the `pan`/`tap` intents are computed but not
// yet routed. It is **pure logic**: no PixiJS, no DOM, no `window` — it only
// reasons over the `{id,x,y,t}` samples handed to it, so the whole disambiguation
// (one-finger drag = pan, two-finger = pinch-zoom, quick stationary press = tap) is
// unit-tested over recorded pointer sequences. It is the touch sibling of the
// mouse-only single-pointer {@link PanZoomController}, and shares its drag/tap
// boundary via {@link DRAG_THRESHOLD} so a tap means the same thing on either path.

import { DRAG_THRESHOLD } from "@/systems/PanZoomController";

/** A single pointer (finger) sample in canvas-local screen coordinates. */
export interface PointerSample {
  /** Stable per-finger id (PointerEvent.pointerId). */
  readonly id: number;
  /** Screen x (canvas-local px). */
  readonly x: number;
  /** Screen y (canvas-local px). */
  readonly y: number;
  /** Optional timestamp (ms); enables the tap max-duration check when present. */
  readonly t?: number;
}

export type PointerPhase = "down" | "move" | "up" | "cancel";

/** A pointer sample tagged with its lifecycle phase — the interpreter's input. */
export interface PointerInput extends PointerSample {
  readonly phase: PointerPhase;
}

/** One-finger drag → shift the view by a screen-pixel delta. */
export interface PanIntent {
  readonly type: "pan";
  readonly dx: number;
  readonly dy: number;
}

/**
 * Two-finger pinch → multiply the zoom by `scale` about the screen-space `center`
 * (the midpoint between the fingers — the natural anchor to keep fixed under the
 * pinch, as `CameraController.zoomByFactor` does about its anchor). `scale` is the
 * **incremental** ratio since the previous pinch sample (>1 = spread/zoom-in,
 * <1 = pinch/zoom-out), so it composes multiplicatively frame to frame.
 */
export interface PinchIntent {
  readonly type: "pinch";
  readonly scale: number;
  readonly centerX: number;
  readonly centerY: number;
}

/** A quick, stationary press-and-release → select / route at this screen point. */
export interface TapIntent {
  readonly type: "tap";
  readonly x: number;
  readonly y: number;
}

export type GestureIntent = PanIntent | PinchIntent | TapIntent;

/** Max movement (px) a press may drift and still count as a tap (shared with the mouse path). */
export const TAP_MOVE_TOLERANCE_PX = DRAG_THRESHOLD;
/** Max press duration (ms) for a tap — only enforced when samples carry timestamps. */
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
  /** Still a tap candidate (single finger, hasn't dragged, no multi-touch). */
  isTap: boolean;
}

/**
 * Stateful (but side-effect-free) interpreter. Drive it with `handle(evt)` per
 * pointer event; it returns the intents that event produced (often none). Reset
 * between scenes with {@link reset}.
 */
export class TouchGestureInterpreter {
  private readonly pointers = new Map<number, ActivePointer>();
  /** True once ≥2 fingers were down during the current interaction — suppresses tap. */
  private multiTouch = false;
  /** Finger-distance at the previous pinch sample (null = not pinching / needs re-baseline). */
  private prevPinchDist: number | null = null;

  /** Number of fingers currently down. */
  get activePointers(): number {
    return this.pointers.size;
  }

  /** Fold one pointer event into the gesture state, returning any intents it produced. */
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

  /** Clear all gesture state (scene teardown / interaction abort). */
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
      // A second finger landed → this is a pinch interaction; no finger can tap.
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

    // Single finger: tap until it drifts past the tolerance, then pan from there.
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
    if (this.prevPinchDist === null || this.prevPinchDist === 0) {
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

  /** Re-baseline the remaining fingers so a lift can't jump the pan/pinch. */
  private afterPointerRemoved(): void {
    if (this.pointers.size >= 2) {
      // Still pinching with the remaining pair — reset the distance baseline.
      this.prevPinchDist = this.pinchDistance();
    } else if (this.pointers.size === 1) {
      // Dropped to one finger (e.g. after a pinch): the survivor must not tap and
      // must not pan with a sudden jump — anchor its delta origin to where it is.
      this.prevPinchDist = null;
      const rem = [...this.pointers.values()][0];
      rem.lastX = rem.x;
      rem.lastY = rem.y;
      rem.dragging = false;
      // isTap stays false while multiTouch holds — set below only at full release.
    } else {
      // All fingers up — the interaction is over; the next press starts fresh.
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
