import { Planet } from '@/domain/Planet';
import { Market } from '@/domain/Market';
import { NPC } from '@/domain/NPC';
import { PlanetType, RaceType } from '@/types';
import { SeededRNG } from '@/utils/seededRNG';
import { logger } from '@/utils/logger';

/**
 * Deterministic planet generation for star systems
 * Uses seeded RNG to ensure same planets for same galaxy seed + system ID
 */
export class PlanetGenerator {
  private readonly rng: SeededRNG;
  private readonly ORBITAL_RADII = [750, 1250, 1750, 2250, 2750] as const; // 5x scale for better navigation
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

      // Generate governor NPC for the planet
      const governor = this.createGovernorNPC(planetId, planetName);

      const planet = new Planet(
        planetId,
        planetName,
        planetType,
        orbitalRadius,
        market,
        [governor], // Add governor to inhabitants
        [], // availableQuests (empty for now)
      );

      planets.push(planet);
    }

    logger.info(`Generated ${count} planets for system ${systemName}`);
    return planets;
  }

  /**
   * Create a governor NPC for a planet
   * @param planetId Unique identifier for the planet
   * @param planetName Name of the planet
   * @returns Governor NPC instance
   */
  private createGovernorNPC(planetId: string, planetName: string): NPC {
    // Randomly select a race for the governor
    const races: RaceType[] = [
      RaceType.HUMAN,
      RaceType.MALAQAR,
      RaceType.PELENG,
      RaceType.FAERIAN,
      RaceType.GAALIAN,
    ];
    const governorRace = races[this.rng.nextInt(0, races.length - 1)];

    // Create governor with neutral emotion baseline
    const governor = new NPC(
      `governor_${planetId}`,
      `Губернатор ${planetName}`,
      governorRace,
      {
        traits: ['authoritative', 'diplomatic'],
        backstory: `Правитель планеты ${planetName}, отвечающий за безопасность и процветание системы.`,
      },
      {
        trust: 5,
        fear: 0,
        respect: 5,
        hostility: 0,
        curiosity: 3,
      },
      [], // Dialogue anchors (empty for MVP, will use DialogueScene templates)
      0, // No reputation requirement
    );

    return governor;
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
