import type { Galaxy } from "@/domain/Galaxy";
import type { StarSystem } from "@/domain/StarSystem";
import { BLACK_HOLE_JUMP_MISHAP_CHANCE } from "@/config/balance";
import { SeededRNG } from "@/utils/seededRNG";

export function rollBlackHoleMishap(seed: string): boolean {
  return new SeededRNG(seed).next() < BLACK_HOLE_JUMP_MISHAP_CHANCE;
}

export function findNearestBlackHoleSystem(
  galaxy: Galaxy,
  fromSystemId: string,
): StarSystem | null {
  const byId = new Map(galaxy.systems.map((system) => [system.id, system]));
  if (!byId.has(fromSystemId)) return null;

  const adjacency = new Map<string, string[]>();
  const link = (from: string, to: string): void => {
    if (!byId.has(from) || !byId.has(to)) return;
    const list = adjacency.get(from);
    if (list) list.push(to);
    else adjacency.set(from, [to]);
  };

  for (const system of galaxy.systems) {
    for (const connection of system.connections) {
      link(system.id, connection.toSystemId);
      link(connection.toSystemId, system.id);
    }
  }

  const distances = new Map<string, number>([[fromSystemId, 0]]);
  const queue = [fromSystemId];
  for (let head = 0; head < queue.length; head++) {
    const currentId = queue[head];
    const currentDistance = distances.get(currentId) ?? 0;
    for (const neighborId of adjacency.get(currentId) ?? []) {
      if (!distances.has(neighborId)) {
        distances.set(neighborId, currentDistance + 1);
        queue.push(neighborId);
      }
    }
  }

  let nearest: StarSystem | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const system of galaxy.systems) {
    if (system.id === fromSystemId || !system.hasBlackHoleAnomaly) continue;
    const distance = distances.get(system.id);
    if (distance === undefined) continue;
    if (
      distance < nearestDistance ||
      (distance === nearestDistance &&
        (nearest === null || system.id < nearest.id))
    ) {
      nearest = system;
      nearestDistance = distance;
    }
  }

  return nearest;
}
