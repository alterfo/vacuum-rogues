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
import type { GameMode, NewsEvent } from "@/types";
import type { RouteRumor } from "@/domain/RouteRumor";
import { applyMarketTradeImpact } from "@/domain/Market";
import { Faction } from "@/types/faction";
import { GAME_BALANCE, scaledGarrisonRange } from "@/config/balance";
import { overmindGarrisonPowerBonus } from "@/systems/campaign/hostileScaling";
import type { NpcBrain } from "./NpcBrain";
import { RuleBasedNpcBrain, selectPirateTarget } from "./NpcBrain";
import {
  factionKindOf,
  isHostile,
  mutuallyHostile,
  pirateCoordination,
} from "./factionHostility";
import { npcOrbitStep, advanceNpcOrbit } from "./npcPlacement";
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
/** Per-PATROL-convoy chance to liberate a contested system on arrival.
 *  Liberation-rally rangers no longer roll this — they persist as an assault
 *  force and fight the garrison instead (see resolveLiberationAssaults). */
const CONVOY_LIBERATION_CHANCE = 0.2;

/** Minimum hostile ships a captured (overmind/pirate) system always holds. */
const GARRISON_MIN = 5;
/** Maximum hostile ships spawned to fill a captured system's garrison. */
const GARRISON_MAX = 10;

/** How often (game days) an established Overmind garrison grows by one ship. */
const GARRISON_GROWTH_INTERVAL_DAYS = 10;
/** Growth cap as a multiple of a garrison's recorded baseline size. Once a
 *  garrison reaches round(baseline × threshold) it stops growing (the excess
 *  buds off as a capture fleet — organic-expansion arc). */
const GARRISON_GROWTH_BUD_THRESHOLD = 1.5;
/** Fraction of a garrison's baseline that buds off as a capture fleet once the
 *  garrison reaches the growth threshold — half the excess flies out to seize
 *  a neighbouring (or distant) system, and the cycle restarts. */
const GARRISON_BUD_OFF_FRACTION = 0.5;

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
/** Max ranger ships mustered galaxy-wide into a single liberation campaign.
 *  Sized against the real garrison fight (resolveLiberationAssaults): a full
 *  standing garrison is GARRISON_MIN..GARRISON_MAX PATROL hulls, so a rally
 *  needs this many full-hull rangers to have a genuine (not guaranteed) shot —
 *  5 was tuned for the old flip-roll era where force size didn't matter. */
const LIBERATION_RALLY_MAX_SHIPS = 8;
/** Max freshly-captured system ids remembered for priority liberation
 *  targeting — a small FIFO so the "rangers are massing to retake it" news
 *  follows recent losses without the queue growing unbounded. */
const RECENTLY_CAPTURED_MAX = 5;

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
export const ROLE_LOADOUT: Record<NpcRole, string[]> = {
  [NpcRole.RANGER]: ["Двигатель ур.3", "Генератор поля", "Сканер целей"],
  [NpcRole.TRADER]: ["Двигатель ур.1", "Топливный бак", "Ремонтный дроид"],
  [NpcRole.PIRATE]: ["Двигатель ур.2", "Импульсная пушка", "Радар"],
  [NpcRole.PATROL]: ["Двигатель ур.3", "Генератор поля", "Балистическая пушка"],
};

/**
 * The homogeneous mid-tier band every common NPC's tech is confined to. Most of
 * the galaxy runs similar mid-tech (tech 1–3, centred on 2) — no wild disparities
 * — so a player is never randomly outclassed by a *common* ship. The rare
 * high-end (the apex hull/engine, tech ≥ `RARE_TECH_THRESHOLD` = 6) is reserved
 * for the player's long earned climb and the richest markets; it is **never**
 * seeded onto a common wandering NPC. Keep {@link npcRoleTechLevel}'s range inside
 * this band (the homogeneous-but-expensive economy: see `balance.ts` progression
 * note).
 */
export const NPC_TECH_BAND = { min: 1, max: 3 } as const;

/**
 * Map NpcRole to a tech level documenting the galaxy's homogeneous tech spread.
 * The four roles map to a tight, homogeneous mid-tier spread within
 * {@link NPC_TECH_BAND} (TRADER 1, RANGER/PIRATE 2, PATROL 3) — never the rare
 * apex tier — so the galaxy reads as similarly teched and a fresh player is never
 * outclassed by a *common* ship. (Pure role→tech mapping; the live combat strength
 * of a spawned NPC comes from `ROLE_STATS`, not this helper, since the legacy hex
 * CombatScene was removed — combat is real-time in-flight only.)
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
   * IDs of liberation-rally rangers currently besieging a hostile system.
   * Transient (not persisted), same category as {@link captureFleetIds}: an
   * arrived rally ranger holds position and fights the standing garrison over
   * subsequent ticks (see {@link resolveLiberationAssaults}) instead of the
   * old flat CONVOY_LIBERATION_CHANCE coin-flip. Rebuilt after a load by
   * {@link reconcileTransientState} from the `liberation_` convoyId prefix
   * (kept on the ship while it besieges). Ships are released (convoyId
   * cleared, removed from the set) once the system falls or is freed by
   * another path; dead ones are pruned with the other hold sets.
   */
  private readonly liberationAssaultIds = new Set<string>();
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
   * As-established garrison size per system — the anchor for slow Overmind
   * garrison growth toward round(baseline × GARRISON_GROWTH_BUD_THRESHOLD).
   * Transient (not persisted), same lifecycle as {@link establishedGarrisons}:
   * recorded when {@link fillGarrison} first establishes a system's garrison,
   * pruned when the system stops being hostile so a recapture re-baselines.
   * After a load a fresh simulator re-records the then-present count, clamped
   * to the scaled garrison max — an already-grown count re-anchored raw would
   * ratchet the growth band ~1.5× per reload without bound.
   */
  private readonly garrisonBaseline = new Map<string, number>();
  /**
   * Freshly Overmind-captured system ids, oldest first (FIFO, capped at
   * RECENTLY_CAPTURED_MAX). {@link assembleLiberationCampaign} retakes these
   * before its random-front scan, so the "rangers are massing to retake it"
   * announcement reliably follows a fresh loss rather than an unrelated
   * 50-day clock. Transient (not persisted), same lifecycle as
   * {@link liberationCampaigns}. Entries are dropped once targeted, already
   * campaigned for, or no longer hostile; an entry with no friendly
   * neighbour yet stays queued for a later retry.
   */
  private readonly recentlyCaptured: string[] = [];
  /**
   * Per-system liberation countdown: days of consecutive garrison-free presence
   * remaining before a captured system is auto-liberated. Transient (not
   * persisted) — it restarts naturally on the next tick after a load, mirroring
   * arrivalDwellCountdown. Reset the moment any hostile ship is present again.
   */
  private readonly liberationCountdown = new Map<string, number>();

  /** Bank for booking NPC pirate plunder through the bus (null until wired). */
  private bank: BankAccess | null = null;

  /**
   * Per-run difficulty mode (default NORMAL). Only HARD changes behaviour — it
   * grows standing garrisons via {@link scaledGarrisonRange}. NORMAL/GOD keep
   * today's exact garrison sizes. Set by GameEngine when a new game starts or a
   * save is loaded; derived, never persisted on the simulator itself.
   */
  private gameMode: GameMode = "NORMAL";

  constructor(brain: NpcBrain = new RuleBasedNpcBrain()) {
    this.brain = brain;
  }

  /** Wire the bank so NPC plunder books a balanced ledger entry via the bus. */
  attachBank(access: BankAccess | null): void {
    this.bank = access;
  }

  /** Set the difficulty mode that scales hostile garrison sizes (HARD only). */
  setGameMode(mode: GameMode): void {
    this.gameMode = mode;
  }

  /**
   * Live source of the run's RATCHETED peak power index
   * (`GameEngine.campaignPeakPower`) — the adaptive Overmind garrison-count
   * input (three-year-campaign Task 4). A provider (not a pushed value) so the
   * per-tick garrison sizing always reads the current ratchet with a single
   * wiring point. Null (legacy DI sites/tests) ⇒ 0 ⇒ today's exact garrison
   * sizes. Derived, never persisted on the simulator itself.
   */
  private campaignPeakPowerSource: (() => number) | null = null;

  /** Wire the ratcheted-power source that grows Overmind garrisons (Task 4). */
  attachCampaignPeakPower(source: (() => number) | null): void {
    this.campaignPeakPowerSource = source;
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
   * Count live standing-garrison *members* (ships in {@link garrisonIds})
   * present in a system. Unlike {@link countGarrisonPresent}, transient
   * visitors — wandering Overmind ships, capture-fleet stopovers, visiting
   * pirates — do not count. Growth/bud-off decisions use this so a passing
   * wanderer can neither push a garrison over its bud threshold (a bud-off
   * would then strip real defenders it never grew) nor resurrect a cleared
   * garrison the liberation countdown owns.
   */
  private countGarrisonMembers(galaxy: Galaxy, systemId: string): number {
    let count = 0;
    for (const n of galaxy.npcShips) {
      if (n.currentSystemId !== systemId) continue;
      if (n.state === NpcState.DEAD || n.state === NpcState.TRAVELING) continue;
      if (this.garrisonIds.has(n.id)) count++;
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
      } else if (
        npc.convoyId?.startsWith("liberation_") &&
        npc.state !== NpcState.TRAVELING
      ) {
        // A rally ranger parked in a still-hostile system is mid-siege: the
        // liberation_ convoyId (persisted with the ship) is the marker that
        // rebuilds the assault hold after a load. One still TRAVELING is a
        // normal in-flight convoy — the arrival branch enrolls it instead.
        if (galaxy.isHostileSystem(npc.currentSystemId)) {
          this.liberationAssaultIds.add(npc.id);
        } else {
          // Parked in a NON-hostile system the marker is exhausted (the target
          // was freed and the save landed before the stand-down tick). Clear
          // it: a stale marker sidelines the ranger from all future convoys,
          // and a later load could enroll it as a lone doomed siege of
          // whatever unrelated hostile system it happens to be parked in.
          npc.convoyId = undefined;
        }
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
    // Adaptive campaign pressure (Task 4): Overmind garrisons grow with the
    // run's ratcheted peak power — gentle early (0 extra while weak), hard
    // late. Spawn-time only, so it is generation-independent (existing saves
    // pick it up as garrisons top up). Pirate garrisons are not power-scaled.
    const powerBonus = overmind
      ? overmindGarrisonPowerBonus(this.campaignPeakPowerSource?.() ?? 0)
      : 0;
    // HARD shifts the garrison range up; NORMAL/GOD keep [GARRISON_MIN, MAX].
    const { min: garrisonMin, max: garrisonMax } = scaledGarrisonRange(
      this.gameMode,
      GARRISON_MIN + powerBonus,
      GARRISON_MAX + powerBonus,
    );
    let present = this.countGarrisonPresent(galaxy, systemId);
    if (present >= garrisonMin) {
      this.establishedGarrisons.add(systemId);
      this.anchorGarrisonBaseline(systemId, present, garrisonMin, garrisonMax);
      return;
    }
    // A fully wiped garrison in an already-established system has been *cleared*
    // (player/ranger combat), not freshly captured. Leave it empty so the
    // liberation countdown can run rather than resurrecting the garrison every
    // tick. Only initial establishment or topping up a partial garrison spawns.
    if (present === 0 && this.establishedGarrisons.has(systemId)) return;
    // Siege freeze: no reinforcements spawn into a system under active Ranger
    // assault — otherwise the daily top-up out-replenishes the assault's
    // attrition and a liberation siege can mathematically never be won.
    if (this.underLiberationAssault(galaxy, systemId)) return;
    const target = rng.nextInt(garrisonMin, garrisonMax);
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
    this.anchorGarrisonBaseline(systemId, present, garrisonMin, garrisonMax);
    logger.info(
      `Garrison: spawned ${spawned} hostile ships in ${systemId} (now ${present})`,
    );
  }

  /**
   * Record (or repair) a system's growth baseline. First establishment clamps
   * to the scaled max: after a save/load a fresh simulator lands here with an
   * already-GROWN count — re-anchoring at that raw value would ratchet the
   * growth band ~1.5× per reload without bound. A recorded baseline below the
   * CURRENT scaled minimum is stale — set in a weaker era, or by a bud-off
   * that dropped below a floor the campaign ratchet has since raised. Left
   * alone, its bud cap round(baseline × 1.5) sits inside the replenishment
   * band, so every growth tick buds off a capture fleet whose cost the free
   * daily top-up refunds — a perpetual subsidized fleet factory instead of
   * slow organic growth. Re-anchoring at the scaled minimum keeps the
   * grow→bud cycle self-funding (post-bud count stays at/above the floor) and
   * matches what a reload's fresh re-record would produce anyway.
   */
  private anchorGarrisonBaseline(
    systemId: string,
    present: number,
    garrisonMin: number,
    garrisonMax: number,
  ): void {
    const prior = this.garrisonBaseline.get(systemId);
    if (prior === undefined) {
      this.garrisonBaseline.set(systemId, Math.min(present, garrisonMax));
    } else if (prior < garrisonMin) {
      this.garrisonBaseline.set(systemId, garrisonMin);
    }
  }

  /**
   * Slow organic garrison growth (Overmind-only): every growth interval, each
   * established Overmind garrison below round(baseline ×
   * GARRISON_GROWTH_BUD_THRESHOLD) gains one ship, so a captured system reads
   * as a mounting threat rather than a static occupation. Pirate garrisons
   * never grow. A *cleared* garrison (zero live hostile ships) is left empty —
   * the liberation-detection countdown owns it, mirroring {@link fillGarrison}'s
   * cleared-system rule — so growth never resurrects a wiped garrison.
   *
   * Adaptive activation ("gentle early, hard late" — root CLAUDE.md Overmind
   * Arc): growth only runs once the run's ratcheted peak power clears the same
   * {@link overmindGarrisonPowerBonus} lever {@link fillGarrison} consumes —
   * the moment the Overmind starts fielding bigger garrisons at all. While the
   * player is still arming up, captured systems hold at their static baseline
   * so early liberations stay within reach (the seeded campaign pacing gate in
   * sessionCompetence.test.ts reds if a weak-era player faces grown garrisons).
   */
  private growGarrisons(
    galaxy: Galaxy,
    rng: SeededRNG,
    playerSystemId?: string,
  ): void {
    const powerBonus = overmindGarrisonPowerBonus(
      this.campaignPeakPowerSource?.() ?? 0,
    );
    if (powerBonus < 1) return;
    for (const systemId of galaxy.overmindSystems) {
      // Player present: defer (same rule as the abstract siege resolvers) —
      // a ship popping into existence, or a bud-off despawning live garrison
      // ships the player may be tracking or fighting, reads as a glitch.
      if (playerSystemId !== undefined && systemId === playerSystemId) {
        continue;
      }
      const baseline = this.garrisonBaseline.get(systemId);
      if (baseline === undefined) continue;
      // Members only: a wandering Overmind/pirate visitor must not push the
      // count over the bud threshold (the bud-off would strip real defenders)
      // or resurrect a cleared garrison via the present!==0 path.
      const present = this.countGarrisonMembers(galaxy, systemId);
      if (present === 0) continue;
      // Siege freeze (mirrors fillGarrison): a garrison under active Ranger
      // assault neither grows nor buds off mid-battle — growth would negate
      // the assault's attrition, and a bud-off would despawn defenders.
      if (this.underLiberationAssault(galaxy, systemId)) continue;
      const cap = Math.round(baseline * GARRISON_GROWTH_BUD_THRESHOLD);
      if (present >= cap) {
        // Threshold reached: the grown excess buds off as a capture fleet
        // instead of piling up further (see budOffGarrison).
        this.budOffGarrison(galaxy, rng, systemId, baseline, present);
        continue;
      }
      const id = `garrison_ovg_${systemId}_${galaxy.gameDays}`;
      galaxy.npcShips.push(this.spawnOvermindInSystem(rng, id, systemId));
      this.garrisonIds.add(id);
      logger.info(
        `Garrison growth: +1 ship in ${systemId} (now ${present + 1}/${cap})`,
      );
    }
  }

  /**
   * Bud off a grown garrison's excess as a new capture fleet (organic
   * expansion): round(baseline × GARRISON_BUD_OFF_FRACTION) standing-garrison
   * ships leave the system and fly — a normal multi-day journey, never an
   * instant flip — to besiege a neutral system, resolved by the same
   * {@link resolveCaptureFleets} siege loop as the periodic capture fleet.
   * Donor garrison ships are despawned and replaced one-for-one by
   * `capture_`-prefixed fleet ships so {@link reconcileTransientState}'s
   * id-prefix rebuild classifies them correctly across a mid-flight save/load.
   * The source garrison's recorded baseline resets to its post-bud-off size so
   * the grow→bud cycle repeats. Skips silently (retrying next growth interval)
   * when no neutral target exists or no live garrison ship can be donated.
   */
  private budOffGarrison(
    galaxy: Galaxy,
    rng: SeededRNG,
    systemId: string,
    baseline: number,
    present: number,
  ): void {
    const targetId = this.pickBudOffTarget(galaxy, rng, systemId);
    if (!targetId) return;
    const donors = galaxy.npcShips.filter(
      (n) =>
        n.currentSystemId === systemId &&
        n.state !== NpcState.DEAD &&
        n.state !== NpcState.TRAVELING &&
        this.garrisonIds.has(n.id),
    );
    const count = Math.min(
      donors.length,
      Math.max(1, Math.round(baseline * GARRISON_BUD_OFF_FRACTION)),
    );
    if (count === 0) return;
    for (const donor of donors.slice(0, count)) {
      this.garrisonIds.delete(donor.id);
      this.arrivalDwellCountdown.delete(donor.id);
      const idx = galaxy.npcShips.indexOf(donor);
      if (idx >= 0) galaxy.npcShips.splice(idx, 1);
    }
    this.launchCaptureFleet(
      galaxy,
      rng,
      systemId,
      targetId,
      count,
      `capture_bud_${systemId}_${galaxy.gameDays}`,
    );
    this.garrisonBaseline.set(systemId, present - count);
    logger.info(
      `Garrison bud-off: ${count} ships leave ${systemId} to seize ${targetId}`,
    );
  }

  /**
   * Pick where a bud-off fleet strikes: a neutral system directly connected to
   * the source garrison ("neighbouring"); when every neighbour is hostile, any
   * neutral system in the galaxy, weighted toward nearer ones by travel time
   * ("or distant"). Null when the whole galaxy is hostile.
   */
  private pickBudOffTarget(
    galaxy: Galaxy,
    rng: SeededRNG,
    sourceId: string,
  ): string | null {
    const adjacent = this.undirectedNeighbors(galaxy, sourceId).filter(
      (id) => !galaxy.isHostileSystem(id),
    );
    if (adjacent.length > 0) {
      return adjacent[rng.nextInt(0, adjacent.length - 1)];
    }
    const distant = galaxy.systems.filter(
      (s) => s.id !== sourceId && !galaxy.isHostileSystem(s.id),
    );
    if (distant.length === 0) return null;
    // Weight ∝ 1 / travel-days: nearer neutral systems are likelier targets,
    // but any neutral system can draw the strike.
    const weights = distant.map(
      (s) => 1 / this.travelDays(galaxy, sourceId, s.id),
    );
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = rng.next() * total;
    for (let i = 0; i < distant.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return distant[i].id;
    }
    return distant[distant.length - 1].id;
  }

  /**
   * Warp neighbours of a system over the **undirected** graph: outgoing edges
   * plus systems whose own connections point here. ~25% of warp links are
   * stored one-way (`ensureConnectivity` bridges — see the `frontierSystems`
   * invariant in root CLAUDE.md), so a directed-only scan silently misses
   * genuinely adjacent systems. Deterministic, systems-order listing.
   */
  private undirectedNeighbors(galaxy: Galaxy, systemId: string): string[] {
    const ids = new Set<string>();
    for (const sys of galaxy.systems) {
      if (sys.id === systemId) {
        for (const conn of sys.connections) ids.add(conn.toSystemId);
      } else if (sys.connections.some((c) => c.toSystemId === systemId)) {
        ids.add(sys.id);
      }
    }
    ids.delete(systemId);
    return [...ids];
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
          // A PATROL convoy arriving at a contested system has a chance to
          // liberate it (main-stream roll, unchanged). A liberation-rally
          // RANGER instead persists as an assault force and fights the
          // standing garrison over subsequent ticks — the system only falls
          // once the garrison is actually destroyed (see
          // resolveLiberationAssaults), never via a flat coin-flip.
          const isConvoyPatrol = npc.role === NpcRole.PATROL && !!npc.convoyId;
          const isRallyRanger =
            npc.role === NpcRole.RANGER &&
            !!npc.convoyId &&
            npc.convoyId.startsWith("liberation_");
          if (isRallyRanger && arrivedAt && galaxy.isHostileSystem(arrivedAt)) {
            // Keep the liberation_ convoyId while besieging: it is the marker
            // reconcileTransientState uses to rebuild this (transient) hold
            // set after a save/load.
            this.liberationAssaultIds.add(npc.id);
            logger.info(
              `Liberation assault: ${npc.name} joins the siege of ${arrivedAt}`,
            );
          } else {
            if (
              isConvoyPatrol &&
              arrivedAt &&
              galaxy.isHostileSystem(arrivedAt) &&
              rng.next() < CONVOY_LIBERATION_CHANCE
            ) {
              galaxy.tryLiberate(arrivedAt);
              logger.info(`Convoy ${npc.convoyId} liberated ${arrivedAt}`);
            }
            if (npc.convoyId) npc.convoyId = undefined;
          }
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

      // Liberation-assault hold: a rally ranger besieging a hostile system
      // keeps fighting its garrison (resolveLiberationAssaults) until the
      // system falls or the force is wiped, rather than wandering off. Like
      // the holds above this consumes no main RNG.
      if (this.liberationAssaultIds.has(npc.id)) {
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

    // Tracked in-system movement: nudge each placed (present) ship along its
    // deterministic orbit. The simulation is the single owner of position change
    // (like the ABS ledger owns balances) — between ticks a ship's persisted spot
    // is frozen, and a tick advances it reproducibly. Uses no main RNG, so the
    // deterministic stream other systems/tests depend on is untouched.
    this.advanceTrackedPositions(galaxy);

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
    this.resolveLiberationAssaults(galaxy, playerSystemId);
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

    // Grow established Overmind garrisons slowly toward the bud-off threshold
    // (organic-expansion arc). Runs after ensureGarrison so the day's garrison
    // counts are final; the isolated day-seeded RNG keeps it off the
    // deterministic main stream, matching the surrounding periodic calls.
    if (
      galaxy.gameDays > 0 &&
      galaxy.gameDays % GARRISON_GROWTH_INTERVAL_DAYS === 0
    ) {
      this.growGarrisons(
        galaxy,
        new SeededRNG(`garrison_growth_${galaxy.gameDays}`),
        playerSystemId,
      );
    }

    // Liberate any captured system whose garrison has been cleared and held empty
    // for LIBERATION_CLEAR_DAYS. Runs after ensureGarrison so a freshly captured
    // system is garrisoned (and excluded) before its first detection pass.
    this.resolveLiberationDetection(galaxy);

    return events;
  }

  /**
   * Advance every placed, present ship's persisted in-system position one tracked
   * tick along its deterministic orbit (radius-preserving rotation by a per-ship
   * seed-derived step). Owns position change: a ship's spot is frozen between
   * ticks and moves only here, reproducibly — so off-screen systems evolve the
   * same way every run and a save captures a coherent layout.
   *
   * Skips DEAD/TRAVELING ships (no meaningful in-system spot) and any ship that
   * has never been placed (`worldX/worldY` still null): first placement stays the
   * presentation layer's seed-derived job (it never invents one mid-simulation).
   */
  private advanceTrackedPositions(galaxy: Galaxy): void {
    for (const npc of galaxy.npcShips) {
      if (npc.state === NpcState.DEAD || npc.state === NpcState.TRAVELING) {
        continue;
      }
      if (!npc.hasWorldPosition()) continue;
      const step = npcOrbitStep(galaxy.id, npc.id);
      const next = advanceNpcOrbit(
        { x: npc.worldX as number, y: npc.worldY as number },
        step,
      );
      npc.setWorldPosition(next.x, next.y);
    }
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
    for (const id of [...this.garrisonBaseline.keys()]) {
      if (!hostileSet.has(id)) this.garrisonBaseline.delete(id);
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
        this.garrisonBaseline.delete(systemId);
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
      // Standing-garrison, besieging capture-fleet, and liberation-assault
      // ships are isolated from abstract off-screen combat: they never perturb
      // the deterministic main stream, and a passing pirate can't wipe a
      // besieging fleet whose fight is owned by its own siege resolver.
      if (this.garrisonIds.has(npc.id)) continue;
      if (this.captureFleetIds.has(npc.id)) continue;
      if (this.liberationAssaultIds.has(npc.id)) continue;
      const list = bySystem.get(npc.currentSystemId) ?? [];
      list.push(npc);
      bySystem.set(npc.currentSystemId, list);
    }

    for (const [systemId, ships] of bySystem) {
      const pirates = ships.filter((s) => s.role === NpcRole.PIRATE);
      // Overmind ships are excluded here: a wandering pirate ↔ wandering Overmind
      // is a mutual-enemy *cross-faction* brawl owned by resolveCrossFactionCombat
      // (single source of truth), not the pirate-preys-on-victims path. (Garrison
      // Overmind ships are already filtered above; this only matters for the rare
      // wandering Overmind, so existing pirate-raid behaviour is unchanged.)
      const victims = ships.filter(
        (s) => s.role !== NpcRole.PIRATE && s.faction !== Faction.OVERMIND,
      );
      if (pirates.length === 0 || victims.length === 0) continue;

      // Solo vs pack (Task 3): in a system the pirates have captured they swarm as
      // a pack, focus-firing the single weakest co-located mark (group
      // engagement); in any foreign system each is a lone raider that strikes a
      // random victim. The pack focus is deterministic (no main-RNG draw), so it
      // never perturbs the deterministic stream other systems/tests rely on.
      const pack =
        pirateCoordination(
          galaxy.isPirateSystem(systemId) ? "pirate" : null,
        ) === "pack";

      for (const pirate of pirates) {
        if (pirate.state === NpcState.DEAD) continue;
        const alive = victims.filter((v) => v.state !== NpcState.DEAD);
        if (alive.length === 0) break;

        const victim = pack
          ? this.packFocusVictim(alive)
          : alive[rng.nextInt(0, alive.length - 1)];
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

    // Cross-faction brawl (Task 5): co-present WANDERING Overmind and pirate ships
    // are mutual enemies and trade hull damage off-screen, independent of the
    // player — the off-screen counterpart of the in-flight Overmind-vs-pirate
    // engagement. Matrix-driven (one source of truth) and isolated from the main
    // RNG stream, so it never perturbs the deterministic simulation.
    this.resolveCrossFactionCombat(galaxy, playerSystemId);

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
   * The single mark a pirate **pack** concentrates fire on: the weakest of the
   * co-located alive victims, chosen through the shared {@link selectPirateTarget}
   * target-selection (combat-strength weighted) so the captured system's pirates
   * gang up on one ship (group engagement) rather than spreading out. Deterministic
   * — no RNG — so pack focus never perturbs the deterministic main stream. Falls
   * back to the first victim if the matrix somehow rules them all out (a co-located
   * non-pirate is always valid prey, so this is defensive only).
   */
  private packFocusVictim(alive: NpcShip[]): NpcShip {
    const candidates = alive.map((v) => ({
      id: v.id,
      kind: factionKindOf(v),
      stats: { hullHP: v.hullHP, shields: v.shields, damage: v.damage },
    }));
    const pick = selectPirateTarget(candidates, { pirateRep: 0 });
    return alive.find((v) => v.id === pick?.id) ?? alive[0];
  }

  /**
   * Off-screen combat between a captured system's Overmind garrison and any ship
   * that has wandered into it. Mirrors {@link resolveOffscreenCombat}'s
   * wandering-pirate path for garrison ships (which are otherwise isolated from
   * abstract combat): in any hostile system (other than the player's) where an
   * Overmind garrison ship shares space with any non-garrison ship the matrix
   * marks it hostile to, the garrison attacks. The Overmind is **indiscriminate**
   * (Task 4) — its prey are every non-Overmind kind via {@link isHostile},
   * **including a wandering pirate** (the Overmind and pirates are mutual enemies),
   * not just friendly traders/rangers. The caller resets FIGHTING survivors.
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
      // Only OVERMIND garrison Dominators engage off-screen here; pirate
      // garrisons stay fully isolated, so a captured pirate system's
      // deterministic convoy/quest streams are never perturbed.
      const garrison = ships.filter(
        (s) => this.garrisonIds.has(s.id) && s.faction === Faction.OVERMIND,
      );
      // Indiscriminate Overmind aggression (Task 4): every non-garrison ship the
      // hostility matrix marks an Overmind attacker hostile to — that is every
      // non-Overmind kind, **including a wandering pirate** (mutual enemies), not
      // only friendly traders/rangers. One source of truth (the matrix), no
      // re-derived relation logic.
      // Besieging liberation-assault rangers are NOT prey here: their battle
      // with this garrison is owned by resolveLiberationAssaults, which models
      // mutual attrition. Letting the garrison also swat them through this
      // no-retaliation wanderer path would double its damage output and make
      // every Ranger siege mathematically unwinnable.
      const victims = ships.filter(
        (s) =>
          !this.garrisonIds.has(s.id) &&
          !this.liberationAssaultIds.has(s.id) &&
          isHostile("overmind", factionKindOf(s), { pirateRep: 0 }),
      );
      if (garrison.length === 0 || victims.length === 0) continue;

      for (const attacker of garrison) {
        if (attacker.state === NpcState.DEAD) continue;
        const alive = victims.filter((v) => v.state !== NpcState.DEAD);
        if (alive.length === 0) break;

        const victim = alive[rng.nextInt(0, alive.length - 1)];
        attacker.state = NpcState.FIGHTING;
        victim.state = NpcState.FIGHTING;

        // The entrenched home-turf garrison swats the lone intruder: it deals
        // damage but takes **no erosive retaliation** in this abstract off-screen
        // resolution. The garrison is a standing, auto-replenished defensive
        // force meant to hold its captured system indefinitely — letting one or
        // two wanderers grind it down over weeks would break that
        // standing-garrison persistence invariant (garrison ships are otherwise
        // isolated and must not be whittled out of existence by random traffic).
        // Now that the Overmind preys on every intruder including pirates
        // (damage 30, common wanderers), this keeps the garrison stable.
        victim.hullHP -= Math.max(
          1,
          Math.round(attacker.damage * PIRATE_DAMAGE_FRACTION),
        );

        if (victim.hullHP <= 0) {
          victim.hullHP = 0;
          victim.state = NpcState.DEAD;
          logger.info(
            `Garrison ${attacker.name} destroyed ${victim.name} in ${attacker.currentSystemId}`,
          );
        }
      }
    }
  }

  /**
   * Off-screen cross-faction combat (Task 5): co-present **wandering** Overmind
   * and pirate ships in any non-player system are mutual enemies (the hostility
   * matrix), so they trade hull damage independent of the player — the off-screen
   * counterpart of the in-flight Overmind-vs-pirate brawl. Damage is **mutual**
   * (both sides are aggressors), unlike the one-directional
   * {@link resolveGarrisonOffscreenCombat}: standing-garrison and besieging
   * capture-fleet Overmind ships are deliberately excluded here so a passing
   * raider can never grind a held position down (the standing-garrison persistence
   * invariant) — they engage only through the no-retaliation garrison path. The
   * matrix is the single source of truth ({@link mutuallyHostile}); victim
   * selection draws from a private day-seeded RNG so adding this never perturbs the
   * deterministic main stream. The caller resets FIGHTING survivors to PATROLLING.
   */
  private resolveCrossFactionCombat(
    galaxy: Galaxy,
    playerSystemId?: string,
  ): void {
    const rng = new SeededRNG(`crossfaction_${galaxy.gameDays}`);
    const bySystem = new Map<string, NpcShip[]>();
    for (const npc of galaxy.npcShips) {
      if (npc.state === NpcState.DEAD || npc.state === NpcState.TRAVELING) {
        continue;
      }
      if (npc.currentSystemId === playerSystemId) continue;
      if (this.garrisonIds.has(npc.id)) continue;
      if (this.captureFleetIds.has(npc.id)) continue;
      const list = bySystem.get(npc.currentSystemId) ?? [];
      list.push(npc);
      bySystem.set(npc.currentSystemId, list);
    }

    // Mutual enmity is a property of the kinds, not the encounter — confirm it once
    // through the matrix rather than re-deriving the relation per system.
    if (!mutuallyHostile("overmind", "pirate", { pirateRep: 0 })) return;

    for (const ships of bySystem.values()) {
      const overminds = ships.filter((s) => factionKindOf(s) === "overmind");
      const pirates = ships.filter((s) => factionKindOf(s) === "pirate");
      if (overminds.length === 0 || pirates.length === 0) continue;

      for (const ov of overminds) {
        if (ov.state === NpcState.DEAD) continue;
        const alive = pirates.filter((p) => p.state !== NpcState.DEAD);
        if (alive.length === 0) break;

        const pirate = alive[rng.nextInt(0, alive.length - 1)];
        ov.state = NpcState.FIGHTING;
        pirate.state = NpcState.FIGHTING;

        // Mutual damage — both are aggressors in a cross-faction brawl (the
        // Overmind strikes, the pirate fires back), each at the same per-day
        // fraction as the wandering-pirate path.
        pirate.hullHP -= Math.max(
          1,
          Math.round(ov.damage * PIRATE_DAMAGE_FRACTION),
        );
        ov.hullHP -= Math.max(
          1,
          Math.round(pirate.damage * PIRATE_DAMAGE_FRACTION),
        );

        if (pirate.hullHP <= 0) {
          pirate.hullHP = 0;
          pirate.state = NpcState.DEAD;
          logger.info(
            `Overmind ${ov.name} destroyed pirate ${pirate.name} in ${ov.currentSystemId}`,
          );
        }
        if (ov.hullHP <= 0) {
          ov.hullHP = 0;
          ov.state = NpcState.DEAD;
          logger.info(
            `Pirate destroyed Overmind ${ov.name} in ${ov.currentSystemId}`,
          );
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
    this.launchCaptureFleet(
      galaxy,
      rng,
      hostileId,
      targetId,
      count,
      `capture_${galaxy.gameDays}_${targetId}`,
    );
  }

  /**
   * Spawn `count` fresh Overmind ships in `hostileId`, bound for `targetId`
   * with a HUNT goal via the normal multi-day travel mechanism, and hold them
   * in {@link captureFleetIds} so {@link resolveCaptureFleets} runs their
   * siege. Shared body of the periodic {@link assembleCaptureFleet} trigger
   * and the garrison {@link budOffGarrison} path. `fleetId` must stay
   * `capture_`-prefixed — {@link reconcileTransientState} reclassifies these
   * ships by that prefix after a save/load.
   */
  private launchCaptureFleet(
    galaxy: Galaxy,
    rng: SeededRNG,
    hostileId: string,
    targetId: string,
    count: number,
    fleetId: string,
  ): void {
    const daysToArrival = this.travelDays(galaxy, hostileId, targetId);

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
        this.recordRecentCapture(systemId);
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
   * Resolve the siege phase of every active liberation assault — the Ranger
   * mirror of {@link resolveCaptureFleets}. For each system where arrived
   * assault rangers are present:
   *  - if the system is no longer hostile (freed by another path), release
   *    the force back to normal life;
   *  - else if garrison defenders remain, resolve one attrition round (plays
   *    out over subsequent ticks) using an isolated day-seeded RNG and the
   *    same damage-trade constants as the capture-fleet siege;
   *  - else the garrison is destroyed: liberation is earned, not a coin-flip —
   *    {@link Galaxy.tryLiberate} fires (it emits the SYSTEM_LIBERATED news
   *    itself, matching the detection/convoy paths — returning it here too
   *    would double-post the headline) and the survivors are released.
   * No-op when no assault is active, so galaxies without rallies are untouched.
   *
   * Skips the player's current system (same rule as `resolveOffscreenCombat`
   * and the other abstract resolvers): those ships are visible, so garrison
   * hulls silently dropping — or the system flipping with the liberation
   * credited to the NPC path while the player is there to do it — reads as a
   * glitch. The siege simply resumes once the player moves on.
   */
  private resolveLiberationAssaults(
    galaxy: Galaxy,
    playerSystemId?: string,
  ): void {
    if (this.liberationAssaultIds.size === 0) return;

    const rng = new SeededRNG(`liberation_assault_resolve_${galaxy.gameDays}`);
    const bySystem = new Map<string, NpcShip[]>();
    for (const npc of galaxy.npcShips) {
      if (!this.liberationAssaultIds.has(npc.id)) continue;
      if (npc.state === NpcState.DEAD || npc.state === NpcState.TRAVELING) {
        continue;
      }
      const list = bySystem.get(npc.currentSystemId) ?? [];
      list.push(npc);
      bySystem.set(npc.currentSystemId, list);
    }

    for (const [systemId, attackers] of bySystem) {
      // Target already freed (another path): stand the assault force down.
      // Runs BEFORE the player-present defer — releasing parked rangers is
      // cleanup, not visible combat, and the player liberating the system
      // personally then staying to dock/repair is the normal case; deferring
      // would hold the whole force frozen there for as long as they camp.
      if (!galaxy.isHostileSystem(systemId)) {
        logger.info(
          `Liberation assault at ${systemId} stands down — already freed`,
        );
        for (const a of attackers) this.releaseAssaultShip(a);
        continue;
      }
      // Player present: defer — the fight there is visible, not abstract.
      if (playerSystemId !== undefined && systemId === playerSystemId) {
        continue;
      }

      const defenders = galaxy.npcShips.filter(
        (n) =>
          n.currentSystemId === systemId &&
          n.state !== NpcState.DEAD &&
          n.state !== NpcState.TRAVELING &&
          !this.liberationAssaultIds.has(n.id) &&
          (n.faction === Faction.OVERMIND || n.role === NpcRole.PIRATE),
      );

      if (defenders.length === 0) {
        // Garrison actually destroyed — liberation is guaranteed, no roll.
        galaxy.tryLiberate(systemId);
        logger.info(`Liberation assault freed ${systemId}`);
        for (const a of attackers) this.releaseAssaultShip(a);
        continue;
      }

      // Garrison holds: resolve one attrition round (mirrors resolveCaptureFleets).
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
            `Liberation assault ${attacker.name} destroyed ${victim.name} in ${systemId}`,
          );
        }
        if (attacker.hullHP <= 0) {
          attacker.hullHP = 0;
          attacker.state = NpcState.DEAD;
        }
      }
    }
  }

  /** Stand an assault ranger down: drop the hold and the liberation_ marker so
   *  it rejoins the wandering population on the next tick. */
  private releaseAssaultShip(npc: NpcShip): void {
    this.liberationAssaultIds.delete(npc.id);
    npc.convoyId = undefined;
  }

  /** Whether a live liberation-assault ship is present (arrived, not dead) in
   *  the system — i.e. the system is under active Ranger siege. */
  private underLiberationAssault(galaxy: Galaxy, systemId: string): boolean {
    for (const npc of galaxy.npcShips) {
      if (!this.liberationAssaultIds.has(npc.id)) continue;
      if (npc.state === NpcState.DEAD || npc.state === NpcState.TRAVELING) {
        continue;
      }
      if (npc.currentSystemId === systemId) return true;
    }
    return false;
  }

  /**
   * Announce a Ranger campaign to liberate a hostile system. Picks one hostile
   * system as the target and a friendly (non-hostile) neighbour as the staging
   * point, schedules the rally LIBERATION_RALLY_DELAY days out, and records the
   * campaign so rangers depart the staging system once that date arrives (see
   * {@link resolveLiberationCampaigns}). Returns the LIBERATION_CAMPAIGN news
   * event, or null when no hostile system borders a friendly one — or one is
   * already pending for the chosen target (no duplicate rallies). Freshly
   * captured systems ({@link recentlyCaptured}) are targeted before the
   * random-front scan, so the retake announcement follows a fresh loss.
   * Called every LIBERATION_CAMPAIGN_INTERVAL days from {@link tick}.
   */
  assembleLiberationCampaign(galaxy: Galaxy, rng: SeededRNG): NewsEvent | null {
    let front = this.dequeueRecentCaptureFront(galaxy);
    if (!front) {
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
      front = fronts[rng.nextInt(0, fronts.length - 1)];
    }
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
   * Remember a fresh Overmind capture for priority liberation targeting. A
   * re-captured system moves to the back of the queue instead of duplicating;
   * the oldest entry falls off once the FIFO exceeds RECENTLY_CAPTURED_MAX.
   */
  private recordRecentCapture(systemId: string): void {
    const existing = this.recentlyCaptured.indexOf(systemId);
    if (existing >= 0) this.recentlyCaptured.splice(existing, 1);
    this.recentlyCaptured.push(systemId);
    while (this.recentlyCaptured.length > RECENTLY_CAPTURED_MAX) {
      this.recentlyCaptured.shift();
    }
  }

  /**
   * Pull the oldest still-valid freshly-captured system off
   * {@link recentlyCaptured} as the next liberation front: it must still be
   * hostile, have no pending campaign, and border a friendly staging system.
   * Stale entries (liberated, or already campaigned for) are dropped; an
   * entry deep in hostile territory is kept for a retry once a neighbour is
   * freed. Returns null when no queued capture qualifies, letting the caller
   * fall back to its random-front scan.
   */
  private dequeueRecentCaptureFront(
    galaxy: Galaxy,
  ): { targetId: string; stagingId: string } | null {
    for (let i = 0; i < this.recentlyCaptured.length; i++) {
      const targetId = this.recentlyCaptured[i];
      if (!galaxy.isHostileSystem(targetId)) {
        this.recentlyCaptured.splice(i--, 1);
        continue;
      }
      if (
        this.liberationCampaigns.some(
          (c) => c.targetSystemId === targetId && !c.dispatched,
        )
      ) {
        this.recentlyCaptured.splice(i--, 1);
        continue;
      }
      // Undirected neighbour scan: a fresh capture whose only friendly
      // neighbour sits behind a one-way incoming edge must still dequeue.
      const stagingId = this.undirectedNeighbors(galaxy, targetId).find(
        (id) => !galaxy.isHostileSystem(id),
      );
      if (!stagingId) continue;
      this.recentlyCaptured.splice(i, 1);
      return { targetId, stagingId };
    }
    return null;
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
   * Muster idle ranger NPCs toward a campaign's target as a single convoy
   * (shared convoyId), using the same convoy mechanism as
   * {@link assembleConvoys}. Rangers staged in the campaign's staging system
   * go first; when fewer than LIBERATION_RALLY_MAX_SHIPS are staged, the
   * muster widens galaxy-wide, nearest-to-the-target first — the announced
   * "rangers are massing" actually masses a real force instead of whatever
   * single ranger happened to be parked at the staging system (a token force
   * could win the old 20% flip-roll, but is hopeless in the real garrison
   * fight of {@link resolveLiberationAssaults}; farther recruits simply join
   * the siege as they arrive). Garrison, capture-fleet, and already-besieging
   * ships are excluded. Returns true when at least one ranger departed, false
   * when none were available (so the caller can retry on a later tick).
   */
  private dispatchLiberationRally(
    galaxy: Galaxy,
    campaign: LiberationCampaign,
  ): boolean {
    const idleRangers = galaxy.npcShips.filter(
      (n) =>
        n.role === NpcRole.RANGER &&
        n.state !== NpcState.TRAVELING &&
        n.state !== NpcState.DEAD &&
        !n.convoyId &&
        !this.garrisonIds.has(n.id) &&
        !this.captureFleetIds.has(n.id) &&
        !this.liberationAssaultIds.has(n.id) &&
        n.currentSystemId !== campaign.targetSystemId,
    );
    // Staged rangers first, then the rest of the galaxy nearest-to-target
    // first — deterministic (travelDays + stable sort), no RNG consumed.
    const staged = idleRangers.filter(
      (n) => n.currentSystemId === campaign.stagingSystemId,
    );
    const remote = idleRangers
      .filter((n) => n.currentSystemId !== campaign.stagingSystemId)
      .sort(
        (a, b) =>
          this.travelDays(galaxy, a.currentSystemId, campaign.targetSystemId) -
          this.travelDays(galaxy, b.currentSystemId, campaign.targetSystemId),
      );
    const rangers = [...staged, ...remote].slice(0, LIBERATION_RALLY_MAX_SHIPS);
    if (rangers.length === 0) return false;

    const convoyId = `liberation_${campaign.liberationDate}_${campaign.targetSystemId}`;
    for (const npc of rangers) {
      // Refit before the offensive: the 30-day window between announcement and
      // rally is the muster — rangers depart the set-piece assault at full
      // hull. Without this, wandering-damage-worn hulls (often 30-70/120)
      // make every siege of a full garrison mathematically unwinnable.
      npc.hullHP = npc.maxHull;
      npc.convoyId = convoyId;
      npc.destinationSystemId = campaign.targetSystemId;
      npc.daysToArrival = this.travelDays(
        galaxy,
        npc.currentSystemId,
        campaign.targetSystemId,
      );
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
        this.liberationAssaultIds.delete(galaxy.npcShips[i].id);
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
