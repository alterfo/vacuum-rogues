export const SHIP_STOP_THRESHOLD = 8; // pixels

export class ShipPhysics {
  public shipX: number;
  public shipY: number;
  public shipAngle: number;
  public currentSpeed: number = 0;
  public isMoving: boolean = false;
  public timeScale: number = 1.0;

  private targetX: number;
  private targetY: number;
  private path: { x: number; y: number }[] = [];
  private followingRoute: boolean = false;
  private readonly maxSpeed: number;
  private readonly acceleration: number = 0.0009; // pixels/ms²
  private readonly deceleration: number = 0.00025; // pixels/ms²
  private readonly rotationSpeed: number; // radians/ms
  private readonly STOP_THRESHOLD: number = SHIP_STOP_THRESHOLD; // distance to consider "arrived"
  private readonly WAYPOINT_SWITCH: number = 48; // pixels
  private readonly ARC_CAPTURE: number = 0.8;
  private readonly ARC_CAP_HEADING: number = Math.PI / 6;

  constructor(
    initialX: number,
    initialY: number,
    maxSpeed?: number,
    initialAngle: number = 0,
  ) {
    this.shipX = initialX;
    this.shipY = initialY;
    this.targetX = initialX;
    this.targetY = initialY;
    this.shipAngle = initialAngle;
    this.maxSpeed = maxSpeed ?? 0.1; // pixels/ms - slower for turn-based gameplay (was 0.3)
    this.rotationSpeed = Math.PI / 2 / 300;
  }

  setTarget(x: number, y: number): void {
    this.path = [];
    this.followingRoute = false; // a bare point-move is not a plotted route
    this.targetX = x;
    this.targetY = y;
    this.isMoving = true;
  }

  setPath(points: { x: number; y: number }[]): void {
    if (points.length === 0) return;
    this.path = points.slice(1);
    const first = points[0];
    this.targetX = first.x;
    this.targetY = first.y;
    this.isMoving = true;
    this.followingRoute = true; // flying a plotted route (crosshair stays hidden)
  }

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

  stop(): void {
    this.path = [];
    this.followingRoute = false;
    this.targetX = this.shipX;
    this.targetY = this.shipY;
    this.currentSpeed = 0;
    this.isMoving = false;
  }

  setTimeScale(v: number): void {
    this.timeScale = Math.max(0.1, v);
  }

  hasPath(): boolean {
    return this.path.length > 0;
  }

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

  getSpeedFraction(): number {
    return this.maxSpeed > 0 ? this.currentSpeed / this.maxSpeed : 0;
  }

  getMaxSpeed(): number {
    return this.maxSpeed;
  }

  canOutrun(pursuerSpeed: number): boolean {
    return this.isMoving && this.currentSpeed > pursuerSpeed;
  }

  update(deltaTime: number): void {
    const dt = Math.min(deltaTime, 100) * this.timeScale;

    let distance = this.getDistanceToTarget();

    while (this.path.length > 0 && distance <= this.WAYPOINT_SWITCH) {
      const next = this.path.shift();
      if (!next) break;
      this.targetX = next.x;
      this.targetY = next.y;
      distance = this.getDistanceToTarget();
    }

    if (distance <= this.STOP_THRESHOLD) {
      this.currentSpeed = 0;
      this.isMoving = false;
      this.followingRoute = false; // route complete — crosshair gate lifts
      if (distance < 2) {
        this.shipX = this.targetX;
        this.shipY = this.targetY;
      }
      return;
    }

    const finalLeg = this.path.length === 0;
    const stoppingDistance =
      (this.currentSpeed * this.currentSpeed) / (2 * this.deceleration);

    const targetAngle = Math.atan2(
      this.targetY - this.shipY,
      this.targetX - this.shipX,
    );
    let angleDiff = targetAngle - this.shipAngle;
    while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
    while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

    if (finalLeg && distance <= stoppingDistance && this.currentSpeed > 0) {
      this.currentSpeed = Math.max(
        0,
        this.currentSpeed - this.deceleration * dt,
      );
    } else if (this.currentSpeed < this.maxSpeed) {
      this.currentSpeed = Math.min(
        this.maxSpeed,
        this.currentSpeed + this.acceleration * dt,
      );
    }

    if (finalLeg && Math.abs(angleDiff) > this.ARC_CAP_HEADING) {
      const maxArcSpeed = this.rotationSpeed * distance * this.ARC_CAPTURE;
      if (this.currentSpeed > maxArcSpeed) this.currentSpeed = maxArcSpeed;
    }

    if (this.currentSpeed > 0) {
      const maxRotation = this.rotationSpeed * dt;
      if (Math.abs(angleDiff) <= maxRotation) {
        this.shipAngle = targetAngle;
      } else {
        this.shipAngle += Math.sign(angleDiff) * maxRotation;
      }
    }

    const moveDistance = this.currentSpeed * dt;
    this.shipX += Math.cos(this.shipAngle) * moveDistance;
    this.shipY += Math.sin(this.shipAngle) * moveDistance;
  }
}
