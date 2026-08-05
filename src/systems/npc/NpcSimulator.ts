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

const DEPART_CHANCE = 0.15;

const RANGER_QUEST_CHANCE = 0.1;

const CONVOY_ASSEMBLY_INTERVAL = 30;
const CONVOY_LIBERATION_CHANCE = 0.2;

const GARRISON_GROWTH_INTERVAL_DAYS = 10;

const CAPTURE_FLEET_INTERVAL = 60;

const LIBERATION_CAMPAIGN_INTERVAL = 50;

export class NpcSimulator {
  private readonly brain: NpcBrain;
  private readonly placement = new NpcPlacementEconomy();
  private readonly garrison: NpcGarrisonCombat;

  constructor(brain: NpcBrain = new RuleBasedNpcBrain()) {
    this.brain = brain;
    this.garrison = new NpcGarrisonCombat(this.placement);
  }

  attachBank(access: BankAccess | null): void {
    this.garrison.attachBank(access);
  }

  setGameMode(mode: GameMode): void {
    this.garrison.setGameMode(mode);
  }

  attachCampaignPeakPower(source: (() => number) | null): void {
    this.garrison.attachCampaignPeakPower(source);
  }

  spawnInitial(galaxy: Galaxy, rng: SeededRNG): NpcShip[] {
    return this.placement.spawnInitial(galaxy, rng);
  }

  spawnPirateInSystem(rng: SeededRNG, id: string, systemId: string): NpcShip {
    return this.garrison.spawnPirateInSystem(rng, id, systemId);
  }

  spawnOvermindInSystem(
    rng: SeededRNG,
    id: string,
    systemId: string,
    sizeTier?: NpcSizeTier,
  ): NpcShip {
    return this.garrison.spawnOvermindInSystem(rng, id, systemId, sizeTier);
  }

  battleSystemIds(galaxy: Galaxy): Set<string> {
    return this.garrison.battleSystemIds(galaxy);
  }

  ensureGarrison(galaxy: Galaxy, rng: SeededRNG): void {
    this.garrison.ensureGarrison(galaxy, rng);
  }

  assembleCaptureFleet(galaxy: Galaxy, rng: SeededRNG): void {
    this.garrison.assembleCaptureFleet(galaxy, rng);
  }

  assembleLiberationCampaign(galaxy: Galaxy, rng: SeededRNG): NewsEvent | null {
    return this.garrison.assembleLiberationCampaign(galaxy, rng);
  }

  removeNpc(galaxy: Galaxy, npcId: string): void {
    this.placement.removeNpc(galaxy, npcId);
  }

  tick(galaxy: Galaxy, rng: SeededRNG, playerSystemId?: string): NewsEvent[] {
    const events: NewsEvent[] = [];

    this.garrison.reconcileTransientState(galaxy);

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
          const isConvoyPatrol = npc.role === NpcRole.PATROL && !!npc.convoyId;
          const isRallyRanger =
            npc.role === NpcRole.RANGER &&
            !!npc.convoyId &&
            npc.convoyId.startsWith("liberation_");
          if (isRallyRanger && arrivedAt && galaxy.isHostileSystem(arrivedAt)) {
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

      if (this.garrison.isHeld(npc.id)) {
        continue;
      }

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

      if (npc.state === NpcState.IDLE) {
        this.departToNewGoal(npc, galaxy, rng);
        continue;
      }

      if (this.placement.consumeDwell(npc.id)) {
        continue;
      }

      if (rng.next() < DEPART_CHANCE) {
        this.departToNewGoal(npc, galaxy, rng);
      }
    }

    this.placement.advanceTrackedPositions(galaxy);

    if (
      galaxy.gameDays > 0 &&
      galaxy.gameDays % CONVOY_ASSEMBLY_INTERVAL === 0
    ) {
      this.garrison.assembleConvoys(galaxy, rng);
    }

    if (galaxy.gameDays > 0 && galaxy.gameDays % CAPTURE_FLEET_INTERVAL === 0) {
      this.garrison.assembleCaptureFleet(
        galaxy,
        new SeededRNG(`capture_${galaxy.gameDays}`),
      );
    }

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

    this.garrison.ensureGarrison(
      galaxy,
      new SeededRNG(`garrison_${galaxy.gameDays}`),
    );

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

    this.garrison.resolveLiberationDetection(galaxy);

    return events;
  }

  private pickTraderGoal(
    npc: NpcShip,
    galaxy: Galaxy,
    rng: SeededRNG,
  ): boolean {
    const rumor = galaxy
      .getActiveRumors()
      .find((r) => r.toSystemId !== npc.currentSystemId);
    if (!rumor) return false;

    if (rng.next() >= rumorReactionChance(rumor.lastMarginPct)) return false;

    this.placement.applyRumorDiversion(npc, galaxy, rumor);
    return true;
  }

  private departToNewGoal(npc: NpcShip, galaxy: Galaxy, rng: SeededRNG): void {
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
