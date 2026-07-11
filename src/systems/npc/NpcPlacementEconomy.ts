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
import type { NpcBrain } from "./NpcBrain";
import type { RouteRumor } from "@/domain/RouteRumor";
import { applyMarketTradeImpact } from "@/domain/Market";
import { GAME_BALANCE } from "@/config/balance";
import {
  FACTIONS,
  ROLES,
  FACTION_NAME,
  ROLE_NAME,
  ROLE_STATS,
  ROLE_LOADOUT,
} from "./npcRoleCatalog";
import { travelDays } from "./npcTravel";
import { npcOrbitStep, advanceNpcOrbit } from "./npcPlacement";
import type { DwellTracker } from "./NpcGarrisonCombat";
import { logger } from "@/utils/logger";

/** Average number of NPC ships spawned per star system. */
const NPCS_PER_SYSTEM = 4;

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

/** Minimum game-days a ship dwells in a system after arriving before the
 *  per-day DEPART_CHANCE can fire. Prevents the "fly in and immediately out"
 *  visual seen when a 15% roll happens to fire on day 1 post-arrival. */
const MIN_DWELL_DAYS = 3;

/**
 * Track 3 (World Economy) — NPC placement (initial spawn, replenishment) and
 * the wandering-population trade economy (cargo picks, market impact, route
 * rumors). Owns the transient (unpersisted) arrival-dwell countdown and the
 * per-trader remembered rumor destination planet.
 */
export class NpcPlacementEconomy implements DwellTracker {
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

  /** Reset a freshly spawned ship's no-depart dwell countdown. */
  mark(id: string): void {
    this.arrivalDwellCountdown.set(id, MIN_DWELL_DAYS);
  }

  /** Clear a despawned ship's dwell-countdown entry (no stale keys). */
  clear(id: string): void {
    this.arrivalDwellCountdown.delete(id);
  }

  /**
   * Consume one day of a ship's no-depart dwell window: returns true (and
   * decrements) while the ship is still dwelling, false once it has elapsed.
   */
  consumeDwell(id: string): boolean {
    const left = this.arrivalDwellCountdown.get(id) ?? 0;
    if (left > 0) {
      this.arrivalDwellCountdown.set(id, left - 1);
      return true;
    }
    return false;
  }

  /** Consume (get-then-clear) a rumor-diverted trader's remembered dear
   *  destination planet, if any. */
  takeRumorDestPlanet(id: string): string | undefined {
    const v = this.rumorDestPlanet.get(id);
    this.rumorDestPlanet.delete(id);
    return v;
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
    this.mark(id);
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
    this.mark(id);
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
  simulateTraderTrade(
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

  /** Pick a random system other than the NPC's current one as a quest destination. */
  pickQuestTarget(
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
  advanceTrackedPositions(galaxy: Galaxy): void {
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
   * Remove a specific NPC from the galaxy (e.g. destroyed by the player in
   * a CombatScene encounter). No-op if the id is not found.
   */
  removeNpc(galaxy: Galaxy, npcId: string): void {
    const idx = galaxy.npcShips.findIndex((n) => n.id === npcId);
    if (idx >= 0) galaxy.npcShips.splice(idx, 1);
  }

  /**
   * Remove destroyed NPCs and respawn up to the target population.
   *
   * `onDead` and `isExcludedFromTarget` are narrow callbacks (wired by
   * `NpcSimulator`) onto Track 2's garrison/capture-fleet bookkeeping: a dead
   * ship's holds must be released, and standing-garrison/capture-fleet ships
   * are excluded from the wandering-population replenishment target (managed
   * separately by `ensureGarrison`/`assembleCaptureFleet`).
   */
  pruneAndReplenish(
    galaxy: Galaxy,
    rng: SeededRNG,
    onDead: (npcId: string) => void,
    isExcludedFromTarget: (npcId: string) => boolean,
  ): void {
    for (let i = galaxy.npcShips.length - 1; i >= 0; i--) {
      if (galaxy.npcShips[i].state === NpcState.DEAD) {
        const deadId = galaxy.npcShips[i].id;
        onDead(deadId);
        this.rumorDestPlanet.delete(deadId);
        galaxy.npcShips.splice(i, 1);
      }
    }

    const target = Math.round(galaxy.systems.length * NPCS_PER_SYSTEM);
    let regular = galaxy.npcShips.filter(
      (n) => !isExcludedFromTarget(n.id),
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
  arrive(npc: NpcShip): void {
    if (npc.destinationSystemId) {
      npc.currentSystemId = npc.destinationSystemId;
    }
    npc.destinationSystemId = null;
    npc.daysToArrival = 0;
    npc.state = this.arrivalState(npc.goal?.kind);
    npc.goal = null;
    this.mark(npc.id);
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
    npc.daysToArrival = travelDays(
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
  departToNewGoal(
    npc: NpcShip,
    galaxy: Galaxy,
    rng: SeededRNG,
    brain: NpcBrain,
  ): void {
    // TRADERs may divert onto a profitable route rumor before falling back to
    // the brain's random goal. Pirates/garrisons/rangers ignore rumors.
    if (npc.role === NpcRole.TRADER && this.pickTraderGoal(npc, galaxy, rng)) {
      return;
    }

    const goal = brain.decideGoal(npc, galaxy, rng);
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
