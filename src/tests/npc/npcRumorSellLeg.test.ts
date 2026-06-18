import { describe, it, expect } from "vitest";
import { Galaxy } from "@/domain/Galaxy";
import { StarSystem } from "@/domain/StarSystem";
import { Planet } from "@/domain/Planet";
import { Market } from "@/domain/Market";
import { WarpPath } from "@/domain/WarpPath";
import { Overmind } from "@/domain/Overmind";
import { NpcShip } from "@/domain/NpcShip";
import { createRumor, type RouteLike } from "@/domain/RouteRumor";
import { NpcSimulator } from "@/systems/npc/NpcSimulator";
import { SeededRNG } from "@/utils/seededRNG";
import {
  StarType,
  NpcState,
  NpcRole,
  FactionType,
  ResourceType,
  PlanetType,
} from "@/types";
import { Faction } from "@/types/faction";

const RESOURCE = ResourceType.METALS;
const FROM = "sys_from";
const TO = "sys_to";
// The rumor's dear destination is the SECOND planet of the TO system — i.e. NOT
// the first market planet `simulateTraderTrade` would otherwise default to. This
// is the production-realistic case (every planet carries a full market), and the
// case the buggy first-planet sell-leg silently mishandled.
const TARGET_PLANET = "planet_to_b";

function neutralMarket(): Market {
  const resources = [
    ResourceType.METALS,
    ResourceType.CRYSTALS,
    ResourceType.ORGANICS,
  ];
  return new Market(
    resources,
    resources.map(() => 1.0),
    resources.map(() => 1.0),
  );
}

function makePlanet(id: string): Planet {
  return new Planet(
    id,
    id,
    PlanetType.TERRESTRIAL,
    800,
    neutralMarket(),
    [],
    [],
  );
}

/** Source: one market planet. Destination: TWO market planets; the rumor targets
 *  the second one. */
function makeRouteGalaxy(): Galaxy {
  const from = new StarSystem(
    FROM,
    FROM.toUpperCase(),
    { q: 0, r: 0 },
    StarType.YELLOW_DWARF,
    [makePlanet("planet_from")],
    Faction.INDEPENDENT,
    [],
  );
  const to = new StarSystem(
    TO,
    TO.toUpperCase(),
    { q: 0, r: 5 },
    StarType.YELLOW_DWARF,
    [makePlanet("planet_to_a"), makePlanet(TARGET_PLANET)],
    Faction.INDEPENDENT,
    [],
  );
  from.connections.push(new WarpPath(FROM, TO, 2));
  to.connections.push(new WarpPath(TO, FROM, 2));
  return new Galaxy("rumor_galaxy", [from, to], new Overmind(), [], []);
}

function makeRumor(marginPct: number) {
  const route: RouteLike = {
    resource: RESOURCE,
    fromSystemId: FROM,
    fromPlanetId: "planet_from",
    toSystemId: TO,
    toPlanetId: TARGET_PLANET,
    fromPrice: 100,
    toPrice: 100 * (1 + marginPct / 100),
    marginPct,
  };
  return createRumor(route, 0);
}

function makeTrader(id: string): NpcShip {
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
    currentSystemId: FROM,
    state: NpcState.IDLE,
    goal: null,
    destinationSystemId: null,
    daysToArrival: 0,
    credits: 500,
    reputation: 0,
    cargo: [],
  });
}

function planetMarket(
  galaxy: Galaxy,
  systemId: string,
  planetId: string,
): Market {
  return galaxy.systems
    .find((s) => s.id === systemId)!
    .planets.find((p) => p.id === planetId)!.market;
}

describe("NPC rumor sell-leg targets the rumor's destination planet", () => {
  it("lowers the rumor's dear target planet, not the first planet in the system", () => {
    const galaxy = makeRouteGalaxy();
    galaxy.activeRumors.push(makeRumor(80));
    for (let i = 0; i < 300; i++) {
      galaxy.npcShips.push(makeTrader(`trader_${i}`));
    }

    const sim = new NpcSimulator();
    const rng = new SeededRNG("sell_leg");
    // Enough ticks for traders to divert at the source, travel, and arrive.
    for (let day = 0; day < 8; day++) {
      sim.tick(galaxy, rng);
    }

    const target = planetMarket(galaxy, TO, TARGET_PLANET);
    // The diverted traders sold their METALS at the rumor's target planet, so its
    // persistent multiplier fell below neutral. Under the old first-planet sell
    // logic this planet was never sold to and would have stayed at 1.0.
    expect(target.multiplierFor(RESOURCE)).toBeLessThan(1.0);
  });
});
