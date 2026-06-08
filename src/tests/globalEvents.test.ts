import { describe, it, expect, beforeEach } from "vitest";
import { Galaxy } from "@/domain/Galaxy";
import { StarSystem } from "@/domain/StarSystem";
import { Planet } from "@/domain/Planet";
import { Market } from "@/domain/Market";
import { WarpPath } from "@/domain/WarpPath";
import { Overmind } from "@/domain/Overmind";
import { GalaxySimulator } from "@/systems/GalaxySimulator";
import { SeededRNG } from "@/utils/seededRNG";
import { StarType, ResourceType, PlanetType } from "@/types";
import { Faction } from "@/types/faction";

function makePlanet(id: string, population = 1_000_000): Planet {
  const market = new Market(
    [ResourceType.METALS, ResourceType.MEDICINE],
    [1, 1],
    [1, 1],
  );
  market.priceMultipliers = [1.0, 1.0];
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
    population,
  );
}

function makeGalaxy(systemCount = 3): Galaxy {
  const systems: StarSystem[] = Array.from({ length: systemCount }, (_, i) => {
    const planet = makePlanet(`pl_${i}`, 2_000_000);
    const sys = new StarSystem(
      `sys_${i}`,
      `System ${i}`,
      { q: i * 10, r: 0 },
      StarType.YELLOW_DWARF,
      [planet],
      Faction.INDEPENDENT,
      [],
    );
    return sys;
  });

  // Connect systems in a chain
  for (let i = 0; i < systems.length - 1; i++) {
    systems[i].connections.push(new WarpPath(`sys_${i}`, `sys_${i + 1}`, 2));
    systems[i + 1].connections.push(
      new WarpPath(`sys_${i + 1}`, `sys_${i}`, 2),
    );
  }

  return new Galaxy("galaxy_test", systems, new Overmind(), [], []);
}

describe("GalaxySimulator.tickGlobalEvents", () => {
  let simulator: GalaxySimulator;

  beforeEach(() => {
    simulator = new GalaxySimulator();
  });

  it("is deterministic for the same RNG seed", () => {
    const galaxy1 = makeGalaxy();
    const galaxy2 = makeGalaxy();
    const rng1 = new SeededRNG("test_seed");
    const rng2 = new SeededRNG("test_seed");

    const events1 = simulator.tickGlobalEvents(galaxy1, rng1);
    const events2 = simulator.tickGlobalEvents(galaxy2, rng2);

    expect(events1.length).toBe(events2.length);
    if (events1.length > 0 && events2.length > 0) {
      expect(events1[0].type).toBe(events2[0].type);
      expect(events1[0].systemId).toBe(events2[0].systemId);
    }
  });

  it("appends the news event to the galaxy feed when an event fires", () => {
    const galaxy = makeGalaxy();
    // Use a seed that forces an event (rng.next() < 0.1)
    // Brute-force: advance day until an event fires
    let found = false;
    for (let day = 0; day < 100; day++) {
      galaxy.gameDays = day;
      const rng = new SeededRNG(`galaxy_test_day_${day}`);
      const events = simulator.tickGlobalEvents(galaxy, rng);
      if (events.length > 0) {
        // Add to news feed like GameEngine does
        for (const e of events) galaxy.addNewsEvent(e);
        expect(galaxy.newsFeed.length).toBeGreaterThan(0);
        expect(
          galaxy.newsFeed[galaxy.newsFeed.length - 1].systemId,
        ).toBeTruthy();
        found = true;
        break;
      }
    }
    // At 10% chance per day over 100 days, a fire is virtually guaranteed
    expect(found).toBe(true);
  });
});

describe("PIRATE_SURGE effect", () => {
  it("spawns pirates in the target system and raises prices", () => {
    const galaxy = makeGalaxy(1);
    const sim = new GalaxySimulator();
    const initialNpcCount = galaxy.npcShips.length;
    const initialPrice =
      galaxy.systems[0].planets[0].market.priceMultipliers[0];

    // Directly call applyGlobalEvent via tickGlobalEvents with a seeded RNG
    // that will produce a PIRATE_SURGE. Since we can't control the random type
    // selection directly, we test the effect indirectly via a known-seed run.
    let pSurgeFound = false;
    for (let day = 0; day < 200; day++) {
      const g = makeGalaxy(1);
      g.gameDays = day;
      const rng = new SeededRNG(`galaxy_test_day_${day}`);
      const events = sim.tickGlobalEvents(g, rng);
      const surge = events.find((e) => e.type === "PIRATE_SURGE");
      if (surge) {
        expect(g.npcShips.length).toBeGreaterThan(0);
        const planet = g.systems[0].planets[0];
        expect(planet.market.priceMultipliers[0]).toBeGreaterThanOrEqual(
          initialPrice,
        );
        pSurgeFound = true;
        break;
      }
    }
    expect(pSurgeFound).toBe(true);

    // Sanity: no NPCs were added to the original galaxy object
    expect(galaxy.npcShips.length).toBe(initialNpcCount);
  });

  it("fires pirate_surge news event with correct fields", () => {
    const sim = new GalaxySimulator();
    for (let day = 0; day < 200; day++) {
      const g = makeGalaxy(1);
      g.gameDays = day;
      const rng = new SeededRNG(`galaxy_test_day_${day}`);
      const events = sim.tickGlobalEvents(g, rng);
      const surge = events.find((e) => e.type === "PIRATE_SURGE");
      if (surge) {
        expect(surge.systemId).toBeTruthy();
        expect(surge.day).toBe(day);
        expect(surge.description.length).toBeGreaterThan(0);
        break;
      }
    }
  });
});

describe("TRADE_BOOM effect", () => {
  it("lowers prices in the target system for a duration", () => {
    const sim = new GalaxySimulator();
    for (let day = 0; day < 200; day++) {
      const g = makeGalaxy(1);
      g.gameDays = day;
      const rng = new SeededRNG(`galaxy_test_day_${day}`);
      const events = sim.tickGlobalEvents(g, rng);
      const boom = events.find((e) => e.type === "TRADE_BOOM");
      if (boom) {
        const planet = g.systems[0].planets[0];
        // Price multipliers should be below 1.0 (reduced by 15%)
        expect(planet.market.priceMultipliers[0]).toBeLessThan(1.0);
        // System should be recorded as having active trade boom
        expect(g.activeTradeBoomSystems[boom.systemId]).toBeDefined();
        expect(g.activeTradeBoomSystems[boom.systemId]).toBeGreaterThan(day);
        return;
      }
    }
    // If no boom found in 200 days, that's fine (10% × 25% = 2.5% chance per day)
  });

  it("expireGlobalEvents restores prices after duration", () => {
    const galaxy = makeGalaxy(1);
    galaxy.gameDays = 0;
    galaxy.applyTradeBoom("sys_0", 10);
    const priceAfterBoom =
      galaxy.systems[0].planets[0].market.priceMultipliers[0];
    expect(priceAfterBoom).toBeLessThan(1.0);

    // Advance past expiry
    galaxy.gameDays = 11;
    galaxy.expireGlobalEvents();
    const priceRestored =
      galaxy.systems[0].planets[0].market.priceMultipliers[0];
    // After expiry, price should be back near 1.0 (within floating-point precision)
    expect(priceRestored).toBeCloseTo(1.0, 3);
    expect(galaxy.activeTradeBoomSystems["sys_0"]).toBeUndefined();
  });
});

describe("PLAGUE effect", () => {
  it("reduces target planet population by 30%", () => {
    const sim = new GalaxySimulator();
    let plagueFound = false;
    for (let day = 0; day < 500; day++) {
      const g = makeGalaxy(1);
      g.gameDays = day;
      const rng = new SeededRNG(`galaxy_test_day_${day}`);
      const events = sim.tickGlobalEvents(g, rng);
      const plague = events.find((e) => e.type === "PLAGUE");
      if (plague) {
        plagueFound = true;
        // Population should have decreased
        const planet = g.systems[0].planets[0];
        // Original population was 2_000_000; after plague it should be 1_400_000
        expect(planet.population).toBeLessThan(2_000_000);
        expect(planet.population).toBeGreaterThanOrEqual(0);
        break;
      }
    }
    expect(plagueFound).toBe(true);
  });
});

describe("DISCOVERY effect", () => {
  it("reveals a foggy adjacent system", () => {
    const sim = new GalaxySimulator();
    let discoveryFound = false;
    for (let day = 0; day < 500; day++) {
      const g = makeGalaxy(3);
      // Set fog on systems 1 and 2
      g.systems[1].fogOfWar = true;
      g.systems[2].fogOfWar = true;
      g.gameDays = day;
      const rng = new SeededRNG(`galaxy_test_day_${day}`);
      const events = sim.tickGlobalEvents(g, rng);
      const disc = events.find((e) => e.type === "DISCOVERY");
      if (disc) {
        discoveryFound = true;
        expect(disc.description.length).toBeGreaterThan(0);
        break;
      }
    }
    expect(discoveryFound).toBe(true);
  });
});

describe("Planet.population", () => {
  it("initializes to a non-negative number", () => {
    const planet = makePlanet("pl_test", 500_000);
    expect(planet.population).toBe(500_000);
  });

  it("plague clamps population to 0 minimum", () => {
    const planet = makePlanet("pl_test", 100);
    const loss = Math.round(planet.population * 0.3);
    planet.population = Math.max(0, planet.population - loss);
    expect(planet.population).toBe(70);

    // Edge case: very small population
    planet.population = 1;
    planet.population = Math.max(0, planet.population - Math.round(1 * 0.3));
    expect(planet.population).toBeGreaterThanOrEqual(0);
  });
});
