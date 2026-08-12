import { SeededRNG } from "@/utils/seededRNG";
import type { StarSystem } from "@/domain/StarSystem";

export const SYSTEM_TECH_WEIGHTS: ReadonlyArray<readonly [number, number]> = [
  [1, 2],
  [2, 3],
  [3, 3],
  [4, 2],
  [5, 1],
  [6, 1],
];

export const HOME_SYSTEM_MIN_TECH = 3;

export const GALAXY_MAX_TECH_FLOOR = 6;

export function pickSystemTechLevel(rng: { next(): number }): number {
  const total = SYSTEM_TECH_WEIGHTS.reduce((sum, [, w]) => sum + w, 0);
  let roll = rng.next() * total;
  for (const [tech, weight] of SYSTEM_TECH_WEIGHTS) {
    roll -= weight;
    if (roll < 0) return tech;
  }
  return SYSTEM_TECH_WEIGHTS[0][0];
}

export function assignSystemTechLevels(
  systems: StarSystem[],
  seed: string,
): void {
  systems.forEach((system, i) => {
    system.techLevel = pickSystemTechLevel(new SeededRNG(`${seed}_tech_${i}`));
  });
  if (systems.length === 0) return;
  systems[0].techLevel = Math.max(systems[0].techLevel, HOME_SYSTEM_MIN_TECH);
  let peakIdx = 0;
  for (let i = 1; i < systems.length; i++) {
    if (systems[i].techLevel > systems[peakIdx].techLevel) peakIdx = i;
  }
  if (systems[peakIdx].techLevel < GALAXY_MAX_TECH_FLOOR) {
    systems[peakIdx].techLevel = GALAXY_MAX_TECH_FLOOR;
  }
}
