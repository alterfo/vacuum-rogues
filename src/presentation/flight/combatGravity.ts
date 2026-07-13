/**
 * Planet gravity-assist (slingshot) physics — pure, PixiJS-free.
 *
 * Task 4 of the pause-and-plan combat rework
 * (`docs/plans/20260713-tactical-pause-combat-rework.md`). During an execute window the
 * ship flies the planned course in real time; if that course carries it within a planet's
 * **assist radius**, the planet's gravity adds a small velocity boost *along the ship's
 * current heading* — a slingshot accelerates along the pass trajectory, it doesn't yank
 * the ship sideways into the planet. The boost is a pure function of the pass distance and
 * a **mass-proxy** (the planet's rendered `displayRadius` — no new domain fields, no
 * galaxy-gen or save impact; it reuses the live planet position/size data the flight scene
 * already has).
 *
 * Scope (Task 1 decision 1e): **planet-assist only**. Black holes — a pull-toward-centre
 * hazard entity needing new galaxy-gen + `StarSystem` state + presentation + almost
 * certainly a schema/migration/version bump — are **deferred to Post-Completion** as a
 * gated stretch follow-up, not in this plan.
 *
 * Kept a pure module (no PixiJS / no scene deps), unit-tested standalone — the same
 * discipline as `combatPlanning` / `combatTrajectory` / `combatRounds`. Live values come
 * from `GRAVITY_ASSIST` in `balance.ts`; the scene passes them in so tune-in-one-place holds.
 */

import type { Vec2 } from "./combatTrajectory";

export type { Vec2 };

/**
 * A gravitating body the slingshot reads: its world position and a size that stands in for
 * mass. For a planet, `radius` is the rendered `displayRadius` (bigger disc ⇒ heavier pull).
 */
export interface GravityBody {
  x: number;
  y: number;
  /** Rendered disc radius (px), used as the mass-proxy — never a new persisted field. */
  radius: number;
}

/** The ship state the slingshot reads: where it is and which way (and how fast) it moves. */
export interface GravityShipState {
  /** Current world position. */
  pos: Vec2;
  /** Current velocity (px/ms). Its direction is the pass trajectory the boost runs along. */
  vel: Vec2;
}

/** Tuning for {@link gravityAssistDelta}; mirrors `GRAVITY_ASSIST` in `balance.ts`. */
export interface GravityAssistConfig {
  /** Assist reaches to `body.radius × radiusMultiplier` from the body centre. */
  radiusMultiplier: number;
  /** Mass-proxy denominator: a body of this `radius` contributes unit mass. */
  referenceRadius: number;
  /** Per-ms boost at closest approach for a unit-mass body, before distance falloff. */
  strengthPerMs: number;
  /** Hard cap on the per-ms speed added by a single body. */
  maxBoostPerMs: number;
}

/** Module-local default, mirroring `GRAVITY_ASSIST` so this file stays import-light for tests. */
export const DEFAULT_GRAVITY_ASSIST: GravityAssistConfig = {
  radiusMultiplier: 3.5,
  referenceRadius: 120,
  strengthPerMs: 0.00012,
  maxBoostPerMs: 0.00008,
};

/** Distance (px) out to which `body` still slings a passing ship. */
export function gravityAssistRadius(
  body: GravityBody,
  config: GravityAssistConfig = DEFAULT_GRAVITY_ASSIST,
): number {
  return Math.max(0, body.radius) * Math.max(0, config.radiusMultiplier);
}

/** The mass-proxy a body contributes (its size relative to `referenceRadius`). */
function massProxy(body: GravityBody, config: GravityAssistConfig): number {
  const ref = config.referenceRadius > 0 ? config.referenceRadius : 1;
  return Math.max(0, body.radius) / ref;
}

/**
 * The velocity delta (px/ms) a single body adds to the ship this frame — a slingshot boost
 * **along the ship's current heading**, scaled by mass-proxy and a linear distance falloff
 * (0 at the assist edge → full at the surface), integrated over `dtMs` and capped at
 * `maxBoostPerMs × dtMs`.
 *
 * Returns a zero vector when: the pass is outside the assist radius, the ship is (near-)
 * stationary (no trajectory to accelerate along), `dtMs ≤ 0`, or the body has no size.
 * Never yanks the ship toward the planet — the boost direction is purely the velocity's.
 */
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

  // Boost runs along the ship's heading; a stationary ship has no trajectory to slingshot.
  const speed = Math.sqrt(ship.vel.x * ship.vel.x + ship.vel.y * ship.vel.y);
  if (speed <= 0) return zero;

  // Linear falloff: 1 at the surface (dist→0), 0 at the assist edge (dist→reach).
  const falloff = Math.max(0, Math.min(1, 1 - dist / reach));
  let boostPerMs = config.strengthPerMs * massProxy(body, config) * falloff;
  boostPerMs = Math.min(boostPerMs, Math.max(0, config.maxBoostPerMs));

  const magnitude = boostPerMs * dt;
  const ux = ship.vel.x / speed;
  const uy = ship.vel.y / speed;
  return { x: ux * magnitude, y: uy * magnitude };
}

/**
 * Sum the slingshot deltas from every body the ship is currently passing — the primitive
 * the execute-phase movement loop calls each frame to fold gravity into the ship's velocity.
 * A ship in no planet's assist radius gets a zero delta (a plain coast).
 */
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
