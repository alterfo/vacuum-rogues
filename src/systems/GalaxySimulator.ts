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
import { StationType } from "@/types";
import type { Faction } from "@/types/faction";

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

      // Generate planets for this system
      const planetGen = new PlanetGenerator(seed, `sys_${i}`);
      const planets = await planetGen.generate(systemNames[i]);

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

    const galaxy = new Galaxy(
      `galaxy_${this._seed}`,
      this.systems,
      this.overmind,
      [],
      [],
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
];

const STATION_NAME: Record<StationType, (sys: string) => string> = {
  [StationType.TRADE_POST]: (s) => `Торговый пост «${s}»`,
  [StationType.REPAIR_DOCK]: (s) => `Верфь «${s}»`,
  [StationType.MILITARY_BASE]: (s) => `База «${s}»`,
  [StationType.RESEARCH_LAB]: (s) => `Лаборатория «${s}»`,
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
