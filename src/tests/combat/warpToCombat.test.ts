import { describe, it, expect } from "vitest";
import { NpcSimulator, npcRoleTechLevel } from "@/systems/npc/NpcSimulator";
import { NpcShip } from "@/domain/NpcShip";
import { Galaxy } from "@/domain/Galaxy";
import { StarSystem } from "@/domain/StarSystem";
import { Overmind } from "@/domain/Overmind";
import { NpcRole, NpcState, FactionType, StarType } from "@/types";
import { Faction } from "@/types/faction";

function makeNpc(id: string, role: NpcRole = NpcRole.RANGER): NpcShip {
  return new NpcShip({
    id,
    name: id,
    race: FactionType.OUTLANDERS,
    faction: Faction.INDEPENDENT,
    role,
    hullHP: 100,
    maxHull: 100,
    shields: 40,
    speed: 0.1,
    damage: 20,
    currentSystemId: "sys_a",
    state: NpcState.PATROLLING,
    goal: null,
    destinationSystemId: null,
    daysToArrival: 0,
    credits: 0,
    reputation: 0,
  });
}

function makeGalaxy(): Galaxy {
  const sys = new StarSystem(
    "sys_a",
    "Alpha",
    { q: 0, r: 0 },
    StarType.YELLOW_DWARF,
    [],
    Faction.INDEPENDENT,
    [],
  );
  return new Galaxy("g", [sys], new Overmind(), [], []);
}

describe("npcRoleTechLevel", () => {
  it("assigns higher tech level to military roles", () => {
    expect(npcRoleTechLevel(NpcRole.PATROL)).toBe(3);
    expect(npcRoleTechLevel(NpcRole.RANGER)).toBe(2);
    expect(npcRoleTechLevel(NpcRole.PIRATE)).toBe(2);
    expect(npcRoleTechLevel(NpcRole.TRADER)).toBe(1);
  });
});

describe("combat context built from NpcShip", () => {
  it("maps NpcShip fields to npcEnemy context correctly", () => {
    const npc = makeNpc("npc_1", NpcRole.PATROL);
    npc.hullHP = 140;
    npc.shields = 70;
    npc.damage = 28;

    const context = {
      id: npc.id,
      hullHP: npc.hullHP,
      shields: npc.shields,
      damage: npc.damage,
      techLevel: npcRoleTechLevel(npc.role),
    };

    expect(context.id).toBe("npc_1");
    expect(context.hullHP).toBe(140);
    expect(context.shields).toBe(70);
    expect(context.damage).toBe(28);
    expect(context.techLevel).toBe(3);
  });
});

describe("NpcSimulator.removeNpc", () => {
  it("removes the targeted NPC from galaxy.npcShips", () => {
    const galaxy = makeGalaxy();
    galaxy.npcShips.push(makeNpc("npc_a"), makeNpc("npc_b"), makeNpc("npc_c"));

    const sim = new NpcSimulator();
    sim.removeNpc(galaxy, "npc_b");

    expect(galaxy.npcShips).toHaveLength(2);
    expect(galaxy.npcShips.map((n) => n.id)).not.toContain("npc_b");
    expect(galaxy.npcShips.map((n) => n.id)).toContain("npc_a");
    expect(galaxy.npcShips.map((n) => n.id)).toContain("npc_c");
  });

  it("is a no-op when the NPC id is not found", () => {
    const galaxy = makeGalaxy();
    galaxy.npcShips.push(makeNpc("npc_x"));

    const sim = new NpcSimulator();
    sim.removeNpc(galaxy, "npc_missing");

    expect(galaxy.npcShips).toHaveLength(1);
  });

  it("victory removes the defeated NPC leaving others intact", () => {
    const galaxy = makeGalaxy();
    const enemy = makeNpc("enemy_1", NpcRole.PIRATE);
    const bystander = makeNpc("bystander_1", NpcRole.TRADER);
    galaxy.npcShips.push(enemy, bystander);

    const sim = new NpcSimulator();
    sim.removeNpc(galaxy, enemy.id);

    expect(galaxy.npcShips).toHaveLength(1);
    expect(galaxy.npcShips[0].id).toBe("bystander_1");
  });
});
