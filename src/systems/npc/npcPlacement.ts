import { SeededRNG } from "@/utils/seededRNG";
import { SYSTEM_GEOMETRY } from "@/config/balance";

/**
 * Deterministic interior position for an NPC ship, expressed as an offset from
 * the system's star centre. Keyed by the galaxy seed (id) + the ship id, so the
 * same ship always lands in the same spot — reproducible for old saves (the
 * migration seeds it) and stable across re-entry (the spawn path stores it).
 *
 * The offset sits in the same `[innerRadius, outerRadius]` band that the flight
 * scene uses for interior NPC spawns; callers add the live star centre to map it
 * to screen space (`spawnX = centre.x + worldX`). This is the single source of
 * truth for first-time NPC placement: the simulation owns position thereafter
 * (like the ABS ledger owns balances) — presentation never invents one.
 */
export function deterministicNpcOffset(
  galaxySeed: string,
  npcId: string,
): { x: number; y: number } {
  const rng = new SeededRNG(`npcpos:${galaxySeed}:${npcId}`);
  const angle = rng.nextFloat(0, Math.PI * 2);
  const radius = rng.nextFloat(
    SYSTEM_GEOMETRY.innerRadius,
    SYSTEM_GEOMETRY.outerRadius,
  );
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  };
}

/**
 * Per-day angular velocity (radians) of an NPC's slow in-system orbit about the
 * star, derived deterministically from the galaxy seed + ship id (small, signed).
 * A constant per ship, so N tracked ticks rotate it by exactly `N × step` — the
 * single source of in-system position change (the simulation owns it; see
 * {@link advanceNpcOrbit}). Pure: no main-RNG consumption, so it never perturbs
 * the deterministic simulation stream.
 */
export function npcOrbitStep(galaxySeed: string, npcId: string): number {
  const rng = new SeededRNG(`npcdrift:${galaxySeed}:${npcId}`);
  // ~3°–15°/day, random sign: a slow, visible drift — never a teleport.
  const magnitude = rng.nextFloat(Math.PI / 60, Math.PI / 12);
  return rng.next() < 0.5 ? -magnitude : magnitude;
}

/**
 * Advance a persisted NPC offset one tracked tick along its deterministic
 * in-system orbit: rotate it `step` radians about the star centre. Pure, and
 * radius-preserving (a rotation), so the ship stays in its `[inner, outer]` band
 * — positions evolve only through this tracked step, never drifting out of bounds.
 */
export function advanceNpcOrbit(
  offset: { x: number; y: number },
  step: number,
): { x: number; y: number } {
  const cos = Math.cos(step);
  const sin = Math.sin(step);
  return {
    x: offset.x * cos - offset.y * sin,
    y: offset.x * sin + offset.y * cos,
  };
}
