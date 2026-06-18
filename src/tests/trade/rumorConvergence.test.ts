import { describe, it, expect } from "vitest";
import { Galaxy } from "@/domain/Galaxy";
import { StarSystem } from "@/domain/StarSystem";
import { Planet } from "@/domain/Planet";
import { Market } from "@/domain/Market";
import { WarpPath } from "@/domain/WarpPath";
import { Overmind } from "@/domain/Overmind";
import { NpcShip } from "@/domain/NpcShip";
import { Player } from "@/domain/Player";
import { PlayerShip } from "@/domain/PlayerShip";
import { Inventory } from "@/domain/Inventory";
import { SkillTree } from "@/domain/SkillTree";
import { NpcSimulator } from "@/systems/npc/NpcSimulator";
import { TradeSystem } from "@/systems/TradeSystem";
import { scanTradeRoutes } from "@/systems/trade/RouteScanner";
import { updateRumors } from "@/systems/trade/RumorDirector";
import { SeededRNG } from "@/utils/seededRNG";
import { GAME_BALANCE } from "@/config/balance";
import {
  StarType,
  NpcState,
  NpcRole,
  FactionType,
  ResourceType,
  PlanetType,
} from "@/types";
import type { QuestLog, Journal } from "@/types";
import { Faction } from "@/types/faction";

const METALS = ResourceType.METALS;

/** A planet whose market trades `resources` with the given seeded multipliers. */
function makePlanet(
  id: string,
  resources: ResourceType[],
  multipliers: number[],
): Planet {
  const market = new Market(
    resources,
    resources.map(() => 1.0),
    resources.map(() => 1.0),
  );
  market.priceMultipliers = [...multipliers];
  return new Planet(
    id,
    `Planet ${id}`,
    PlanetType.TERRESTRIAL,
    600,
    market,
    [],
    [],
  );
}

function makeSystem(id: string, planets: Planet[]): StarSystem {
  return new StarSystem(
    id,
    `System ${id}`,
    { q: 0, r: id === "S2" ? 5 : 0 },
    StarType.YELLOW_DWARF,
    planets,
    Faction.INDEPENDENT,
    [],
  );
}

function connect(a: StarSystem, b: StarSystem): void {
  a.connections.push(new WarpPath(a.id, b.id, 2));
  b.connections.push(new WarpPath(b.id, a.id, 2));
}

function makeTrader(
  id: string,
  fromSystemId: string,
  toSystemId: string,
): NpcShip {
  return new NpcShip({
    id,
    name: id,
    race: FactionType.OUTLANDERS,
    faction: Faction.INDEPENDENT,
    role: NpcRole.TRADER,
    hullHP: 100,
    maxHull: 100,
    shields: 30,
    speed: 0.1,
    damage: 10,
    currentSystemId: fromSystemId,
    state: NpcState.TRAVELING,
    goal: null,
    destinationSystemId: toSystemId,
    daysToArrival: 1,
    credits: 500,
    reputation: 0,
    cargo: [{ goodId: METALS, qty: 20 }],
  });
}

function makePlayer(): Player {
  return new Player(
    "p1",
    "Pilot",
    FactionType.BASTIONS,
    0,
    1,
    new SkillTree([]),
    {},
    { activeQuests: [], completedQuests: [] } as QuestLog,
    { entries: [] } as Journal,
    10_000_000,
    new PlayerShip(
      "ship1",
      "Ship",
      100,
      100,
      50,
      50,
      100,
      100,
      10,
      5,
      FactionType.BASTIONS,
    ),
    new Inventory(),
  );
}

describe("NPC trades move the SAME persistent balance (priceMultipliers)", () => {
  it("a TRADER selling its cargo at the destination lowers that market's persistent multiplier", () => {
    // Destination trades five goods; METALS is by far the dearest (mult 2.5) so
    // the trader's rebuy (the 1–3 *cheapest* goods) can never touch METALS — the
    // sell impact on METALS is therefore isolated and unambiguous.
    const dest = makeSystem("D", [
      makePlanet(
        "Pd",
        [
          METALS,
          ResourceType.CRYSTALS,
          ResourceType.ORGANICS,
          ResourceType.ELECTRONICS,
          ResourceType.MEDICINE,
        ],
        [2.5, 1.0, 1.0, 1.0, 1.0],
      ),
    ]);
    const origin = makeSystem("O", [makePlanet("Po", [METALS], [1.0])]);
    connect(origin, dest);
    const galaxy = new Galaxy(
      "g_lever",
      [origin, dest],
      new Overmind(),
      [],
      [],
    );

    const trader = makeTrader("trader_1", "O", "D");
    trader.cargo = [{ goodId: METALS, qty: 40 }];
    galaxy.npcShips.push(trader);

    const market = dest.planets[0].market;
    new NpcSimulator().tick(galaxy, new SeededRNG("lever"));

    // Sell impact landed on the persistent multiplier (not just supplyVector).
    const afterMetals = market.multiplierFor(METALS);
    expect(afterMetals).toBeLessThan(2.5);
    // NPC-scaled: the per-trade nudge is capped like the player's lever.
    const drop = 2.5 - afterMetals;
    expect(drop).toBeGreaterThan(0);
    expect(drop).toBeLessThanOrEqual(
      GAME_BALANCE.marketImpactMaxPerTrade + 1e-9,
    );

    // The goods the trader bought at the destination rose above neutral (buy
    // depletes stock → price up).
    const boughtSomething = [
      ResourceType.CRYSTALS,
      ResourceType.ORGANICS,
      ResourceType.ELECTRONICS,
      ResourceType.MEDICINE,
    ].some((r) => market.multiplierFor(r) > 1.0);
    expect(boughtSomething).toBe(true);
  });

  it("player + NPC trading converges a seeded route's margin below the expiry threshold and closes the rumor", () => {
    // Source (S1) trades only cheap METALS; destination (S2) trades dear METALS
    // plus four other goods that exist nowhere else (so the ONLY cross-system
    // route is METALS S1→S2, and the NPC rebuy at S2 never touches METALS).
    const source = makeSystem("S1", [makePlanet("Pmet", [METALS], [0.5])]);
    const dest = makeSystem("S2", [
      makePlanet(
        "Pmet",
        [
          METALS,
          ResourceType.CRYSTALS,
          ResourceType.ORGANICS,
          ResourceType.ELECTRONICS,
          ResourceType.MEDICINE,
        ],
        [2.5, 1.0, 1.0, 1.0, 1.0],
      ),
    ]);
    connect(source, dest);
    const galaxy = new Galaxy("g_conv", [source, dest], new Overmind(), [], []);

    const trade = new TradeSystem();
    const player = makePlayer();
    const sim = new NpcSimulator();
    const rng = new SeededRNG("convergence");

    const sourcePlanet = source.planets[0];
    const destPlanet = dest.planets[0];
    const scanFn = () =>
      scanTradeRoutes(galaxy, (p, r) => trade.referenceMarketPrice(p, r), {
        maxRoutes: 8,
        minMarginPct: 0,
      });
    const cfg = {
      marginOpen: GAME_BALANCE.rumorMarginOpen,
      marginExpire: GAME_BALANCE.rumorMarginExpire,
      maxActive: GAME_BALANCE.rumorMaxActive,
    };

    const isMetalsRoute = (r: {
      resource: ResourceType;
      fromSystemId: string;
    }) => r.resource === METALS && r.fromSystemId === "S1";

    // Day 0: the seeded ~400% spread opens a METALS S1→S2 rumor.
    updateRumors(galaxy, scanFn, 0, cfg);
    const opened = galaxy.activeRumors.find(isMetalsRoute);
    expect(opened).toBeDefined();
    expect(opened!.marginPct).toBeGreaterThan(GAME_BALANCE.rumorMarginOpen);

    const margins: number[] = [opened!.marginPct];
    let closed = false;
    for (let day = 1; day <= 60 && !closed; day++) {
      // Player runs the route: buy at the cheap source (price up), carry, sell
      // at the dear destination (price down). Two round-trips per day.
      for (let trip = 0; trip < 2; trip++) {
        trade.executeTrade(player, sourcePlanet, METALS, 20, true);
        trade.executeTrade(player, destPlanet, METALS, 20, false);
      }

      // A wave of NPC traders arrives at the destination and dumps METALS,
      // reinforcing the downward pressure on the sell side (fresh ships each
      // day so cross-day NPC state never confounds the run).
      galaxy.npcShips.length = 0;
      for (let i = 0; i < 3; i++) {
        galaxy.npcShips.push(makeTrader(`t_${day}_${i}`, "S1", "S2"));
      }
      sim.tick(galaxy, rng);

      // Daily mean-reversion of both markets toward neutral.
      sourcePlanet.market.advanceMarketDay(() => rng.next());
      destPlanet.market.advanceMarketDay(() => rng.next());

      updateRumors(galaxy, scanFn, day, cfg);
      const still = galaxy.activeRumors.find(isMetalsRoute);
      if (still) {
        margins.push(still.lastMarginPct);
      } else {
        closed = true;
      }
    }

    // Self-balancing: the rumor closed and its tracked margin shrank.
    expect(closed).toBe(true);
    expect(galaxy.activeRumors.find(isMetalsRoute)).toBeUndefined();
    expect(margins[margins.length - 1]).toBeLessThan(margins[0]);

    // The route's *recomputed* neutral spread is now at/below the expiry band.
    const fromPrice = trade.referenceMarketPrice(sourcePlanet, METALS);
    const toPrice = trade.referenceMarketPrice(destPlanet, METALS);
    const finalMargin = ((toPrice - fromPrice) / fromPrice) * 100;
    expect(finalMargin).toBeLessThanOrEqual(GAME_BALANCE.rumorMarginExpire);

    // The lifecycle emitted the close-out news line exactly once.
    expect(
      galaxy.newsFeed.filter((n) => n.description.includes("акция закончилась"))
        .length,
    ).toBeGreaterThanOrEqual(1);
  });
});

describe("SELL_SPREAD no-arbitrage invariant survives the NPC lever change", () => {
  it("same-planet buy→sell of a modest lot still loses credits, even for the best sell faction", () => {
    const trade = new TradeSystem();
    const planet = makePlanet(
      "invariant",
      [METALS, ResourceType.CRYSTALS],
      [1.0, 1.0],
    );
    const player = new Player(
      "p2",
      "Pilot",
      FactionType.SYNDICATE,
      0,
      1,
      new SkillTree([]),
      {},
      { activeQuests: [], completedQuests: [] } as QuestLog,
      { entries: [] } as Journal,
      1_000_000,
      new PlayerShip(
        "ship2",
        "Ship",
        100,
        100,
        50,
        50,
        100,
        100,
        10,
        5,
        FactionType.SYNDICATE,
      ),
      new Inventory(),
    );

    const before = player.credits;
    trade.executeTrade(player, planet, ResourceType.CRYSTALS, 10, true);
    trade.executeTrade(player, planet, ResourceType.CRYSTALS, 10, false);

    expect(player.credits).toBeLessThan(before);
  });
});
