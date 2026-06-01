import type { IGalaxyService } from "@/core/ports/IGalaxyService";
import type { Galaxy } from "@/domain/Galaxy";
import type { StarSystem } from "@/domain/StarSystem";
import { GalaxySimulator } from "@/systems/GalaxySimulator";

/**
 * Mock implementation of IGalaxyService for testing.
 * Uses real GalaxySimulator for generation but allows spying/stubbing.
 */
export class MockGalaxyService implements IGalaxyService {
  private readonly simulator = new GalaxySimulator();
  private lastSeed?: string;
  private lastCount?: number;

  async generate(seed: string, systemCount: number): Promise<Galaxy> {
    this.lastSeed = seed;
    this.lastCount = systemCount;
    return this.simulator.generateGalaxy(seed, systemCount);
  }

  getSystemById(galaxy: Galaxy, id: string): StarSystem | undefined {
    return galaxy.systems.find((s) => s.id === id);
  }

  getNearbySystems(
    galaxy: Galaxy,
    origin: StarSystem,
    radius: number,
  ): StarSystem[] {
    return galaxy.systems.filter((s) => {
      if (s.id === origin.id) return false;
      const dx = s.coordinates.q - origin.coordinates.q;
      const dy = s.coordinates.r - origin.coordinates.r;
      return Math.sqrt(dx * dx + dy * dy) <= radius;
    });
  }

  /** Test helper: retrieve last generation parameters. */
  getLastGenerationParams(): { seed?: string; count?: number } {
    return { seed: this.lastSeed, count: this.lastCount };
  }
}
