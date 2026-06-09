import { Planet } from "@/domain/Planet";
import { Market } from "@/domain/Market";
import { PlanetType } from "@/types";
import { SeededRNG } from "@/utils/seededRNG";
import { PlanetNameGenerator } from "@/utils/planetNameGenerator";
import { logger } from "@/utils/logger";
import { SYSTEM_GEOMETRY } from "@/config/balance";

export interface GenerationProgress {
  total: number;
  current: number;
  status: string;
}

/**
 * Frost-line orbital zones: the set of planet types allowed at each orbit
 * index (0 = innermost/hottest, 4 = outermost/coldest). Hot rocky worlds hug
 * the star; gas giants and ice worlds sit in the cold outer reaches. There is
 * no dedicated "barren" enum member, so INDUSTRIAL (mining/factory worlds)
 * stands in for the harsh rocky bodies of the inner system.
 *
 * Index this with the planet's orbit index; unit tests assert every generated
 * planet's type falls within its zone.
 */
export const ORBIT_ZONES: readonly PlanetType[][] = [
  [PlanetType.VOLCANIC, PlanetType.INDUSTRIAL],
  [PlanetType.VOLCANIC, PlanetType.INDUSTRIAL, PlanetType.TERRESTRIAL],
  [PlanetType.TERRESTRIAL, PlanetType.HABITAT, PlanetType.INDUSTRIAL],
  [PlanetType.HABITAT, PlanetType.TERRESTRIAL, PlanetType.GAS_GIANT],
  [PlanetType.GAS_GIANT, PlanetType.ICE],
];

/** Relative selection weights per planet type (within a zone's allowed set). */
const TYPE_WEIGHTS: Record<PlanetType, number> = {
  [PlanetType.VOLCANIC]: 20,
  [PlanetType.INDUSTRIAL]: 15,
  [PlanetType.TERRESTRIAL]: 30,
  [PlanetType.HABITAT]: 10,
  [PlanetType.GAS_GIANT]: 20,
  [PlanetType.ICE]: 20,
};

/** Planet types that carry population and can be landed on / traded with. */
const HABITABLE_TYPES: readonly PlanetType[] = [
  PlanetType.TERRESTRIAL,
  PlanetType.INDUSTRIAL,
  PlanetType.HABITAT,
];

export class PlanetGenerator {
  private readonly rng: SeededRNG;
  private readonly ORBITAL_RADII = SYSTEM_GEOMETRY.orbitRadii;

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

    // Guarantee at least one habitable planet, placed at the goldilocks orbit
    // (index 2) when the system is large enough, else the outermost orbit.
    const habitableOrbit = Math.min(count - 1, 2);

    for (let i = 0; i < count; i++) {
      const planetType = this.selectForZone(i, i === habitableOrbit);
      const planetName = names[i] ?? `${systemName} ${i + 1}`;
      const orbitalRadius = this.ORBITAL_RADII[i];
      const market = this.createStubMarket();
      const planetId = `planet_${systemName}_${i}`;
      const isHabitable = HABITABLE_TYPES.includes(planetType);

      const population = isHabitable ? this.rng.nextInt(500_000, 5_000_000) : 0;

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
          population,
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
   * Pick a planet type for the given orbit index, constrained to that orbit's
   * frost-line zone. When `habitableOnly` is set, the choice is further limited
   * to habitable types within the zone (the system's guaranteed landing spot).
   */
  private selectForZone(
    orbitIndex: number,
    habitableOnly: boolean,
  ): PlanetType {
    const zone =
      ORBIT_ZONES[Math.min(orbitIndex, ORBIT_ZONES.length - 1)] ??
      ORBIT_ZONES[ORBIT_ZONES.length - 1];
    let allowed = zone;
    if (habitableOnly) {
      const habitable = zone.filter((t) => HABITABLE_TYPES.includes(t));
      if (habitable.length > 0) allowed = habitable;
    }
    return this.weightedPick(allowed);
  }

  private weightedPick(types: readonly PlanetType[]): PlanetType {
    const total = types.reduce((s, t) => s + TYPE_WEIGHTS[t], 0);
    let roll = this.rng.nextFloat(0, total);
    for (const t of types) {
      roll -= TYPE_WEIGHTS[t];
      if (roll <= 0) return t;
    }
    return types[types.length - 1];
  }

  private createStubMarket(): Market {
    return new Market([], [], []);
  }
}
