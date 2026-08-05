import type { Galaxy } from "@/domain/Galaxy";
import type { StarSystem } from "@/domain/StarSystem";

export interface IGalaxyService {
  generate(seed: string, systemCount: number): Promise<Galaxy>;
  getSystemById(galaxy: Galaxy, id: string): StarSystem | undefined;
  getNearbySystems(
    galaxy: Galaxy,
    origin: StarSystem,
    radius: number,
  ): StarSystem[];
}
