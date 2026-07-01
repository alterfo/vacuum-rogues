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
import { BankBus } from "@/systems/banking/bus";
import { SeededRNG } from "@/utils/seededRNG";
import { ResourceType } from "@/types";
import { GAME_BALANCE } from "@/config/balance";
import { logger } from "@/utils/logger";

/**
 * Everything {@link DayTickController.run} needs from `GameEngine` — pure state
 * accessors + the handful of steps that must stay engine-owned (the win/loss
 * outcome guards and quest-expiry callback are Task 10's `EndgameController`
 * territory; this controller calls back into them rather than duplicating them).
 */
export interface DayTickControllerDeps {
  getGalaxy: () => Galaxy | null;
  getPlayer: () => Player | null;
  getPlayerLoadout: () => ShipLoadout | null;
  npcSimulator: NpcSimulator;
  galaxySimulator: GalaxySimulator;
  tradeSystem: TradeSystem;
  bankBus: BankBus;
  checkWinCondition: () => boolean;
  checkExpiredQuests: () => void;
  isOutcomeShown: () => boolean;
  showGameOutcomeScreen: (win: boolean) => void;
  isWinScreenShown: () => boolean;
  markWinScreenShown: () => void;
  transitionToWinScreen: () => void;
  invalidateInfoRegistryCache: () => void;
}

/**
 * Orchestrates one galaxy-day tick (extracted from `GameEngine.advanceGalaxyDay`,
 * Phase 2 Task 9). Each step is a 1:1 move of the original inline block; the
 * ordering (drift → rumor scan → ownership tick → Overmind arc → outcome →
 * quest expiry → EOD banking → win condition) is preserved exactly, since
 * several steps depend on the state the previous one leaves behind (e.g. rumor
 * scan must run after today's market drift).
 */
export class DayTickController {
  constructor(private readonly deps: DayTickControllerDeps) {}

  run(): void {
    const galaxy = this.deps.getGalaxy();
    if (!galaxy) return;

    galaxy.simulateDay();
    const rng = new SeededRNG(`${galaxy.id}_day_${galaxy.gameDays}`);

    const npcEvents = this.deps.npcSimulator.tick(
      galaxy,
      rng,
      this.deps.getPlayer()?.currentSystemId,
    );
    for (const event of npcEvents) {
      galaxy.addNewsEvent(event);
    }

    // Global galaxy events: PIRATE_SURGE, TRADE_BOOM, PLAGUE, DISCOVERY (Task 24).
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
    this.advanceOvermindArc(galaxy);
    this.dispatchOutcomeOverlay(galaxy);

    this.deps.invalidateInfoRegistryCache(); // world advanced → registry is stale

    this.deps.checkExpiredQuests();

    // End-of-day banking batch (АБС): accrue interest on savings/loan accounts,
    // cut statements, and roll the bank's business date. Dispatched on the
    // universal bus so the core books balanced accrual entries and consumers
    // (the HUD, the Bank UI) react via events. Runs after today's fines so they
    // land on the day's statement; idempotent per business date.
    this.deps.bankBus.dispatch({ kind: "RunEndOfDay" });

    this.dispatchWinCondition();
  }

  // Advance market drift on every planet (Task 1: daily supply/demand drift).
  // Emit a MARKET_SHIFT news event for notable price swings (~10% chance/day per system).
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

  // Trade-route rumors (living-trade-economy): after today's drift settles,
  // re-scan the galaxy's neutral spreads and advance the rumor lifecycle so
  // TRADE_OPPORTUNITY rumors open/refresh/expire against current prices.
  // Ordering matters — drift → scan → rumor update — so rumors reflect the
  // prices that were just rolled. Skip galaxies with fewer than two
  // market-bearing systems: no cross-system route can exist there, so there is
  // nothing to scan (and the guard keeps degenerate maps from crashing).
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
          // One route per ResourceType at most — keep them all visible so a
          // closing rumor stays in the re-score set until it truly expires.
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

  // Droid repair: if player has a droid installed, heal hull by repairRate HP/day.
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

  // Self-balancing ownership tick: replaces the old unidirectional expansion.
  // Runs every OVERMIND_BALANCE_INTERVAL days; pure function, no side effects
  // beyond the returned ownership sets.
  private advanceOwnershipEquilibrium(galaxy: Galaxy, rng: SeededRNG): void {
    if (galaxy.gameDays % GAME_BALANCE.OVERMIND_BALANCE_INTERVAL !== 0) return;

    const balanceCfg = {
      pCapture: GAME_BALANCE.OVERMIND_CAPTURE_PROB,
      pRecaptureBase: GAME_BALANCE.OVERMIND_RECAPTURE_BASE_PROB,
      feedbackStrength: GAME_BALANCE.OVERMIND_FEEDBACK_STRENGTH,
      // The endgame-arc spread (`advanceOvermindArc`, run every EOD) is the sole
      // authority on the Overmind front whenever the Overmind holds territory:
      // the equilibrium then only churns PIRATES. This stops the equilibrium's
      // ~25% feedback ceiling from (a) capping the arc below its loss line —
      // making the "galaxy consumed" defeat unreachable — and (b) liberating the
      // Overmind core, which would fire a spurious "core broken" victory.
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

    // Emit news for newly captured systems.
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

    // Floor: the balance tick maintains a minimum cosmic overmind presence
    // (OVERMIND_FLOOR_MIN) ONLY while the endgame arc has never engaged
    // (peakThreat === 0 — i.e. before the first arc spread tick). Once the arc
    // owns the front (peakThreat > 0), the arc is the sole authority on the
    // Overmind front (the same rationale as `freezeOvermind` above), so the
    // legacy floor must NOT resurrect a front the player has pushed below it —
    // otherwise it would (a) silently undo the player's containment progress on
    // every 5-day churn and (b) snatch the eradication win by reseeding before
    // the arc sees the empty front. Check overmindSystems only — pirates
    // filling the hostile quota must not mask an overmind wipe-out.
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

  /**
   * Drive the Overmind endgame-arc spread machine one EOD tick.
   *
   * Pure decision (`advanceOvermind`) over a read-only galaxy view → newly
   * captured frontier ids + the next arc state. The captures are applied to the
   * live galaxy (`addOvermindSystem`, which the landing gate / garrisons / threat
   * indicator all derive from) and announced as OVERMIND_EXPANSION news; the arc
   * clock/threat/status snapshot is persisted on `galaxy.overmindArc`.
   *
   * Idempotent per business date: the machine's `lastSpreadDay` cadence blocks a
   * second capture on the same day, status re-derivation is a pure read, and
   * `peakThreat`/`dayZero` are monotone — so a re-run for the same day is a no-op.
   */
  private advanceOvermindArc(galaxy: Galaxy): void {
    const day = galaxy.gameDays;

    const config: OvermindSpreadConfig = {
      graceDays: GAME_BALANCE.OVERMIND_SPREAD_GRACE_DAYS,
      spreadIntervalDays: GAME_BALANCE.OVERMIND_SPREAD_INTERVAL_DAYS,
      capturesPerTick: GAME_BALANCE.OVERMIND_SPREAD_CAPTURES_PER_TICK,
      lossShare: GAME_BALANCE.OVERMIND_SPREAD_LOSS_SHARE,
      containedShare: GAME_BALANCE.OVERMIND_SPREAD_CONTAINED_SHARE,
      minSystemsForLoss: GAME_BALANCE.OVERMIND_SPREAD_MIN_SYSTEMS,
    };

    const prevStatus = galaxy.overmindArc.status;
    // The real Galaxy/StarSystem structurally satisfy the spread machine's
    // minimal read-only view (id + connections + the overmind sets).
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
  }

  // Endgame outcome: the arc status machine is the single source of truth.
  // `won` (core broken / Overmind eradicated) shows the victory screen; `lost`
  // (front past the loss line, past grace, full-size galaxy) shows the defeat
  // screen. The overlay is drawn over the current scene — NOT a terminal scene
  // transition — so it never clobbers the autosave checkpoint the way an
  // autosaving GAME_OVER scene would. Gated on the outcome-shown guard (and the
  // overlay is itself idempotent) so the sticky won/lost status re-running each
  // EOD — and the in-flight core-kill win path — only shows the screen once.
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

  // Win condition: rank >= VETERAN (2) + 3+ factions with rep > 50. Suppressed
  // once an Overmind-arc outcome overlay has shown this run, so a rank-WIN_SCREEN
  // scene transition can't clobber the arc's win/loss overlay (notably showing a
  // victory over an arc-loss) if both fire the same EOD.
  private dispatchWinCondition(): void {
    if (
      this.deps.checkWinCondition() &&
      !this.deps.isWinScreenShown() &&
      !this.deps.isOutcomeShown()
    ) {
      this.deps.markWinScreenShown();
      this.deps.transitionToWinScreen();
    }
  }
}
