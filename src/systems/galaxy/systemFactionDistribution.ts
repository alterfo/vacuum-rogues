import type { Faction } from "@/types/faction";
import { FACTION_DISTRIBUTION_WEIGHTS } from "@/config/balance";

/**
 * Deterministically pick a weighted system owner faction. `rng` only needs
 * `next()` → [0,1) (a {@link SeededRNG} satisfies this), so the draw is
 * reproducible from the seed it was built with. Mirrors
 * `pickSystemTechLevel`'s weighted-pick shape.
 */
export function pickSystemFaction(rng: { next(): number }): Faction {
  const total = FACTION_DISTRIBUTION_WEIGHTS.reduce((sum, [, w]) => sum + w, 0);
  let roll = rng.next() * total;
  for (const [faction, weight] of FACTION_DISTRIBUTION_WEIGHTS) {
    roll -= weight;
    if (roll < 0) return faction;
  }
  return FACTION_DISTRIBUTION_WEIGHTS[0][0];
}
