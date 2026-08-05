import type { Faction } from "@/types/faction";
import { FACTION_DISTRIBUTION_WEIGHTS } from "@/config/balance";

export function pickSystemFaction(rng: { next(): number }): Faction {
  const total = FACTION_DISTRIBUTION_WEIGHTS.reduce((sum, [, w]) => sum + w, 0);
  let roll = rng.next() * total;
  for (const [faction, weight] of FACTION_DISTRIBUTION_WEIGHTS) {
    roll -= weight;
    if (roll < 0) return faction;
  }
  return FACTION_DISTRIBUTION_WEIGHTS[0][0];
}
