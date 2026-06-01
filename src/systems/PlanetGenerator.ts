import { Planet } from "@/domain/Planet";
import { Market } from "@/domain/Market";
import { NPC } from "@/domain/NPC";
import { PlanetType, RaceType } from "@/types";
import { SeededRNG } from "@/utils/seededRNG";
import { PlanetNameGenerator } from "@/utils/planetNameGenerator";
import { logger } from "@/utils/logger";

export interface GenerationProgress {
  total: number;
  current: number;
  status: string;
}

export class PlanetGenerator {
  private readonly rng: SeededRNG;
  private readonly ORBITAL_RADII = [150, 250, 350, 450, 550] as const;

  constructor(galaxySeed: string, systemId: string) {
    this.rng = new SeededRNG(galaxySeed + systemId);
  }

  async generate(
    systemName: string,
    onProgress?: (p: GenerationProgress) => void,
  ): Promise<Planet[]> {
    const count = this.rng.nextInt(2, 5);
    const names = PlanetNameGenerator.generate(this.rng, count);
    const planets: Planet[] = [];

    for (let i = 0; i < count; i++) {
      // Guarantee at least one habitable planet (first planet is always habitable)
      const planetType =
        i === 0 ? this.selectHabitablePlanetType() : this.selectPlanetType();
      const planetName = names[i] ?? `${systemName} ${i + 1}`;
      const orbitalRadius = this.ORBITAL_RADII[i];
      const market = this.createStubMarket();
      const planetId = `planet_${systemName}_${i}`;
      const isHabitable =
        planetType === PlanetType.TERRESTRIAL ||
        planetType === PlanetType.INDUSTRIAL ||
        planetType === PlanetType.HABITAT;

      const inhabitants = isHabitable
        ? [this.createGovernorNPC(planetId, planetName)]
        : [];

      planets.push(
        new Planet(
          planetId,
          planetName,
          planetType,
          orbitalRadius,
          market,
          inhabitants,
          [],
          isHabitable,
          0,
        ),
      );

      if (onProgress) {
        onProgress({
          total: count,
          current: i + 1,
          status: `Генерация ${planetName}...`,
        });
        await new Promise((r) => setTimeout(r, 30));
      }
    }

    logger.info(
      `Generated ${count} planets for system ${systemName} (${planets.filter((p) => p.isHabitable).length} habitable)`,
    );
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
        traits: ["authoritative", "diplomatic"],
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

  private selectPlanetType(): PlanetType {
    const weights: [PlanetType, number][] = [
      [PlanetType.TERRESTRIAL, 35],
      [PlanetType.ICE, 20],
      [PlanetType.VOLCANIC, 15],
      [PlanetType.GAS_GIANT, 15],
      [PlanetType.INDUSTRIAL, 10],
      [PlanetType.HABITAT, 5],
    ];
    const total = weights.reduce((s, [, w]) => s + w, 0);
    let roll = this.rng.nextFloat(0, total);
    for (const [type, w] of weights) {
      roll -= w;
      if (roll <= 0) return type;
    }
    return PlanetType.TERRESTRIAL;
  }

  /**
   * Select only habitable planet types for guaranteed habitable planet
   * @returns One of TERRESTRIAL, INDUSTRIAL, or HABITAT
   */
  private selectHabitablePlanetType(): PlanetType {
    const weights: [PlanetType, number][] = [
      [PlanetType.TERRESTRIAL, 70], // 70% chance (most common)
      [PlanetType.INDUSTRIAL, 20], // 20% chance
      [PlanetType.HABITAT, 10], // 10% chance (rarest)
    ];
    const total = weights.reduce((s, [, w]) => s + w, 0);
    let roll = this.rng.nextFloat(0, total);
    for (const [type, w] of weights) {
      roll -= w;
      if (roll <= 0) return type;
    }
    return PlanetType.TERRESTRIAL; // Fallback
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
}
