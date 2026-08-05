import type { StarSystem } from "@/domain/StarSystem";

export interface JumpDistanceOptions {
  readonly undirected?: boolean;
}

export function jumpDistances(
  systems: StarSystem[],
  originId: string,
  options?: JumpDistanceOptions,
): Map<string, number> {
  const undirected = options?.undirected ?? false;
  const byId = new Map(systems.map((s) => [s.id, s]));

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
