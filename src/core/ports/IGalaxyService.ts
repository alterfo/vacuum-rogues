import type { Galaxy } from "@/domain/Galaxy";
import type { StarSystem } from "@/domain/StarSystem";

/**
 * Port for galaxy generation and simulation.
 * Follows SRP: generation logic is separate from GameEngine coordination.
 */
export interface IGalaxyService {
  generate(seed: string, systemCount: number): Promise<Galaxy>;
  getSystemById(galaxy: Galaxy, id: string): StarSystem | undefined;
  getNearbySystems(
    galaxy: Galaxy,
    origin: StarSystem,
    radius: number,
  ): StarSystem[];
}
