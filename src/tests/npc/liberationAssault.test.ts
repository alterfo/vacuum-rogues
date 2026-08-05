import { describe, it, expect } from "vitest";
import { Galaxy } from "@/domain/Galaxy";
import { StarSystem } from "@/domain/StarSystem";
import { Overmind } from "@/domain/Overmind";
import { WarpPath } from "@/domain/WarpPath";
import { NpcShip } from "@/domain/NpcShip";
import { NpcSimulator } from "@/systems/npc/NpcSimulator";
import { SeededRNG } from "@/utils/seededRNG";
import { StarType, NpcRole, NpcState, FactionType } from "@/types";
import { Faction } from "@/types/faction";

function makeGalaxy(): Galaxy {
  const sysA = new StarSystem(
    "sys_a",
    "Alpha",
    { q: 0, r: 0 },
    StarType.YELLOW_DWARF,
    [],
    Faction.INDEPENDENT,
    [],
  );
  const sysB = new StarSystem(
    "sys_b",
    "Beta",
    { q: 10, r: 0 },
    StarType.YELLOW_DWARF,
    [],
    Faction.INDEPENDENT,
    [],
  );
  sysA.connections.push(new WarpPath("sys_a", "sys_b", 3));
  sysB.connections.push(new WarpPath("sys_b", "sys_a", 3));
  return new Galaxy("galaxy_assault", [sysA, sysB], new Overmind(), [], []);
}

function makeRallyRanger(
  id: string,
  opts: { damage: number; hull: number },
): NpcShip {
  return new NpcShip({
    id,
    name: `Ranger ${id}`,
    race: FactionType.BASTIONS,
    faction: Faction.INDEPENDENT,
    role: NpcRole.RANGER,
    hullHP: opts.hull,
    maxHull: opts.hull,
    shields: 0,
    speed: 0.1,
    damage: opts.damage,
    currentSystemId: "sys_b",
    state: NpcState.TRAVELING,
    goal: null,
    destinationSystemId: "sys_a",
    daysToArrival: 1,
    credits: 0,
    reputation: 0,
    convoyId: "liberation_5_sys_a",
  });
}

function makeBesiegingRanger(
  id: string,
  opts: { damage: number; hull: number },
): NpcShip {
  const npc = makeRallyRanger(id, opts);
  npc.currentSystemId = "sys_a";
  npc.state = NpcState.PATROLLING;
  npc.destinationSystemId = null;
  npc.daysToArrival = 0;
  return npc;
}

function makeGarrisonShip(
  n: number,
  opts: { damage: number; hull: number },
): NpcShip {
  return new NpcShip({
    id: `garrison_ov_sys_a_0_${n}`,
    name: `Dominator ${n}`,
    race: FactionType.PARADOXES,
    faction: Faction.OVERMIND,
    role: NpcRole.PATROL,
    hullHP: opts.hull,
    maxHull: opts.hull,
    shields: 0,
    speed: 0.1,
    damage: opts.damage,
    currentSystemId: "sys_a",
    state: NpcState.PATROLLING,
    goal: null,
    destinationSystemId: null,
    daysToArrival: 0,
    credits: 0,
    reputation: 0,
    hostile: true,
  });
}

function tickDays(
  sim: NpcSimulator,
  galaxy: Galaxy,
  days: number,
  label: string,
): void {
  for (let i = 0; i < days; i++) {
    galaxy.simulateDay();
    sim.tick(galaxy, new SeededRNG(`${label}_${i}`));
  }
}

describe("NpcSimulator liberation assaults (real combat, no coin flip)", () => {
  it("arriving rally rangers persist as an assault force instead of rolling a flat chance", () => {
    const galaxy = makeGalaxy();
    galaxy.addOvermindSystem("sys_a");
    const garrison = Array.from({ length: 6 }, (_, n) =>
      makeGarrisonShip(n, { damage: 10, hull: 300 }),
    );
    const r1 = makeRallyRanger("r1", { damage: 20, hull: 200 });
    const r2 = makeRallyRanger("r2", { damage: 20, hull: 200 });
    galaxy.npcShips.push(...garrison, r1, r2);

    const sim = new NpcSimulator();
    tickDays(sim, galaxy, 1, "arrive");

    expect(galaxy.isHostileSystem("sys_a")).toBe(true);
    for (const r of [r1, r2]) {
      expect(r.currentSystemId).toBe("sys_a");
      expect(r.state).not.toBe(NpcState.TRAVELING);
      expect(r.state).not.toBe(NpcState.DEAD);
      expect(r.convoyId?.startsWith("liberation_")).toBe(true);
    }

    tickDays(sim, galaxy, 3, "hold");
    for (const r of [r1, r2]) {
      expect(r.currentSystemId).toBe("sys_a");
      expect(r.state).not.toBe(NpcState.TRAVELING);
    }
  });

  it("a stronger assault force grinds the garrison down and liberates only once it is destroyed", () => {
    const galaxy = makeGalaxy();
    galaxy.addOvermindSystem("sys_a");
    const garrison = Array.from({ length: 3 }, (_, n) =>
      makeGarrisonShip(n, { damage: 5, hull: 40 }),
    );
    const rangers = Array.from({ length: 5 }, (_, n) =>
      makeRallyRanger(`r${n}`, { damage: 100, hull: 500 }),
    );
    galaxy.npcShips.push(...garrison, ...rangers);

    const sim = new NpcSimulator();
    tickDays(sim, galaxy, 5, "grind");

    for (const g of garrison) {
      const live = galaxy.npcShips.find((n) => n.id === g.id);
      expect(live === undefined || live.state === NpcState.DEAD).toBe(true);
    }
    expect(galaxy.isHostileSystem("sys_a")).toBe(false);
    const liberated = galaxy.newsFeed.find(
      (e) => e.type === "SYSTEM_LIBERATED" && e.systemId === "sys_a",
    );
    expect(liberated).toBeDefined();
    const survivors = rangers.filter((r) => r.state !== NpcState.DEAD);
    expect(survivors.length).toBeGreaterThan(0);
    for (const r of survivors) {
      expect(r.convoyId).toBeUndefined();
    }
  });

  it("a garrison that outguns the assault wipes it without liberating", () => {
    const galaxy = makeGalaxy();
    galaxy.addOvermindSystem("sys_a");
    const garrison = Array.from({ length: 6 }, (_, n) =>
      makeGarrisonShip(n, { damage: 100, hull: 300 }),
    );
    const r1 = makeRallyRanger("r1", { damage: 4, hull: 50 });
    const r2 = makeRallyRanger("r2", { damage: 4, hull: 50 });
    galaxy.npcShips.push(...garrison, r1, r2);

    const sim = new NpcSimulator();
    tickDays(sim, galaxy, 6, "wipe");

    for (const id of ["r1", "r2"]) {
      const live = galaxy.npcShips.find((n) => n.id === id);
      expect(live === undefined || live.state === NpcState.DEAD).toBe(true);
    }
    expect(galaxy.isHostileSystem("sys_a")).toBe(true);
    const liberated = galaxy.newsFeed.find(
      (e) => e.type === "SYSTEM_LIBERATED" && e.systemId === "sys_a",
    );
    expect(liberated).toBeUndefined();
  });

  it("a mid-fight save/load rebuilds the assault hold from the liberation_ convoyId prefix", () => {
    const galaxy = makeGalaxy();
    galaxy.addOvermindSystem("sys_a");
    const garrison = Array.from({ length: 3 }, (_, n) =>
      makeGarrisonShip(n, { damage: 5, hull: 40 }),
    );
    const rangers = Array.from({ length: 3 }, (_, n) =>
      makeBesiegingRanger(`r${n}`, { damage: 100, hull: 500 }),
    );
    galaxy.npcShips.push(...garrison, ...rangers);

    const sim = new NpcSimulator();
    tickDays(sim, galaxy, 1, "reload");

    const damaged = garrison.filter(
      (g) =>
        g.state === NpcState.DEAD ||
        g.hullHP < g.maxHull ||
        !galaxy.npcShips.includes(g),
    );
    expect(damaged.length).toBeGreaterThan(0);
    for (const r of rangers) {
      expect(r.currentSystemId).toBe("sys_a");
      expect(r.state).not.toBe(NpcState.TRAVELING);
    }

    tickDays(sim, galaxy, 4, "reload_more");
    expect(galaxy.isHostileSystem("sys_a")).toBe(false);
  });

  it("a load clears a stale liberation_ marker on a ranger parked in a friendly system", () => {
    const galaxy = makeGalaxy(); // sys_a never added to overmindSystems
    const ranger = makeBesiegingRanger("r_stale", { damage: 20, hull: 200 });
    galaxy.npcShips.push(ranger);

    const sim = new NpcSimulator();
    tickDays(sim, galaxy, 1, "stale");

    expect(ranger.convoyId).toBeUndefined();
  });

  it("stands a parked assault force down in a freed system even while the player camps it", () => {
    const galaxy = makeGalaxy();
    galaxy.addOvermindSystem("sys_a");
    const garrison = Array.from({ length: 3 }, (_, n) =>
      makeGarrisonShip(n, { damage: 5, hull: 400 }),
    );
    const rangers = Array.from({ length: 2 }, (_, n) =>
      makeBesiegingRanger(`r${n}`, { damage: 20, hull: 200 }),
    );
    galaxy.npcShips.push(...garrison, ...rangers);

    const sim = new NpcSimulator();
    galaxy.simulateDay();
    sim.tick(galaxy, new SeededRNG("camp_enroll"), "sys_b");
    const ids = (
      sim as unknown as { garrison: { liberationAssaultIds: Set<string> } }
    ).garrison.liberationAssaultIds;
    expect(ids.size).toBe(2);

    for (const g of garrison) g.state = NpcState.DEAD;
    galaxy.tryLiberate("sys_a");
    expect(galaxy.isHostileSystem("sys_a")).toBe(false);

    galaxy.simulateDay();
    sim.tick(galaxy, new SeededRNG("camp_release"), "sys_a");
    expect(ids.size).toBe(0);
    for (const r of rangers) {
      expect(r.convoyId).toBeUndefined();
    }
  });

  it("defers siege attrition for the player's current system, resuming after departure", () => {
    const galaxy = makeGalaxy();
    galaxy.addOvermindSystem("sys_a");
    const garrison = Array.from({ length: 3 }, (_, n) =>
      makeGarrisonShip(n, { damage: 5, hull: 400 }),
    );
    const rangers = Array.from({ length: 3 }, (_, n) =>
      makeBesiegingRanger(`r${n}`, { damage: 100, hull: 500 }),
    );
    galaxy.npcShips.push(...garrison, ...rangers);

    const sim = new NpcSimulator();
    galaxy.simulateDay();
    sim.tick(galaxy, new SeededRNG("defer_player_0"), "sys_a");
    for (const g of garrison) expect(g.hullHP).toBe(g.maxHull);
    for (const r of rangers) expect(r.hullHP).toBe(r.maxHull);

    galaxy.simulateDay();
    sim.tick(galaxy, new SeededRNG("defer_player_1"), "sys_b");
    const damaged = garrison.filter(
      (g) => g.hullHP < g.maxHull || g.state === NpcState.DEAD,
    );
    expect(damaged.length).toBeGreaterThan(0);
  });
});
