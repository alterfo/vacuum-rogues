import type { Galaxy } from "@/domain/Galaxy";
import type { StarSystem } from "@/domain/StarSystem";
import type { SeededRNG } from "@/utils/seededRNG";
import { NpcShip } from "@/domain/NpcShip";
import {
  NpcRole,
  NpcState,
  NpcGoalKind,
  FactionType,
  ResourceType,
} from "@/types";
import type { NewsEvent } from "@/types";
import type { NpcBrain } from "./NpcBrain";
import { RuleBasedNpcBrain } from "./NpcBrain";
import { logger } from "@/utils/logger";

/** Average number of NPC ships spawned per star system. */
const NPCS_PER_SYSTEM = 4;

/** Per-day fraction of a pirate's damage applied to a victim in off-screen fights. */
const PIRATE_DAMAGE_FRACTION = 0.5;
/** Per-day fraction of damage a victim deals back to the attacking pirate. */
const VICTIM_RETALIATION_FRACTION = 0.3;
/** Credits a pirate loots when it destroys a victim. */
const PIRATE_LOOT = 200;
/** How much one unit of NPC cargo shifts a market's supply vector on trade. */
const NPC_TRADE_SUPPLY_IMPACT = 0.02;

/** Goods a trader NPC can carry (fuel excluded — consumed for travel). */
const TRADEABLE_GOODS: ResourceType[] = [
  ResourceType.METALS,
  ResourceType.CRYSTALS,
  ResourceType.ORGANICS,
  ResourceType.MEDICINE,
  ResourceType.ELECTRONICS,
  ResourceType.LUXURY,
  ResourceType.DATA_CORES,
];

/** Per-day chance a ship that has arrived somewhere decides to move on (~6-7 day
 *  dwell): long enough to actually orbit/visit a planet and read as purposeful,
 *  short enough that ships keep circulating and don't pile up in one system. */
const DEPART_CHANCE = 0.15;

/** Per-day chance a ranger NPC accepts a random delivery quest to another system. */
const RANGER_QUEST_CHANCE = 0.1;

/** Per-day chance a pirate NPC raids a trader's cargo in the same off-screen system. */
const PIRATE_CARGO_RAID_CHANCE = 0.05;

/** How often (game days) PATROL convoys are assembled toward contested borders. */
const CONVOY_ASSEMBLY_INTERVAL = 30;
/** Max PATROL ships recruited into a single convoy. */
const CONVOY_MAX_SHIPS = 3;
/** Per-convoy chance to liberate a contested system on arrival. */
const CONVOY_LIBERATION_CHANCE = 0.2;

const FACTIONS: FactionType[] = [
  FactionType.OUTLANDERS,
  FactionType.BASTIONS,
  FactionType.SYNDICATE,
  FactionType.PARADOXES,
  FactionType.PROGRESSORS,
];

const ROLES: NpcRole[] = [
  NpcRole.RANGER,
  NpcRole.TRADER,
  NpcRole.PIRATE,
  NpcRole.PATROL,
];

const FACTION_NAME: Record<FactionType, string> = {
  [FactionType.OUTLANDERS]: "Окраинник",
  [FactionType.BASTIONS]: "Бастион",
  [FactionType.SYNDICATE]: "Синдикат",
  [FactionType.PARADOXES]: "Парадокс",
  [FactionType.PROGRESSORS]: "Прогрессор",
};

const ROLE_NAME: Record<NpcRole, string> = {
  [NpcRole.RANGER]: "Рейнджер",
  [NpcRole.TRADER]: "Торговец",
  [NpcRole.PIRATE]: "Пират",
  [NpcRole.PATROL]: "Патруль",
};

/** Base combat stats per role. */
const ROLE_STATS: Record<
  NpcRole,
  {
    hull: number;
    shields: number;
    speed: number;
    damage: number;
    shieldPower: number;
  }
> = {
  [NpcRole.RANGER]: {
    hull: 120,
    shields: 60,
    speed: 0.1,
    damage: 25,
    shieldPower: 3,
  },
  [NpcRole.TRADER]: {
    hull: 100,
    shields: 30,
    speed: 0.08,
    damage: 10,
    shieldPower: 1,
  },
  [NpcRole.PIRATE]: {
    hull: 110,
    shields: 40,
    speed: 0.12,
    damage: 30,
    shieldPower: 2,
  },
  [NpcRole.PATROL]: {
    hull: 140,
    shields: 70,
    speed: 0.1,
    damage: 28,
    shieldPower: 4,
  },
};

/** Representative equipment loadout names for each role (shown via scan). */
const ROLE_LOADOUT: Record<NpcRole, string[]> = {
  [NpcRole.RANGER]: ["Двигатель ур.3", "Генератор поля", "Сканер целей"],
  [NpcRole.TRADER]: ["Двигатель ур.1", "Топливный бак", "Ремонтный дроид"],
  [NpcRole.PIRATE]: ["Двигатель ур.2", "Импульсная пушка", "Радар"],
  [NpcRole.PATROL]: ["Двигатель ур.3", "Генератор поля", "Балистическая пушка"],
};

/**
 * Map NpcRole to a tech level (1–3) used for CombatScene enemy initialization.
 * Determines weapon/shield strength of the spawned enemy.
 */
export function npcRoleTechLevel(role: NpcRole): number {
  const map: Record<NpcRole, number> = {
    [NpcRole.PATROL]: 3,
    [NpcRole.RANGER]: 2,
    [NpcRole.PIRATE]: 2,
    [NpcRole.TRADER]: 1,
  };
  return map[role] ?? 1;
}

/**
 * Advances the autonomous life of NPC ships across the galaxy: spawning them at
 * generation time and, each game day, moving them between systems toward their
 * goals. Off-screen combat, trading and quest resolution arrive in later slices
 * (Feature 8). Stateless aside from its brain, so it is save/load-safe.
 */
export class NpcSimulator {
  private readonly brain: NpcBrain;

  constructor(brain: NpcBrain = new RuleBasedNpcBrain()) {
    this.brain = brain;
  }

  /**
   * Populate the galaxy with an initial NPC population. Deterministic for a
   * given rng (which is seeded from the galaxy seed during generation).
   */
  spawnInitial(galaxy: Galaxy, rng: SeededRNG): NpcShip[] {
    if (galaxy.systems.length === 0) return galaxy.npcShips;

    const count = Math.round(galaxy.systems.length * NPCS_PER_SYSTEM);
    for (let i = 0; i < count; i++) {
      this.spawnOne(galaxy, rng, `npc_${i}`);
    }

    // Faction home systems get double NPC density to feel more alive.
    const homeSystems = galaxy.systems.filter((s) => s.isFactionHome);
    let homeIdx = 0;
    for (const homeSystem of homeSystems) {
      for (let j = 0; j < NPCS_PER_SYSTEM; j++) {
        this.spawnOneInSystem(
          galaxy,
          rng,
          `npc_home_${homeIdx}_${j}`,
          homeSystem.id,
        );
        homeIdx++;
      }
    }

    logger.info(`Spawned ${galaxy.npcShips.length} NPC ships`);
    return galaxy.npcShips;
  }

  /**
   * Spawn a pirate NPC directly in the specified system and return it.
   * Used by GalaxySimulator for PIRATE_SURGE events.
   */
  spawnPirateInSystem(
    _galaxy: Galaxy,
    rng: SeededRNG,
    id: string,
    systemId: string,
  ): NpcShip {
    const stats = ROLE_STATS[NpcRole.PIRATE];
    const faction = FactionType.OUTLANDERS;
    return new NpcShip({
      id,
      name: `${ROLE_NAME[NpcRole.PIRATE]} ${FACTION_NAME[faction]} ${id}`,
      race: faction,
      faction: faction as unknown as import("@/types/faction").Faction,
      role: NpcRole.PIRATE,
      hullHP: stats.hull,
      maxHull: stats.hull,
      shields: stats.shields,
      speed: stats.speed,
      damage: stats.damage,
      currentSystemId: systemId,
      state: NpcState.PATROLLING, // dwell at spawn; IDLE departs next tick
      goal: null,
      destinationSystemId: null,
      daysToArrival: 0,
      credits: rng.nextInt(50, 300),
      reputation: 0,
      shieldPower: stats.shieldPower,
      loadoutSummary: ROLE_LOADOUT[NpcRole.PIRATE],
      cargo: [],
    });
  }

  /** Create one NPC with the given id at a random system. */
  private spawnOne(galaxy: Galaxy, rng: SeededRNG, id: string): void {
    const system = galaxy.systems[rng.nextInt(0, galaxy.systems.length - 1)];
    const role = ROLES[rng.nextInt(0, ROLES.length - 1)];
    const faction =
      role === NpcRole.PIRATE
        ? FactionType.OUTLANDERS
        : FACTIONS[rng.nextInt(0, FACTIONS.length - 1)];
    const stats = ROLE_STATS[role];

    galaxy.npcShips.push(
      new NpcShip({
        id,
        name: `${ROLE_NAME[role]} ${FACTION_NAME[faction]} ${id}`,
        race: faction,
        faction: faction as unknown as import("@/types/faction").Faction,
        role,
        hullHP: stats.hull,
        maxHull: stats.hull,
        shields: stats.shields,
        speed: stats.speed,
        damage: stats.damage,
        currentSystemId: system.id,
        state: NpcState.PATROLLING,
        goal: null,
        destinationSystemId: null,
        daysToArrival: 0,
        credits: rng.nextInt(100, 1000),
        reputation: 0,
        shieldPower: stats.shieldPower,
        loadoutSummary: ROLE_LOADOUT[role],
        cargo: role === NpcRole.TRADER ? this.pickTraderCargo(system, rng) : [],
      }),
    );
  }

  /** Spawn one NPC in a specific system (used for home-system density boost). */
  private spawnOneInSystem(
    galaxy: Galaxy,
    rng: SeededRNG,
    id: string,
    systemId: string,
  ): void {
    const system = galaxy.systems.find((s) => s.id === systemId);
    if (!system) return;
    const role = ROLES[rng.nextInt(0, ROLES.length - 1)];
    const faction =
      role === NpcRole.PIRATE
        ? FactionType.OUTLANDERS
        : FACTIONS[rng.nextInt(0, FACTIONS.length - 1)];
    const stats = ROLE_STATS[role];
    galaxy.npcShips.push(
      new NpcShip({
        id,
        name: `${ROLE_NAME[role]} ${FACTION_NAME[faction]} ${id}`,
        race: faction,
        faction: faction as unknown as import("@/types/faction").Faction,
        role,
        hullHP: stats.hull,
        maxHull: stats.hull,
        shields: stats.shields,
        speed: stats.speed,
        damage: stats.damage,
        currentSystemId: system.id,
        state: NpcState.PATROLLING,
        goal: null,
        destinationSystemId: null,
        daysToArrival: 0,
        credits: rng.nextInt(100, 1000),
        reputation: 0,
        shieldPower: stats.shieldPower,
        loadoutSummary: ROLE_LOADOUT[role],
        cargo: role === NpcRole.TRADER ? this.pickTraderCargo(system, rng) : [],
      }),
    );
  }

  /**
   * Pick a random cargo load (1–3 goods, 5–20 units each) for a trader NPC.
   * Prefers the cheapest goods available in the system's markets; falls back to
   * the global tradeable goods list when the system has no planets with markets.
   */
  private pickTraderCargo(
    system: StarSystem,
    rng: SeededRNG,
  ): { goodId: string; qty: number }[] {
    let candidateGoods: string[] = TRADEABLE_GOODS as string[];

    const planet = system.planets.find(
      (p) => p.market && p.market.availableResources.length > 0,
    );
    if (planet) {
      const priced = planet.market.availableResources
        .map((r) => ({ r: r as string, price: planet.market.getPrice(r) }))
        .sort((a, b) => a.price - b.price);
      candidateGoods = priced.map((p) => p.r);
    }

    const count = rng.nextInt(1, Math.min(3, candidateGoods.length));
    const result: { goodId: string; qty: number }[] = [];
    const used = new Set<string>();
    let attempts = 0;
    while (result.length < count && attempts < candidateGoods.length * 3) {
      const idx = rng.nextInt(0, candidateGoods.length - 1);
      attempts++;
      if (!used.has(candidateGoods[idx])) {
        used.add(candidateGoods[idx]);
        result.push({ goodId: candidateGoods[idx], qty: rng.nextInt(5, 20) });
      }
    }
    return result;
  }

  /**
   * Simulate a trader NPC selling its cargo at the destination and buying new
   * goods. Selling increases market supply (lowers prices); buying decreases it.
   */
  private simulateTraderTrade(
    npc: NpcShip,
    galaxy: Galaxy,
    rng: SeededRNG,
  ): void {
    const system = galaxy.systems.find((s) => s.id === npc.currentSystemId);
    if (!system) return;

    const planet = system.planets.find(
      (p) => p.market && p.market.availableResources.length > 0,
    );
    if (!planet) return;

    const market = planet.market;

    // Sell existing cargo (increase supply → lower prices)
    for (const item of npc.cargo) {
      const idx = market.availableResources.indexOf(
        item.goodId as ResourceType,
      );
      if (idx >= 0) {
        market.supplyVector[idx] = Math.min(
          5.0,
          (market.supplyVector[idx] ?? 1) + item.qty * NPC_TRADE_SUPPLY_IMPACT,
        );
      }
    }

    // Buy new cargo at this destination (decrease supply → higher prices)
    npc.cargo = this.pickTraderCargo(system, rng);
    for (const item of npc.cargo) {
      const idx = market.availableResources.indexOf(
        item.goodId as ResourceType,
      );
      if (idx >= 0) {
        market.supplyVector[idx] = Math.max(
          0.1,
          (market.supplyVector[idx] ?? 1) - item.qty * NPC_TRADE_SUPPLY_IMPACT,
        );
      }
    }
  }

  /**
   * Advance one game day for every NPC: progress travel, arrive at
   * destinations, and pick fresh goals for idle/arrived ships.
   * Returns news events generated during this tick.
   */
  tick(galaxy: Galaxy, rng: SeededRNG, playerSystemId?: string): NewsEvent[] {
    const events: NewsEvent[] = [];

    for (const npc of galaxy.npcShips) {
      if (npc.state === NpcState.DEAD) continue;

      if (npc.state === NpcState.TRAVELING) {
        npc.daysToArrival -= 1;
        if (npc.daysToArrival <= 0) {
          const arrivedAt = npc.destinationSystemId;
          this.arrive(npc);
          if (npc.role === NpcRole.TRADER) {
            this.simulateTraderTrade(npc, galaxy, rng);
          }
          // PATROL arriving as convoy → 20% chance to liberate contested system
          if (
            npc.role === NpcRole.PATROL &&
            npc.convoyId &&
            arrivedAt &&
            galaxy.isHostileSystem(arrivedAt) &&
            rng.next() < CONVOY_LIBERATION_CHANCE
          ) {
            galaxy.tryLiberate(arrivedAt);
            logger.info(`Convoy ${npc.convoyId} liberated ${arrivedAt}`);
          }
          if (npc.convoyId) npc.convoyId = undefined;
          // Ranger arriving at quest target → quest complete
          if (
            npc.role === NpcRole.RANGER &&
            npc.activeQuestTarget !== null &&
            npc.currentSystemId === npc.activeQuestTarget
          ) {
            npc.reputation += 10;
            events.push({
              type: "NPC_QUEST_COMPLETE",
              npcId: npc.id,
              systemId: npc.currentSystemId,
              day: galaxy.gameDays,
              description: `Рейнджер ${npc.name} выполнил задание в системе ${npc.currentSystemId}`,
            });
            npc.activeQuestTarget = null;
            logger.info(
              `NPC ranger ${npc.name} completed quest in ${npc.currentSystemId}`,
            );
          }
        }
        continue;
      }

      // Ranger without an active quest: 10% chance to accept one.
      if (
        npc.role === NpcRole.RANGER &&
        npc.activeQuestTarget === null &&
        rng.next() < RANGER_QUEST_CHANCE
      ) {
        const target = this.pickQuestTarget(npc.currentSystemId, galaxy, rng);
        if (target) {
          npc.activeQuestTarget = target;
          logger.info(`NPC ranger ${npc.name} accepted quest → ${target}`);
        }
      }

      // Present in a system. A purposeless (IDLE) ship looks for somewhere to go
      // right away; ships that arrived with a purpose dwell (see arrivalState —
      // they never arrive IDLE), departing only on the per-day DEPART_CHANCE, so
      // they linger and visit rather than bouncing straight back out.
      if (npc.state === NpcState.IDLE || rng.next() < DEPART_CHANCE) {
        this.departToNewGoal(npc, galaxy, rng);
      }
    }

    // Assemble military convoys toward contested systems every 30 days.
    if (
      galaxy.gameDays > 0 &&
      galaxy.gameDays % CONVOY_ASSEMBLY_INTERVAL === 0
    ) {
      this.assembleConvoys(galaxy, rng);
    }

    // Resolve abstract off-screen fights, then keep the population topped up.
    this.resolveOffscreenCombat(galaxy, rng, playerSystemId);
    const raidEvents = this.resolveOffscreenPirateRaids(
      galaxy,
      rng,
      playerSystemId,
    );
    for (const e of raidEvents) events.push(e);
    this.pruneAndReplenish(galaxy, rng);

    return events;
  }

  /** Pick a random system other than the NPC's current one as a quest destination. */
  private pickQuestTarget(
    currentSystemId: string,
    galaxy: Galaxy,
    rng: SeededRNG,
  ): string | null {
    const candidates = galaxy.systems
      .map((s) => s.id)
      .filter((id) => id !== currentSystemId);
    if (candidates.length === 0) return null;
    return candidates[rng.nextInt(0, candidates.length - 1)];
  }

  /**
   * Simulate pirate cargo raids in off-screen systems: each pirate has a 5%
   * daily chance to raid a co-located trader, clearing its cargo.
   */
  private resolveOffscreenPirateRaids(
    galaxy: Galaxy,
    rng: SeededRNG,
    playerSystemId?: string,
  ): NewsEvent[] {
    const events: NewsEvent[] = [];
    const bySystem = new Map<string, NpcShip[]>();
    for (const npc of galaxy.npcShips) {
      if (npc.state === NpcState.DEAD || npc.state === NpcState.TRAVELING)
        continue;
      if (npc.currentSystemId === playerSystemId) continue;
      const list = bySystem.get(npc.currentSystemId) ?? [];
      list.push(npc);
      bySystem.set(npc.currentSystemId, list);
    }

    for (const [systemId, ships] of bySystem) {
      const pirates = ships.filter((s) => s.role === NpcRole.PIRATE);
      const traders = ships.filter(
        (s) => s.role === NpcRole.TRADER && s.cargo.length > 0,
      );
      if (pirates.length === 0 || traders.length === 0) continue;

      for (const pirate of pirates) {
        if (rng.next() >= PIRATE_CARGO_RAID_CHANCE) continue;
        const alive = traders.filter((t) => t.state !== NpcState.DEAD);
        if (alive.length === 0) continue;
        const target = alive[rng.nextInt(0, alive.length - 1)];
        target.cargo = [];
        events.push({
          type: "PIRATE_ATTACK",
          systemId,
          day: galaxy.gameDays,
          description: `Пираты атаковали торговца в системе ${systemId}`,
        });
        logger.info(
          `NPC pirate ${pirate.name} raided ${target.name}'s cargo in ${systemId}`,
        );
      }
    }
    return events;
  }

  /**
   * Abstractly resolve hostile encounters that happen away from the player's
   * eyes: in any system (other than the player's) where a pirate shares space
   * with a non-pirate, the pirate attacks. Damage is partial per day, so fights
   * play out over time; destroyed ships become DEAD and are pruned later. The
   * player's own system is skipped — those ships are visible and fought there.
   */
  private resolveOffscreenCombat(
    galaxy: Galaxy,
    rng: SeededRNG,
    playerSystemId?: string,
  ): void {
    const bySystem = new Map<string, NpcShip[]>();
    for (const npc of galaxy.npcShips) {
      if (npc.state === NpcState.DEAD || npc.state === NpcState.TRAVELING) {
        continue;
      }
      if (npc.currentSystemId === playerSystemId) continue;
      const list = bySystem.get(npc.currentSystemId) ?? [];
      list.push(npc);
      bySystem.set(npc.currentSystemId, list);
    }

    for (const ships of bySystem.values()) {
      const pirates = ships.filter((s) => s.role === NpcRole.PIRATE);
      const victims = ships.filter((s) => s.role !== NpcRole.PIRATE);
      if (pirates.length === 0 || victims.length === 0) continue;

      for (const pirate of pirates) {
        if (pirate.state === NpcState.DEAD) continue;
        const alive = victims.filter((v) => v.state !== NpcState.DEAD);
        if (alive.length === 0) break;

        const victim = alive[rng.nextInt(0, alive.length - 1)];
        pirate.state = NpcState.FIGHTING;
        victim.state = NpcState.FIGHTING;

        victim.hullHP -= Math.max(
          1,
          Math.round(pirate.damage * PIRATE_DAMAGE_FRACTION),
        );
        pirate.hullHP -= Math.max(
          1,
          Math.round(victim.damage * VICTIM_RETALIATION_FRACTION),
        );

        if (victim.hullHP <= 0) {
          victim.hullHP = 0;
          victim.state = NpcState.DEAD;
          pirate.credits += PIRATE_LOOT;
          logger.info(
            `NPC ${pirate.name} destroyed ${victim.name} in ${pirate.currentSystemId}`,
          );
        }
        if (pirate.hullHP <= 0) {
          pirate.hullHP = 0;
          pirate.state = NpcState.DEAD;
        }
      }
    }

    // Reset surviving combatants to PATROLLING so they don't appear as
    // perpetually FIGHTING in the contact panel. Use PATROLLING (not IDLE) so
    // the 15% per-day departure chance is preserved rather than triggering an
    // immediate departure.
    for (const npc of galaxy.npcShips) {
      if (npc.state === NpcState.FIGHTING) {
        npc.state = NpcState.PATROLLING;
      }
    }
  }

  /**
   * Assemble military convoys toward contested border systems. Called every
   * CONVOY_ASSEMBLY_INTERVAL days. For each hostile system adjacent to a
   * friendly system, recruit idle PATROL ships from the friendly side and
   * assign them a shared convoyId so they travel together.
   */
  private assembleConvoys(galaxy: Galaxy, rng: SeededRNG): void {
    // Find contested borders: hostile systems that have at least one friendly neighbour.
    const contestedBorders: Array<{
      hostileId: string;
      friendlyNeighbourId: string;
    }> = [];
    for (const sys of galaxy.systems) {
      if (!galaxy.isHostileSystem(sys.id)) continue;
      for (const conn of sys.connections) {
        if (!galaxy.isHostileSystem(conn.toSystemId)) {
          contestedBorders.push({
            hostileId: sys.id,
            friendlyNeighbourId: conn.toSystemId,
          });
          break;
        }
      }
    }
    if (contestedBorders.length === 0) return;

    // Pick one contested border at random to send a convoy toward.
    const border =
      contestedBorders[rng.nextInt(0, contestedBorders.length - 1)];
    const { hostileId, friendlyNeighbourId } = border;

    // Gather idle PATROL ships currently in the friendly neighbour system (or
    // any friendly system connected to the hostile one) that are not already
    // in a convoy or travelling.
    const candidatePatrols = galaxy.npcShips.filter(
      (n) =>
        n.role === NpcRole.PATROL &&
        n.state !== NpcState.TRAVELING &&
        n.state !== NpcState.DEAD &&
        !n.convoyId &&
        n.currentSystemId === friendlyNeighbourId,
    );

    if (candidatePatrols.length === 0) return;

    const count = Math.min(
      CONVOY_MAX_SHIPS,
      candidatePatrols.length,
      rng.nextInt(2, CONVOY_MAX_SHIPS),
    );
    const convoyId = `convoy_${galaxy.gameDays}_${hostileId}`;
    const daysToArrival = this.travelDays(
      galaxy,
      friendlyNeighbourId,
      hostileId,
    );

    for (let i = 0; i < count; i++) {
      const npc = candidatePatrols[i];
      npc.convoyId = convoyId;
      npc.destinationSystemId = hostileId;
      npc.daysToArrival = daysToArrival;
      npc.state = NpcState.TRAVELING;
      npc.goal = { kind: NpcGoalKind.PATROL, targetSystemId: hostileId };
      logger.info(`Convoy ${convoyId}: assigned ${npc.name} → ${hostileId}`);
    }
  }

  /**
   * Remove a specific NPC from the galaxy (e.g. destroyed by the player in
   * a CombatScene encounter). No-op if the id is not found.
   */
  removeNpc(galaxy: Galaxy, npcId: string): void {
    const idx = galaxy.npcShips.findIndex((n) => n.id === npcId);
    if (idx >= 0) galaxy.npcShips.splice(idx, 1);
  }

  /** Remove destroyed NPCs and respawn up to the target population. */
  private pruneAndReplenish(galaxy: Galaxy, rng: SeededRNG): void {
    for (let i = galaxy.npcShips.length - 1; i >= 0; i--) {
      if (galaxy.npcShips[i].state === NpcState.DEAD) {
        galaxy.npcShips.splice(i, 1);
      }
    }

    const target = Math.round(galaxy.systems.length * NPCS_PER_SYSTEM);
    let guard = 0;
    while (galaxy.npcShips.length < target && guard++ < 1000) {
      this.spawnOne(
        galaxy,
        rng,
        `npc_d${galaxy.gameDays}_${galaxy.npcShips.length}`,
      );
    }
  }

  /** Resolve a TRAVELING ship reaching its destination. */
  private arrive(npc: NpcShip): void {
    if (npc.destinationSystemId) {
      npc.currentSystemId = npc.destinationSystemId;
    }
    npc.destinationSystemId = null;
    npc.daysToArrival = 0;
    npc.state = this.arrivalState(npc.goal?.kind);
    npc.goal = null;
  }

  /** Ask the brain for a goal and start travelling toward it. */
  private departToNewGoal(npc: NpcShip, galaxy: Galaxy, rng: SeededRNG): void {
    const goal = this.brain.decideGoal(npc, galaxy, rng);
    const target = goal.targetSystemId;
    if (!target || target === npc.currentSystemId) {
      npc.state = NpcState.IDLE;
      return;
    }

    npc.goal = goal;
    npc.destinationSystemId = target;
    npc.daysToArrival = this.travelDays(galaxy, npc.currentSystemId, target);
    npc.state = NpcState.TRAVELING;
  }

  /** State an NPC enters once it arrives, based on the goal it travelled for. */
  private arrivalState(kind?: NpcGoalKind): NpcState {
    switch (kind) {
      case NpcGoalKind.TRADE:
        return NpcState.TRADING;
      case NpcGoalKind.QUEST:
        return NpcState.QUESTING;
      case NpcGoalKind.PATROL:
      case NpcGoalKind.HUNT:
        return NpcState.PATROLLING;
      default:
        // Never arrive IDLE — an arrived ship should dwell (and be seen) for a
        // while rather than immediately departing next tick (the in/out churn the
        // player noticed). PATROLLING is our neutral "present, milling about".
        return NpcState.PATROLLING;
    }
  }

  /** Days a hop takes: warp-path cost if connected, else coordinate distance. */
  private travelDays(galaxy: Galaxy, fromId: string, toId: string): number {
    const from = galaxy.systems.find((s) => s.id === fromId);
    const warp = from?.connections.find((c) => c.toSystemId === toId);
    if (warp) return Math.max(1, Math.round(warp.fuelCost));

    const to = galaxy.systems.find((s) => s.id === toId);
    if (from && to) return Math.max(1, Math.round(distance(from, to) / 10));
    return 1;
  }
}

/**
 * NPC ships currently present (and visible) in a system: those located there
 * and not in transit or destroyed. Used by the presentation layer to decide
 * which NPCs to render in the player's system.
 */
export function npcsPresentInSystem(
  galaxy: Galaxy,
  systemId: string,
): NpcShip[] {
  return galaxy.npcShips.filter(
    (n) =>
      n.currentSystemId === systemId &&
      n.state !== NpcState.TRAVELING &&
      n.state !== NpcState.DEAD,
  );
}

function distance(a: StarSystem, b: StarSystem): number {
  const dq = a.coordinates.q - b.coordinates.q;
  const dr = a.coordinates.r - b.coordinates.r;
  return Math.sqrt(dq * dq + dr * dr);
}
