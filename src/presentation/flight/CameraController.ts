import type { Renderer } from "../Renderer";
import type { ShipPhysics } from "@/systems/ShipPhysics";
import { logger } from "@/utils/logger";

export interface CameraControllerDeps {
  /** Live ship physics (authoritative world position) — null before spawn. */
  getShipPhysics(): ShipPhysics | null;
  /** Star centre (screen coords) the pan-clamp keys off of. */
  getStarCenter(): { x: number; y: number };
  /** Half-extent (px) used to clamp the pan so the backdrop edge never shows. */
  boundaryRadius: number;
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
   */
  focusOnWorld(worldX: number, worldY: number): void {
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
  }

  /**
   * Per-frame camera step: first ease toward the ship if a return is in flight,
   * then take over with the smoothed motion-follow while the ship is moving.
   * Preserves the original SpaceFlightScene order (return-lerp, then follow).
   */
  update(): void {
    this.updateReturn();
    this.updateFollow();
  }

  /**
   * Camera-follow: while the ship is flying, keep it centred (the system is
   * larger than the viewport). When the ship is stopped, the camera is left
   * alone so the player can freely pan/zoom to look around (consistent with the
   * turn-based pause, and preserves manual pan behaviour).
   */
  private updateFollow(): void {
    const ship = this.deps.getShipPhysics();
    if (!ship) return;
    const moving = ship.isMoving && ship.currentSpeed > 0.01;
    const hasLead =
      Math.abs(this.camLeadX) > 0.5 || Math.abs(this.camLeadY) > 0.5;
    // Follow with smoothed look-ahead while moving; once stopped, let the
    // residual lead ease to zero and then STOP touching the camera — so the
    // player can freely pan to examine the map without it snapping back to the
    // ship (US-070: don't yank the view to the ship between turns).
    if (moving || hasLead) {
      this.cameraReturning = false; // ship motion follow takes over
      this.focusWithLead();
    }
  }

  /**
   * Pan the camera so a point *ahead* of the ship (along its heading, scaled by
   * speed) sits at screen centre — the ship rides toward the back of the view
   * and the player can see what's coming. The lead is smoothed each frame.
   */
  private focusWithLead(): void {
    const ship = this.deps.getShipPhysics();
    if (!ship) return;
    const cx = this.renderer.app.screen.width / 2;
    const cy = this.renderer.app.screen.height / 2;

    // Desired lead (world units) in the heading direction, up to ~34% of a
    // half-screen ahead at full speed. Zero when stopped → ship recenters.
    const maxLeadWorld = (cx * 0.34) / this.cameraZoom;
    const f = Math.min(1, ship.getSpeedFraction() * 1.4);
    const desired = maxLeadWorld * f;
    const desiredX = Math.cos(ship.shipAngle) * desired;
    const desiredY = Math.sin(ship.shipAngle) * desired;

    // Smooth toward the desired lead (and toward 0 when slowing/stopped).
    this.camLeadX += (desiredX - this.camLeadX) * 0.06;
    this.camLeadY += (desiredY - this.camLeadY) * 0.06;

    const focusX = ship.shipX + this.camLeadX;
    const focusY = ship.shipY + this.camLeadY;
    // Ease the camera toward the target pan instead of snapping the ship to dead
    // centre every frame — a gentle follow so the view glides rather than jerks
    // when the ship turns or changes speed (US-070: camera not so abrupt).
    const targetPanX = cx - focusX * this.cameraZoom;
    const targetPanY = cy - focusY * this.cameraZoom;
    const FOLLOW = 0.08; // lower = smoother / more lag
    this.cameraPanX += (targetPanX - this.cameraPanX) * FOLLOW;
    this.cameraPanY += (targetPanY - this.cameraPanY) * FOLLOW;
    this.applyTransform();
  }

  /**
   * Each frame: lerp the camera toward the ship's centred position.
   * Clears `cameraReturning` once the ship is within 1 px of the target.
   */
  private updateReturn(): void {
    const ship = this.deps.getShipPhysics();
    if (!this.cameraReturning || !ship) return;
    const cx = this.renderer.app.screen.width / 2;
    const cy = this.renderer.app.screen.height / 2;
    const targetPanX = cx - ship.shipX * this.cameraZoom;
    const targetPanY = cy - ship.shipY * this.cameraZoom;
    const LERP = 0.12;
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
   * Clamp the camera pan so the visible viewport never extends past the
   * background coverage (the nebula backdrop), i.e. the picture's edge can't be
   * panned into view. When the viewport is larger than the bound (fully zoomed
   * out) the system is simply centred on that axis.
   */
  private clampPan(): void {
    const z = this.cameraZoom;
    const center = this.deps.getStarCenter();
    // Slightly smaller than the backdrop half-size (BOUNDARY * 2.8 / 2 = 1.4)
    // so a margin of gas always remains beyond the edge of the screen.
    const half = this.deps.boundaryRadius * 1.25;
    const sw = this.renderer.app.screen.width;
    const sh = this.renderer.app.screen.height;

    // Viewport world edges: left = -panX/z, right = (sw - panX)/z. Require the
    // edges to stay within [center ± half].
    const minX = center.x - half;
    const maxX = center.x + half;
    const panXMax = -minX * z;
    const panXMin = sw - maxX * z;
    this.cameraPanX =
      panXMin > panXMax
        ? (panXMin + panXMax) / 2
        : Math.max(panXMin, Math.min(panXMax, this.cameraPanX));

    const minY = center.y - half;
    const maxY = center.y + half;
    const panYMax = -minY * z;
    const panYMin = sh - maxY * z;
    this.cameraPanY =
      panYMin > panYMax
        ? (panYMin + panYMax) / 2
        : Math.max(panYMin, Math.min(panYMax, this.cameraPanY));
  }
}
