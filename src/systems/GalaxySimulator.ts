import { StarSystem } from '@/domain/StarSystem';
import { Galaxy } from '@/domain/Galaxy';
import type { Player } from '@/domain/Player';
import { Overmind } from '@/domain/Overmind';
import type { GalacticEvent } from '@/domain/GalacticEvent';
import { WarpPath } from '@/domain/WarpPath';
import { SeededRNG } from '@/utils/seededRNG';
import { SystemNameGenerator } from '@/utils/systemNameGenerator';
import { PlanetGenerator } from './PlanetGenerator';
import { logger } from '@/utils/logger';

export class GalaxySimulator {
  private _seed: string;
  private systems: StarSystem[] = [];
  private overmind: Overmind;
  private _eventQueue: GalacticEvent[] = [];
  private rng: SeededRNG;

  constructor() {
    this._seed = '';
    this.rng = new SeededRNG('default');
    this.overmind = new Overmind();
  }

  generateGalaxy(seed: string, systemCount = 10): Galaxy {
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
      const planets = planetGen.generate(systemNames[i]);

      const system = new StarSystem(
        `sys_${i}`,
        systemNames[i],
        coord,
        'YELLOW_DWARF' as import('@/types').StarType,
        planets,
        'INDEPENDENT' as import('@/types/faction').Faction,
        [],
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
          new WarpPath(system.id, conn.system.id, Math.max(1, Math.round(conn.dist / 10))),
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
    );

    logger.info(`Galaxy generated with ${systemCount} systems`);
    return galaxy;
  }

  simulateDay(galaxy: Galaxy): void {
    galaxy.simulateDay();

    // Invoke overmind every 7 days
    if (galaxy.gameDays % 7 === 0) {
      const action = this.overmind.makeMove(galaxy);
      logger.info(`Overmind action: ${action.type} on ${action.targetSystemId}`);
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
      logger.info('Chaos Gate spawn triggered');
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
