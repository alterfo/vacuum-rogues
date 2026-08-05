import { TouchGestureInterpreter, type PointerPhase } from "./touchGestures";

export interface TouchCameraDeps {
  zoomByFactor(scale: number, anchorX: number, anchorY: number): void;
}

export interface TouchPointerEvent {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly global: { readonly x: number; readonly y: number };
  readonly isPrimary?: boolean;
}

export class FlightTouchController {
  private readonly gestures = new TouchGestureInterpreter();

  constructor(
    private readonly camera: TouchCameraDeps,
    private readonly gate: () => boolean,
  ) {}

  get isPinching(): boolean {
    return this.gestures.activePointers >= 2;
  }

  onDown(e: TouchPointerEvent): boolean {
    if (!this.handles(e)) return false;
    if (e.isPrimary) this.gestures.reset();
    this.feed(e, "down");
    return this.isPinching;
  }

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

  onUp(e: TouchPointerEvent): void {
    if (!this.handles(e)) return;
    this.feed(e, "up");
  }

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
