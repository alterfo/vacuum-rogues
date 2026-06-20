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
