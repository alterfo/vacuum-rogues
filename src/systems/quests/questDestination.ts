export interface QuestDestinationPlanetLike {
  id: string;
  name: string;
}

export interface QuestDestinationSystemLike {
  id: string;
  name: string;
  planets: ReadonlyArray<QuestDestinationPlanetLike>;
}

export interface QuestDestinationGalaxyLike {
  systems: ReadonlyArray<QuestDestinationSystemLike>;
}

export interface QuestDestinationQuestLike {
  targetSystemId: string;
  targetPlanetId: string | null;
}

export interface QuestDestination {
  systemId: string;
  systemName: string;
  planetId: string | null;
  planetName: string | null;
  sameSystem: boolean;
}

export function questDestination(
  quest: QuestDestinationQuestLike,
  galaxy: QuestDestinationGalaxyLike,
  currentSystemId: string,
): QuestDestination {
  const system =
    galaxy.systems.find((s) => s.id === quest.targetSystemId) ?? null;
  const planet =
    quest.targetPlanetId != null
      ? (system?.planets.find((p) => p.id === quest.targetPlanetId) ?? null)
      : null;
  return {
    systemId: quest.targetSystemId,
    systemName: system?.name ?? quest.targetSystemId,
    planetId: quest.targetPlanetId,
    planetName: planet?.name ?? null,
    sameSystem: quest.targetSystemId === currentSystemId,
  };
}

export type QuestRouteAction =
  | { kind: "approach-planet"; planetId: string }
  | { kind: "warp-to-system"; systemId: string };

export function questRouteAction(dest: QuestDestination): QuestRouteAction {
  if (dest.sameSystem && dest.planetId != null) {
    return { kind: "approach-planet", planetId: dest.planetId };
  }
  return { kind: "warp-to-system", systemId: dest.systemId };
}
