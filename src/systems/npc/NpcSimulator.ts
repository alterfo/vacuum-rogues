import type { Galaxy } from "@/domain/Galaxy";
import { SeededRNG } from "@/utils/seededRNG";
import type { NpcShip } from "@/domain/NpcShip";
import { NpcRole, NpcState } from "@/types";
import type { GameMode, NewsEvent } from "@/types";
import type { NpcSizeTier } from "@/types";
import type { NpcBrain } from "./NpcBrain";
import { RuleBasedNpcBrain } from "./NpcBrain";
import { NpcGarrisonCombat } from "./NpcGarrisonCombat";
import {
  NpcPlacementEconomy,
  rumorReactionChance,
} from "./NpcPlacementEconomy";
import { travelDays } from "./npcTravel";
import type { BankAccess } from "@/systems/banking/economy";
import { logger } from "@/utils/logger";

export {
  ROLE_STATS,
  ROLE_LOADOUT,
  NPC_TECH_BAND,
  npcRoleTechLevel,
  overmindSizeTierForId,
} from "./npcRoleCatalog";
export {
  rumorReactionChance,
  npcsPresentInSystem,
} from "./NpcPlacementEconomy";

/** Per-day chance a ship that has arrived somewhere decides to move on (~6-7 day
 *  dwell): long enough to actually orbit/visit a planet and read as purposeful,
 *  short enough that ships keep circulating and don't pile up in one system. */
const DEPART_CHANCE = 0.15;

/** Per-day chance a ranger NPC accepts a random delivery quest to another system. */
const RANGER_QUEST_CHANCE = 0.1;

/** How often (game days) PATROL convoys are assembled toward contested borders. */
const CONVOY_ASSEMBLY_INTERVAL = 30;
/** Per-PATROL-convoy chance to liberate a contested system on arrival.
 *  Liberation-rally rangers no longer roll this — they persist as an assault
 *  force and fight the garrison instead (see resolveLiberationAssaults). */
const CONVOY_LIBERATION_CHANCE = 0.2;

/** How often (game days) an established Overmind garrison grows by one ship. */
const GARRISON_GROWTH_INTERVAL_DAYS = 10;

/** How often (game days) the Overmind launches a fleet to capture a new system. */
const CAPTURE_FLEET_INTERVAL = 60;

/** How often (game days) the Rangers announce a liberation campaign. */
const LIBERATION_CAMPAIGN_INTERVAL = 50;

/**
 * Advances the autonomous life of NPC ships across the galaxy: spawning them at
 * generation time and, each game day, moving them between systems toward their
 * goals. The cross-cutting "NPC brain" layer (per
 * `docs/plans/20260711-parallel-workstream-boundaries.md`) — composes two
 * track-owned collaborators, `NpcGarrisonCombat` (Track 2 — standing garrisons,
 * capture fleets, liberation assaults/campaigns, off-screen combat) and
 * `NpcPlacementEconomy` (Track 3 — spawn/placement and the wandering-population
 * trade economy), and owns the per-NPC decision loop (`tick`) that reads and
 * writes both through their narrow public methods.
 */
export class NpcSimulator {
  private readonly brain: NpcBrain;
  private readonly placement = new NpcPlacementEconomy();
  private readonly garrison: NpcGarrisonCombat;

  constructor(brain: NpcBrain = new RuleBasedNpcBrain()) {
    this.brain = brain;
    this.garrison = new NpcGarrisonCombat(this.placement);
  }

  /** Wire the bank so NPC plunder books a balanced ledger entry via the bus. */
  attachBank(access: BankAccess | null): void {
    this.garrison.attachBank(access);
  }

  /** Set the difficulty mode that scales hostile garrison sizes (HARD only). */
  setGameMode(mode: GameMode): void {
    this.garrison.setGameMode(mode);
  }

  /** Wire the ratcheted-power source that grows Overmind garrisons (Task 4). */
  attachCampaignPeakPower(source: (() => number) | null): void {
    this.garrison.attachCampaignPeakPower(source);
  }

  /**
   * Populate the galaxy with an initial NPC population. Deterministic for a
   * given rng (which is seeded from the galaxy seed during generation).
   */
  spawnInitial(galaxy: Galaxy, rng: SeededRNG): NpcShip[] {
    return this.placement.spawnInitial(galaxy, rng);
  }

  /**
   * Spawn a pirate NPC directly in the specified system and return it.
   * Used by GalaxySimulator for PIRATE_SURGE events.
   */
  spawnPirateInSystem(rng: SeededRNG, id: string, systemId: string): NpcShip {
    return this.garrison.spawnPirateInSystem(rng, id, systemId);
  }

  /**
   * Spawn an OVERMIND garrison NPC directly in the specified system and
   * return it. See {@link NpcGarrisonCombat.spawnOvermindInSystem}.
   */
  spawnOvermindInSystem(
    rng: SeededRNG,
    id: string,
    systemId: string,
    sizeTier?: NpcSizeTier,
  ): NpcShip {
    return this.garrison.spawnOvermindInSystem(rng, id, systemId, sizeTier);
  }

  /**
   * System ids that currently hold a live fight (hostile + friendly ship both
   * present). The star map reads this to paint the battle marker.
   */
  battleSystemIds(galaxy: Galaxy): Set<string> {
    return this.garrison.battleSystemIds(galaxy);
  }

  /**
   * Guarantee that every captured (overmind/pirate) system holds a standing
   * garrison of hostile ships.
   */
  ensureGarrison(galaxy: Galaxy, rng: SeededRNG): void {
    this.garrison.ensureGarrison(galaxy, rng);
  }

  /**
   * Launch an Overmind capture fleet against a neutral border system. See
   * {@link NpcGarrisonCombat.assembleCaptureFleet}.
   */
  assembleCaptureFleet(galaxy: Galaxy, rng: SeededRNG): void {
    this.garrison.assembleCaptureFleet(galaxy, rng);
  }

  /**
   * Announce a Ranger campaign to liberate a hostile system. See
   * {@link NpcGarrisonCombat.assembleLiberationCampaign}.
   */
  assembleLiberationCampaign(galaxy: Galaxy, rng: SeededRNG): NewsEvent | null {
    return this.garrison.assembleLiberationCampaign(galaxy, rng);
  }

  /**
   * Remove a specific NPC from the galaxy (e.g. destroyed by the player in
   * a CombatScene encounter). No-op if the id is not found.
   */
  removeNpc(galaxy: Galaxy, npcId: string): void {
    this.placement.removeNpc(galaxy, npcId);
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
    this.garrison.reconcileTransientState(galaxy);

    // Start of day: dispatch any liberation rally whose date has arrived, before
    // the per-NPC movement loop gets a chance to scatter the staging rangers.
    this.garrison.resolveLiberationCampaigns(galaxy);

    for (const npc of galaxy.npcShips) {
      if (npc.state === NpcState.DEAD) continue;

      if (npc.state === NpcState.TRAVELING) {
        npc.daysToArrival -= 1;
        if (npc.daysToArrival <= 0) {
          const arrivedAt = npc.destinationSystemId;
          this.placement.arrive(npc);
          if (npc.role === NpcRole.TRADER) {
            const sellPlanetId = this.placement.takeRumorDestPlanet(npc.id);
            this.placement.simulateTraderTrade(npc, galaxy, rng, sellPlanetId);
          }
          // A PATROL convoy arriving at a contested system has a chance to
          // liberate it (main-stream roll, unchanged). A liberation-rally
          // RANGER instead persists as an assault force and fights the
          // standing garrison over subsequent ticks (see
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
            this.garrison.enrollLiberationAssault(npc.id);
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

      // Garrison / capture-fleet / liberation-assault hold: a ship under any
      // of these holds defends or besieges instead of wandering off via the
      // random departure roll, and consumes no main RNG.
      if (this.garrison.isHeld(npc.id)) {
        continue;
      }

      // Ranger without an active quest: 10% chance to accept one.
      if (
        npc.role === NpcRole.RANGER &&
        npc.activeQuestTarget === null &&
        rng.next() < RANGER_QUEST_CHANCE
      ) {
        const target = this.placement.pickQuestTarget(
          npc.currentSystemId,
          galaxy,
          rng,
        );
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
      if (this.placement.consumeDwell(npc.id)) {
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
    this.placement.advanceTrackedPositions(galaxy);

    // Assemble military convoys toward contested systems every 30 days.
    if (
      galaxy.gameDays > 0 &&
      galaxy.gameDays % CONVOY_ASSEMBLY_INTERVAL === 0
    ) {
      this.garrison.assembleConvoys(galaxy, rng);
    }

    // Launch an Overmind capture fleet at a neutral border system every 60 days.
    // Uses an isolated, day-seeded RNG so capture campaigns never perturb the
    // deterministic main stream that other systems/tests depend on.
    if (galaxy.gameDays > 0 && galaxy.gameDays % CAPTURE_FLEET_INTERVAL === 0) {
      this.garrison.assembleCaptureFleet(
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
      const campaignEvent = this.garrison.assembleLiberationCampaign(
        galaxy,
        new SeededRNG(`liberation_${galaxy.gameDays}`),
      );
      if (campaignEvent) events.push(campaignEvent);
    }

    // Resolve abstract off-screen fights, then keep the population topped up.
    this.garrison.resolveOffscreenCombat(galaxy, rng, playerSystemId);
    for (const e of this.garrison.resolveCaptureFleets(galaxy)) events.push(e);
    this.garrison.resolveLiberationAssaults(galaxy, playerSystemId);
    const raidEvents = this.garrison.resolveOffscreenPirateRaids(
      galaxy,
      rng,
      playerSystemId,
    );
    for (const e of raidEvents) events.push(e);
    this.placement.pruneAndReplenish(
      galaxy,
      rng,
      (id) => this.garrison.releaseHeldId(id),
      (id) => this.garrison.isGarrisonOrCaptureFleet(id),
    );

    // Keep captured systems garrisoned: any overmind/pirate system below the
    // minimum hostile-ship count is topped back up to a full standing garrison.
    // Use an isolated, day-seeded RNG so garrison spawning never perturbs the
    // deterministic main simulation stream that other systems/tests depend on.
    this.garrison.ensureGarrison(
      galaxy,
      new SeededRNG(`garrison_${galaxy.gameDays}`),
    );

    // Grow established Overmind garrisons slowly toward the bud-off threshold
    // (organic-expansion arc). Runs after ensureGarrison so the day's garrison
    // counts are final; the isolated day-seeded RNG keeps it off the
    // deterministic main stream, matching the surrounding periodic calls.
    if (
      galaxy.gameDays > 0 &&
      galaxy.gameDays % GARRISON_GROWTH_INTERVAL_DAYS === 0
    ) {
      this.garrison.growGarrisons(
        galaxy,
        new SeededRNG(`garrison_growth_${galaxy.gameDays}`),
        playerSystemId,
      );
    }

    // Liberate any captured system whose garrison has been cleared and held empty
    // for LIBERATION_CLEAR_DAYS. Runs after ensureGarrison so a freshly captured
    // system is garrisoned (and excluded) before its first detection pass.
    this.garrison.resolveLiberationDetection(galaxy);

    return events;
  }

  /**
   * Decide whether a TRADER NPC diverts onto an active route rumor as it
   * departs, committing the diversion (via `NpcPlacementEconomy`) if so.
   * Returns whether it diverted; caller falls back to the brain's random
   * goal when this returns false.
   *
   * To keep the deterministic main simulation untouched for galaxies with no
   * rumors, this draws from `rng` ONLY when there is a reachable rumor — so
   * the existing NPC stream is unperturbed unless rumors are live. The draw
   * scales with the rumor's live margin via {@link rumorReactionChance}.
   */
  private pickTraderGoal(
    npc: NpcShip,
    galaxy: Galaxy,
    rng: SeededRNG,
  ): boolean {
    // Most-profitable first; only rumors whose destination differs from where
    // the trader already sits are actionable.
    const rumor = galaxy
      .getActiveRumors()
      .find((r) => r.toSystemId !== npc.currentSystemId);
    if (!rumor) return false;

    if (rng.next() >= rumorReactionChance(rumor.lastMarginPct)) return false;

    this.placement.applyRumorDiversion(npc, galaxy, rumor);
    return true;
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
    npc.daysToArrival = travelDays(galaxy, npc.currentSystemId, target);
    npc.state = NpcState.TRAVELING;
  }
}
