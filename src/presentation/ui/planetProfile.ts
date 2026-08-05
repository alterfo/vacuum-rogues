export const ECONOMY_RU: Record<string, string> = {
  AGRICULTURAL: "Аграрная",
  INDUSTRIAL: "Промышленная",
  MIXED: "Смешанная",
};

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

export function deterministicPopulation(planetId: string): number {
  let hash = 0;
  for (let i = 0; i < planetId.length; i++) {
    hash = (hash * 31 + planetId.charCodeAt(i)) >>> 0;
  }
  return 100_000 + (hash % 9_900_000);
}

export function resolvePopulation(
  population: number | undefined,
  planetIdSeed: string,
): number {
  return population && population > 0
    ? population
    : deterministicPopulation(planetIdSeed);
}

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
