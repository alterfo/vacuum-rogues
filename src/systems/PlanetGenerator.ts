import { Planet } from '@/domain/Planet';
import { Market } from '@/domain/Market';
import { PlanetType } from '@/types';
import { SeededRNG } from '@/utils/seededRNG';
import { logger } from '@/utils/logger';

/**
 * Deterministic planet generation for star systems
 * Uses seeded RNG to ensure same planets for same galaxy seed + system ID
 */
export class PlanetGenerator {
  private readonly rng: SeededRNG;
  private readonly ORBITAL_RADII = [100, 180, 260, 340, 420] as const;
  private readonly PLANET_TYPE_WEIGHTS: Map<PlanetType, number>;

  constructor(galaxySeed: string, systemId: string) {
    // Combine galaxy seed with system ID for deterministic per-system generation
    this.rng = new SeededRNG(galaxySeed + systemId);

    // Define planet type distribution (more terrestrial planets, fewer gas giants)
    this.PLANET_TYPE_WEIGHTS = new Map([
      [PlanetType.TERRESTRIAL, 40],
      [PlanetType.ICE, 25],
      [PlanetType.VOLCANIC, 15],
      [PlanetType.GAS_GIANT, 10],
      [PlanetType.INDUSTRIAL, 7],
      [PlanetType.HABITAT, 3],
    ]);
  }

  /**
   * Generate 1-5 planets for a star system
   * @param systemName Name of the parent star system (for planet naming)
   * @returns Array of generated planets
   */
  generate(systemName: string): Planet[] {
    const count = this.rng.nextInt(1, 5);
    const planets: Planet[] = [];

    for (let i = 0; i < count; i++) {
      const planetType = this.selectPlanetType();
      const planetName = `${systemName} ${this.toRomanNumeral(i + 1)}`;
      const orbitalRadius = this.ORBITAL_RADII[i];
      const market = this.createStubMarket();
      const planetId = `planet_${systemName}_${i}`;

      const planet = new Planet(
        planetId,
        planetName,
        planetType,
        orbitalRadius,
        market,
        [], // inhabitants (empty for now)
        [], // availableQuests (empty for now)
      );

      planets.push(planet);
    }

    logger.info(`Generated ${count} planets for system ${systemName}`);
    return planets;
  }

  /**
   * Select planet type using weighted random distribution
   * @returns Selected PlanetType
   */
  private selectPlanetType(): PlanetType {
    // Calculate total weight
    let totalWeight = 0;
    for (const weight of this.PLANET_TYPE_WEIGHTS.values()) {
      totalWeight += weight;
    }

    // Generate random value in [0, totalWeight)
    const randomValue = this.rng.nextFloat(0, totalWeight);

    // Find selected type by accumulating weights
    let accumulatedWeight = 0;
    for (const [type, weight] of this.PLANET_TYPE_WEIGHTS.entries()) {
      accumulatedWeight += weight;
      if (randomValue < accumulatedWeight) {
        return type;
      }
    }

    // Fallback (should never reach here)
    return PlanetType.TERRESTRIAL;
  }

  /**
   * Create stub market with empty resources
   * Avoids circular dependency (Market requires Planet, Planet requires Market)
   * @returns Market instance with no resources
   */
  private createStubMarket(): Market {
    // Create empty market - planet reference can be undefined initially
    // Market will be properly initialized in future stories when trade is implemented
    return new Market([], [], []);
  }

  /**
   * Convert number to Roman numeral (1-5 only)
   * @param num Number to convert (1-5)
   * @returns Roman numeral string
   */
  private toRomanNumeral(num: number): string {
    const romanMap: Record<number, string> = {
      1: 'I',
      2: 'II',
      3: 'III',
      4: 'IV',
      5: 'V',
    };
    return romanMap[num] ?? 'I';
  }
}
