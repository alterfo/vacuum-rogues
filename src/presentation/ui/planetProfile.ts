/**
 * Shared, PixiJS-free descriptors for a planet/system's social profile —
 * economy type, political system and population — so every info surface
 * (the flight-hover `PlanetInfoPanel`, the landed `PlanetScene` card and the
 * `GovernmentScene`) renders the same labels from one source of truth.
 *
 * SOURCE-OF-TRUTH §11.1 requires the planet info panel to surface population,
 * economy type, political system and player attitude; these helpers cover the
 * first three (attitude is reputation, resolved via `reputationUtils`).
 */

/** RU display label per `EconomyType`. */
export const ECONOMY_RU: Record<string, string> = {
  AGRICULTURAL: "Аграрная",
  INDUSTRIAL: "Промышленная",
  MIXED: "Смешанная",
};

/** RU display label per `PoliticalSystem`. */
export const POLITICAL_RU: Record<string, string> = {
  ANARCHY: "Анархия",
  DICTATORSHIP: "Диктатура",
  MONARCHY: "Монархия",
  REPUBLIC: "Республика",
  DEMOCRACY: "Демократия",
};

export function economyLabel(economyType?: string | null): string {
  return ECONOMY_RU[economyType ?? ""] ?? "—";
}

export function politicalLabel(politicalSystem?: string | null): string {
  return POLITICAL_RU[politicalSystem ?? ""] ?? "—";
}

/**
 * A stable, seed-free population count derived purely from the planet id, so a
 * planet always reads the same number without needing a persisted field. Used
 * as a fallback whenever `planet.population` is unset (0) — generation seeds it
 * only on fresh galaxies (see `systems/galaxy/CLAUDE.md`).
 */
export function deterministicPopulation(planetId: string): number {
  let hash = 0;
  for (let i = 0; i < planetId.length; i++) {
    hash = (hash * 31 + planetId.charCodeAt(i)) >>> 0;
  }
  return 100_000 + (hash % 9_900_000);
}

/**
 * Resolve the population to display: the live `planet.population` when it has
 * been seeded (> 0), else the deterministic id-derived fallback.
 */
export function resolvePopulation(
  population: number | undefined,
  planetIdSeed: string,
): number {
  return population && population > 0
    ? population
    : deterministicPopulation(planetIdSeed);
}

/** Compact RU population read-out, e.g. `1.2 млн` / `450 тыс`. */
export function formatPopulation(count: number): string {
  if (count >= 1_000_000) {
    const millions = count / 1_000_000;
    return `${millions.toFixed(millions >= 10 ? 0 : 1)} млн`;
  }
  if (count >= 1_000) {
    return `${Math.round(count / 1_000)} тыс`;
  }
  return String(count);
}
