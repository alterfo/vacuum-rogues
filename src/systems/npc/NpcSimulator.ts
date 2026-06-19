import type { Galaxy } from "@/domain/Galaxy";
import type { StarSystem } from "@/domain/StarSystem";
import { SeededRNG } from "@/utils/seededRNG";
import { NpcShip } from "@/domain/NpcShip";
import {
  NpcRole,
  NpcState,
  NpcGoalKind,
  FactionType,
  ResourceType,
} from "@/types";
import type { NewsEvent } from "@/types";
import type { RouteRumor } from "@/domain/RouteRumor";
import { applyMarketTradeImpact } from "@/domain/Market";
import { Faction } from "@/types/faction";
import { GAME_BALANCE } from "@/config/balance";
import type { NpcBrain } from "./NpcBrain";
import { RuleBasedNpcBrain } from "./NpcBrain";
import { logger } from "@/utils/logger";
import {
  creditNpc,
  GL_COUNTERPARTY,
  type BankAccess,
} from "@/systems/banking/economy";
import {
  systemsWithActiveBattle,
  type BattleShip,
} from "@/utils/battleSystems";

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

/**
 * Per-unit nudge an NPC trade applies to the SAME persistent `priceMultipliers`
 * lever the player's `TradeSystem.executeTrade` uses — so NPC trade flow
 * converges a route's spread (buying depletes stock → price up; selling gluts
 * the market → price down) instead of only touching the transient supplyVector,
 * which relaxes away. Scaled to half the player's per-unit impact so one NPC leg
 * moves a route less than a player round-trip, while a flow of diverted traders
 * still closes the spread. Capped per trade like the player's lever.
 */
const NPC_TRADE_PRICE_IMPACT_PER_UNIT = GAME_BALANCE.marketImpactPerUnit * 0.5;

/** Magnitude of the persistent price-multiplier nudge for an NPC `qty`-unit
 *  trade, capped per transaction (mirrors {@link GAME_BALANCE.marketImpactMaxPerTrade}). */
function npcTradeImpact(qty: number): number {
  return Math.min(
    qty * NPC_TRADE_PRICE_IMPACT_PER_UNIT,
    GAME_BALANCE.marketImpactMaxPerTrade,
  );
}

/** Units a trader picks up when it diverts onto a route rumor (a bulk run). */
const RUMOR_TRADE_QTY = 20;

/**
 * Per-departure probability a TRADER diverts onto a route rumor with the given
 * live margin. Anchored to the margin *above* the expiry threshold so the pull
 * tapers to ~`rumorNpcBaseChance` (almost none) as the spread closes toward
 * expiry, and grows with a fat fresh margin up to `rumorNpcMaxChance`. Pure and
 * exported so the reaction curve is unit-testable without driving an NPC tick.
 */
export function rumorReactionChance(marginPct: number): number {
  const over = Math.max(0, marginPct - GAME_BALANCE.rumorMarginExpire);
  const p =
    GAME_BALANCE.rumorNpcBaseChance + GAME_BALANCE.rumorNpcMarginScale * over;
  return Math.min(GAME_BALANCE.rumorNpcMaxChance, Math.max(0, p));
}

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

/** Minimum hostile ships a captured (overmind/pirate) system always holds. */
const GARRISON_MIN = 5;
/** Maximum hostile ships spawned to fill a captured system's garrison. */
const GARRISON_MAX = 10;

/** How often (game days) the Overmind launches a fleet to capture a new system. */
const CAPTURE_FLEET_INTERVAL = 60;
/** Minimum ships in a capture fleet (also the threshold needed to seize a system). */
const CAPTURE_FLEET_MIN = 3;
/** Maximum ships recruited into a single capture fleet. */
const CAPTURE_FLEET_MAX = 5;

/** How often (game days) the Rangers announce a liberation campaign. */
const LIBERATION_CAMPAIGN_INTERVAL = 50;
/** Days between a liberation announcement and the rally/assault date. */
const LIBERATION_RALLY_DELAY = 30;
/** Max ranger ships rallied from a staging system in a single campaign. */
const LIBERATION_RALLY_MAX_SHIPS = 5;

/** Consecutive garrison-free days a captured system must hold before it is
 *  automatically liberated (mirrors the player/ranger "clear and hold" rule). */
const LIBERATION_CLEAR_DAYS = 3;

/** Minimum game-days a ship dwells in a system after arriving before the
 *  per-day DEPART_CHANCE can fire. Prevents the "fly in and immediately out"
 *  visual seen when a 15% roll happens to fire on day 1 post-arrival. */
const MIN_DWELL_DAYS = 3;

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

/** A scheduled Ranger campaign to liberate a hostile system. */
interface LiberationCampaign {
  /** Hostile system the campaign aims to free. */
  targetSystemId: string;
  /** Friendly system rangers rally at before the assault. */
  stagingSystemId: string;
  /** Absolute galaxy day the rally departs the staging system. */
  liberationDate: number;
  /** True once the staging rangers have been sent toward the target. */
  dispatched: boolean;
}

/**
 * Advances the autonomous life of NPC ships across the galaxy: spawning them at
 * generation time and, each game day, moving them between systems toward their
 * goals. Holds a transient arrival-dwell countdown (not persisted) so freshly
 * arrived ships don't depart on the very next tick.
 */
export class NpcSimulator {
  private readonly brain: NpcBrain;
  /** Days remaining before a ship may be subject to DEPART_CHANCE; keyed by npc.id. */
  private readonly arrivalDwellCountdown = new Map<string, number>();
  /**
   * For a TRADER currently diverted onto a route rumor: the rumor's *destination
   * planet id*, so the on-arrival sell-leg lowers that exact (dear) planet's
   * price and actually closes the tracked rumor's spread. Keyed by npc.id and
   * consumed (deleted) on arrival. Transient — a mid-flight trader on a loaded
   * save simply falls back to the first market planet. Set only when a trader
   * diverts; production systems are multi-planet, so the rumor's target planet
   * is usually NOT the first market planet in the destination system.
   */
  private readonly rumorDestPlanet = new Map<string, string>();
  /**
   * IDs of standing-garrison ships spawned to defend captured systems. Transient
   * (not persisted): garrison ships are isolated from the wandering-population
   * streams — they hold position, are excluded from off-screen combat, and don't
   * count toward replenishment — so adding garrisons never perturbs the
   * deterministic main simulation. Resets on load; ensureGarrison rebuilds it.
   */
  private readonly garrisonIds = new Set<string>();
  /**
   * IDs of ships currently part of an Overmind capture fleet en route to (or
   * besieging) a neutral system. Transient (not persisted). Like garrison ships
   * they are held in position after arrival and excluded from the wandering
   * population streams, so capture campaigns never perturb the deterministic
   * main simulation. On a successful capture the survivors fold into the new
   * standing garrison (moved to {@link garrisonIds}).
   */
  private readonly captureFleetIds = new Set<string>();
  /**
   * Active Ranger liberation campaigns: each holds a hostile target, the
   * friendly staging system, and the absolute day the rally departs. Transient
   * (not persisted) — campaigns whose date has not yet arrived simply restart
   * naturally on the next 50-day announcement after a load. Once a campaign's
   * date is reached the rangers rallying at the staging system depart together
   * toward the target (see {@link resolveLiberationCampaigns}).
   */
  private readonly liberationCampaigns: LiberationCampaign[] = [];
  /**
   * System ids whose standing garrison has been established at least once.
   * Transient (not persisted). A hostile system that is established but now holds
   * zero live garrison ships has been *cleared* (by the player or rangers) rather
   * than freshly captured — {@link fillGarrison} leaves it empty so the
   * {@link resolveLiberationDetection} countdown can run instead of resurrecting
   * the garrison every tick. Pruned when a system is no longer hostile so a
   * recapture re-garrisons from scratch.
   */
  private readonly establishedGarrisons = new Set<string>();
  /**
   * Per-system liberation countdown: days of consecutive garrison-free presence
   * remaining before a captured system is auto-liberated. Transient (not
   * persisted) — it restarts naturally on the next tick after a load, mirroring
   * arrivalDwellCountdown. Reset the moment any hostile ship is present again.
   */
  private readonly liberationCountdown = new Map<string, number>();

  /** Bank for booking NPC pirate plunder through the bus (null until wired). */
  private bank: BankAccess | null = null;

  constructor(brain: NpcBrain = new RuleBasedNpcBrain()) {
    this.brain = brain;
  }

  /** Wire the bank so NPC plunder books a balanced ledger entry via the bus. */
  attachBank(access: BankAccess | null): void {
    this.bank = access;
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
  spawnPirateInSystem(rng: SeededRNG, id: string, systemId: string): NpcShip {
    const stats = ROLE_STATS[NpcRole.PIRATE];
    const faction = FactionType.OUTLANDERS;
    this.arrivalDwellCountdown.set(id, MIN_DWELL_DAYS);
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
      state: NpcState.PATROLLING,
      goal: null,
      destinationSystemId: null,
      daysToArrival: 0,
      credits: rng.nextInt(50, 300),
      reputation: 0,
      shieldPower: stats.shieldPower,
      loadoutSummary: ROLE_LOADOUT[NpcRole.PIRATE],
      cargo: [],
      hostile: true,
    });
  }

  /**
   * Spawn an OVERMIND garrison NPC directly in the specified system and return
   * it. Same combat stats as a PATROL ship, but flagged as faction OVERMIND so
   * it reads as hostile to the player and friendly NPCs. Used by ensureGarrison.
   */
  spawnOvermindInSystem(rng: SeededRNG, id: string, systemId: string): NpcShip {
    const stats = ROLE_STATS[NpcRole.PATROL];
    this.arrivalDwellCountdown.set(id, MIN_DWELL_DAYS);
    return new NpcShip({
      id,
      name: `Доминатор ${id}`,
      race: FactionType.PARADOXES,
      faction: Faction.OVERMIND,
      role: NpcRole.PATROL,
      hullHP: stats.hull,
      maxHull: stats.hull,
      shields: stats.shields,
      speed: stats.speed,
      damage: stats.damage,
      currentSystemId: systemId,
      state: NpcState.PATROLLING,
      goal: null,
      destinationSystemId: null,
      daysToArrival: 0,
      credits: rng.nextInt(50, 300),
      reputation: 0,
      shieldPower: stats.shieldPower,
      loadoutSummary: ROLE_LOADOUT[NpcRole.PATROL],
      cargo: [],
      hostile: true,
    });
  }

  /**
   * Count hostile garrison ships currently present (located and not in transit
   * or destroyed) in a system. A garrison ship is any OVERMIND-faction ship or
   * any PIRATE-role ship — the two flavours of captured-system defenders.
   */
  private countGarrisonPresent(galaxy: Galaxy, systemId: string): number {
    let count = 0;
    for (const n of galaxy.npcShips) {
      if (n.currentSystemId !== systemId) continue;
      if (n.state === NpcState.DEAD || n.state === NpcState.TRAVELING) continue;
      if (n.faction === Faction.OVERMIND || n.role === NpcRole.PIRATE) count++;
    }
    return count;
  }

  /**
   * System ids that currently hold a *live fight*: at least one hostile
   * (pirate/Overmind) ship AND at least one friendly/Ranger ship both present
   * (located, not in transit or destroyed) in the same system. Feeds the live
   * NPC ship list to {@link systemsWithActiveBattle} — purely a projection of
   * the transient population, so it is render-only with no persistence. The
   * star map reads this to paint the half-red/half-green battle marker.
   */
  battleSystemIds(galaxy: Galaxy): Set<string> {
    const present: BattleShip[] = [];
    for (const n of galaxy.npcShips) {
      if (n.state === NpcState.DEAD || n.state === NpcState.TRAVELING) continue;
      present.push({
        systemId: n.currentSystemId,
        hostile: n.hostile,
        faction: n.faction,
        role: n.role,
      });
    }
    return systemsWithActiveBattle(present);
  }

  /**
   * Re-derive the transient garrison / capture-fleet hold sets from the live
   * ship list. These sets are not persisted, so after a save→load (a fresh
   * GameEngine whose NpcSimulator starts with empty sets) the standing-garrison
   * and capture-fleet ships are still in `galaxy.npcShips` but no longer
   * recognised as held — they would fall through to the random-departure path,
   * scatter out of their captured systems as rogue hostiles, and perturb the
   * deterministic stream. Their ids carry a stable prefix (`garrison_*` /
   * `capture_*`) so they can be reclassified: a `capture_*` survivor folded into
   * a captured garrison keeps its id, so route by where it now sits (parked in a
   * hostile system → garrison; otherwise still en route / besieging). Idempotent
   * and RNG-free, so within a single session it is a no-op.
   */
  private reconcileTransientState(galaxy: Galaxy): void {
    for (const npc of galaxy.npcShips) {
      if (npc.state === NpcState.DEAD) continue;
      if (npc.id.startsWith("garrison_")) {
        this.garrisonIds.add(npc.id);
      } else if (npc.id.startsWith("capture_")) {
        const parkedInHostile =
          npc.state !== NpcState.TRAVELING &&
          galaxy.isHostileSystem(npc.currentSystemId);
        if (parkedInHostile) this.garrisonIds.add(npc.id);
        else this.captureFleetIds.add(npc.id);
      }
    }
  }

  /**
   * Guarantee that every captured (overmind/pirate) system holds a standing
   * garrison of hostile ships. For each hostile system whose present garrison is
   * below GARRISON_MIN, spawn fresh hostile ships up to a random target in
   * [GARRISON_MIN, GARRISON_MAX]. Overmind systems get OVERMIND PATROL ships;
   * pirate systems get PIRATE ships. Idempotent once the minimum is met.
   */
  ensureGarrison(galaxy: Galaxy, rng: SeededRNG): void {
    for (const systemId of galaxy.overmindSystems) {
      this.fillGarrison(galaxy, rng, systemId, true);
    }
    for (const systemId of galaxy.pirateSystems) {
      this.fillGarrison(galaxy, rng, systemId, false);
    }
  }

  /** Top a single hostile system's garrison up to a random [MIN, MAX] target. */
  private fillGarrison(
    galaxy: Galaxy,
    rng: SeededRNG,
    systemId: string,
    overmind: boolean,
  ): void {
    let present = this.countGarrisonPresent(galaxy, systemId);
    if (present >= GARRISON_MIN) {
      this.establishedGarrisons.add(systemId);
      return;
    }
    // A fully wiped garrison in an already-established system has been *cleared*
    // (player/ranger combat), not freshly captured. Leave it empty so the
    // liberation countdown can run rather than resurrecting the garrison every
    // tick. Only initial establishment or topping up a partial garrison spawns.
    if (present === 0 && this.establishedGarrisons.has(systemId)) return;
    const target = rng.nextInt(GARRISON_MIN, GARRISON_MAX);
    let spawned = 0;
    while (present < target) {
      const id = `garrison_${overmind ? "ov" : "pi"}_${systemId}_${galaxy.gameDays}_${spawned}`;
      const ship = overmind
        ? this.spawnOvermindInSystem(rng, id, systemId)
        : this.spawnPirateInSystem(rng, id, systemId);
      galaxy.npcShips.push(ship);
      this.garrisonIds.add(id);
      present++;
      spawned++;
    }
    this.establishedGarrisons.add(systemId);
    logger.info(
      `Garrison: spawned ${spawned} hostile ships in ${systemId} (now ${present})`,
    );
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
    this.arrivalDwellCountdown.set(id, MIN_DWELL_DAYS);
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
    this.arrivalDwellCountdown.set(id, MIN_DWELL_DAYS);
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
    sellPlanetId?: string,
  ): void {
    const system = galaxy.systems.find((s) => s.id === npc.currentSystemId);
    if (!system) return;

    const hasMarket = (p: {
      market?: { availableResources: ResourceType[] };
    }) => !!p.market && p.market.availableResources.length > 0;
    // When the trader diverted onto a rumor, trade at the rumor's dear target
    // planet so the sell-leg lowers the price the rumor re-score actually reads;
    // otherwise (or if that planet is gone) fall back to the first market planet.
    const planet =
      (sellPlanetId
        ? system.planets.find((p) => p.id === sellPlanetId && hasMarket(p))
        : undefined) ?? system.planets.find(hasMarket);
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
        // Persistent price impact (negative = sell gluts the market → price
        // falls). Same lever the player uses, so NPC flow converges a route's
        // sell-high side the same way player round-trips do.
        applyMarketTradeImpact(
          market,
          item.goodId as ResourceType,
          -npcTradeImpact(item.qty),
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
        // Persistent price impact (positive = buying depletes stock → price
        // rises), raising this planet's prices as a buy source.
        applyMarketTradeImpact(
          market,
          item.goodId as ResourceType,
          npcTradeImpact(item.qty),
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

    // Re-derive the (transient, unpersisted) garrison / capture-fleet hold sets
    // from the live ships before anything reads them, so standing garrisons
    // survive a save→load instead of scattering on the first post-load tick.
    this.reconcileTransientState(galaxy);

    // Start of day: dispatch any liberation rally whose date has arrived, before
    // the per-NPC movement loop gets a chance to scatter the staging rangers.
    this.resolveLiberationCampaigns(galaxy);

    for (const npc of galaxy.npcShips) {
      if (npc.state === NpcState.DEAD) continue;

      if (npc.state === NpcState.TRAVELING) {
        npc.daysToArrival -= 1;
        if (npc.daysToArrival <= 0) {
          const arrivedAt = npc.destinationSystemId;
          this.arrive(npc);
          if (npc.role === NpcRole.TRADER) {
            const sellPlanetId = this.rumorDestPlanet.get(npc.id);
            this.rumorDestPlanet.delete(npc.id);
            this.simulateTraderTrade(npc, galaxy, rng, sellPlanetId);
          }
          // A convoy/rally arriving at a contested system has a chance to
          // liberate it. PATROL convoys roll from the main stream (unchanged);
          // liberation-rally RANGERS roll from an isolated, day+id-seeded RNG so
          // the Ranger assault can actually free the system without perturbing
          // the deterministic main stream. Without this the rally was cosmetic:
          // rangers could never clear the auto-replenished garrison (Task 7).
          const isConvoyPatrol = npc.role === NpcRole.PATROL && !!npc.convoyId;
          const isRallyRanger =
            npc.role === NpcRole.RANGER &&
            !!npc.convoyId &&
            npc.convoyId.startsWith("liberation_");
          if (
            (isConvoyPatrol || isRallyRanger) &&
            arrivedAt &&
            galaxy.isHostileSystem(arrivedAt)
          ) {
            const roll = isRallyRanger
              ? new SeededRNG(
                  `liberation_assault_${galaxy.gameDays}_${npc.id}`,
                ).next()
              : rng.next();
            if (roll < CONVOY_LIBERATION_CHANCE) {
              galaxy.tryLiberate(arrivedAt);
              logger.info(`Convoy ${npc.convoyId} liberated ${arrivedAt}`);
            }
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

      // Garrison hold: a standing-garrison ship defends its captured system and
      // never wanders off via the random departure roll. Skipping before the
      // DEPART logic means garrison ships consume no main RNG, keeping the
      // deterministic stream identical to a galaxy with no garrisons.
      if (this.garrisonIds.has(npc.id)) {
        continue;
      }

      // Capture-fleet hold: once an Overmind assault force arrives at its target
      // it besieges (holds position) until the system falls or it is destroyed,
      // rather than wandering off. Like the garrison hold this consumes no main
      // RNG, so capture campaigns never perturb the deterministic stream.
      if (this.captureFleetIds.has(npc.id)) {
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

      // A purposeless (IDLE) ship always departs immediately — no dwell applies.
      if (npc.state === NpcState.IDLE) {
        this.departToNewGoal(npc, galaxy, rng);
        continue;
      }

      // Enforce minimum dwell: freshly arrived / newly spawned ships may not
      // depart via the random DEPART_CHANCE until MIN_DWELL_DAYS have elapsed.
      // Prevents the "fly in and immediately out" visual (2026-06-15 report).
      const dwellLeft = this.arrivalDwellCountdown.get(npc.id) ?? 0;
      if (dwellLeft > 0) {
        this.arrivalDwellCountdown.set(npc.id, dwellLeft - 1);
        continue;
      }

      // Present in a system after dwell period: random daily departure chance.
      if (rng.next() < DEPART_CHANCE) {
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

    // Launch an Overmind capture fleet at a neutral border system every 60 days.
    // Uses an isolated, day-seeded RNG so capture campaigns never perturb the
    // deterministic main stream that other systems/tests depend on.
    if (galaxy.gameDays > 0 && galaxy.gameDays % CAPTURE_FLEET_INTERVAL === 0) {
      this.assembleCaptureFleet(
        galaxy,
        new SeededRNG(`capture_${galaxy.gameDays}`),
      );
    }

    // Announce a Ranger liberation campaign against a hostile system every 50
    // days. The isolated, day-seeded RNG keeps target selection from perturbing
    // the deterministic main stream that other systems/tests depend on.
    if (
      galaxy.gameDays > 0 &&
      galaxy.gameDays % LIBERATION_CAMPAIGN_INTERVAL === 0
    ) {
      const campaignEvent = this.assembleLiberationCampaign(
        galaxy,
        new SeededRNG(`liberation_${galaxy.gameDays}`),
      );
      if (campaignEvent) events.push(campaignEvent);
    }

    // Resolve abstract off-screen fights, then keep the population topped up.
    this.resolveOffscreenCombat(galaxy, rng, playerSystemId);
    for (const e of this.resolveCaptureFleets(galaxy)) events.push(e);
    const raidEvents = this.resolveOffscreenPirateRaids(
      galaxy,
      rng,
      playerSystemId,
    );
    for (const e of raidEvents) events.push(e);
    this.pruneAndReplenish(galaxy, rng);

    // Keep captured systems garrisoned: any overmind/pirate system below the
    // minimum hostile-ship count is topped back up to a full standing garrison.
    // Use an isolated, day-seeded RNG so garrison spawning never perturbs the
    // deterministic main simulation stream that other systems/tests depend on.
    this.ensureGarrison(galaxy, new SeededRNG(`garrison_${galaxy.gameDays}`));

    // Liberate any captured system whose garrison has been cleared and held empty
    // for LIBERATION_CLEAR_DAYS. Runs after ensureGarrison so a freshly captured
    // system is garrisoned (and excluded) before its first detection pass.
    this.resolveLiberationDetection(galaxy);

    return events;
  }

  /**
   * Auto-liberate captured systems whose garrison has been cleared. For each
   * hostile (overmind/pirate) system: if any hostile garrison ship is present the
   * countdown resets; otherwise the per-system clock ticks down from
   * LIBERATION_CLEAR_DAYS and {@link Galaxy.tryLiberate} fires (emitting a
   * SYSTEM_LIBERATED news event) when it reaches zero. Bookkeeping for systems
   * that are no longer hostile (freed via another path) is pruned so a later
   * recapture re-garrisons from scratch.
   */
  private resolveLiberationDetection(galaxy: Galaxy): void {
    const hostile = [...galaxy.overmindSystems, ...galaxy.pirateSystems];
    const hostileSet = new Set(hostile);

    for (const id of [...this.liberationCountdown.keys()]) {
      if (!hostileSet.has(id)) this.liberationCountdown.delete(id);
    }
    for (const id of [...this.establishedGarrisons]) {
      if (!hostileSet.has(id)) this.establishedGarrisons.delete(id);
    }

    // A system freed via another path (convoy liberation, DEFENSE quest, or a
    // direct tryLiberate) may still hold standing-garrison ships frozen in place
    // by the garrison hold and flagged hostile (red threat ring). Despawn them so
    // a liberated system never keeps frozen hostile ghosts.
    for (let i = galaxy.npcShips.length - 1; i >= 0; i--) {
      const ship = galaxy.npcShips[i];
      if (!this.garrisonIds.has(ship.id)) continue;
      if (hostileSet.has(ship.currentSystemId)) continue;
      this.garrisonIds.delete(ship.id);
      galaxy.npcShips.splice(i, 1);
    }

    for (const systemId of hostile) {
      if (this.countGarrisonPresent(galaxy, systemId) > 0) {
        // Garrison reformed or invaders re-entered → cancel any countdown.
        this.liberationCountdown.delete(systemId);
        continue;
      }
      const remaining =
        (this.liberationCountdown.get(systemId) ?? LIBERATION_CLEAR_DAYS) - 1;
      if (remaining <= 0) {
        this.liberationCountdown.delete(systemId);
        this.establishedGarrisons.delete(systemId);
        if (galaxy.tryLiberate(systemId)) {
          logger.info(
            `System ${systemId} liberated: garrison cleared and held`,
          );
        }
      } else {
        this.liberationCountdown.set(systemId, remaining);
      }
    }
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
      // Standing-garrison ships are isolated from abstract off-screen combat.
      if (this.garrisonIds.has(npc.id)) continue;
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
      // Standing-garrison and besieging capture-fleet ships are isolated from
      // abstract off-screen combat: they never perturb the deterministic main
      // stream, and a passing pirate can't wipe a besieging Overmind fleet.
      if (this.garrisonIds.has(npc.id)) continue;
      if (this.captureFleetIds.has(npc.id)) continue;
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
          creditNpc(
            this.bank,
            pirate,
            PIRATE_LOOT,
            GL_COUNTERPARTY.PLUNDER,
            "Пиратский трофей",
          );
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

    // Standing garrisons also engage friendly NPCs that wander into a captured
    // system (mirror of the wandering-pirate path for OVERMIND Dominators). The
    // helper uses its own day-seeded RNG so garrison combat never perturbs the
    // main simulation stream — Task 4's determinism guarantee that the
    // convoy/quest tests rely on.
    this.resolveGarrisonOffscreenCombat(galaxy, playerSystemId);

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
   * Off-screen combat between a captured system's standing garrison and friendly
   * NPCs that have wandered into it. Mirrors {@link resolveOffscreenCombat}'s
   * wandering-pirate path for garrison ships (which are otherwise isolated from
   * abstract combat): in any hostile system (other than the player's) where a
   * garrison ship shares space with a friendly (non-garrison, non-OVERMIND,
   * non-pirate) NPC, the garrison attacks. The caller resets FIGHTING survivors.
   *
   * Victim selection draws from a private day-seeded RNG (not the main tick RNG)
   * so adding garrison combat never shifts the deterministic main stream.
   */
  private resolveGarrisonOffscreenCombat(
    galaxy: Galaxy,
    playerSystemId?: string,
  ): void {
    const rng = new SeededRNG(`garrison_combat_${galaxy.gameDays}`);
    const bySystem = new Map<string, NpcShip[]>();
    for (const npc of galaxy.npcShips) {
      if (npc.state === NpcState.DEAD || npc.state === NpcState.TRAVELING) {
        continue;
      }
      if (npc.currentSystemId === playerSystemId) continue;
      if (!galaxy.isHostileSystem(npc.currentSystemId)) continue;
      const list = bySystem.get(npc.currentSystemId) ?? [];
      list.push(npc);
      bySystem.set(npc.currentSystemId, list);
    }

    for (const ships of bySystem.values()) {
      // Only OVERMIND garrison Dominators engage friendly NPCs off-screen; pirate
      // garrisons stay fully isolated (as before Task 5), so a captured pirate
      // system's deterministic convoy/quest streams are never perturbed.
      const garrison = ships.filter(
        (s) => this.garrisonIds.has(s.id) && s.faction === Faction.OVERMIND,
      );
      const victims = ships.filter(
        (s) =>
          !this.garrisonIds.has(s.id) &&
          s.faction !== Faction.OVERMIND &&
          s.role !== NpcRole.PIRATE,
      );
      if (garrison.length === 0 || victims.length === 0) continue;

      for (const attacker of garrison) {
        if (attacker.state === NpcState.DEAD) continue;
        const alive = victims.filter((v) => v.state !== NpcState.DEAD);
        if (alive.length === 0) break;

        const victim = alive[rng.nextInt(0, alive.length - 1)];
        attacker.state = NpcState.FIGHTING;
        victim.state = NpcState.FIGHTING;

        victim.hullHP -= Math.max(
          1,
          Math.round(attacker.damage * PIRATE_DAMAGE_FRACTION),
        );
        attacker.hullHP -= Math.max(
          1,
          Math.round(victim.damage * VICTIM_RETALIATION_FRACTION),
        );

        if (victim.hullHP <= 0) {
          victim.hullHP = 0;
          victim.state = NpcState.DEAD;
          logger.info(
            `Garrison ${attacker.name} destroyed ${victim.name} in ${attacker.currentSystemId}`,
          );
        }
        if (attacker.hullHP <= 0) {
          attacker.hullHP = 0;
          attacker.state = NpcState.DEAD;
        }
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
   * Launch an Overmind capture fleet against a neutral border system. Picks a
   * random non-hostile system adjacent to a hostile one as the attack target,
   * then spawns CAPTURE_FLEET_MIN–CAPTURE_FLEET_MAX OVERMIND PATROL ships in the
   * hostile neighbour, bound for the target with a HUNT goal. The fleet travels
   * via the normal {@link tick} travel mechanism and, once it arrives, besieges
   * the target until it falls (see {@link resolveCaptureFleets}) or is repelled.
   * No-op when no hostile system borders a neutral one.
   */
  assembleCaptureFleet(galaxy: Galaxy, rng: SeededRNG): void {
    // Borders the Overmind can push outward from: hostile system → neutral neighbour.
    const fronts: Array<{ hostileId: string; targetId: string }> = [];
    for (const sys of galaxy.systems) {
      if (!galaxy.isHostileSystem(sys.id)) continue;
      for (const conn of sys.connections) {
        if (!galaxy.isHostileSystem(conn.toSystemId)) {
          fronts.push({ hostileId: sys.id, targetId: conn.toSystemId });
        }
      }
    }
    if (fronts.length === 0) return;

    const front = fronts[rng.nextInt(0, fronts.length - 1)];
    const { hostileId, targetId } = front;
    const count = rng.nextInt(CAPTURE_FLEET_MIN, CAPTURE_FLEET_MAX);
    const daysToArrival = this.travelDays(galaxy, hostileId, targetId);
    const fleetId = `capture_${galaxy.gameDays}_${targetId}`;

    for (let i = 0; i < count; i++) {
      const id = `${fleetId}_${i}`;
      const ship = this.spawnOvermindInSystem(rng, id, hostileId);
      ship.destinationSystemId = targetId;
      ship.daysToArrival = daysToArrival;
      ship.state = NpcState.TRAVELING;
      ship.goal = { kind: NpcGoalKind.HUNT, targetSystemId: targetId };
      galaxy.npcShips.push(ship);
      this.captureFleetIds.add(id);
    }
    logger.info(
      `Capture fleet ${fleetId}: ${count} Overmind ships ${hostileId} → ${targetId}`,
    );
  }

  /**
   * Resolve the siege phase of every active capture fleet. For each system where
   * arrived capture-fleet ships are present:
   *  - if the system is already hostile, fold survivors into the standing garrison;
   *  - else if friendly defenders remain, resolve one combat round (plays out
   *    over subsequent ticks) using an isolated day-seeded RNG;
   *  - else, once the assault force is at strength (≥ CAPTURE_FLEET_MIN), seize
   *    the system: mark it Overmind-controlled, emit a SYSTEM_CAPTURED news
   *    event, and fold the besiegers into the new garrison.
   * Returns any news events generated. No-op when no capture fleet is active.
   */
  private resolveCaptureFleets(galaxy: Galaxy): NewsEvent[] {
    const events: NewsEvent[] = [];
    if (this.captureFleetIds.size === 0) return events;

    const rng = new SeededRNG(`capture_resolve_${galaxy.gameDays}`);
    const bySystem = new Map<string, NpcShip[]>();
    for (const npc of galaxy.npcShips) {
      if (!this.captureFleetIds.has(npc.id)) continue;
      if (npc.state === NpcState.DEAD || npc.state === NpcState.TRAVELING) {
        continue;
      }
      const list = bySystem.get(npc.currentSystemId) ?? [];
      list.push(npc);
      bySystem.set(npc.currentSystemId, list);
    }

    for (const [systemId, attackers] of bySystem) {
      // Target already fell (captured this campaign or another): garrison the survivors.
      if (galaxy.isHostileSystem(systemId)) {
        for (const a of attackers) this.promoteToGarrison(a.id);
        continue;
      }

      const defenders = galaxy.npcShips.filter(
        (n) =>
          n.currentSystemId === systemId &&
          n.state !== NpcState.DEAD &&
          n.state !== NpcState.TRAVELING &&
          !this.captureFleetIds.has(n.id) &&
          n.faction !== Faction.OVERMIND &&
          n.role !== NpcRole.PIRATE,
      );

      if (defenders.length === 0) {
        if (attackers.length < CAPTURE_FLEET_MIN) {
          // Assault force was whittled below capture strength yet outlived every
          // defender: the survivors can't hold the system. Despawn them instead
          // of freezing them forever via the capture-fleet hold.
          for (const a of attackers) {
            this.captureFleetIds.delete(a.id);
            const idx = galaxy.npcShips.indexOf(a);
            if (idx >= 0) galaxy.npcShips.splice(idx, 1);
          }
          continue;
        }
        galaxy.addOvermindSystem(systemId);
        const sys = galaxy.systems.find((s) => s.id === systemId);
        const event: NewsEvent = {
          type: "SYSTEM_CAPTURED",
          systemId,
          day: galaxy.gameDays,
          description: `Система ${sys?.name ?? systemId} захвачена Доминаторами!`,
        };
        // Return via the events array only — the caller (advanceGalaxyDay) writes
        // it to the news feed. Adding here too double-posted the capture headline.
        events.push(event);
        logger.info(`Capture fleet seized ${systemId}`);
        for (const a of attackers) this.promoteToGarrison(a.id);
        continue;
      }

      // Defenders hold: resolve one attrition round (mirrors off-screen combat).
      for (const attacker of attackers) {
        if (attacker.state === NpcState.DEAD) continue;
        const alive = defenders.filter((d) => d.state !== NpcState.DEAD);
        if (alive.length === 0) break;
        const victim = alive[rng.nextInt(0, alive.length - 1)];

        victim.hullHP -= Math.max(
          1,
          Math.round(attacker.damage * PIRATE_DAMAGE_FRACTION),
        );
        attacker.hullHP -= Math.max(
          1,
          Math.round(victim.damage * VICTIM_RETALIATION_FRACTION),
        );

        if (victim.hullHP <= 0) {
          victim.hullHP = 0;
          victim.state = NpcState.DEAD;
          logger.info(
            `Capture fleet ${attacker.name} destroyed defender ${victim.name} in ${systemId}`,
          );
        }
        if (attacker.hullHP <= 0) {
          attacker.hullHP = 0;
          attacker.state = NpcState.DEAD;
        }
      }
    }
    return events;
  }

  /** Move a ship from the capture fleet into the captured system's standing garrison. */
  private promoteToGarrison(npcId: string): void {
    this.captureFleetIds.delete(npcId);
    this.garrisonIds.add(npcId);
  }

  /**
   * Announce a Ranger campaign to liberate a hostile system. Picks one hostile
   * system as the target and a friendly (non-hostile) neighbour as the staging
   * point, schedules the rally LIBERATION_RALLY_DELAY days out, and records the
   * campaign so rangers depart the staging system once that date arrives (see
   * {@link resolveLiberationCampaigns}). Returns the LIBERATION_CAMPAIGN news
   * event, or null when no hostile system borders a friendly one — or one is
   * already pending for the chosen target (no duplicate rallies). Called every
   * LIBERATION_CAMPAIGN_INTERVAL days from {@link tick}.
   */
  assembleLiberationCampaign(galaxy: Galaxy, rng: SeededRNG): NewsEvent | null {
    // Fronts the Rangers can liberate: hostile system → friendly neighbour to stage from.
    const fronts: Array<{ targetId: string; stagingId: string }> = [];
    for (const sys of galaxy.systems) {
      if (!galaxy.isHostileSystem(sys.id)) continue;
      for (const conn of sys.connections) {
        if (!galaxy.isHostileSystem(conn.toSystemId)) {
          fronts.push({ targetId: sys.id, stagingId: conn.toSystemId });
          break;
        }
      }
    }
    if (fronts.length === 0) return null;

    const front = fronts[rng.nextInt(0, fronts.length - 1)];
    const { targetId, stagingId } = front;

    // Don't stack a second pending rally on a target already being campaigned for.
    if (
      this.liberationCampaigns.some(
        (c) => c.targetSystemId === targetId && !c.dispatched,
      )
    ) {
      return null;
    }

    const liberationDate = galaxy.gameDays + LIBERATION_RALLY_DELAY;
    this.liberationCampaigns.push({
      targetSystemId: targetId,
      stagingSystemId: stagingId,
      liberationDate,
      dispatched: false,
    });

    const target = galaxy.systems.find((s) => s.id === targetId);
    const staging = galaxy.systems.find((s) => s.id === stagingId);
    logger.info(
      `Liberation campaign announced: ${targetId} (rally in ${stagingId}, day ${liberationDate})`,
    );
    return {
      type: "LIBERATION_CAMPAIGN",
      systemId: targetId,
      day: galaxy.gameDays,
      targetSystemId: targetId,
      stagingSystemId: stagingId,
      liberationDate,
      description: `Рейнджеры освободят ${target?.name ?? targetId} через ${LIBERATION_RALLY_DELAY} дней. Сбор в ${staging?.name ?? stagingId}`,
    };
  }

  /**
   * Dispatch the Ranger rally for any campaign whose liberation date has been
   * reached. Each campaign dispatches once. Called at the start of {@link tick}
   * so the staging rangers depart together before the per-NPC movement loop can
   * scatter them. Campaigns whose target is no longer hostile (already freed)
   * are dropped without sending anyone.
   */
  private resolveLiberationCampaigns(galaxy: Galaxy): void {
    for (const campaign of this.liberationCampaigns) {
      if (campaign.dispatched) continue;
      if (galaxy.gameDays < campaign.liberationDate) continue;
      // Target already freed (e.g. by the 3-day clear rule) — retire the campaign.
      if (!galaxy.isHostileSystem(campaign.targetSystemId)) {
        campaign.dispatched = true;
        continue;
      }
      // Only retire the campaign once at least one ranger actually departs;
      // otherwise retry on later ticks until rangers are staged to rally. (Marking
      // it dispatched on an empty staging system permanently consumed the campaign
      // and the announced rally never happened.)
      if (this.dispatchLiberationRally(galaxy, campaign)) {
        campaign.dispatched = true;
      }
    }
  }

  /**
   * Send idle ranger NPCs gathered in a campaign's staging system toward its
   * target as a single convoy (shared convoyId), using the same convoy
   * mechanism as {@link assembleConvoys}. Garrison and capture-fleet ships are
   * excluded. Returns true when at least one ranger departed, false when none
   * were staged (so the caller can retry the campaign on a later tick).
   */
  private dispatchLiberationRally(
    galaxy: Galaxy,
    campaign: LiberationCampaign,
  ): boolean {
    const rangers = galaxy.npcShips.filter(
      (n) =>
        n.role === NpcRole.RANGER &&
        n.state !== NpcState.TRAVELING &&
        n.state !== NpcState.DEAD &&
        !n.convoyId &&
        !this.garrisonIds.has(n.id) &&
        !this.captureFleetIds.has(n.id) &&
        n.currentSystemId === campaign.stagingSystemId,
    );
    if (rangers.length === 0) return false;

    const count = Math.min(LIBERATION_RALLY_MAX_SHIPS, rangers.length);
    const convoyId = `liberation_${campaign.liberationDate}_${campaign.targetSystemId}`;
    const daysToArrival = this.travelDays(
      galaxy,
      campaign.stagingSystemId,
      campaign.targetSystemId,
    );

    for (let i = 0; i < count; i++) {
      const npc = rangers[i];
      npc.convoyId = convoyId;
      npc.destinationSystemId = campaign.targetSystemId;
      npc.daysToArrival = daysToArrival;
      npc.state = NpcState.TRAVELING;
      npc.goal = {
        kind: NpcGoalKind.PATROL,
        targetSystemId: campaign.targetSystemId,
      };
      logger.info(
        `Liberation rally ${convoyId}: ${npc.name} → ${campaign.targetSystemId}`,
      );
    }
    return true;
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
        this.garrisonIds.delete(galaxy.npcShips[i].id);
        this.captureFleetIds.delete(galaxy.npcShips[i].id);
        this.rumorDestPlanet.delete(galaxy.npcShips[i].id);
        galaxy.npcShips.splice(i, 1);
      }
    }

    // Replenishment targets only the wandering population; standing-garrison and
    // capture-fleet ships are managed separately (ensureGarrison /
    // assembleCaptureFleet) and excluded here so their presence never shrinks
    // (and thus perturbs) the normal spawn count.
    const target = Math.round(galaxy.systems.length * NPCS_PER_SYSTEM);
    let regular = galaxy.npcShips.filter(
      (n) => !this.garrisonIds.has(n.id) && !this.captureFleetIds.has(n.id),
    ).length;
    let guard = 0;
    while (regular < target && guard++ < 1000) {
      this.spawnOne(
        galaxy,
        rng,
        `npc_d${galaxy.gameDays}_${galaxy.npcShips.length}`,
      );
      regular++;
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
    this.arrivalDwellCountdown.set(npc.id, MIN_DWELL_DAYS);
  }

  /**
   * Decide whether a TRADER NPC diverts onto an active route rumor as it
   * departs. Returns the rumor it reacted to (and mutates the NPC onto that
   * route), or `null` to fall back to the brain's random goal.
   *
   * To keep the deterministic main simulation untouched for galaxies with no
   * rumors, this draws from `rng` ONLY when there is a reachable rumor — so the
   * existing NPC stream is unperturbed unless rumors are live. The draw scales
   * with the rumor's live margin via {@link rumorReactionChance}.
   */
  private pickTraderGoal(
    npc: NpcShip,
    galaxy: Galaxy,
    rng: SeededRNG,
  ): RouteRumor | null {
    // Most-profitable first; only rumors whose destination differs from where
    // the trader already sits are actionable.
    const rumor = galaxy
      .getActiveRumors()
      .find((r) => r.toSystemId !== npc.currentSystemId);
    if (!rumor) return null;

    if (rng.next() >= rumorReactionChance(rumor.lastMarginPct)) return null;

    // Divert onto the route: head for the destination carrying the rumor's
    // resource bought at the source. The buy-leg raises the (cheap) source here;
    // the sell-leg lowers the (dear) destination when the trader arrives and runs
    // simulateTraderTrade — so NPC flow converges BOTH legs of the route the way
    // the player's round-trips do (Task 6), not just the sell side.
    const sourceMarket = galaxy.systems
      .find((s) => s.id === rumor.fromSystemId)
      ?.planets.find((p) => p.id === rumor.fromPlanetId)?.market;
    if (sourceMarket) {
      applyMarketTradeImpact(
        sourceMarket,
        rumor.resource,
        npcTradeImpact(RUMOR_TRADE_QTY),
      );
    }
    npc.goal = { kind: NpcGoalKind.TRADE, targetSystemId: rumor.toSystemId };
    npc.destinationSystemId = rumor.toSystemId;
    npc.daysToArrival = this.travelDays(
      galaxy,
      npc.currentSystemId,
      rumor.toSystemId,
    );
    npc.cargo = [{ goodId: rumor.resource, qty: RUMOR_TRADE_QTY }];
    npc.state = NpcState.TRAVELING;
    // Remember the rumor's dear destination planet so the on-arrival sell-leg
    // lowers THAT planet's price (the one the rumor re-score reads), not just
    // whichever planet happens to be first in the destination system.
    this.rumorDestPlanet.set(npc.id, rumor.toPlanetId);
    return rumor;
  }

  /** Ask the brain for a goal and start travelling toward it. */
  private departToNewGoal(npc: NpcShip, galaxy: Galaxy, rng: SeededRNG): void {
    // TRADERs may divert onto a profitable route rumor before falling back to
    // the brain's random goal. Pirates/garrisons/rangers ignore rumors.
    if (npc.role === NpcRole.TRADER && this.pickTraderGoal(npc, galaxy, rng)) {
      return;
    }

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
