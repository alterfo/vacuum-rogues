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
import { NpcSimulator } from "./npc/NpcSimulator";
import { logger } from "@/utils/logger";
import {
  StationType,
  EconomyType,
  PoliticalSystem,
  GalaxyEventType,
} from "@/types";
import type { GalaxyGlobalEvent, NewsEvent } from "@/types";
import type { Faction } from "@/types/faction";

/**
 * Per-day probability of a global galaxy event firing (~1 event per 10 days on
 * average, which falls comfortably within the stated 7–15 day range).
 */
const GLOBAL_EVENT_CHANCE = 0.1;

/** Duration of a TradeBoom effect in days. */
const TRADE_BOOM_DURATION = 10;

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

    // Generate unique system names
    const systemNames = SystemNameGenerator.generate(this.rng, systemCount);

    // Generate systems with deterministic coordinates
    const generatedSystems: StarSystem[] = [];
    for (let i = 0; i < systemCount; i++) {
      const coord = {
        q: this.rng.nextInt(-50, 50),
        r: this.rng.nextInt(-50, 50),
      };

      // Deterministically assign economy type and political system from seed
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

      // Generate planets for this system
      const planetGen = new PlanetGenerator(seed, `sys_${i}`);
      const planets = await planetGen.generate(systemNames[i]);

      // Propagate economy type to each planet's market
      for (const planet of planets) {
        planet.market.economyType = economyType;
      }

      // Generate 1 station per system (type depends on index/seed)
      const faction = "INDEPENDENT" as Faction;
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
        "YELLOW_DWARF" as import("@/types").StarType,
        planets,
        faction,
        [],
        stations,
        economyType,
        politicalSystem,
      );
      generatedSystems.push(system);
    }

    // Ensure minimum 2 warp paths per system using simplified distance-based connections
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

    this.systems = generatedSystems;
    this.overmind = new Overmind();
    this._eventQueue = [];

    // Assign OVERMIND starting systems: the 2 most distant from the galactic
    // centre (highest q²+r² magnitude). The most distant becomes the core.
    const sortedByDistance = [...generatedSystems].sort((a, b) => {
      const da = a.coordinates.q ** 2 + a.coordinates.r ** 2;
      const db = b.coordinates.q ** 2 + b.coordinates.r ** 2;
      return db - da; // descending — most isolated first
    });
    const overmindStart: string[] = [];
    if (sortedByDistance.length >= 1)
      overmindStart.push(sortedByDistance[0].id);
    if (sortedByDistance.length >= 2)
      overmindStart.push(sortedByDistance[1].id);
    const overmindCoreId = sortedByDistance[0]?.id ?? "";

    const galaxy = new Galaxy(
      `galaxy_${this._seed}`,
      this.systems,
      this.overmind,
      [],
      [],
      overmindStart,
      overmindCoreId,
    );

    // Populate the galaxy with autonomous NPC ships (Feature 8).
    this.npcSimulator.spawnInitial(galaxy, this.rng);

    logger.info(`Galaxy generated with ${systemCount} systems`);
    return galaxy;
  }

  simulateDay(galaxy: Galaxy): void {
    galaxy.simulateDay();

    // Invoke overmind every 7 days
    if (galaxy.gameDays % 7 === 0) {
      const action = this.overmind.makeMove(galaxy);
      logger.info(
        `Overmind action: ${action.type} on ${action.targetSystemId}`,
      );
    }

    // Process active events
    for (const event of [...galaxy.activeEvents]) {
      event.durationDays--;
      if (event.durationDays <= 0) {
        event.onExpire();
        const idx = galaxy.activeEvents.indexOf(event);
        if (idx >= 0) galaxy.activeEvents.splice(idx, 1);
      }
    }

    // Roll for Chaos Gate spawn (5% per ~30 days)
    if (galaxy.gameDays % 30 === 0 && this.rng.next() < 0.05) {
      logger.info("Chaos Gate spawn triggered");
    }

    // Update market vectors
    for (const system of galaxy.systems) {
      for (const planet of system.planets) {
        // Slight random drift in supply/demand
        for (let i = 0; i < planet.market.demandVector.length; i++) {
          planet.market.demandVector[i] += this.rng.nextFloat(-0.1, 0.1);
          planet.market.supplyVector[i] += this.rng.nextFloat(-0.1, 0.1);
        }
      }
    }
  }

  /**
   * Roll and apply random galaxy-wide events every ~10 days (seeded per day so
   * events are deterministic for a given galaxy + day combination).
   * Returns news events describing what happened.
   */
  tickGlobalEvents(galaxy: Galaxy, rng: SeededRNG): NewsEvent[] {
    const events: NewsEvent[] = [];

    // Expire any TradeBoom whose duration has elapsed.
    galaxy.expireGlobalEvents();

    if (rng.next() >= GLOBAL_EVENT_CHANCE) return events;

    // Pick a target system at random (exclude systems with no planets).
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

  /**
   * Apply a global event's effect and return the corresponding news event.
   */
  private applyGlobalEvent(
    event: GalaxyGlobalEvent,
    galaxy: Galaxy,
    rng: SeededRNG,
  ): NewsEvent {
    const system = galaxy.systems.find((s) => s.id === event.systemId);

    switch (event.type) {
      case GalaxyEventType.PIRATE_SURGE: {
        // Spawn +3 pirate NPCs in target system; prices rise +20%.
        const pirateCount = 3 * event.severity;
        for (let i = 0; i < pirateCount; i++) {
          const id = `npc_surge_${event.systemId}_${event.day}_${i}`;
          galaxy.npcShips.push(
            this.npcSimulator.spawnPirateInSystem(
              galaxy,
              rng,
              id,
              event.systemId,
            ),
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
        // All prices in target system drop -15% for 10 days.
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
        // Target planet population -= 30%.
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
        // Reveal a previously foggy system adjacent to the target.
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
    }
  }

  getVisibleSystems(_player: Player): StarSystem[] {
    // Systems within 2 warp jumps of any visited system
    // In a full implementation, visited systems would be tracked on the player
    // For now, return all systems as a placeholder
    return this.systems.filter((s) => {
      if (s.explored) return true;
      // Check if within 2 jumps of explored system
      return false;
    });
  }
}

// ── Station generation helpers ──────────────────────────────────────────────

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
  // Each system gets exactly 1 station. Type is pseudo-random but reproducible.
  const typeIdx = rng.nextInt(0, STATION_TYPES.length - 1);
  const type = STATION_TYPES[typeIdx];
  const name = STATION_NAME[type](systemName);

  // Place station between the innermost and outermost planet orbits.
  // PlanetGenerator uses ORBITAL_RADII ≈ [600..2500]; we split that range.
  const orbitRadius = 900 + rng.nextInt(0, 800); // 900–1700 px
  // Use a seeded angle unique to this system to spread stations around the star.
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
