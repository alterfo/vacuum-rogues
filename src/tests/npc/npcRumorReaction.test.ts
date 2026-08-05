import { describe, it, expect } from "vitest";
import { Galaxy } from "@/domain/Galaxy";
import { StarSystem } from "@/domain/StarSystem";
import { Planet } from "@/domain/Planet";
import { Market } from "@/domain/Market";
import { WarpPath } from "@/domain/WarpPath";
import { Overmind } from "@/domain/Overmind";
import { NpcShip } from "@/domain/NpcShip";
import { createRumor, type RouteLike } from "@/domain/RouteRumor";
import { NpcSimulator, rumorReactionChance } from "@/systems/npc/NpcSimulator";
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
import { Faction } from "@/types/faction";

const RESOURCE = ResourceType.METALS;
const FROM = "sys_from";
const TO = "sys_to";

function makeSystemWithMarket(id: string): StarSystem {
  const resources = [
    ResourceType.METALS,
    ResourceType.CRYSTALS,
    ResourceType.ORGANICS,
  ];
  const market = new Market(
    resources,
    resources.map(() => 1.0),
    resources.map(() => 1.0),
  );
  const planet = new Planet(
    `planet_${id}`,
    `Planet ${id}`,
    PlanetType.TERRESTRIAL,
    800,
    market,
    [],
    [],
  );
  return new StarSystem(
    id,
    id.toUpperCase(),
    { q: 0, r: id === TO ? 5 : 0 },
    StarType.YELLOW_DWARF,
    [planet],
    Faction.INDEPENDENT,
    [],
  );
}

function makeRouteGalaxy(): Galaxy {
  const from = makeSystemWithMarket(FROM);
  const to = makeSystemWithMarket(TO);
  from.connections.push(new WarpPath(FROM, TO, 2));
  to.connections.push(new WarpPath(TO, FROM, 2));
  return new Galaxy("rumor_galaxy", [from, to], new Overmind(), [], []);
}

function makeRumor(marginPct: number) {
  const route: RouteLike = {
    resource: RESOURCE,
    fromSystemId: FROM,
    fromPlanetId: `planet_${FROM}`,
    toSystemId: TO,
    toPlanetId: `planet_${TO}`,
    fromPrice: 100,
    toPrice: 100 * (1 + marginPct / 100),
    marginPct,
  };
  return createRumor(route, 0);
}

function makeShip(id: string, role: NpcRole): NpcShip {
  return new NpcShip({
    id,
    name: id,
    race: FactionType.OUTLANDERS,
    faction: Faction.INDEPENDENT,
    role,
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

function reactedToRumor(npc: NpcShip): boolean {
  return (
    npc.destinationSystemId === TO &&
    npc.cargo.some((c) => c.goodId === RESOURCE)
  );
}

function reactionFraction(
  marginPct: number,
  role: NpcRole,
  seed: string,
  count = 200,
): number {
  const galaxy = makeRouteGalaxy();
  galaxy.activeRumors.push(makeRumor(marginPct));
  for (let i = 0; i < count; i++) {
    galaxy.npcShips.push(makeShip(`${role}_${i}`, role));
  }
  new NpcSimulator().tick(galaxy, new SeededRNG(seed));
  const reacted = galaxy.npcShips.filter(reactedToRumor).length;
  return reacted / count;
}

describe("rumorReactionChance curve", () => {
  it("tapers to ~baseChance (almost none) at the expiry threshold", () => {
    const atExpiry = rumorReactionChance(GAME_BALANCE.rumorMarginExpire);
    expect(atExpiry).toBeCloseTo(GAME_BALANCE.rumorNpcBaseChance, 6);
    expect(atExpiry).toBeLessThan(0.05);
  });

  it("is never below baseChance even for sub-expiry margins", () => {
    expect(rumorReactionChance(0)).toBe(GAME_BALANCE.rumorNpcBaseChance);
    expect(rumorReactionChance(-50)).toBe(GAME_BALANCE.rumorNpcBaseChance);
  });

  it("scales up with margin above the expiry threshold", () => {
    const nearExpiry = rumorReactionChance(GAME_BALANCE.rumorMarginExpire + 1);
    const open = rumorReactionChance(GAME_BALANCE.rumorMarginOpen);
    const fat = rumorReactionChance(50);
    expect(open).toBeGreaterThan(nearExpiry);
    expect(fat).toBeGreaterThan(open);
  });

  it("never exceeds the configured maximum chance", () => {
    expect(rumorReactionChance(1000)).toBe(GAME_BALANCE.rumorNpcMaxChance);
    for (const m of [0, 10, 25, 50, 100, 500]) {
      const p = rumorReactionChance(m);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(GAME_BALANCE.rumorNpcMaxChance);
    }
  });
});

describe("NPC trader rumor reaction", () => {
  it("a fat-margin rumor pulls a measurable fraction of traders", () => {
    const frac = reactionFraction(50, NpcRole.TRADER, "fat_margin");
    expect(frac).toBeGreaterThan(0.4);
  });

  it("a near-expiry rumor pulls almost none", () => {
    const frac = reactionFraction(
      GAME_BALANCE.rumorMarginExpire + 0.5,
      NpcRole.TRADER,
      "near_expiry",
    );
    expect(frac).toBeLessThan(0.1);
  });

  it("a fat-margin rumor pulls strictly more than a near-expiry one", () => {
    const fat = reactionFraction(50, NpcRole.TRADER, "compare");
    const thin = reactionFraction(
      GAME_BALANCE.rumorMarginExpire + 0.5,
      NpcRole.TRADER,
      "compare",
    );
    expect(fat).toBeGreaterThan(thin);
  });

  it("a diverting trader raises the rumor's SOURCE price (buy-side impact, Task 6)", () => {
    const galaxy = makeRouteGalaxy();
    galaxy.activeRumors.push(makeRumor(80));
    for (let i = 0; i < 200; i++) {
      galaxy.npcShips.push(makeShip(`trader_${i}`, NpcRole.TRADER));
    }
    const sourceMarket = galaxy.systems.find((s) => s.id === FROM)!.planets[0]
      .market;
    expect(sourceMarket.multiplierFor(RESOURCE)).toBe(1.0);

    new NpcSimulator().tick(galaxy, new SeededRNG("source_buy"));

    const diverted = galaxy.npcShips.filter(reactedToRumor).length;
    expect(diverted).toBeGreaterThan(0);
    expect(sourceMarket.multiplierFor(RESOURCE)).toBeGreaterThan(1.0);
  });

  it("never moves the source price when there are no rumors", () => {
    const galaxy = makeRouteGalaxy();
    for (let i = 0; i < 50; i++) {
      galaxy.npcShips.push(makeShip(`trader_${i}`, NpcRole.TRADER));
    }
    const sourceMarket = galaxy.systems.find((s) => s.id === FROM)!.planets[0]
      .market;

    new NpcSimulator().tick(galaxy, new SeededRNG("no_rumor_no_impact"));

    expect(sourceMarket.multiplierFor(RESOURCE)).toBe(1.0);
  });

  it("non-trader NPCs ignore rumors entirely", () => {
    for (const role of [NpcRole.PIRATE, NpcRole.PATROL, NpcRole.RANGER]) {
      const frac = reactionFraction(50, role, `nontrader_${role}`);
      expect(frac).toBe(0);
    }
  });

  it("reaction is deterministic for a fixed seed", () => {
    const a = reactionFraction(40, NpcRole.TRADER, "determinism");
    const b = reactionFraction(40, NpcRole.TRADER, "determinism");
    expect(a).toBe(b);
  });

  it("does not perturb the simulation when no rumors are active", () => {
    const run = (): string => {
      const galaxy = makeRouteGalaxy();
      for (let i = 0; i < 20; i++) {
        galaxy.npcShips.push(makeShip(`trader_${i}`, NpcRole.TRADER));
      }
      new NpcSimulator().tick(galaxy, new SeededRNG("no_rumors"));
      return galaxy.npcShips
        .map((n) => `${n.id}:${n.state}:${n.destinationSystemId}`)
        .join("|");
    };
    const first = run();
    const second = run();
    expect(first).toBe(second);
  });
});
