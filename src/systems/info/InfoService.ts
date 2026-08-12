import type { StarSystem } from "@/domain/StarSystem";
import type { NpcShip } from "@/domain/NpcShip";
import type { NewsEvent } from "@/types";
import { StationType } from "@/types";
import { Faction } from "@/types/faction";
import { GalacticRegistry } from "@/systems/info/GalacticRegistry";
import {
  generateGalaxyGear,
  stationSellsGear,
} from "@/systems/equipment/ShopGenerator";
import { GearKind } from "@/systems/equipment/GearCatalog";
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
  const stations: {
    systemId: string;
    planetId: string;
    priceFactor: number;
    maxTechLevel: number;
  }[] = [];
  for (const sys of galaxy.systems) {
    const factor = factionPriceFactor(sys.ownerFaction);
    const systemTechLevel = techLevelWithUplift(sys.techLevel, day);
    for (const planet of sys.planets) {
      if (planet.isHabitable === false) continue;
      planets.push({
        systemId: sys.id,
        planetId: planet.id,
        priceFactor: factor,
        maxTechLevel: systemTechLevel,
      });
    }
    for (const station of sys.stations ?? []) {
      if (!stationSellsGear(station.type)) continue;
      const isResearchLab = station.type === StationType.RESEARCH_LAB;
      stations.push({
        systemId: sys.id,
        planetId: station.id,
        priceFactor: isResearchLab ? 1.1 : 1.0,
        maxTechLevel: isResearchLab
          ? Math.min(8, systemTechLevel + 1)
          : systemTechLevel,
      });
    }
  }
  const gear = [
    ...generateGalaxyGear(planets, seed, day),
    ...generateGalaxyGear(stations, seed, day).filter(
      (l) => l.gear.kind !== GearKind.HULL,
    ),
  ];
  return new GalacticRegistry(
    galaxy.systems,
    galaxy.npcShips,
    gear,
    galaxy.newsFeed,
  );
}
