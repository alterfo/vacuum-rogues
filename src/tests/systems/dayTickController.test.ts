import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  DayTickController,
  type DayTickControllerDeps,
} from "@/systems/DayTickController";
import { Galaxy } from "@/domain/Galaxy";
import { StarSystem } from "@/domain/StarSystem";
import { Planet } from "@/domain/Planet";
import { Market } from "@/domain/Market";
import { WarpPath } from "@/domain/WarpPath";
import { Overmind } from "@/domain/Overmind";
import { StarType, ResourceType, PlanetType } from "@/types";
import { Faction } from "@/types/faction";
import { NpcSimulator } from "@/systems/npc/NpcSimulator";
import { GalaxySimulator } from "@/systems/GalaxySimulator";
import { TradeSystem } from "@/systems/TradeSystem";
import { BankBus } from "@/systems/banking/bus";
import { BankingService } from "@/systems/banking/BankingService";

function makePlanet(id: string, priceMultiplier: number): Planet {
  const market = new Market([ResourceType.METALS], [1], [1]);
  market.priceMultipliers = [priceMultiplier];
  return new Planet(
    id,
    `Planet ${id}`,
    PlanetType.TERRESTRIAL,
    600,
    market,
    [],
    [],
    true,
    0,
    1_000_000,
  );
}

function makeSystem(id: string, planets: Planet[]): StarSystem {
  return new StarSystem(
    id,
    `System ${id}`,
    { q: 0, r: 0 },
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

/** Minimal two-system galaxy with a seeded cross-system price spread. */
function makeGalaxy(): Galaxy {
  const cheap = makeSystem("S1", [makePlanet("S1p", 0.4)]);
  const dear = makeSystem("S2", [makePlanet("S2p", 2.5)]);
  connect(cheap, dear);
  return new Galaxy("g_daytick", [cheap, dear], new Overmind(), [], []);
}

function makeDeps(
  galaxy: Galaxy,
  overrides: Partial<DayTickControllerDeps> = {},
): DayTickControllerDeps {
  const bankBus = new BankBus();
  new BankingService(bankBus); // registers the RunEndOfDay handler on the bus
  return {
    getGalaxy: () => galaxy,
    getPlayer: () => null,
    getPlayerLoadout: () => null,
    npcSimulator: new NpcSimulator(),
    galaxySimulator: new GalaxySimulator(),
    tradeSystem: new TradeSystem(),
    bankBus,
    checkWinCondition: () => false,
    checkExpiredQuests: vi.fn(),
    isOutcomeShown: () => false,
    showGameOutcomeScreen: vi.fn(),
    isWinScreenShown: () => false,
    markWinScreenShown: vi.fn(),
    transitionToWinScreen: vi.fn(),
    invalidateInfoRegistryCache: vi.fn(),
    ...overrides,
  };
}

describe("DayTickController", () => {
  let galaxy: Galaxy;

  beforeEach(() => {
    galaxy = makeGalaxy();
  });

  it("no-ops when the galaxy is absent", () => {
    const deps = makeDeps(galaxy, { getGalaxy: () => null });
    const controller = new DayTickController(deps);
    expect(() => controller.run()).not.toThrow();
    expect(deps.checkExpiredQuests).not.toHaveBeenCalled();
  });

  it("advances the day counter and runs the drift → rumor pipeline in order", () => {
    const deps = makeDeps(galaxy);
    const controller = new DayTickController(deps);
    const dayBefore = galaxy.gameDays;

    controller.run();

    expect(galaxy.gameDays).toBe(dayBefore + 1);
    const tradeNews = galaxy.newsFeed.filter(
      (n) => n.type === "TRADE_OPPORTUNITY",
    );
    expect(tradeNews.length).toBeGreaterThanOrEqual(1);
    const metalsRumor = galaxy.activeRumors.find(
      (r) => r.resource === ResourceType.METALS,
    );
    expect(metalsRumor).toBeDefined();
    expect(metalsRumor!.fromSystemId).toBe("S1");
    expect(metalsRumor!.toSystemId).toBe("S2");
  });

  it("dispatches the end-of-day banking batch and quest-expiry check", () => {
    const deps = makeDeps(galaxy);
    const dispatchSpy = vi.spyOn(deps.bankBus, "dispatch");
    const controller = new DayTickController(deps);

    controller.run();

    expect(dispatchSpy).toHaveBeenCalledWith({ kind: "RunEndOfDay" });
    expect(deps.checkExpiredQuests).toHaveBeenCalledTimes(1);
    expect(deps.invalidateInfoRegistryCache).toHaveBeenCalledTimes(1);
  });

  it("shows the victory overlay once when the arc status is won, and stays silent once outcome is shown", () => {
    galaxy.overmindArc.status = "won";
    const deps = makeDeps(galaxy);
    new DayTickController(deps).run();
    expect(deps.showGameOutcomeScreen).toHaveBeenCalledWith(true);

    // Once the outcome guard reports shown, a second run must not re-dispatch.
    const deps2 = makeDeps(galaxy, { isOutcomeShown: () => true });
    new DayTickController(deps2).run();
    expect(deps2.showGameOutcomeScreen).not.toHaveBeenCalled();
  });

  it("shows the defeat overlay when the arc status is lost", () => {
    galaxy.overmindArc.status = "lost";
    const deps = makeDeps(galaxy);
    new DayTickController(deps).run();
    expect(deps.showGameOutcomeScreen).toHaveBeenCalledWith(false);
  });

  it("triggers the win-condition scene transition when eligible and no outcome overlay has fired", () => {
    const deps = makeDeps(galaxy, { checkWinCondition: () => true });
    new DayTickController(deps).run();
    expect(deps.markWinScreenShown).toHaveBeenCalledTimes(1);
    expect(deps.transitionToWinScreen).toHaveBeenCalledTimes(1);
  });

  it("suppresses the win-condition transition once an outcome overlay has already shown", () => {
    const deps = makeDeps(galaxy, {
      checkWinCondition: () => true,
      isOutcomeShown: () => true,
    });
    new DayTickController(deps).run();
    expect(deps.markWinScreenShown).not.toHaveBeenCalled();
    expect(deps.transitionToWinScreen).not.toHaveBeenCalled();
  });

  it("suppresses the win-condition transition once the win screen has already shown", () => {
    const deps = makeDeps(galaxy, {
      checkWinCondition: () => true,
      isWinScreenShown: () => true,
    });
    new DayTickController(deps).run();
    expect(deps.markWinScreenShown).not.toHaveBeenCalled();
    expect(deps.transitionToWinScreen).not.toHaveBeenCalled();
  });

  it("does not crash for a galaxy with fewer than two market-bearing systems", () => {
    const only = makeSystem("S1", [makePlanet("S1p", 0.4)]);
    const barren = makeSystem("S2", []);
    connect(only, barren);
    const single = new Galaxy(
      "g_single",
      [only, barren],
      new Overmind(),
      [],
      [],
    );
    const deps = makeDeps(single);
    expect(() => new DayTickController(deps).run()).not.toThrow();
    expect(
      single.newsFeed.filter((n) => n.type === "TRADE_OPPORTUNITY"),
    ).toHaveLength(0);
  });
});
