import { Galaxy } from "@/domain/Galaxy";
import type { Player } from "@/domain/Player";
import type { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import { NpcSimulator } from "@/systems/npc/NpcSimulator";
import { GalaxySimulator } from "@/systems/GalaxySimulator";
import { TradeSystem } from "@/systems/TradeSystem";
import { scanTradeRoutes } from "@/systems/trade/RouteScanner";
import { updateRumors } from "@/systems/trade/RumorDirector";
import { stepOwnershipTick } from "@/systems/galaxy/OvermindBalance";
import {
  advanceOvermind,
  type OvermindSpreadConfig,
} from "@/systems/overmind/overmindSpread";
import { adaptiveSpreadIntervalDays } from "@/systems/campaign/adaptivePacing";
import { EscalationNoticeTracker } from "@/systems/campaign/escalationNotices";
import { BankBus } from "@/systems/banking/bus";
import { SeededRNG } from "@/utils/seededRNG";
import { ResourceType } from "@/types";
import { GAME_BALANCE, ADAPTIVE_GRACE_DAYS } from "@/config/balance";
import { t } from "@/i18n/i18n";
import { logger } from "@/utils/logger";

export interface DayTickControllerDeps {
  getGalaxy: () => Galaxy | null;
  getPlayer: () => Player | null;
  getPlayerLoadout: () => ShipLoadout | null;
  npcSimulator: NpcSimulator;
  galaxySimulator: GalaxySimulator;
  tradeSystem: TradeSystem;
  bankBus: BankBus;
  checkExpiredQuests: () => void;
  isOutcomeShown: () => boolean;
  showGameOutcomeScreen: (win: boolean) => void;
  invalidateInfoRegistryCache: () => void;
  updateCampaignPeakPower?: () => number;
}

export class DayTickController {
  private readonly escalationNotices = new EscalationNoticeTracker();

  constructor(private readonly deps: DayTickControllerDeps) {}

  run(): void {
    const galaxy = this.deps.getGalaxy();
    if (!galaxy) return;

    galaxy.simulateDay();
    const rng = new SeededRNG(`${galaxy.id}_day_${galaxy.gameDays}`);

    this.deps.updateCampaignPeakPower?.();

    const npcEvents = this.deps.npcSimulator.tick(
      galaxy,
      rng,
      this.deps.getPlayer()?.currentSystemId,
    );
    for (const event of npcEvents) {
      galaxy.addNewsEvent(event);
    }

    const globalEvents = this.deps.galaxySimulator.tickGlobalEvents(
      galaxy,
      rng,
    );
    for (const event of globalEvents) {
      galaxy.addNewsEvent(event);
    }

    this.advanceMarketDrift(galaxy, rng);
    this.advanceTradeRumors(galaxy);
    this.advanceDroidRepair();
    this.advanceOwnershipEquilibrium(galaxy, rng);
    const peakPower = this.advanceOvermindArc(galaxy);
    this.emitEscalationNotices(galaxy, peakPower);
    this.dispatchOutcomeOverlay(galaxy);

    this.deps.invalidateInfoRegistryCache(); // world advanced → registry is stale

    this.deps.checkExpiredQuests();

    this.deps.bankBus.dispatch({ kind: "RunEndOfDay" });
  }

  private advanceMarketDrift(galaxy: Galaxy, rng: SeededRNG): void {
    for (const system of galaxy.systems) {
      for (const planet of system.planets) {
        if (typeof planet.market.advanceMarketDay === "function") {
          planet.market.advanceMarketDay(() => rng.next());
        }
      }
      if (rng.next() < 0.1 && system.planets.length > 0) {
        galaxy.addNewsEvent({
          type: "MARKET_SHIFT",
          systemId: system.id,
          day: galaxy.gameDays,
          description: `Рыночные цены изменились в системе ${system.name}`,
        });
      }
    }
  }

  private advanceTradeRumors(galaxy: Galaxy): void {
    const marketSystemCount = galaxy.systems.filter((s) =>
      s.planets.some((p) => !!p.market),
    ).length;
    if (marketSystemCount < 2) return;
    updateRumors(
      galaxy,
      () =>
        scanTradeRoutes(
          galaxy,
          (planet, resource) =>
            this.deps.tradeSystem.referenceMarketPrice(planet, resource),
          { maxRoutes: Object.values(ResourceType).length, minMarginPct: 0 },
        ),
      galaxy.gameDays,
      {
        marginOpen: GAME_BALANCE.rumorMarginOpen,
        marginExpire: GAME_BALANCE.rumorMarginExpire,
        maxActive: GAME_BALANCE.rumorMaxActive,
      },
    );
  }

  private advanceDroidRepair(): void {
    const player = this.deps.getPlayer();
    const playerLoadout = this.deps.getPlayerLoadout();
    if (!player || !playerLoadout) return;
    const stats = playerLoadout.derivedStats();
    if (stats.repairRate > 0) {
      const ship = player.ship;
      if (ship.hullHP < ship.maxHull) {
        ship.hullHP = Math.min(ship.maxHull, ship.hullHP + stats.repairRate);
      }
    }
  }

  private advanceOwnershipEquilibrium(galaxy: Galaxy, rng: SeededRNG): void {
    if (galaxy.gameDays % GAME_BALANCE.OVERMIND_BALANCE_INTERVAL !== 0) return;

    const balanceCfg = {
      pCapture: GAME_BALANCE.OVERMIND_CAPTURE_PROB,
      pRecaptureBase: GAME_BALANCE.OVERMIND_RECAPTURE_BASE_PROB,
      feedbackStrength: GAME_BALANCE.OVERMIND_FEEDBACK_STRENGTH,
      freezeOvermind: galaxy.overmindSystems.length > 0,
    };
    const nodes = galaxy.systems.map((s) => ({
      id: s.id,
      connections: s.connections,
    }));
    const prevOvermind = new Set(galaxy.overmindSystems);
    const prevPirate = new Set(galaxy.pirateSystems);
    const result = stepOwnershipTick(
      nodes,
      galaxy.overmindSystems,
      galaxy.pirateSystems,
      rng,
      balanceCfg,
    );
    galaxy.overmindSystems = result.overmindSystems;
    galaxy.pirateSystems = result.pirateSystems;

    for (const id of result.overmindSystems) {
      if (!prevOvermind.has(id)) {
        const sys = galaxy.systems.find((s) => s.id === id);
        if (sys) {
          galaxy.addNewsEvent({
            type: "OVERMIND_EXPANSION",
            systemId: id,
            day: galaxy.gameDays,
            description: `OVERMIND захватил систему ${sys.name}`,
          });
          logger.info(`OVERMIND captured: ${sys.name} (${id})`);
        }
      }
    }
    for (const id of result.pirateSystems) {
      if (!prevPirate.has(id)) {
        const sys = galaxy.systems.find((s) => s.id === id);
        if (sys) {
          galaxy.addNewsEvent({
            type: "PIRATE_SURGE",
            systemId: id,
            day: galaxy.gameDays,
            description: `Пираты захватили систему ${sys.name}`,
          });
          logger.info(`Pirates captured: ${sys.name} (${id})`);
        }
      }
    }

    if (
      galaxy.overmindArc.peakThreat === 0 &&
      galaxy.overmindSystems.length < GAME_BALANCE.OVERMIND_FLOOR_MIN
    ) {
      const hostile = new Set([
        ...galaxy.overmindSystems,
        ...galaxy.pirateSystems,
      ]);
      const playerSystemId = this.deps.getPlayer()?.currentSystemId ?? "";
      const available = galaxy.systems.filter(
        (s) => !hostile.has(s.id) && s.id !== playerSystemId,
      );
      const needed =
        GAME_BALANCE.OVERMIND_FLOOR_MIN - galaxy.overmindSystems.length;
      for (let i = 0; i < needed && available.length > 0; i++) {
        const idx = rng.nextInt(0, available.length - 1);
        const chosen = available.splice(idx, 1)[0];
        galaxy.addOvermindSystem(chosen.id);
        logger.info(
          `OVERMIND floor: reseeded at ${chosen.name} (${chosen.id})`,
        );
      }
    }
  }

  private advanceOvermindArc(galaxy: Galaxy): number {
    const day = galaxy.gameDays;

    const peakPower = this.deps.updateCampaignPeakPower?.() ?? 0;
    const config: OvermindSpreadConfig = {
      graceDays: ADAPTIVE_GRACE_DAYS,
      spreadIntervalDays: adaptiveSpreadIntervalDays(
        day,
        galaxy.overmindArc.dayZero,
        peakPower,
      ),
      capturesPerTick: GAME_BALANCE.OVERMIND_SPREAD_CAPTURES_PER_TICK,
      lossShare: GAME_BALANCE.OVERMIND_SPREAD_LOSS_SHARE,
      containedShare: GAME_BALANCE.OVERMIND_SPREAD_CONTAINED_SHARE,
      minSystemsForLoss: GAME_BALANCE.OVERMIND_SPREAD_MIN_SYSTEMS,
    };

    const prevStatus = galaxy.overmindArc.status;
    const { state, captured } = advanceOvermind(
      galaxy.overmindArc,
      {
        id: galaxy.id,
        systems: galaxy.systems,
        overmindSystems: galaxy.overmindSystems,
        overmindCoreSystemId: galaxy.overmindCoreSystemId,
      },
      day,
      config,
    );

    for (const id of captured) {
      galaxy.addOvermindSystem(id);
      const sys = galaxy.systems.find((s) => s.id === id);
      galaxy.addNewsEvent({
        type: "OVERMIND_EXPANSION",
        systemId: id,
        day,
        description: `OVERMIND поглотил систему ${sys?.name ?? id}`,
      });
      logger.info(`OVERMIND arc captured: ${sys?.name ?? id} (${id})`);
    }

    galaxy.overmindArc = state;
    if (state.status !== prevStatus) {
      logger.info(`OVERMIND arc status: ${prevStatus} → ${state.status}`);
    }
    return peakPower;
  }

  private emitEscalationNotices(galaxy: Galaxy, peakPower: number): void {
    const total = galaxy.systems.length;
    const fresh = this.escalationNotices.observe(galaxy.id, {
      peakPower,
      overmindShare: total === 0 ? 0 : galaxy.overmindSystems.length / total,
      arcStatus: galaxy.overmindArc.status,
    });
    if (fresh.length === 0) return;
    const systemId =
      this.deps.getPlayer()?.currentSystemId ?? galaxy.systems[0]?.id ?? "";
    for (const stage of fresh) {
      galaxy.addNewsEvent({
        type: "CAMPAIGN_ESCALATION",
        systemId,
        day: galaxy.gameDays,
        description: t(`news.escalation.${stage}`),
      });
      logger.info(`Campaign escalation notice: ${stage}`);
    }
  }

  private dispatchOutcomeOverlay(galaxy: Galaxy): void {
    if (this.deps.isOutcomeShown()) return;
    if (galaxy.overmindArc.status === "won") {
      logger.info("OVERMIND arc won — showing victory screen");
      this.deps.showGameOutcomeScreen(true);
    } else if (galaxy.overmindArc.status === "lost") {
      logger.warn("OVERMIND arc lost — galaxy consumed, showing defeat screen");
      this.deps.showGameOutcomeScreen(false);
    }
  }
}
