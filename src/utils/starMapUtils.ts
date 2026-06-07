/** Visibility tiers for star map rendering */
export type SystemVisibility = "visited" | "neighbor" | "unknown";

interface SystemRef {
  id: string;
  connections: { toSystemId: string }[];
}

/**
 * Returns the visibility tier for a system on the star map.
 *
 * - visited: player has personally been to this system
 * - neighbor: reachable in 1 jump from any visited system (bidirectional)
 * - unknown: no connection to any visited system
 */
export function getSystemVisibility(
  systemId: string,
  visitedSystemIds: readonly string[],
  allSystems: readonly SystemRef[],
): SystemVisibility {
  const visitedSet = new Set(visitedSystemIds);

  if (visitedSet.has(systemId)) return "visited";

  // Check if any visited system connects to this one, or this one connects to any visited system
  for (const system of allSystems) {
    if (!visitedSet.has(system.id)) continue;
    // visited system → this system
    if (system.connections.some((c) => c.toSystemId === systemId)) {
      return "neighbor";
    }
  }

  // this system → any visited system
  const thisSystem = allSystems.find((s) => s.id === systemId);
  if (thisSystem) {
    for (const conn of thisSystem.connections) {
      if (visitedSet.has(conn.toSystemId)) return "neighbor";
    }
  }

  return "unknown";
}
