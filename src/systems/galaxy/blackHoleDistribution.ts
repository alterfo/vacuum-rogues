import { SeededRNG } from "@/utils/seededRNG";
import type { StarSystem } from "@/domain/StarSystem";
import { BLACK_HOLE_SYSTEM_CHANCE } from "@/config/balance";

export const BLACK_HOLE_ANOMALY_MIN_SYSTEMS = 8;

export function pickHasBlackHoleAnomaly(rng: { next(): number }): boolean {
  return rng.next() < BLACK_HOLE_SYSTEM_CHANCE;
}

export function assignBlackHoleAnomalies(
  systems: StarSystem[],
  seed: string,
): void {
  systems.forEach((system, i) => {
    system.hasBlackHoleAnomaly = pickHasBlackHoleAnomaly(
      new SeededRNG(`${seed}_blackhole_${i}`),
    );
  });
  if (
    systems.length >= BLACK_HOLE_ANOMALY_MIN_SYSTEMS &&
    !systems.some((system) => system.hasBlackHoleAnomaly)
  ) {
    systems[0].hasBlackHoleAnomaly = true;
  }
}
