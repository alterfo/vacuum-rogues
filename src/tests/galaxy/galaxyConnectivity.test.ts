import { describe, it, expect } from "vitest";
import { GalaxySimulator, ensureConnectivity } from "@/systems/GalaxySimulator";
import { StarSystem } from "@/domain/StarSystem";
import { WarpPath } from "@/domain/WarpPath";
import type { StarType } from "@/types";
import type { Faction } from "@/types/faction";

interface ConnLike {
  connections: { toSystemId: string }[];
  id: string;
}

function reachableCount(systems: ConnLike[], originId: string): number {
  const byId = new Map(systems.map((s) => [s.id, s]));
  const adj = new Map<string, Set<string>>();
  for (const s of systems) adj.set(s.id, new Set());
  for (const s of systems) {
    for (const c of s.connections) {
      if (byId.has(c.toSystemId)) {
        adj.get(s.id)!.add(c.toSystemId);
        adj.get(c.toSystemId)!.add(s.id);
      }
    }
  }
  const seen = new Set<string>([originId]);
  const queue = [originId];
  for (let head = 0; head < queue.length; head++) {
    for (const n of adj.get(queue[head]) ?? []) {
      if (!seen.has(n)) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  return seen.size;
}

function makeSystem(id: string, q: number, r: number): StarSystem {
  return new StarSystem(
    id,
    id,
    { q, r },
    "YELLOW_DWARF" as StarType,
    [],
    "INDEPENDENT" as Faction,
    [],
  );
}

describe("ensureConnectivity", () => {
  it("merges two disconnected clusters into one reachable component", () => {
    const a0 = makeSystem("a0", 0, 0);
    const a1 = makeSystem("a1", 1, 0);
    const a2 = makeSystem("a2", 0, 1);
    const b0 = makeSystem("b0", 50, 50);
    const b1 = makeSystem("b1", 51, 50);
    a0.connections.push(
      new WarpPath("a0", "a1", 1),
      new WarpPath("a0", "a2", 1),
    );
    a1.connections.push(new WarpPath("a1", "a0", 1));
    a2.connections.push(new WarpPath("a2", "a0", 1));
    b0.connections.push(new WarpPath("b0", "b1", 1));
    b1.connections.push(new WarpPath("b1", "b0", 1));
    const systems = [a0, a1, a2, b0, b1];

    expect(reachableCount(systems, "a0")).toBe(3);

    ensureConnectivity(systems);

    expect(reachableCount(systems, "a0")).toBe(5);
    expect(reachableCount(systems, "b1")).toBe(5);
  });

  it("connects the nearest pair across components (cheapest cross-link)", () => {
    const a0 = makeSystem("a0", 0, 0);
    const a1 = makeSystem("a1", 10, 0);
    const b0 = makeSystem("b0", 12, 0);
    a0.connections.push(new WarpPath("a0", "a1", 1));
    a1.connections.push(new WarpPath("a1", "a0", 1));
    const systems = [a0, b0, a1];

    ensureConnectivity(systems);

    const b0LinksToA1 = b0.connections.some((c) => c.toSystemId === "a1");
    const a1LinksToB0 = a1.connections.some((c) => c.toSystemId === "b0");
    expect(b0LinksToA1 || a1LinksToB0).toBe(true);
    expect(b0.connections.some((c) => c.toSystemId === "a0")).toBe(false);
    expect(reachableCount(systems, "a0")).toBe(3);
  });

  it("is a no-op for an already-connected graph (adds no extra links)", () => {
    const a0 = makeSystem("a0", 0, 0);
    const a1 = makeSystem("a1", 1, 0);
    a0.connections.push(new WarpPath("a0", "a1", 1));
    a1.connections.push(new WarpPath("a1", "a0", 1));
    const before = a0.connections.length + a1.connections.length;

    ensureConnectivity([a0, a1]);

    expect(a0.connections.length + a1.connections.length).toBe(before);
  });
});

describe("GalaxySimulator warp connectivity", () => {
  const seeds = [
    "conn-seed-1",
    "conn-seed-2",
    "conn-seed-3",
    "conn-seed-4",
    "conn-seed-5",
    "conn-seed-6",
    "conn-seed-7",
    "conn-seed-8",
    "conn-seed-9",
    "conn-seed-10",
    "isolated-cluster",
    "lonely-star",
  ];

  for (const seed of seeds) {
    it(`generates a fully-connected 10-system galaxy for seed "${seed}"`, async () => {
      const galaxy = await new GalaxySimulator().generateGalaxy(seed, 10);
      const origin = galaxy.systems[0].id;
      expect(reachableCount(galaxy.systems, origin)).toBe(
        galaxy.systems.length,
      );
    });
  }
});
