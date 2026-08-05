import type { Renderer } from "../Renderer";
import type { ShipPhysics } from "@/systems/ShipPhysics";
import { logger } from "@/utils/logger";

const REFERENCE_FRAME_MS = 1000 / 60;

function frameAlpha(perFrameAlpha: number, deltaTimeMs: number): number {
  const rate = -Math.log(1 - perFrameAlpha) / REFERENCE_FRAME_MS;
  return 1 - Math.exp(-rate * deltaTimeMs);
}

export interface CameraControllerDeps {
  getShipPhysics(): ShipPhysics | null;
  getStarCenter(): { x: number; y: number };
  boundaryRadius: number;
  isInCombat?(): boolean;
}

export class CameraController {
  private cameraZoom = 1.0;
  private cameraPanX = 0;
  private cameraPanY = 0;
  private camLeadX = 0;
  private camLeadY = 0;
  private cameraReturning = false;
  private followSuspended = false;
  private prevMoving = false;
  readonly MIN_ZOOM = 0.25;
  readonly MAX_ZOOM = 2.0;

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

  pan(dx: number, dy: number): void {
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

  zoomAtClient(deltaY: number, clientX: number, clientY: number): void {
    const oldZoom = this.cameraZoom;

    const zoomDelta = deltaY > 0 ? 0.9 : 1.1;
    const newZoom = this.cameraZoom * zoomDelta;

    const clampedZoom = Math.max(
      this.MIN_ZOOM,
      Math.min(this.MAX_ZOOM, newZoom),
    );

    const rect = this.renderer.app.canvas.getBoundingClientRect();
    const anchorX = clientX - rect.left;
    const anchorY = clientY - rect.top;

    const worldAnchorX = (anchorX - this.cameraPanX) / this.cameraZoom;
    const worldAnchorY = (anchorY - this.cameraPanY) / this.cameraZoom;

    this.cameraZoom = clampedZoom;

    this.cameraPanX = anchorX - worldAnchorX * this.cameraZoom;
    this.cameraPanY = anchorY - worldAnchorY * this.cameraZoom;

    this.applyTransform();
    logger.info(
      `Camera zoom: ${oldZoom.toFixed(2)} → ${this.cameraZoom.toFixed(2)} (deltaY: ${deltaY})`,
    );
  }

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

  setZoom(zoom: number): void {
    this.cameraZoom = Math.max(this.MIN_ZOOM, Math.min(this.MAX_ZOOM, zoom));
    this.applyTransform();
  }

  setPan(x: number, y: number): void {
    this.cameraPanX = x;
    this.cameraPanY = y;
    this.applyTransform();
  }

  screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    const worldX = (screenX - this.cameraPanX) / this.cameraZoom;
    const worldY = (screenY - this.cameraPanY) / this.cameraZoom;
    return { x: worldX, y: worldY };
  }

  worldViewport(): { minX: number; minY: number; maxX: number; maxY: number } {
    const z = this.cameraZoom;
    return {
      minX: (0 - this.cameraPanX) / z,
      minY: (0 - this.cameraPanY) / z,
      maxX: (this.renderer.app.screen.width - this.cameraPanX) / z,
      maxY: (this.renderer.app.screen.height - this.cameraPanY) / z,
    };
  }

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

  startReturn(): void {
    this.camLeadX = 0;
    this.camLeadY = 0;
    this.cameraReturning = true;
    this.followSuspended = false; // explicit return re-engages the motion-follow
  }

  update(deltaTime: number): void {
    const dt = Math.min(Math.max(deltaTime, 0), 100);
    this.updateReturn(dt);
    this.updateFollow(dt);
  }

  private updateFollow(dt: number): void {
    const ship = this.deps.getShipPhysics();
    if (!ship) return;
    const moving = ship.isMoving && ship.currentSpeed > 0.01;
    if (moving && !this.prevMoving) this.followSuspended = false;
    this.prevMoving = moving;

    if (this.followSuspended) return;

    const hasLead =
      Math.abs(this.camLeadX) > 0.5 || Math.abs(this.camLeadY) > 0.5;
    if (moving || hasLead) {
      this.cameraReturning = false; // ship motion follow takes over
      this.focusWithLead(dt);
    }
  }

  private focusWithLead(dt: number): void {
    const ship = this.deps.getShipPhysics();
    if (!ship) return;
    const cx = this.renderer.app.screen.width / 2;
    const cy = this.renderer.app.screen.height / 2;

    const inCombat = this.deps.isInCombat?.() ?? false;
    const leadAlpha = frameAlpha(0.06, dt);

    if (inCombat) {
      this.camLeadX += (0 - this.camLeadX) * leadAlpha;
      this.camLeadY += (0 - this.camLeadY) * leadAlpha;
    } else {
      const maxLeadWorld = (cx * 0.34) / this.cameraZoom;
      const f = Math.min(1, ship.getSpeedFraction() * 1.4);
      const desired = maxLeadWorld * f;
      const desiredX = Math.cos(ship.shipAngle) * desired;
      const desiredY = Math.sin(ship.shipAngle) * desired;

      this.camLeadX += (desiredX - this.camLeadX) * leadAlpha;
      this.camLeadY += (desiredY - this.camLeadY) * leadAlpha;
    }

    const focusX = ship.shipX + this.camLeadX;
    const focusY = ship.shipY + this.camLeadY;
    const targetPanX = cx - focusX * this.cameraZoom;
    const targetPanY = cy - focusY * this.cameraZoom;
    const FOLLOW = frameAlpha(0.08, dt); // lower base = smoother / more lag
    this.cameraPanX += (targetPanX - this.cameraPanX) * FOLLOW;
    this.cameraPanY += (targetPanY - this.cameraPanY) * FOLLOW;
    this.applyTransform();
  }

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

  applyTransform(): void {
    if (!this.renderer.gameLayer) return;

    this.clampPan();

    this.renderer.gameLayer.scale.set(this.cameraZoom);
    this.renderer.gameLayer.x = this.cameraPanX;
    this.renderer.gameLayer.y = this.cameraPanY;

    this.onTransform?.(this.cameraZoom, this.cameraPanX, this.cameraPanY);
  }

  private clampPan(): void {
    const z = this.cameraZoom;
    const center = this.deps.getStarCenter();
    const half = this.deps.boundaryRadius;
    const sw = this.renderer.app.screen.width;
    const sh = this.renderer.app.screen.height;

    const panXMax = sw / 2 - (center.x - half) * z;
    const panXMin = sw / 2 - (center.x + half) * z;
    this.cameraPanX = Math.max(panXMin, Math.min(panXMax, this.cameraPanX));

    const panYMax = sh / 2 - (center.y - half) * z;
    const panYMin = sh / 2 - (center.y + half) * z;
    this.cameraPanY = Math.max(panYMin, Math.min(panYMax, this.cameraPanY));
  }
}
