import type { StarSystem } from "@/domain/StarSystem";
import type { NpcShip } from "@/domain/NpcShip";
import type { NewsEvent } from "@/types";
import { Faction } from "@/types/faction";
import { GalacticRegistry } from "@/systems/info/GalacticRegistry";
import { generateGalaxyGear } from "@/systems/equipment/ShopGenerator";
import { techLevelWithUplift } from "@/systems/campaign/techUplift";

export interface GalaxyView {
  readonly systems: StarSystem[];
  readonly npcShips: NpcShip[];
  readonly newsFeed: NewsEvent[];
}

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

export function buildRegistry(
  galaxy: GalaxyView,
  seed: string,
  day: number,
): GalacticRegistry {
  const planets: {
    systemId: string;
    planetId: string;
    priceFactor: number;
    maxTechLevel: number;
  }[] = [];
  for (const sys of galaxy.systems) {
    const factor = factionPriceFactor(sys.ownerFaction);
    const maxTechLevel = techLevelWithUplift(sys.techLevel, day);
    for (const planet of sys.planets) {
      planets.push({
        systemId: sys.id,
        planetId: planet.id,
        priceFactor: factor,
        maxTechLevel,
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
