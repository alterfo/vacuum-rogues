/**
 * Info-center facade (EPIC-009): builds a {@link GalacticRegistry} from the live
 * galaxy in one call, composing per-planet equipment shops (EPIC-007) and the
 * market/ship indices. This is the seam the info-center UI and the engine use —
 * they ask InfoService for a ready registry and run queries against it, without
 * knowing how the listings are assembled.
 *
 * Pure: deterministic given the galaxy + seed + day; rebuild after the
 * simulation advances a day (cheap — it only re-indexes derived state).
 */
import type { StarSystem } from "@/domain/StarSystem";
import type { NpcShip } from "@/domain/NpcShip";
import type { NewsEvent } from "@/types";
import { Faction } from "@/types/faction";
import { GalacticRegistry } from "@/systems/info/GalacticRegistry";
import { generateGalaxyGear } from "@/systems/equipment/ShopGenerator";

/** Minimal view of the galaxy the registry needs (eases testing). */
export interface GalaxyView {
  readonly systems: StarSystem[];
  readonly npcShips: NpcShip[];
  readonly newsFeed: NewsEvent[];
}

/**
 * Faction/economy price modifier for a system's shops: trade-leaning owners are
 * cheaper, militarised ones dearer. Keeps gear prices varied across the galaxy
 * so "where is it cheapest" has a real answer (US-094).
 */
export function factionPriceFactor(faction: Faction): number {
  switch (faction) {
    case Faction.OUTLANDERS:
      return 0.9; // traders — cheap
    case Faction.SYNDICATE:
      return 0.95; // black market
    case Faction.PROGRESSORS:
      return 1.05; // high-tech premium
    case Faction.BASTIONS:
      return 1.15; // militarised — dear
    default:
      return 1.0;
  }
}

/**
 * Build a galactic registry for the given day: ship locations, market goods and
 * per-planet gear shops, all queryable by parameter and jump distance.
 */
export function buildRegistry(
  galaxy: GalaxyView,
  seed: string,
  day: number,
): GalacticRegistry {
  const planets: { systemId: string; planetId: string; priceFactor: number }[] =
    [];
  for (const sys of galaxy.systems) {
    const factor = factionPriceFactor(sys.ownerFaction);
    for (const planet of sys.planets) {
      planets.push({
        systemId: sys.id,
        planetId: planet.id,
        priceFactor: factor,
      });
    }
  }
  const gear = generateGalaxyGear(planets, seed, day);
  return new GalacticRegistry(
    galaxy.systems,
    galaxy.npcShips,
    gear,
    galaxy.newsFeed,
  );
}
