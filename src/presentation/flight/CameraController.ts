import type { Renderer } from "../Renderer";
import type { ShipPhysics } from "@/systems/ShipPhysics";
import { logger } from "@/utils/logger";

/** Frame duration (ms) the original hand-tuned per-frame lerp constants below were calibrated at (~60fps). */
const REFERENCE_FRAME_MS = 1000 / 60;

/**
 * Frame-rate-independent exponential smoothing factor. `perFrameAlpha` is the
 * fraction of the remaining distance closed in one call at
 * {@link REFERENCE_FRAME_MS} (how the constants below were originally tuned
 * by eye); this converts it to the equivalent continuous decay rate and
 * re-applies it for the *actual* elapsed `deltaTimeMs`. Without this, a fixed
 * per-call constant (`pan += (target - pan) * 0.08`) compounds differently at
 * 30fps vs 60fps — under ordinary frame-time variance (GC pause, compositor
 * hitch) the camera's glide speed visibly fluctuates frame to frame, reading
 * as jitter even though `ShipPhysics.update` itself is already correctly
 * deltaTime-scaled (confirmed live-session complaint, 2026-07-13).
 */
function frameAlpha(perFrameAlpha: number, deltaTimeMs: number): number {
  const rate = -Math.log(1 - perFrameAlpha) / REFERENCE_FRAME_MS;
  return 1 - Math.exp(-rate * deltaTimeMs);
}

export interface CameraControllerDeps {
  /** Live ship physics (authoritative world position) — null before spawn. */
  getShipPhysics(): ShipPhysics | null;
  /** Star centre (screen coords) the pan-clamp keys off of. */
  getStarCenter(): { x: number; y: number };
  /**
   * Half-extent (px) of the ship-reachable area: the camera focus point is
   * clamped to [star ± boundaryRadius] (see clampPan; F3). The backdrop is
   * screen-fixed, so panning can never expose its edge.
   */
  boundaryRadius: number;
  /**
   * True when the player is in active combat. During combat, the camera follows
   * the ship's position but ignores heading-based look-ahead, so circling
   * maneuvers don't swing the view around (the ship rotates to track the target
   * but the camera stays centered on the ship's position).
   */
  isInCombat?(): boolean;
}

/**
 * Owns the world camera: zoom, pan, smoothed follow/look-ahead, edge clamping
 * and screen↔world conversion. Extracted from SpaceFlightScene so the scene is a
 * thinner Controller (SRP). Pan/zoom *gestures* are still recognised by the
 * scene's PanZoomController (an input concern); it forwards the resulting pan
 * deltas / wheel events here. `onTransform` lets the scene fan the new transform
 * out to dependents (NPC hit-area rescale, HUD debug read-out) without the
 * camera needing to know about them (Low Coupling).
 */
export class CameraController {
  private cameraZoom = 1.0;
  private cameraPanX = 0;
  private cameraPanY = 0;
  // Camera "look-ahead": while moving, the focus point leads the ship along its
  // heading so the player sees what's coming. Smoothed for a calm feel.
  private camLeadX = 0;
  private camLeadY = 0;
  // Lerp-return animation: true while the camera is smoothly returning to ship.
  private cameraReturning = false;
  // Free-look: set when the player manually pans, it suspends the motion-follow
  // so the camera does NOT snap back to the ship while it is still flying (the
  // player explicitly asked to look around mid-flight). Re-engaged on the next
  // fresh flight leg (standstill → moving) and by the ⊙ return-to-ship button.
  private followSuspended = false;
  private prevMoving = false;
  // Lower min zoom so the player can pull back to survey the now much larger
  // system (grand scale, EPIC-004).
  readonly MIN_ZOOM = 0.25;
  readonly MAX_ZOOM = 2.0;

  /** Fired after every transform change with the new zoom/pan. */
  onTransform: ((zoom: number, panX: number, panY: number) => void) | null =
    null;

  constructor(
    private readonly renderer: Renderer,
    private readonly deps: CameraControllerDeps,
  ) {}

  get zoom(): number {
    return this.cameraZoom;
  }
  get panX(): number {
    return this.cameraPanX;
  }
  get panY(): number {
    return this.cameraPanY;
  }

  /** Drag-pan: shift the view by a raw screen-pixel delta. */
  pan(dx: number, dy: number): void {
    // The player took manual control of the view → stop the motion-follow from
    // yanking it back to the ship until the next flight or a return-to-ship.
    this.followSuspended = true;
    this.cameraPanX += dx;
    this.cameraPanY += dy;
    this.applyTransform();
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      logger.info(
        `📍 Camera pan: (${this.cameraPanX.toFixed(0)}, ${this.cameraPanY.toFixed(0)})`,
      );
    }
  }

  /**
   * Wheel zoom toward the cursor so the world point under the pointer stays
   * fixed (US-070 #4). `clientX/Y` are viewport coordinates (the wheel listener
   * lives on `window`); they are converted to canvas-local screen coordinates.
   */
  zoomAtClient(deltaY: number, clientX: number, clientY: number): void {
    const oldZoom = this.cameraZoom;

    // Calculate zoom delta (negative deltaY = zoom in, positive = zoom out)
    const zoomDelta = deltaY > 0 ? 0.9 : 1.1;
    const newZoom = this.cameraZoom * zoomDelta;

    // Clamp zoom to min/max bounds
    const clampedZoom = Math.max(
      this.MIN_ZOOM,
      Math.min(this.MAX_ZOOM, newZoom),
    );

    const rect = this.renderer.app.canvas.getBoundingClientRect();
    const anchorX = clientX - rect.left;
    const anchorY = clientY - rect.top;

    // World coordinates of the anchor point before zoom
    const worldAnchorX = (anchorX - this.cameraPanX) / this.cameraZoom;
    const worldAnchorY = (anchorY - this.cameraPanY) / this.cameraZoom;

    // Update zoom
    this.cameraZoom = clampedZoom;

    // Adjust pan to keep the anchor point under the cursor at the same position
    this.cameraPanX = anchorX - worldAnchorX * this.cameraZoom;
    this.cameraPanY = anchorY - worldAnchorY * this.cameraZoom;

    this.applyTransform();
    logger.info(
      `Camera zoom: ${oldZoom.toFixed(2)} → ${this.cameraZoom.toFixed(2)} (deltaY: ${deltaY})`,
    );
  }

  /**
   * Pinch zoom: multiply the zoom by `scale` about a **canvas-local** screen
   * anchor (the touch midpoint, already in screen px — no client→canvas rect
   * conversion, unlike {@link zoomAtClient} which reads a window-level wheel
   * event). The world point under the anchor stays fixed, so a two-finger pinch
   * zooms toward where the fingers are. Composes multiplicatively frame-to-frame
   * (`scale` is the incremental ratio from `TouchGestureInterpreter`).
   */
  zoomByFactor(scale: number, anchorX: number, anchorY: number): void {
    const clampedZoom = Math.max(
      this.MIN_ZOOM,
      Math.min(this.MAX_ZOOM, this.cameraZoom * scale),
    );
    const worldAnchorX = (anchorX - this.cameraPanX) / this.cameraZoom;
    const worldAnchorY = (anchorY - this.cameraPanY) / this.cameraZoom;
    this.cameraZoom = clampedZoom;
    this.cameraPanX = anchorX - worldAnchorX * this.cameraZoom;
    this.cameraPanY = anchorY - worldAnchorY * this.cameraZoom;
    this.applyTransform();
  }

  /** E2E helper: clamp + set the zoom directly. */
  setZoom(zoom: number): void {
    this.cameraZoom = Math.max(this.MIN_ZOOM, Math.min(this.MAX_ZOOM, zoom));
    this.applyTransform();
  }

  /** E2E helper: set the pan directly. */
  setPan(x: number, y: number): void {
    this.cameraPanX = x;
    this.cameraPanY = y;
    this.applyTransform();
  }

  /** Convert screen coordinates to world coordinates (accounting for transform). */
  screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    const worldX = (screenX - this.cameraPanX) / this.cameraZoom;
    const worldY = (screenY - this.cameraPanY) / this.cameraZoom;
    return { x: worldX, y: worldY };
  }

  /** Current camera view in world coords → a viewport rectangle (for the radar). */
  worldViewport(): { minX: number; minY: number; maxX: number; maxY: number } {
    const z = this.cameraZoom;
    return {
      minX: (0 - this.cameraPanX) / z,
      minY: (0 - this.cameraPanY) / z,
      maxX: (this.renderer.app.screen.width - this.cameraPanX) / z,
      maxY: (this.renderer.app.screen.height - this.cameraPanY) / z,
    };
  }

  /** Snap the camera so the ship sits exactly at screen centre (spawn). */
  centerOnShip(): void {
    const ship = this.deps.getShipPhysics();
    if (!ship) return;
    const cx = this.renderer.app.screen.width / 2;
    const cy = this.renderer.app.screen.height / 2;
    this.camLeadX = 0;
    this.camLeadY = 0;
    this.cameraReturning = false;
    this.cameraPanX = cx - ship.shipX * this.cameraZoom;
    this.cameraPanY = cy - ship.shipY * this.cameraZoom;
    this.applyTransform();
  }

  /**
   * Centre the main view on a world point — used by the radar drag-to-pan. The
   * residual camera lead is cleared so the view doesn't snap back while idle.
   *
   * Like a manual {@link pan}, this is the player taking control of the view, so
   * it **suspends the motion-follow** — otherwise looking around via the minimap
   * while the ship is flying snapped straight back to the ship every frame
   * (playtest 2026-06-27). The follow re-engages on the next fresh flight leg or
   * an explicit ⊙ return-to-ship ({@link startReturn}).
   */
  focusOnWorld(worldX: number, worldY: number): void {
    this.followSuspended = true;
    const cx = this.renderer.app.screen.width / 2;
    const cy = this.renderer.app.screen.height / 2;
    this.camLeadX = 0;
    this.camLeadY = 0;
    this.cameraPanX = cx - worldX * this.cameraZoom;
    this.cameraPanY = cy - worldY * this.cameraZoom;
    this.applyTransform();
  }

  /** Activate the lerp-return animation toward the ship (⊙ button handler). */
  startReturn(): void {
    this.camLeadX = 0;
    this.camLeadY = 0;
    this.cameraReturning = true;
    this.followSuspended = false; // explicit return re-engages the motion-follow
  }

  /**
   * Per-frame camera step: first ease toward the ship if a return is in flight,
   * then take over with the smoothed motion-follow while the ship is moving.
   * Preserves the original SpaceFlightScene order (return-lerp, then follow).
   * `deltaTime` (ms, from the same rAF clock `ShipPhysics` uses) drives the
   * frame-rate-independent smoothing in {@link updateReturn}/{@link focusWithLead}
   * — clamped like `ShipPhysics.update` so a tab-backgrounding stall can't
   * fire one giant catch-up glide.
   */
  update(deltaTime: number): void {
    const dt = Math.min(Math.max(deltaTime, 0), 100);
    this.updateReturn(dt);
    this.updateFollow(dt);
  }

  /**
   * Camera-follow: while the ship is flying, keep it centred (the system is
   * larger than the viewport). When the ship is stopped, the camera is left
   * alone so the player can freely pan/zoom to look around (consistent with the
   * turn-based pause, and preserves manual pan behaviour).
   */
  private updateFollow(dt: number): void {
    const ship = this.deps.getShipPhysics();
    if (!ship) return;
    const moving = ship.isMoving && ship.currentSpeed > 0.01;
    // A fresh flight leg (standstill → moving) re-engages the follow, even if the
    // player had panned away during a previous flight. A mid-flight re-aim toward
    // a moving target does NOT stop the ship, so it never trips this and the
    // player's free-look survives the course correction.
    if (moving && !this.prevMoving) this.followSuspended = false;
    this.prevMoving = moving;

    // Free-look: the player panned manually — leave the camera exactly where they
    // put it (don't snap back to the ship) until a new flight or a return click.
    if (this.followSuspended) return;

    const hasLead =
      Math.abs(this.camLeadX) > 0.5 || Math.abs(this.camLeadY) > 0.5;
    // Follow with smoothed look-ahead while moving; once stopped, let the
    // residual lead ease to zero and then STOP touching the camera — so the
    // player can freely pan to examine the map without it snapping back to the
    // ship (US-070: don't yank the view to the ship between turns).
    if (moving || hasLead) {
      this.cameraReturning = false; // ship motion follow takes over
      this.focusWithLead(dt);
    }
  }

  /**
   * Pan the camera so a point *ahead* of the ship (along its heading, scaled by
   * speed) sits at screen centre — the ship rides toward the back of the view
   * and the player can see what's coming. The lead is smoothed each frame.
   *
   * During combat, the look-ahead is disabled: the ship rotates to track
   * circling targets, but the camera stays centered on the ship's position
   * (otherwise the view would swing around as the ship turns).
   */
  private focusWithLead(dt: number): void {
    const ship = this.deps.getShipPhysics();
    if (!ship) return;
    const cx = this.renderer.app.screen.width / 2;
    const cy = this.renderer.app.screen.height / 2;

    // Combat: disable heading-based lead so circling maneuvers don't swing
    // the camera. The ship still rotates to track the target, but the view
    // stays centered on the ship's position.
    const inCombat = this.deps.isInCombat?.() ?? false;
    const leadAlpha = frameAlpha(0.06, dt);

    if (inCombat) {
      // Fade out the lead smoothly when combat starts
      this.camLeadX += (0 - this.camLeadX) * leadAlpha;
      this.camLeadY += (0 - this.camLeadY) * leadAlpha;
    } else {
      // Desired lead (world units) in the heading direction, up to ~34% of a
      // half-screen ahead at full speed. Zero when stopped → ship recenters.
      const maxLeadWorld = (cx * 0.34) / this.cameraZoom;
      const f = Math.min(1, ship.getSpeedFraction() * 1.4);
      const desired = maxLeadWorld * f;
      const desiredX = Math.cos(ship.shipAngle) * desired;
      const desiredY = Math.sin(ship.shipAngle) * desired;

      // Smooth toward the desired lead (and toward 0 when slowing/stopped).
      this.camLeadX += (desiredX - this.camLeadX) * leadAlpha;
      this.camLeadY += (desiredY - this.camLeadY) * leadAlpha;
    }

    const focusX = ship.shipX + this.camLeadX;
    const focusY = ship.shipY + this.camLeadY;
    // Ease the camera toward the target pan instead of snapping the ship to dead
    // centre every frame — a gentle follow so the view glides rather than jerks
    // when the ship turns or changes speed (US-070: camera not so abrupt).
    const targetPanX = cx - focusX * this.cameraZoom;
    const targetPanY = cy - focusY * this.cameraZoom;
    const FOLLOW = frameAlpha(0.08, dt); // lower base = smoother / more lag
    this.cameraPanX += (targetPanX - this.cameraPanX) * FOLLOW;
    this.cameraPanY += (targetPanY - this.cameraPanY) * FOLLOW;
    this.applyTransform();
  }

  /**
   * Each frame: lerp the camera toward the ship's centred position.
   * Clears `cameraReturning` once the ship is within 1 px of the target.
   */
  private updateReturn(dt: number): void {
    const ship = this.deps.getShipPhysics();
    if (!this.cameraReturning || !ship) return;
    const cx = this.renderer.app.screen.width / 2;
    const cy = this.renderer.app.screen.height / 2;
    const targetPanX = cx - ship.shipX * this.cameraZoom;
    const targetPanY = cy - ship.shipY * this.cameraZoom;
    const LERP = frameAlpha(0.12, dt);
    this.cameraPanX += (targetPanX - this.cameraPanX) * LERP;
    this.cameraPanY += (targetPanY - this.cameraPanY) * LERP;
    this.applyTransform();
    if (
      Math.abs(this.cameraPanX - targetPanX) < 1 &&
      Math.abs(this.cameraPanY - targetPanY) < 1
    ) {
      this.cameraPanX = targetPanX;
      this.cameraPanY = targetPanY;
      this.cameraReturning = false;
      this.applyTransform();
    }
  }

  /** Apply the camera zoom and pan to the game layer (clamped). */
  applyTransform(): void {
    if (!this.renderer.gameLayer) return;

    this.clampPan();

    this.renderer.gameLayer.scale.set(this.cameraZoom);
    this.renderer.gameLayer.x = this.cameraPanX;
    this.renderer.gameLayer.y = this.cameraPanY;

    this.onTransform?.(this.cameraZoom, this.cameraPanX, this.cameraPanY);
  }

  /**
   * Clamp the camera FOCUS POINT (the world coordinate at screen centre) to
   * the ship-reachable square [star ± boundaryRadius], so any spawn/flight
   * position — including the system-edge hyperjump spawn — can be centred at
   * every zoom level and screen size (F3, letsplay 2026-06-10). The sky
   * backdrop is screen-fixed (skyContainer, not the panned gameLayer), so
   * panning can never expose a backdrop edge; the clamp only stops the view
   * from wandering into empty void far beyond the system boundary.
   */
  private clampPan(): void {
    const z = this.cameraZoom;
    const center = this.deps.getStarCenter();
    const half = this.deps.boundaryRadius;
    const sw = this.renderer.app.screen.width;
    const sh = this.renderer.app.screen.height;

    // Focus point: worldX = (sw/2 - panX) / z. Require it within [center ± half].
    const panXMax = sw / 2 - (center.x - half) * z;
    const panXMin = sw / 2 - (center.x + half) * z;
    this.cameraPanX = Math.max(panXMin, Math.min(panXMax, this.cameraPanX));

    const panYMax = sh / 2 - (center.y - half) * z;
    const panYMin = sh / 2 - (center.y + half) * z;
    this.cameraPanY = Math.max(panYMin, Math.min(panYMax, this.cameraPanY));
  }
}
