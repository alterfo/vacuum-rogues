import { StarSystem } from "@/domain/StarSystem";
import { Galaxy } from "@/domain/Galaxy";
import type { Player } from "@/domain/Player";
import { Overmind } from "@/domain/Overmind";
import type { GalacticEvent } from "@/domain/GalacticEvent";
import { WarpPath } from "@/domain/WarpPath";
import { Station } from "@/domain/Station";
import { SeededRNG } from "@/utils/seededRNG";
import { SystemNameGenerator } from "@/utils/systemNameGenerator";
import { PlanetGenerator } from "./PlanetGenerator";
import { seedMarket } from "./galaxy/marketSeeding";
import { pickStarType } from "./galaxy/starTypeDistribution";
import { assignSystemTechLevels } from "./galaxy/systemTechDistribution";
import { pickSystemFaction } from "./galaxy/systemFactionDistribution";
import { NpcSimulator } from "./npc/NpcSimulator";
import { logger } from "@/utils/logger";
import {
  StationType,
  EconomyType,
  PoliticalSystem,
  FactionType,
  GalaxyEventType,
} from "@/types";
import type { GalaxyGlobalEvent, NewsEvent } from "@/types";
import type { Faction } from "@/types/faction";

const GLOBAL_EVENT_CHANCE = 0.1;

const TRADE_BOOM_DURATION = 10;

export const MIN_SYSTEM_DISTANCE = 12;

const MAX_PLACEMENT_ATTEMPTS = 200;

function pickSystemCoordinate(
  rng: SeededRNG,
  placed: readonly { q: number; r: number }[],
): { q: number; r: number } {
  let best: { q: number; r: number } | null = null;
  let bestNearestDist = -Infinity;
  for (let attempt = 0; attempt < MAX_PLACEMENT_ATTEMPTS; attempt++) {
    const candidate = { q: rng.nextInt(-50, 50), r: rng.nextInt(-50, 50) };
    let nearestDist = Infinity;
    for (const p of placed) {
      const d = Math.hypot(candidate.q - p.q, candidate.r - p.r);
      if (d < nearestDist) nearestDist = d;
    }
    if (placed.length === 0 || nearestDist >= MIN_SYSTEM_DISTANCE) {
      return candidate;
    }
    if (nearestDist > bestNearestDist) {
      bestNearestDist = nearestDist;
      best = candidate;
    }
  }
  return best ?? { q: rng.nextInt(-50, 50), r: rng.nextInt(-50, 50) };
}

export class GalaxySimulator {
  private _seed: string;
  private systems: StarSystem[] = [];
  private overmind: Overmind;
  private _eventQueue: GalacticEvent[] = [];
  private rng: SeededRNG;
  private readonly npcSimulator = new NpcSimulator();

  constructor() {
    this._seed = "";
    this.rng = new SeededRNG("default");
    this.overmind = new Overmind();
  }

  async generateGalaxy(seed: string, systemCount = 10): Promise<Galaxy> {
    this._seed = seed;
    void this._eventQueue; // referenced for future use
    this.rng = new SeededRNG(seed);

    const systemNames = SystemNameGenerator.generate(this.rng, systemCount);

    const generatedSystems: StarSystem[] = [];
    const placedCoords: { q: number; r: number }[] = [];
    for (let i = 0; i < systemCount; i++) {
      const coord = pickSystemCoordinate(
        new SeededRNG(`${seed}_coord_${i}`),
        placedCoords,
      );
      placedCoords.push(coord);

      const economyTypes = [
        EconomyType.AGRICULTURAL,
        EconomyType.INDUSTRIAL,
        EconomyType.MIXED,
      ];
      const politicalSystems = [
        PoliticalSystem.ANARCHY,
        PoliticalSystem.DICTATORSHIP,
        PoliticalSystem.MONARCHY,
        PoliticalSystem.REPUBLIC,
        PoliticalSystem.DEMOCRACY,
      ];
      const economyType =
        economyTypes[this.rng.nextInt(0, economyTypes.length - 1)];
      const politicalSystem =
        politicalSystems[this.rng.nextInt(0, politicalSystems.length - 1)];

      const starType = pickStarType(new SeededRNG(`${seed}_star_${i}`));

      const planetGen = new PlanetGenerator(seed, `sys_${i}`);
      const planets = await planetGen.generate(systemNames[i]);

      for (const planet of planets) {
        planet.market.economyType = economyType;
        planet.market.populate(seedMarket(economyType, planet.id));
      }

      const faction = pickSystemFaction(new SeededRNG(`${seed}_faction_${i}`));
      const stations = generateStations(
        `sys_${i}`,
        systemNames[i],
        faction,
        this.rng,
      );

      const system = new StarSystem(
        `sys_${i}`,
        systemNames[i],
        coord,
        starType,
        planets,
        faction,
        [],
        stations,
        economyType,
        politicalSystem,
      );
      generatedSystems.push(system);
    }

    assignSystemTechLevels(generatedSystems, seed);

    for (const system of generatedSystems) {
      const distances = generatedSystems
        .filter((s) => s.id !== system.id)
        .map((s) => ({
          system: s,
          dist: Math.sqrt(
            Math.pow(s.coordinates.q - system.coordinates.q, 2) +
              Math.pow(s.coordinates.r - system.coordinates.r, 2),
          ),
        }))
        .sort((a, b) => a.dist - b.dist);

      const connections = distances.slice(0, Math.min(3, distances.length));
      for (const conn of connections) {
        system.connections.push(
          new WarpPath(
            system.id,
            conn.system.id,
            Math.max(1, Math.round(conn.dist / 10)),
          ),
        );
      }
    }

    ensureConnectivity(generatedSystems);

    this.systems = generatedSystems;
    this.overmind = new Overmind();
    this._eventQueue = [];

    const homeId = generatedSystems[0]?.id ?? "";
    const sortedByDistance = [...generatedSystems].sort((a, b) => {
      const da = a.coordinates.q ** 2 + a.coordinates.r ** 2;
      const db = b.coordinates.q ** 2 + b.coordinates.r ** 2;
      return db - da; // descending — most isolated first
    });
    const overmindStart: string[] = [];
    const core =
      sortedByDistance.find((s) => s.id !== homeId) ?? sortedByDistance[0];
    const overmindCoreId = core?.id ?? "";
    if (core) overmindStart.push(core.id);
    if (sortedByDistance.length >= 2 && core) {
      const coreNeighbourIds = new Set(
        core.connections.map((c) => c.toSystemId),
      );
      for (const s of generatedSystems) {
        if (s.connections.some((c) => c.toSystemId === core.id)) {
          coreNeighbourIds.add(s.id);
        }
      }
      const byDistanceToCore = [...generatedSystems]
        .filter((s) => s.id !== core.id && s.id !== homeId)
        .sort((a, b) => {
          const da =
            (a.coordinates.q - core.coordinates.q) ** 2 +
            (a.coordinates.r - core.coordinates.r) ** 2;
          const db =
            (b.coordinates.q - core.coordinates.q) ** 2 +
            (b.coordinates.r - core.coordinates.r) ** 2;
          return da - db;
        });
      const secondStart =
        sortedByDistance.find(
          (s) =>
            s.id !== core.id && s.id !== homeId && coreNeighbourIds.has(s.id),
        ) ??
        byDistanceToCore[0] ??
        sortedByDistance.find((s) => s.id !== core.id && s.id !== homeId);
      if (secondStart) overmindStart.push(secondStart.id);
    }

    const overmindStartSet = new Set(overmindStart);
    const pirateStart: string[] = [];
    const pirateCandidate = sortedByDistance.find(
      (s) => !overmindStartSet.has(s.id) && s.id !== homeId,
    );
    if (pirateCandidate) pirateStart.push(pirateCandidate.id);

    assignFactionHomeSystems(generatedSystems, overmindStart, this.rng);

    const galaxy = new Galaxy(
      `galaxy_${this._seed}`,
      this.systems,
      this.overmind,
      [],
      [],
      overmindStart,
      overmindCoreId,
      pirateStart,
    );

    this.npcSimulator.spawnInitial(galaxy, this.rng);

    logger.info(`Galaxy generated with ${systemCount} systems`);
    return galaxy;
  }

  simulateDay(galaxy: Galaxy): void {
    galaxy.simulateDay();

    advanceTech(galaxy);

    if (galaxy.gameDays % 7 === 0) {
      const action = this.overmind.makeMove(galaxy);
      logger.info(
        `Overmind action: ${action.type} on ${action.targetSystemId}`,
      );
    }

    for (const event of [...galaxy.activeEvents]) {
      event.durationDays--;
      if (event.durationDays <= 0) {
        event.onExpire();
        const idx = galaxy.activeEvents.indexOf(event);
        if (idx >= 0) galaxy.activeEvents.splice(idx, 1);
      }
    }

    if (galaxy.gameDays % 30 === 0 && this.rng.next() < 0.05) {
      logger.info("Chaos Gate spawn triggered");
    }

    for (const system of galaxy.systems) {
      for (const planet of system.planets) {
        for (let i = 0; i < planet.market.demandVector.length; i++) {
          planet.market.demandVector[i] = Math.max(
            0.1,
            Math.min(
              5.0,
              planet.market.demandVector[i] + this.rng.nextFloat(-0.1, 0.1),
            ),
          );
          planet.market.supplyVector[i] = Math.max(
            0.1,
            Math.min(
              5.0,
              planet.market.supplyVector[i] + this.rng.nextFloat(-0.1, 0.1),
            ),
          );
        }
      }
    }
  }

  tickGlobalEvents(galaxy: Galaxy, rng: SeededRNG): NewsEvent[] {
    const events: NewsEvent[] = [];

    galaxy.expireGlobalEvents();

    if (rng.next() >= GLOBAL_EVENT_CHANCE) return events;

    const candidates = galaxy.systems.filter((s) => s.planets.length > 0);
    if (candidates.length === 0) return events;
    const target = candidates[rng.nextInt(0, candidates.length - 1)];

    const severity = rng.nextInt(1, 3) as 1 | 2 | 3;
    const eventTypes: GalaxyEventType[] = [
      GalaxyEventType.PIRATE_SURGE,
      GalaxyEventType.TRADE_BOOM,
      GalaxyEventType.PLAGUE,
      GalaxyEventType.DISCOVERY,
    ];
    const eventType = eventTypes[rng.nextInt(0, eventTypes.length - 1)];

    const globalEvent: GalaxyGlobalEvent = {
      type: eventType,
      systemId: target.id,
      severity,
      day: galaxy.gameDays,
    };

    const newsEvent = this.applyGlobalEvent(globalEvent, galaxy, rng);
    events.push(newsEvent);
    return events;
  }

  private applyGlobalEvent(
    event: GalaxyGlobalEvent,
    galaxy: Galaxy,
    rng: SeededRNG,
  ): NewsEvent {
    const system = galaxy.systems.find((s) => s.id === event.systemId);

    switch (event.type) {
      case GalaxyEventType.PIRATE_SURGE: {
        const pirateCount = 3 * event.severity;
        for (let i = 0; i < pirateCount; i++) {
          const id = `npc_surge_${event.systemId}_${event.day}_${i}`;
          galaxy.npcShips.push(
            this.npcSimulator.spawnPirateInSystem(rng, id, event.systemId),
          );
        }
        if (system) {
          for (const planet of system.planets) {
            if (!planet.market) continue;
            for (let i = 0; i < planet.market.priceMultipliers.length; i++) {
              planet.market.priceMultipliers[i] = Math.min(
                2.5,
                (planet.market.priceMultipliers[i] ?? 1) * 1.2,
              );
            }
          }
        }
        logger.info(
          `PIRATE_SURGE in ${system?.name ?? event.systemId} (severity ${event.severity}): +${pirateCount} pirates, prices +20%`,
        );
        return {
          type: "PIRATE_SURGE",
          systemId: event.systemId,
          day: event.day,
          description: `Пиратский рейд! Флот пиратов атакует систему ${system?.name ?? event.systemId}. Цены на товары резко выросли.`,
        };
      }

      case GalaxyEventType.TRADE_BOOM: {
        galaxy.applyTradeBoom(event.systemId, TRADE_BOOM_DURATION);
        logger.info(
          `TRADE_BOOM in ${system?.name ?? event.systemId}: prices -15% for ${TRADE_BOOM_DURATION} days`,
        );
        return {
          type: "TRADE_BOOM",
          systemId: event.systemId,
          day: event.day,
          description: `Торговый бум в системе ${system?.name ?? event.systemId}! Цены снижены на 15% в течение ${TRADE_BOOM_DURATION} дней.`,
        };
      }

      case GalaxyEventType.PLAGUE: {
        if (system) {
          const habitable = system.planets.filter((p) => p.isHabitable);
          const planet =
            habitable[rng.nextInt(0, Math.max(0, habitable.length - 1))];
          if (planet) {
            const loss = Math.round(planet.population * 0.3);
            planet.population = Math.max(0, planet.population - loss);
            logger.info(
              `PLAGUE on ${planet.name}: population -30% (now ${planet.population})`,
            );
          }
        }
        return {
          type: "PLAGUE",
          systemId: event.systemId,
          day: event.day,
          description: `Эпидемия в системе ${system?.name ?? event.systemId}! Население резко сократилось. Спрос на медикаменты вырос.`,
        };
      }

      case GalaxyEventType.DISCOVERY: {
        const foggyNeighbors = galaxy.systems.filter((s) => {
          if (!s.fogOfWar) return false;
          return (
            system?.connections.some((c) => c.toSystemId === s.id) ?? false
          );
        });
        let discovered = "неизвестная система";
        if (foggyNeighbors.length > 0) {
          const found =
            foggyNeighbors[rng.nextInt(0, foggyNeighbors.length - 1)];
          found.fogOfWar = false;
          found.explored = true;
          discovered = found.name;
          logger.info(
            `DISCOVERY: revealed ${found.name} (adjacent to ${system?.name})`,
          );
        }
        const findTypes = [
          "заброшенный корабль",
          "залежи минералов",
          "древние руины",
        ];
        const findType = findTypes[rng.nextInt(0, findTypes.length - 1)];
        return {
          type: "DISCOVERY",
          systemId: event.systemId,
          day: event.day,
          description: `Открытие! Вблизи системы ${system?.name ?? event.systemId} обнаружен ${findType}. Система ${discovered} нанесена на карту.`,
        };
      }

      default: {
        const unknownType = (event as GalaxyGlobalEvent).type;
        logger.warn(`GalaxySimulator: unknown event type "${unknownType}"`);
        return {
          type: "MARKET_SHIFT" as NewsEvent["type"],
          systemId: event.systemId,
          day: event.day,
          description: `Неизвестное событие в системе ${system?.name ?? event.systemId}.`,
        };
      }
    }
  }

  getVisibleSystems(_player: Player): StarSystem[] {
    return this.systems.filter((s) => {
      if (s.explored) return true;
      return false;
    });
  }
}

function undirectedComponents(systems: StarSystem[]): StarSystem[][] {
  const byId = new Map(systems.map((s) => [s.id, s]));
  const adj = new Map<string, Set<string>>();
  for (const s of systems) adj.set(s.id, new Set());
  for (const s of systems) {
    for (const conn of s.connections) {
      if (!byId.has(conn.toSystemId)) continue;
      adj.get(s.id)!.add(conn.toSystemId);
      adj.get(conn.toSystemId)!.add(s.id);
    }
  }

  const seen = new Set<string>();
  const components: StarSystem[][] = [];
  for (const start of systems) {
    if (seen.has(start.id)) continue;
    const component: StarSystem[] = [];
    const queue = [start.id];
    seen.add(start.id);
    for (let head = 0; head < queue.length; head++) {
      const id = queue[head];
      const sys = byId.get(id);
      if (sys) component.push(sys);
      for (const neighbor of adj.get(id) ?? []) {
        if (!seen.has(neighbor)) {
          seen.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    components.push(component);
  }
  return components;
}

export function ensureConnectivity(systems: StarSystem[]): void {
  if (systems.length <= 1) return;

  let components = undirectedComponents(systems);
  let guard = systems.length + 1;
  while (components.length > 1 && guard-- > 0) {
    components.sort((a, b) => b.length - a.length);
    const largest = components[0];
    const smallest = components[components.length - 1];

    let bestFrom: StarSystem | null = null;
    let bestTo: StarSystem | null = null;
    let bestDist = Infinity;
    for (const a of smallest) {
      for (const b of largest) {
        const dq = a.coordinates.q - b.coordinates.q;
        const dr = a.coordinates.r - b.coordinates.r;
        const dist = Math.sqrt(dq * dq + dr * dr);
        if (dist < bestDist) {
          bestDist = dist;
          bestFrom = a;
          bestTo = b;
        }
      }
    }

    if (bestFrom && bestTo) {
      const cost = Math.max(1, Math.round(bestDist / 10));
      bestFrom.connections.push(new WarpPath(bestFrom.id, bestTo.id, cost));
      bestTo.connections.push(new WarpPath(bestTo.id, bestFrom.id, cost));
    }

    components = undirectedComponents(systems);
  }
}

const TECH_MAX = 8;
const TECH_ADVANCE_INTERVAL_RESEARCH_LAB = 50;
const TECH_ADVANCE_INTERVAL_PLAIN = 100;

export function advanceTech(galaxy: Galaxy): void {
  const day = galaxy.gameDays;
  const shouldAdvanceResearchLab =
    day % TECH_ADVANCE_INTERVAL_RESEARCH_LAB === 0 && day > 0;
  const shouldAdvancePlain = day % TECH_ADVANCE_INTERVAL_PLAIN === 0 && day > 0;

  if (!shouldAdvanceResearchLab && !shouldAdvancePlain) return;

  const hostileSet = new Set([
    ...galaxy.overmindSystems,
    ...galaxy.pirateSystems,
  ]);

  for (const system of galaxy.systems) {
    if (hostileSet.has(system.id)) continue;
    if (system.techLevel >= TECH_MAX) continue;

    const hasResearchLab = system.stations.some(
      (s) => s.type === StationType.RESEARCH_LAB,
    );

    if (hasResearchLab && shouldAdvanceResearchLab) {
      system.techLevel = Math.min(TECH_MAX, system.techLevel + 1);
    } else if (!hasResearchLab && shouldAdvancePlain) {
      system.techLevel = Math.min(TECH_MAX, system.techLevel + 1);
    }
  }
}

const FACTION_HOME_ECONOMY: Record<string, EconomyType> = {
  [FactionType.PROGRESSORS]: EconomyType.INDUSTRIAL,
  [FactionType.OUTLANDERS]: EconomyType.AGRICULTURAL,
  [FactionType.SYNDICATE]: EconomyType.MIXED,
  [FactionType.BASTIONS]: EconomyType.MIXED,
  [FactionType.PARADOXES]: EconomyType.MIXED,
};

const HOME_FACTIONS = [
  FactionType.OUTLANDERS,
  FactionType.BASTIONS,
  FactionType.SYNDICATE,
  FactionType.PARADOXES,
  FactionType.PROGRESSORS,
];

function assignFactionHomeSystems(
  systems: StarSystem[],
  overmindSystemIds: string[],
  rng: SeededRNG,
): void {
  const overmindSet = new Set(overmindSystemIds);
  const candidates = systems.filter((s) => !overmindSet.has(s.id));
  if (candidates.length < HOME_FACTIONS.length) return;

  const chosen: StarSystem[] = [];

  for (const faction of HOME_FACTIONS) {
    let best: StarSystem | null = null;
    let bestScore = -Infinity;

    for (const sys of candidates) {
      if (sys.isFactionHome) continue;

      let score: number;
      if (chosen.length === 0) {
        score =
          sys.coordinates.q * sys.coordinates.q +
          sys.coordinates.r * sys.coordinates.r;
      } else {
        score = Math.min(
          ...chosen.map((c) => {
            const dq = sys.coordinates.q - c.coordinates.q;
            const dr = sys.coordinates.r - c.coordinates.r;
            return dq * dq + dr * dr;
          }),
        );
      }
      score += rng.nextFloat(0, 0.01);

      if (score > bestScore) {
        bestScore = score;
        best = sys;
      }
    }

    if (!best) continue;
    best.isFactionHome = true;
    best.homeFactionId =
      faction as unknown as import("@/types/faction").Faction;
    (best as unknown as { ownerFaction: Faction }).ownerFaction =
      best.homeFactionId;

    const econOverride = FACTION_HOME_ECONOMY[faction];
    if (econOverride) {
      (best as unknown as { economyType: EconomyType }).economyType =
        econOverride;
      for (const planet of best.planets) {
        planet.market.economyType = econOverride;
        planet.market.populate(seedMarket(econOverride, planet.id));
      }
    }
    chosen.push(best);
  }
}

const STATION_TYPES = [
  StationType.TRADE_POST,
  StationType.REPAIR_DOCK,
  StationType.MILITARY_BASE,
  StationType.RESEARCH_LAB,
  StationType.CRAFT_CENTER,
];

const STATION_NAME: Record<StationType, (sys: string) => string> = {
  [StationType.TRADE_POST]: (s) => `Торговый пост «${s}»`,
  [StationType.REPAIR_DOCK]: (s) => `Верфь «${s}»`,
  [StationType.MILITARY_BASE]: (s) => `База «${s}»`,
  [StationType.RESEARCH_LAB]: (s) => `Лаборатория «${s}»`,
  [StationType.CRAFT_CENTER]: (s) => `Центр крафта «${s}»`,
};

function generateStations(
  systemId: string,
  systemName: string,
  faction: Faction,
  rng: SeededRNG,
): Station[] {
  const typeIdx = rng.nextInt(0, STATION_TYPES.length - 1);
  const type = STATION_TYPES[typeIdx];
  const name = STATION_NAME[type](systemName);

  const orbitRadius = 900 + rng.nextInt(0, 800); // 900–1700 px
  const hash = [...systemId].reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const orbitAngle = ((hash * 137.508) % 360) * (Math.PI / 180);

  return [
    new Station(
      `${systemId}_station_0`,
      name,
      type,
      faction,
      orbitRadius,
      orbitAngle,
    ),
  ];
}
