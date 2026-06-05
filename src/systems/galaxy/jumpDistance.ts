/**
 * Hyperjump-distance over the warp graph (shared by the quest generator and the
 * galactic information registry). Pure: a breadth-first search returning, for an
 * origin system, the number of hyperjumps to every reachable system.
 */
import type { StarSystem } from "@/domain/StarSystem";

/** Map of `systemId → hyperjumps from origin` (origin itself = 0). */
export function jumpDistances(
  systems: StarSystem[],
  originId: string,
): Map<string, number> {
  const byId = new Map(systems.map((s) => [s.id, s]));
  const dist = new Map<string, number>();
  const queue: string[] = [];
  if (byId.has(originId)) {
    dist.set(originId, 0);
    queue.push(originId);
  }
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head];
    const d = dist.get(id) ?? 0;
    const sys = byId.get(id);
    if (!sys) continue;
    for (const conn of sys.connections) {
      if (!dist.has(conn.toSystemId) && byId.has(conn.toSystemId)) {
        dist.set(conn.toSystemId, d + 1);
        queue.push(conn.toSystemId);
      }
    }
  }
  return dist;
}
