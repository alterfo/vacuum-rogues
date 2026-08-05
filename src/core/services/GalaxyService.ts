import type { IGalaxyService } from "@/core/ports/IGalaxyService";
import type { Galaxy } from "@/domain/Galaxy";
import type { StarSystem } from "@/domain/StarSystem";
import { GalaxySimulator } from "@/systems/GalaxySimulator";

export class GalaxyService implements IGalaxyService {
  private readonly simulator = new GalaxySimulator();

  async generate(seed: string, systemCount: number): Promise<Galaxy> {
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
      const dist = Math.sqrt(dx * dx + dy * dy);
      return dist <= radius;
    });
  }
}
