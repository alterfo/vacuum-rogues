import type { Vec2 } from "./combatTrajectory";

export type { Vec2 };

export interface GravityBody {
  x: number;
  y: number;
  radius: number;
}

export interface GravityShipState {
  pos: Vec2;
  vel: Vec2;
}

export interface GravityAssistConfig {
  radiusMultiplier: number;
  referenceRadius: number;
  strengthPerMs: number;
  maxBoostPerMs: number;
}

export const DEFAULT_GRAVITY_ASSIST: GravityAssistConfig = {
  radiusMultiplier: 3.5,
  referenceRadius: 120,
  strengthPerMs: 0.00012,
  maxBoostPerMs: 0.00008,
};

export function gravityAssistRadius(
  body: GravityBody,
  config: GravityAssistConfig = DEFAULT_GRAVITY_ASSIST,
): number {
  return Math.max(0, body.radius) * Math.max(0, config.radiusMultiplier);
}

function massProxy(body: GravityBody, config: GravityAssistConfig): number {
  const ref = config.referenceRadius > 0 ? config.referenceRadius : 1;
  return Math.max(0, body.radius) / ref;
}

export function gravityAssistDelta(
  ship: GravityShipState,
  body: GravityBody,
  dtMs: number,
  config: GravityAssistConfig = DEFAULT_GRAVITY_ASSIST,
): Vec2 {
  const zero = { x: 0, y: 0 };
  const dt = Math.max(0, dtMs);
  if (dt === 0 || body.radius <= 0) return zero;

  const reach = gravityAssistRadius(body, config);
  if (reach <= 0) return zero;

  const dx = ship.pos.x - body.x;
  const dy = ship.pos.y - body.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist >= reach) return zero;

  const speed = Math.sqrt(ship.vel.x * ship.vel.x + ship.vel.y * ship.vel.y);
  if (speed <= 0) return zero;

  const falloff = Math.max(0, Math.min(1, 1 - dist / reach));
  let boostPerMs = config.strengthPerMs * massProxy(body, config) * falloff;
  boostPerMs = Math.min(boostPerMs, Math.max(0, config.maxBoostPerMs));

  const magnitude = boostPerMs * dt;
  const ux = ship.vel.x / speed;
  const uy = ship.vel.y / speed;
  return { x: ux * magnitude, y: uy * magnitude };
}

export function gravityAssistTotal(
  ship: GravityShipState,
  bodies: readonly GravityBody[],
  dtMs: number,
  config: GravityAssistConfig = DEFAULT_GRAVITY_ASSIST,
): Vec2 {
  let x = 0;
  let y = 0;
  for (const body of bodies) {
    const d = gravityAssistDelta(ship, body, dtMs, config);
    x += d.x;
    y += d.y;
  }
  return { x, y };
}
