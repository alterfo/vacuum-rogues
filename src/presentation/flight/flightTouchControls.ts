// On-screen touch controls wiring for the flight scene (mobile adaptation Phase
// 2, `docs/plans/20260625-mobile-adaptation.md`, Task 3).
//
// `FlightTouchController` is the thin seam between PixiJS pointer events and the
// pure {@link TouchGestureInterpreter}: the scene forwards each touch pointer
// event to it, and it turns a **two-finger pinch** into a camera zoom via the
// injected `TouchCameraDeps`. It is deliberately *narrow*:
//
//   - one-finger taps stay on the scene's existing route-planning path (a touch
//     pointer already fires a button-0 pointerdown/up there — tap-to-route and
//     tap-to-target work unchanged), so this controller never re-implements the
//     route guards;
//   - the *second* finger landing flips it into "pinch" mode, which the scene
//     uses to suppress the route that the first finger planned and to route the
//     subsequent moves here for zooming;
//   - **mouse** events and **non-touch layouts** are ignored (every method
//     early-returns), so the desktop path is byte-for-byte unchanged.
//
// PixiJS-free apart from the structural `TouchPointerEvent` shape (a
// `FederatedPointerEvent` satisfies it), so the gating + pinch routing are
// unit-tested without a renderer.

import { TouchGestureInterpreter, type PointerPhase } from "./touchGestures";

/** The camera operations the touch controller drives (a `CameraController` satisfies it). */
export interface TouchCameraDeps {
  /** Multiply zoom by `scale` about the canvas-local screen anchor (pinch midpoint). */
  zoomByFactor(scale: number, anchorX: number, anchorY: number): void;
}

/** The minimal slice of a PixiJS `FederatedPointerEvent` the controller reads. */
export interface TouchPointerEvent {
  readonly pointerId: number;
  /** "touch" | "mouse" | "pen" — only "touch" is handled. */
  readonly pointerType: string;
  /** Canvas-local screen coordinates (stage space). */
  readonly global: { readonly x: number; readonly y: number };
}

/**
 * Folds touch pointer events into pinch-zoom intents. Drive it with
 * {@link onDown}/{@link onMove}/{@link onUp} from the scene's pointer handlers;
 * `gate()` is re-checked live (the viewport can change) so the controller only
 * acts on a real touch layout.
 */
export class FlightTouchController {
  private readonly gestures = new TouchGestureInterpreter();

  constructor(
    private readonly camera: TouchCameraDeps,
    private readonly gate: () => boolean,
  ) {}

  /** True once ≥2 fingers are down — the scene treats this as "pinch in progress". */
  get isPinching(): boolean {
    return this.gestures.activePointers >= 2;
  }

  /**
   * Fold a pointer-down. Returns **true** when this down started/continued a
   * pinch (≥2 fingers) — the scene should then drop any single-finger route and
   * stop planning a new one; **false** for a first finger / non-touch / desktop,
   * letting the scene's normal route handling run.
   */
  onDown(e: TouchPointerEvent): boolean {
    if (!this.handles(e)) return false;
    this.feed(e, "down");
    return this.isPinching;
  }

  /**
   * Fold a pointer-move. Returns **true** when it consumed the move as a pinch
   * (≥2 fingers) — the scene should skip its own move handling; **false**
   * otherwise so single-finger drag-tracking on the existing path is untouched.
   */
  onMove(e: TouchPointerEvent): boolean {
    if (!this.handles(e)) return false;
    const pinching = this.isPinching;
    const intents = this.feed(e, "move");
    if (!pinching) return false;
    for (const intent of intents) {
      if (intent.type === "pinch") {
        this.camera.zoomByFactor(intent.scale, intent.centerX, intent.centerY);
      }
    }
    return true;
  }

  /** Fold a pointer-up so finger bookkeeping clears (the tap itself is ignored — the scene path owns taps). */
  onUp(e: TouchPointerEvent): void {
    if (!this.handles(e)) return;
    this.feed(e, "up");
  }

  /** Clear all gesture state (scene teardown / interaction abort). */
  reset(): void {
    this.gestures.reset();
  }

  private handles(e: TouchPointerEvent): boolean {
    return e.pointerType === "touch" && this.gate();
  }

  private feed(e: TouchPointerEvent, phase: PointerPhase) {
    return this.gestures.handle({
      id: e.pointerId,
      x: e.global.x,
      y: e.global.y,
      phase,
    });
  }
}
