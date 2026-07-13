import type { Galaxy } from "@/domain/Galaxy";
import { NpcShip } from "@/domain/NpcShip";
import { NpcRole, NpcState, NpcGoalKind, FactionType } from "@/types";
import type { GameMode, NewsEvent, NpcSizeTier } from "@/types";
import { Faction } from "@/types/faction";
import {
  scaledGarrisonRange,
  OVERMIND_BOSS_TIER,
  OVERMIND_SIZE_TIERS,
} from "@/config/balance";
import {
  overmindGarrisonPowerBonus,
  overmindGarrisonPowerDiscount,
} from "@/systems/campaign/hostileScaling";
import {
  factionKindOf,
  isHostile,
  mutuallyHostile,
  pirateCoordination,
} from "./factionHostility";
import { selectPirateTarget } from "./NpcBrain";
import {
  ROLE_STATS,
  ROLE_LOADOUT,
  ROLE_NAME,
  FACTION_NAME,
  overmindSizeTierForId,
} from "./npcRoleCatalog";
import { travelDays } from "./npcTravel";
import { SeededRNG } from "@/utils/seededRNG";
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

/** Per-day fraction of a pirate's damage applied to a victim in off-screen fights. */
const PIRATE_DAMAGE_FRACTION = 0.5;
/** Per-day fraction of damage a victim deals back to the attacking pirate. */
const VICTIM_RETALIATION_FRACTION = 0.3;
/** Credits a pirate loots when it destroys a victim. */
const PIRATE_LOOT = 200;

/** Per-day chance a pirate NPC raids a trader's cargo in the same off-screen system. */
const PIRATE_CARGO_RAID_CHANCE = 0.05;

/** Max PATROL ships recruited into a single convoy. */
const CONVOY_MAX_SHIPS = 3;

/** Minimum hostile ships a captured (overmind/pirate) system always holds. */
const GARRISON_MIN = 5;
/** Maximum hostile ships spawned to fill a captured system's garrison. */
const GARRISON_MAX = 10;
/**
 * Absolute floor the power discount can never push a garrison's minimum
 * below — a held system must still read as genuinely held (0 collides with
 * the "cleared, awaiting liberation countdown" semantics in {@link fillGarrison}).
 */
const GARRISON_DISCOUNT_FLOOR = 1;

/** Growth cap as a multiple of a garrison's recorded baseline size. Once a
 *  garrison reaches round(baseline × threshold) it stops growing (the excess
 *  buds off as a capture fleet — organic-expansion arc). */
const GARRISON_GROWTH_BUD_THRESHOLD = 1.5;
/** Fraction of a garrison's baseline that buds off as a capture fleet once the
 *  garrison reaches the growth threshold — half the excess flies out to seize
 *  a neighbouring (or distant) system, and the cycle restarts. */
const GARRISON_BUD_OFF_FRACTION = 0.5;

/** Minimum ships in a capture fleet (also the threshold needed to seize a system). */
const CAPTURE_FLEET_MIN = 3;
/** Maximum ships recruited into a single capture fleet. */
const CAPTURE_FLEET_MAX = 5;

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
 * Narrow interface onto the Track 3 (placement/economy) no-depart dwell
 * countdown — the only Track 3 state this Track 2 class ever needs to touch.
 * `NpcSimulator` wires this to its `NpcPlacementEconomy` collaborator so
 * `NpcGarrisonCombat` never imports it directly.
 */
export interface DwellTracker {
  /** Reset a freshly spawned ship's no-depart dwell countdown. */
  mark(id: string): void;
  /** Clear a despawned ship's dwell-countdown entry (no stale keys). */
  clear(id: string): void;
}

/**
 * Track 2 (Combat) — standing garrisons, Overmind capture fleets, and Ranger
 * liberation assaults/campaigns. Spawns and manages every hostile-occupation
 * ship, resolves off-screen combat between wandering/garrisoned ships, and
 * owns the transient (unpersisted) bookkeeping that survives a save/load via
 * {@link reconcileTransientState}.
 */
export class NpcGarrisonCombat {
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
   * another path; dead ones are pruned via {@link releaseHeldId}.
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
   * the placement dwell countdown. Reset the moment any hostile ship is
   * present again.
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

  /**
   * Live source of the run's RATCHETED peak power index
   * (`GameEngine.campaignPeakPower`) — the adaptive Overmind garrison-count
   * input (three-year-campaign Task 4). A provider (not a pushed value) so the
   * per-tick garrison sizing always reads the current ratchet with a single
   * wiring point. Null (legacy DI sites/tests) ⇒ 0 ⇒ today's exact garrison
   * sizes. Derived, never persisted on the simulator itself.
   */
  private campaignPeakPowerSource: (() => number) | null = null;

  constructor(private readonly dwell: DwellTracker) {}

  /** Wire the bank so NPC plunder books a balanced ledger entry via the bus. */
  attachBank(access: BankAccess | null): void {
    this.bank = access;
  }

  /** Set the difficulty mode that scales hostile garrison sizes (HARD only). */
  setGameMode(mode: GameMode): void {
    this.gameMode = mode;
  }

  /** Wire the ratcheted-power source that grows Overmind garrisons (Task 4). */
  attachCampaignPeakPower(source: (() => number) | null): void {
    this.campaignPeakPowerSource = source;
  }

  /**
   * Whether an NPC is held by a garrison/capture-fleet/liberation-assault
   * position lock — such a ship never wanders (main tick's per-NPC loop skips
   * it entirely), and consumes no main RNG.
   */
  isHeld(id: string): boolean {
    return (
      this.garrisonIds.has(id) ||
      this.captureFleetIds.has(id) ||
      this.liberationAssaultIds.has(id)
    );
  }

  /** Whether an NPC is a standing-garrison or capture-fleet member — the
   *  subset excluded from the wandering-population replenishment target
   *  (liberation-assault rangers still count toward it). */
  isGarrisonOrCaptureFleet(id: string): boolean {
    return this.garrisonIds.has(id) || this.captureFleetIds.has(id);
  }

  /** Release every hold this id may be under — called when an NPC dies. */
  releaseHeldId(id: string): void {
    this.garrisonIds.delete(id);
    this.captureFleetIds.delete(id);
    this.liberationAssaultIds.delete(id);
  }

  /** Enroll a rally ranger that just arrived at its hostile target into the
   *  liberation-assault siege hold (see {@link resolveLiberationAssaults}). */
  enrollLiberationAssault(id: string): void {
    this.liberationAssaultIds.add(id);
  }

  /**
   * Spawn a pirate NPC directly in the specified system and return it.
   * Used by GalaxySimulator for PIRATE_SURGE events.
   */
  spawnPirateInSystem(rng: SeededRNG, id: string, systemId: string): NpcShip {
    const stats = ROLE_STATS[NpcRole.PIRATE];
    const faction = FactionType.OUTLANDERS;
    this.dwell.mark(id);
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
   * it. Carries its own `NpcRole.OVERMIND` stats (tougher than a PATROL hull)
   * and faction OVERMIND so it reads as hostile to the player and friendly
   * NPCs. Used by ensureGarrison.
   *
   * `sizeTier` (default medium = the exact base stats) scales hull via
   * {@link OVERMIND_SIZE_TIERS}; the boss tier applies the fixed
   * {@link OVERMIND_BOSS_TIER} stats. Garrison/capture-fleet callers derive
   * the tier with {@link overmindSizeTierForId} — kept out of this factory so
   * a direct (tier-less) spawn keeps its exact base stats.
   */
  spawnOvermindInSystem(
    rng: SeededRNG,
    id: string,
    systemId: string,
    sizeTier?: NpcSizeTier,
  ): NpcShip {
    const stats = ROLE_STATS[NpcRole.OVERMIND];
    const tier = sizeTier ?? "medium";
    const hull =
      tier === "boss"
        ? OVERMIND_BOSS_TIER.hull
        : Math.round(stats.hull * OVERMIND_SIZE_TIERS[tier].statMult);
    // Damage is tier-flat below boss (see OVERMIND_SIZE_TIERS — the seeded
    // campaign/siege gates red on any garrison damage change).
    const damage = tier === "boss" ? OVERMIND_BOSS_TIER.damage : stats.damage;
    this.dwell.mark(id);
    return new NpcShip({
      id,
      name: `Жнец ${id}`,
      race: FactionType.PARADOXES,
      faction: Faction.OVERMIND,
      role: NpcRole.OVERMIND,
      hullHP: hull,
      maxHull: hull,
      shields: stats.shields,
      speed: stats.speed,
      damage,
      sizeTier: tier,
      currentSystemId: systemId,
      state: NpcState.PATROLLING,
      goal: null,
      destinationSystemId: null,
      daysToArrival: 0,
      credits: rng.nextInt(50, 300),
      reputation: 0,
      shieldPower: stats.shieldPower,
      loadoutSummary: ROLE_LOADOUT[NpcRole.OVERMIND],
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
  reconcileTransientState(galaxy: Galaxy): void {
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
   * below the (power-scaled, Overmind-only) minimum, spawn fresh hostile ships
   * up to a random target in that system's [min, max] range. Overmind systems
   * get OVERMIND-role ships; pirate systems get PIRATE ships (always at the
   * unscaled [GARRISON_MIN, GARRISON_MAX]). Idempotent once the minimum is met.
   */
  ensureGarrison(galaxy: Galaxy, rng: SeededRNG): void {
    // Re-sync `garrisonIds` from any `garrison_`/`capture_`-prefixed ships
    // first (idempotent — a no-op if `tick()` already ran it this turn), so a
    // reloaded or otherwise out-of-band call still recognises pre-existing
    // members instead of treating them as unregistered transients.
    this.reconcileTransientState(galaxy);
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
    const peakPower = this.campaignPeakPowerSource?.() ?? 0;
    const powerBonus = overmind ? overmindGarrisonPowerBonus(peakPower) : 0;
    // Win-rate architecture plan (Task 2): the mirrored downward half — a
    // powerless player faces a SMALLER standing garrison, phasing out to 0
    // discount by full power. Pirate garrisons stay undiscounted, matching
    // the upward bonus's own Overmind-only scope.
    const powerDiscount = overmind
      ? overmindGarrisonPowerDiscount(peakPower)
      : 0;
    const netDelta = powerBonus - powerDiscount;
    // Floored so the discount can never make a held system read as empty.
    const scaledMin = Math.max(
      GARRISON_DISCOUNT_FLOOR,
      GARRISON_MIN + netDelta,
    );
    const scaledMax = Math.max(scaledMin, GARRISON_MAX + netDelta);
    // HARD shifts the garrison range up; NORMAL/GOD keep [GARRISON_MIN, MAX].
    const { min: garrisonMin, max: garrisonMax } = scaledGarrisonRange(
      this.gameMode,
      scaledMin,
      scaledMax,
    );
    let present = this.countGarrisonPresent(galaxy, systemId);
    if (present >= garrisonMin) {
      this.establishedGarrisons.add(systemId);
      // Members only (not raw `present`): a transient wanderer counted toward
      // meeting the minimum here must not permanently inflate the growth
      // baseline past what registered garrison members can ever reach.
      this.anchorGarrisonBaseline(
        systemId,
        this.countGarrisonMembers(galaxy, systemId),
        garrisonMin,
        garrisonMax,
      );
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
        ? this.spawnOvermindInSystem(
            rng,
            id,
            systemId,
            overmindSizeTierForId(id),
          )
        : this.spawnPirateInSystem(rng, id, systemId);
      galaxy.npcShips.push(ship);
      this.garrisonIds.add(id);
      present++;
      spawned++;
    }
    this.establishedGarrisons.add(systemId);
    // Members only, same reasoning as the early-return branch above — every
    // ship spawned in the loop was just registered into `garrisonIds`, so
    // this recount excludes any stray non-member present before the loop ran.
    this.anchorGarrisonBaseline(
      systemId,
      this.countGarrisonMembers(galaxy, systemId),
      garrisonMin,
      garrisonMax,
    );
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
  growGarrisons(galaxy: Galaxy, rng: SeededRNG, playerSystemId?: string): void {
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
      galaxy.npcShips.push(
        this.spawnOvermindInSystem(
          rng,
          id,
          systemId,
          overmindSizeTierForId(id),
        ),
      );
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
      this.dwell.clear(donor.id);
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
    const weights = distant.map((s) => 1 / travelDays(galaxy, sourceId, s.id));
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
  undirectedNeighbors(galaxy: Galaxy, systemId: string): string[] {
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

  /**
   * Auto-liberate captured systems whose garrison has been cleared. For each
   * hostile (overmind/pirate) system: if any hostile garrison ship is present the
   * countdown resets; otherwise the per-system clock ticks down from
   * LIBERATION_CLEAR_DAYS and {@link Galaxy.tryLiberate} fires (emitting a
   * SYSTEM_LIBERATED news event) when it reaches zero. Bookkeeping for systems
   * that are no longer hostile (freed via another path) is pruned so a later
   * recapture re-garrisons from scratch.
   */
  resolveLiberationDetection(galaxy: Galaxy): void {
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

  /**
   * Simulate pirate cargo raids in off-screen systems: each pirate has a 5%
   * daily chance to raid a co-located trader, clearing its cargo.
   */
  resolveOffscreenPirateRaids(
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
  resolveOffscreenCombat(
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
  assembleConvoys(galaxy: Galaxy, rng: SeededRNG): void {
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
    const daysToArrival = travelDays(galaxy, friendlyNeighbourId, hostileId);

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
    const daysToArrival = travelDays(galaxy, hostileId, targetId);

    for (let i = 0; i < count; i++) {
      const id = `${fleetId}_${i}`;
      const ship = this.spawnOvermindInSystem(
        rng,
        id,
        hostileId,
        overmindSizeTierForId(id),
      );
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
  resolveCaptureFleets(galaxy: Galaxy): NewsEvent[] {
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
          description: `Система ${sys?.name ?? systemId} захвачена Жнецами!`,
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
  resolveLiberationAssaults(galaxy: Galaxy, playerSystemId?: string): void {
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
  resolveLiberationCampaigns(galaxy: Galaxy): void {
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
          travelDays(galaxy, a.currentSystemId, campaign.targetSystemId) -
          travelDays(galaxy, b.currentSystemId, campaign.targetSystemId),
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
      npc.daysToArrival = travelDays(
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
}
