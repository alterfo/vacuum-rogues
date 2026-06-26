/**
 * Hyperjump-distance over the warp graph (shared by the quest generator and the
 * galactic information registry). Pure: a breadth-first search returning, for an
 * origin system, the number of hyperjumps to every reachable system.
 */
import type { StarSystem } from "@/domain/StarSystem";

/** Options for {@link jumpDistances}. */
export interface JumpDistanceOptions {
  /**
   * Treat the warp graph as UNDIRECTED — a jump may follow an edge in EITHER
   * direction. This is the metric the player actually travels: the star-map nav
   * allows a warp whenever a connection exists either way
   * (`StarMapScene.handleSystemDoubleClick`), and ~25% of galaxy links are
   * one-way (`ensureConnectivity` bridges components with directed edges). A
   * directed-only scan therefore mis-counts the real hop distance (the same
   * reason the Overmind arc reads `frontierSystems` undirected). Quests advertise
   * and budget deadlines against this metric so "advertised jumps" matches the
   * nav. Defaults to `false` (legacy directed behaviour).
   */
  readonly undirected?: boolean;
}

/** Map of `systemId → hyperjumps from origin` (origin itself = 0). */
export function jumpDistances(
  systems: StarSystem[],
  originId: string,
  options?: JumpDistanceOptions,
): Map<string, number> {
  const undirected = options?.undirected ?? false;
  const byId = new Map(systems.map((s) => [s.id, s]));

  // Build the adjacency BFS walks: every system's outgoing connections, plus —
  // when undirected — every system that connects *into* it. Preserves the
  // original per-connection iteration order so the directed result is byte-identical.
  const adj = new Map<string, string[]>();
  const link = (from: string, to: string): void => {
    if (!byId.has(to) || !byId.has(from)) return;
    const list = adj.get(from);
    if (list) list.push(to);
    else adj.set(from, [to]);
  };
  for (const sys of systems) {
    for (const conn of sys.connections) {
      link(sys.id, conn.toSystemId);
      if (undirected) link(conn.toSystemId, sys.id);
    }
  }

  const dist = new Map<string, number>();
  const queue: string[] = [];
  if (byId.has(originId)) {
    dist.set(originId, 0);
    queue.push(originId);
  }
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head];
    const d = dist.get(id) ?? 0;
    for (const to of adj.get(id) ?? []) {
      if (!dist.has(to)) {
        dist.set(to, d + 1);
        queue.push(to);
      }
    }
  }
  return dist;
}
