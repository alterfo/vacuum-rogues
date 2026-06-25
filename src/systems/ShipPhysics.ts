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
  // True while flying an auto-plotted route (setPath). Stays set through the
  // final leg too — unlike hasPath(), which empties as waypoints are consumed —
  // so the route stays "active" until the ship actually arrives or is stopped.
  // The route line + destination marker already show where the ship is going, so
  // the renderer hides the redundant heading crosshair while this is true.
  private followingRoute: boolean = false;
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
    this.followingRoute = false; // a bare point-move is not a plotted route
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
    this.followingRoute = true; // flying a plotted route (crosshair stays hidden)
  }

  /**
   * Instantly place the ship at (x,y) and park it there. Unlike setting shipX/Y
   * directly, this also resets the target so update() — which always eases
   * toward the target when it is far — doesn't immediately fly the ship back to
   * its old position. Used for take-off/respawn relocation.
   */
  teleport(x: number, y: number): void {
    this.path = [];
    this.followingRoute = false;
    this.shipX = x;
    this.shipY = y;
    this.targetX = x;
    this.targetY = y;
    this.currentSpeed = 0;
    this.isMoving = false;
  }

  /**
   * Halt the ship in place immediately: clear any queued waypoints, park the
   * target at the current position (so update() won't ease it back toward an
   * old target), and zero out speed. Used to abort a route mid-flight (Pause).
   */
  stop(): void {
    this.path = [];
    this.followingRoute = false;
    this.targetX = this.shipX;
    this.targetY = this.shipY;
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

  /**
   * True while auto-flying a plotted route (set by {@link setPath}, cleared on
   * arrival / {@link stop} / {@link setTarget} / {@link teleport}). Unlike
   * {@link hasPath}, this stays true on the final leg, so callers can treat the
   * whole route — not just the legs with queued waypoints — as "on a route".
   */
  isFollowingRoute(): boolean {
    return this.followingRoute;
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

  /** Max cruise speed (px/ms) — used to solve intercept lead against a target. */
  getMaxSpeed(): number {
    return this.maxSpeed;
  }

  /**
   * Speed-based escape test: true while this ship is actively moving faster than
   * a pursuer cruising at `pursuerSpeed` (px/ms) — i.e. the gap to that pursuer
   * is opening, so a faster engine breaks pursuit. A parked or slower ship
   * out-runs no one (a stationary player is not "fleeing"), so the comparison is
   * against the live `currentSpeed`, not the engine's max capability.
   */
  canOutrun(pursuerSpeed: number): boolean {
    return this.isMoving && this.currentSpeed > pursuerSpeed;
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
      this.followingRoute = false; // route complete — crosshair gate lifts
      // Snap to target if very close
      if (distance < 2) {
        this.shipX = this.targetX;
        this.shipY = this.targetY;
      }
      return;
    }

    // Momentum / arc-only movement (no rotate-in-place): the ship ALWAYS cruises
    // forward along its heading and steers toward the target by turning at a
    // bounded rate — it does NOT slow or stop because the target is off-axis.
    // A target behind is reached by looping around, never by pivoting on the spot.
    //
    // Speed first (so heading only ever changes while the ship is moving):
    // accelerate to cruise while far / on intermediate legs; only the FINAL leg
    // decelerates to a stop at the destination (eases the "last mile" over ≈a day;
    // intermediate waypoints are switched at WAYPOINT_SWITCH above, flown through
    // at speed).
    const finalLeg = this.path.length === 0;
    const stoppingDistance =
      (this.currentSpeed * this.currentSpeed) / (2 * this.deceleration);

    if (finalLeg && distance <= stoppingDistance && this.currentSpeed > 0) {
      // Deceleration phase (final approach) — eases over the last ~day's distance.
      this.currentSpeed = Math.max(
        0,
        this.currentSpeed - this.deceleration * dt,
      );
    } else if (this.currentSpeed < this.maxSpeed) {
      // Acceleration / cruise phase — maintained regardless of heading alignment.
      this.currentSpeed = Math.min(
        this.maxSpeed,
        this.currentSpeed + this.acceleration * dt,
      );
    }

    // Turn toward the target at a bounded rate, but only WHILE MOVING. Because
    // forward distance is currentSpeed*dt and the per-frame heading change is
    // capped at rotationSpeed*dt, the path curves with a minimum turn radius of
    // currentSpeed / rotationSpeed (≈19px at cruise) — an arc, never a pivot.
    if (this.currentSpeed > 0) {
      const dx = this.targetX - this.shipX;
      const dy = this.targetY - this.shipY;
      const targetAngle = Math.atan2(dy, dx);

      // Normalize angle difference to [-π, π]
      let angleDiff = targetAngle - this.shipAngle;
      while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
      while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

      const maxRotation = this.rotationSpeed * dt;
      if (Math.abs(angleDiff) <= maxRotation) {
        this.shipAngle = targetAngle;
      } else {
        this.shipAngle += Math.sign(angleDiff) * maxRotation;
      }
    }

    // Position update — always advance forward along the current heading.
    const moveDistance = this.currentSpeed * dt;
    this.shipX += Math.cos(this.shipAngle) * moveDistance;
    this.shipY += Math.sin(this.shipAngle) * moveDistance;
  }
}
