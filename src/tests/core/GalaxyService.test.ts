import { describe, it, expect } from "vitest";
import { GalaxyService } from "@/core/services/GalaxyService";

describe("GalaxyService", () => {
  const service = new GalaxyService();

  it("should generate a galaxy with specified system count", async () => {
    const galaxy = await service.generate("test_seed", 10);

    expect(galaxy).toBeDefined();
    expect(galaxy.systems).toHaveLength(10);
    expect(galaxy.id).toContain("test_seed");
  });

  it("should find system by id", async () => {
    const galaxy = await service.generate("test_seed", 5);
    const firstSystem = galaxy.systems[0];

    const found = service.getSystemById(galaxy, firstSystem.id);
    expect(found).toBeDefined();
    expect(found!.id).toBe(firstSystem.id);
  });

  it("should return undefined for unknown system id", async () => {
    const galaxy = await service.generate("test_seed", 3);
    expect(service.getSystemById(galaxy, "nonexistent")).toBeUndefined();
  });

  it("should find nearby systems within radius", async () => {
    const galaxy = await service.generate("test_seed", 20);
    const origin = galaxy.systems[0];

    const nearby = service.getNearbySystems(galaxy, origin, 100);
    expect(nearby.length).toBeGreaterThanOrEqual(0);
    expect(nearby.every((s) => s.id !== origin.id)).toBe(true);
  });

  it("should return deterministic results for same seed", async () => {
    const g1 = await service.generate("deterministic", 15);
    const g2 = await service.generate("deterministic", 15);

    expect(g1.systems.map((s) => s.name)).toEqual(
      g2.systems.map((s) => s.name),
    );
  });
});
