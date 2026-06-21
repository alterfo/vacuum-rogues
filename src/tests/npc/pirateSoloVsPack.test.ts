import { describe, it, expect } from "vitest";
import { Galaxy } from "@/domain/Galaxy";
import { StarSystem } from "@/domain/StarSystem";
import { Overmind } from "@/domain/Overmind";
import { NpcSimulator } from "@/systems/npc/NpcSimulator";
import { NpcShip } from "@/domain/NpcShip";
import { SeededRNG } from "@/utils/seededRNG";
import { pirateCoordination } from "@/systems/npc/factionHostility";
import { StarType, NpcState, NpcRole, FactionType } from "@/types";
import { Faction } from "@/types/faction";

// ---------------------------------------------------------------------------
// Solo vs pack behaviour
// (docs/plans/20260620-faction-hostility-pirate-overmind-ai.md, Task 3):
// pirates swarm as a pack in systems they have captured (galaxy.pirateSystems),
// and act as lone raiders (solo) in any foreign system.
// ---------------------------------------------------------------------------

describe("pirateCoordination — pure pack/solo decision", () => {
  it("pirates swarm as a pack only in a pirate-captured system", () => {
    expect(pirateCoordination("pirate")).toBe("pack");
  });

  it("an overmind-held system leaves pirates hunting solo", () => {
    expect(pirateCoordination("overmind")).toBe("solo");
  });

  it("a neutral/foreign system leaves pirates hunting solo", () => {
    expect(pirateCoordination(null)).toBe("solo");
    expect(pirateCoordination(undefined)).toBe("solo");
  });
});

function makePirate(id: string): NpcShip {
  return new NpcShip({
    id,
    name: id,
    race: FactionType.OUTLANDERS,
    faction: Faction.INDEPENDENT,
    role: NpcRole.PIRATE,
    hullHP: 200,
    maxHull: 200,
    shields: 0,
    speed: 0.1,
    damage: 30,
    currentSystemId: "sys_x",
    state: NpcState.PATROLLING,
    goal: null,
    destinationSystemId: null,
    daysToArrival: 0,
    credits: 0,
    reputation: 0,
  });
}

function makeVictim(
  id: string,
  opts: { hullHP: number; damage: number },
): NpcShip {
  return new NpcShip({
    id,
    name: id,
    race: FactionType.OUTLANDERS,
    faction: Faction.INDEPENDENT,
    role: NpcRole.TRADER,
    hullHP: opts.hullHP,
    maxHull: opts.hullHP,
    shields: 50,
    speed: 0.1,
    damage: opts.damage,
    currentSystemId: "sys_x",
    state: NpcState.PATROLLING,
    goal: null,
    destinationSystemId: null,
    daysToArrival: 0,
    credits: 0,
    reputation: 0,
  });
}

function makeSingleSystemGalaxy(): Galaxy {
  const sys = new StarSystem(
    "sys_x",
    "X",
    { q: 0, r: 0 },
    StarType.YELLOW_DWARF,
    [],
    Faction.INDEPENDENT,
    [],
  );
  return new Galaxy("galaxy_solo_pack", [sys], new Overmind(), [], []);
}

describe("NpcSimulator off-screen — pack engagement in a captured system", () => {
  it("a pirate pack in its captured system focus-fires the weakest mark, sparing the stronger", () => {
    const galaxy = makeSingleSystemGalaxy();
    galaxy.addPirateSystem("sys_x"); // pirate-controlled → pack coordination

    const weak = makeVictim("weak", { hullHP: 500, damage: 5 });
    const strong = makeVictim("strong", { hullHP: 500, damage: 80 });
    galaxy.npcShips.push(
      makePirate("pir_a"),
      makePirate("pir_b"),
      weak,
      strong,
    );

    const sim = new NpcSimulator();
    // One tick: both pirates act before any standing garrison is topped up.
    sim.tick(galaxy, new SeededRNG("pack"), "player_elsewhere");

    // The whole pack concentrated on the weakest mark; the stronger one is
    // untouched — group focus fire, not a spread of independent raids.
    expect(strong.hullHP).toBe(500);
    expect(weak.hullHP).toBeLessThan(500);
  });
});

describe("NpcSimulator off-screen — solo engagement in a foreign system", () => {
  it("lone raiders in a foreign system spread fire across marks (the stronger is also hit)", () => {
    const galaxy = makeSingleSystemGalaxy(); // not captured → solo coordination

    // Equal-strength marks so neither is a forced focus; only random per-pirate
    // selection (solo) can land hits on both. Fat hulls so neither dies and the
    // marks stay co-located for the whole run.
    const a = makeVictim("mark_a", { hullHP: 1000, damage: 5 });
    const b = makeVictim("mark_b", { hullHP: 1000, damage: 5 });
    galaxy.npcShips.push(makePirate("pir_a"), makePirate("pir_b"), a, b);

    const sim = new NpcSimulator();
    const rng = new SeededRNG("solo");
    for (let i = 0; i < 20; i++) sim.tick(galaxy, rng, "player_elsewhere");

    // Independent lone-raider targeting spreads damage across both marks — in a
    // captured system the pack would have left one pristine.
    expect(a.hullHP).toBeLessThan(1000);
    expect(b.hullHP).toBeLessThan(1000);
  });
});
