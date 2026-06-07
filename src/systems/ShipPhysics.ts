/**
 * Physics-based movement state machine for ship control.
 * Implements three-phase movement: acceleration → cruise → deceleration.
 * Extracted from SpaceFlightScene for testability.
 */
export class ShipPhysics {
  public shipX: number;
  public shipY: number;
  public shipAngle: number;
  public currentSpeed: number = 0;
  public isMoving: boolean = false;
  public timeScale: number = 1.0;

  private targetX: number;
  private targetY: number;
  // Remaining waypoints of a curved path (e.g. around the star). The ship flows
  // through them without stopping — the next waypoint is taken before arrival so
  // speed is never zeroed mid-route (US-070: smooth motion around the sun).
  private path: { x: number; y: number }[] = [];
  private readonly maxSpeed: number;
  // Gentle accel/decel for a physical feel. Deceleration is tuned so the ship
  // eases to a stop over roughly DISTANCE_PER_DAY (≈500px) at cruise — i.e. the
  // final leg of a route is slowed to take about a day, even when it's short
  // (US-070: tie movement to physics + "last mile takes a day"). Only the final
  // leg decelerates; intermediate waypoints are switched at speed.
  private readonly acceleration: number = 0.0009; // pixels/ms²
  private readonly deceleration: number = 0.00025; // pixels/ms²
  private readonly rotationSpeed: number; // radians/ms
  private readonly STOP_THRESHOLD: number = 8; // pixels - distance to consider "arrived"
  // Switch to the next queued waypoint once this close, so the ship rounds the
  // corner at speed instead of decelerating to a stop at each one.
  private readonly WAYPOINT_SWITCH: number = 48; // pixels

  constructor(initialX: number, initialY: number, maxSpeed?: number) {
    this.shipX = initialX;
    this.shipY = initialY;
    this.targetX = initialX;
    this.targetY = initialY;
    this.shipAngle = 0;
    this.maxSpeed = maxSpeed ?? 0.1; // pixels/ms - slower for turn-based gameplay (was 0.3)
    // Calculate rotation speed: 90° (π/2 rad) in 300ms = 5.24 rad/s = 0.00524 rad/ms
    this.rotationSpeed = Math.PI / 2 / 300;
  }

  setTarget(x: number, y: number): void {
    this.path = [];
    this.targetX = x;
    this.targetY = y;
    this.isMoving = true;
  }

  /**
   * Fly through an ordered list of waypoints (the last one is the destination).
   * Intermediate waypoints are switched before arrival (see WAYPOINT_SWITCH) so
   * the ship keeps its speed around curves; only the final point decelerates.
   */
  setPath(points: { x: number; y: number }[]): void {
    if (points.length === 0) return;
    this.path = points.slice(1);
    const first = points[0];
    this.targetX = first.x;
    this.targetY = first.y;
    this.isMoving = true;
  }

  /**
   * Instantly place the ship at (x,y) and park it there. Unlike setting shipX/Y
   * directly, this also resets the target so update() — which always eases
   * toward the target when it is far — doesn't immediately fly the ship back to
   * its old position. Used for take-off/respawn relocation.
   */
  teleport(x: number, y: number): void {
    this.path = [];
    this.shipX = x;
    this.shipY = y;
    this.targetX = x;
    this.targetY = y;
    this.currentSpeed = 0;
    this.isMoving = false;
  }

  /** Set the animation time-scale (1.0 = normal, 2.0 = double speed, etc.). */
  setTimeScale(v: number): void {
    this.timeScale = Math.max(0.1, v);
  }

  /** Waypoints still queued ahead of the current target. */
  hasPath(): boolean {
    return this.path.length > 0;
  }

  getDistanceToTarget(): number {
    const dx = this.targetX - this.shipX;
    const dy = this.targetY - this.shipY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  getTargetX(): number {
    return this.targetX;
  }

  getTargetY(): number {
    return this.targetY;
  }

  /** Current speed as a fraction [0..1] of max speed (for camera lead, FX). */
  getSpeedFraction(): number {
    return this.maxSpeed > 0 ? this.currentSpeed / this.maxSpeed : 0;
  }

  update(deltaTime: number): void {
    // Cap deltaTime to prevent physics explosion on lag spikes, then apply
    // timeScale so the HUD speed button accelerates visual movement.
    const dt = Math.min(deltaTime, 100) * this.timeScale;

    let distance = this.getDistanceToTarget();

    // Flow through queued waypoints: switch to the next one before reaching the
    // current target so the ship keeps its speed around the curve (no stop/start
    // stutter at each star-avoidance point). The final waypoint is handled by the
    // normal arrival/deceleration logic below.
    while (this.path.length > 0 && distance <= this.WAYPOINT_SWITCH) {
      const next = this.path.shift();
      if (!next) break;
      this.targetX = next.x;
      this.targetY = next.y;
      distance = this.getDistanceToTarget();
    }

    // Check if arrived at target
    if (distance <= this.STOP_THRESHOLD) {
      this.currentSpeed = 0;
      this.isMoving = false;
      // Snap to target if very close
      if (distance < 2) {
        this.shipX = this.targetX;
        this.shipY = this.targetY;
      }
      return;
    }

    // Rotation update - calculate angle to target
    const dx = this.targetX - this.shipX;
    const dy = this.targetY - this.shipY;
    const targetAngle = Math.atan2(dy, dx);

    // Normalize angle difference to [-π, π]
    let angleDiff = targetAngle - this.shipAngle;
    while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
    while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

    // Apply rotation with maximum rotation per frame
    const maxRotation = this.rotationSpeed * dt;
    if (Math.abs(angleDiff) <= maxRotation) {
      this.shipAngle = targetAngle;
    } else {
      this.shipAngle += Math.sign(angleDiff) * maxRotation;
    }

    // Calculate alignment factor: how well the ship is pointing at target
    // 1.0 = perfectly aligned, 0.0 = perpendicular or worse
    const alignmentFactor = Math.max(0, Math.cos(angleDiff));

    // Only accelerate if ship is reasonably aligned with target (within 60°)
    const isAligned = Math.abs(angleDiff) < Math.PI / 3;

    // Only the final leg (no more queued waypoints) decelerates to a stop;
    // intermediate waypoints are flown through at speed (smooth route — they are
    // switched at WAYPOINT_SWITCH above). This eases the "last mile" over ≈a day.
    const finalLeg = this.path.length === 0;
    const stoppingDistance =
      (this.currentSpeed * this.currentSpeed) / (2 * this.deceleration);

    // Speed update: accelerate while far / on intermediate legs; decelerate only
    // when approaching the final destination.
    if (finalLeg && distance <= stoppingDistance && this.currentSpeed > 0) {
      // Deceleration phase (final approach) — eases over the last ~day's distance.
      this.currentSpeed = Math.max(
        0,
        this.currentSpeed - this.deceleration * dt,
      );
    } else if (this.currentSpeed < this.maxSpeed && isAligned) {
      // Acceleration / cruise phase — only when pointing at target.
      this.currentSpeed = Math.min(
        this.maxSpeed,
        this.currentSpeed + this.acceleration * dt,
      );
    } else if (!isAligned && this.currentSpeed > this.maxSpeed * 0.3) {
      // Slow down if not aligned and going too fast
      this.currentSpeed = Math.max(
        this.maxSpeed * 0.3,
        this.currentSpeed - this.deceleration * dt * 0.5,
      );
    }

    // Position update - apply alignment factor to prevent sideways drift
    const effectiveSpeed = this.currentSpeed * alignmentFactor;
    const moveDistance = effectiveSpeed * dt;
    this.shipX += Math.cos(this.shipAngle) * moveDistance;
    this.shipY += Math.sin(this.shipAngle) * moveDistance;
  }
}
