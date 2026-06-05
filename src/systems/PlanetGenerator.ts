import { Planet } from "@/domain/Planet";
import { Market } from "@/domain/Market";
import { PlanetType } from "@/types";
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
  private readonly ORBITAL_RADII = [600, 1050, 1500, 1950, 2500] as const;

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

      planets.push(
        new Planet(
          planetId,
          planetName,
          planetType,
          orbitalRadius,
          market,
          [],
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

  private selectHabitablePlanetType(): PlanetType {
    const weights: [PlanetType, number][] = [
      [PlanetType.TERRESTRIAL, 70],
      [PlanetType.INDUSTRIAL, 20],
      [PlanetType.HABITAT, 10],
    ];
    const total = weights.reduce((s, [, w]) => s + w, 0);
    let roll = this.rng.nextFloat(0, total);
    for (const [type, w] of weights) {
      roll -= w;
      if (roll <= 0) return type;
    }
    return PlanetType.TERRESTRIAL;
  }

  private createStubMarket(): Market {
    return new Market([], [], []);
  }
}
