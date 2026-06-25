/**
 * Pure, Pixi/DOM-free resolver that turns a quest's `targetSystemId` /
 * `targetPlanetId` into a human-readable destination descriptor and a route
 * action. The quest journal uses this to NAME the target system on an objective
 * and to wire a «Проложить маршрут» button onto existing routing seams
 * (in-system planet approach vs. star-map warp) — it invents no navigation.
 *
 * Structural (`*Like`) inputs keep the helper decoupled from the domain classes
 * (Galaxy/StarSystem/Planet/GeneratedQuest), mirroring `deliveryCompletion.ts`.
 */

/** Minimal structural view of a planet needed to resolve a name. */
export interface QuestDestinationPlanetLike {
  id: string;
  name: string;
}

/** Minimal structural view of a star system needed to resolve a name. */
export interface QuestDestinationSystemLike {
  id: string;
  name: string;
  planets: ReadonlyArray<QuestDestinationPlanetLike>;
}

/** Minimal structural view of the galaxy needed to resolve names. */
export interface QuestDestinationGalaxyLike {
  systems: ReadonlyArray<QuestDestinationSystemLike>;
}

/** Minimal structural view of the quest target needed to resolve a destination. */
export interface QuestDestinationQuestLike {
  targetSystemId: string;
  targetPlanetId: string | null;
}

/** Resolved, displayable destination for a quest objective. */
export interface QuestDestination {
  /** The target system id (verbatim from the quest). */
  systemId: string;
  /** Resolved system name, or the id when the system is unknown. */
  systemName: string;
  /** The target planet id, or null when the objective needs no planet. */
  planetId: string | null;
  /** Resolved planet name, or null when there is no/unknown planet. */
  planetName: string | null;
  /** True iff the target system is the player's current system. */
  sameSystem: boolean;
}

/**
 * Resolve a quest's target into a `{ systemId, systemName, planetId,
 * planetName, sameSystem }` descriptor. Tolerates a null `targetPlanetId`
 * (planetName null) and an unknown system/planet id (name falls back to the id
 * for the system, null for the planet).
 */
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

/**
 * Route action for a resolved destination:
 * - `approach-planet` when the target is in the current system AND names a
 *   concrete planet — the flight scene approaches it directly.
 * - `warp-to-system` otherwise — the star-map warp carries the player toward
 *   the target system (also the graceful fallback when same-system but the
 *   objective names no planet).
 */
export type QuestRouteAction =
  | { kind: "approach-planet"; planetId: string }
  | { kind: "warp-to-system"; systemId: string };

/** Pure decision: pick the route action for a resolved destination. */
export function questRouteAction(dest: QuestDestination): QuestRouteAction {
  if (dest.sameSystem && dest.planetId != null) {
    return { kind: "approach-planet", planetId: dest.planetId };
  }
  return { kind: "warp-to-system", systemId: dest.systemId };
}
