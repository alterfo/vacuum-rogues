import { describe, it, expect } from "vitest";
import { GalaxySimulator } from "@/systems/GalaxySimulator";

interface ConnLike {
  connections: { toSystemId: string }[];
  id: string;
}

function areWarpConnected(a: ConnLike, b: ConnLike): boolean {
  return (
    a.connections.some((c) => c.toSystemId === b.id) ||
    b.connections.some((c) => c.toSystemId === a.id)
  );
}

describe("GalaxySimulator OVERMIND seed coherence", () => {
  const seeds = [
    "overmind-seed-1",
    "overmind-seed-2",
    "overmind-seed-3",
    "overmind-seed-4",
    "overmind-seed-5",
    "overmind-seed-6",
    "overmind-seed-7",
    "overmind-seed-8",
  ];

  for (const seed of seeds) {
    it(`seeds 2 warp-connected OVERMIND systems for seed "${seed}"`, async () => {
      const galaxy = await new GalaxySimulator().generateGalaxy(seed, 24);

      expect(galaxy.overmindSystems.length).toBe(2);
      expect(galaxy.overmindCoreSystemId).toBe(galaxy.overmindSystems[0]);

      const [coreId, secondId] = galaxy.overmindSystems;
      const core = galaxy.systems.find((s) => s.id === coreId);
      const second = galaxy.systems.find((s) => s.id === secondId);
      expect(core).toBeDefined();
      expect(second).toBeDefined();

      expect(areWarpConnected(core!, second!)).toBe(true);

      expect(coreId).not.toBe(galaxy.systems[0].id);
      expect(secondId).not.toBe(galaxy.systems[0].id);
    });
  }

  it("never seeds the player's home system as the second OVERMIND starter in a 2-system galaxy", async () => {
    const galaxy = await new GalaxySimulator().generateGalaxy(
      "overmind-tiny-seed",
      2,
    );
    const homeId = galaxy.systems[0].id;
    for (const id of galaxy.overmindSystems) {
      expect(id).not.toBe(homeId);
    }
  });

  it("still seeds a distinct pirate system that doesn't collide with the OVERMIND seed", async () => {
    const galaxy = await new GalaxySimulator().generateGalaxy(
      "overmind-pirate-seed",
      24,
    );
    expect(galaxy.pirateSystems.length).toBe(1);
    const overmindSet = new Set(galaxy.overmindSystems);
    expect(overmindSet.has(galaxy.pirateSystems[0])).toBe(false);
  });
});
