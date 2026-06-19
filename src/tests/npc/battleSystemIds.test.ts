import { describe, it, expect } from "vitest";
import { Galaxy } from "@/domain/Galaxy";
import { StarSystem } from "@/domain/StarSystem";
import { Overmind } from "@/domain/Overmind";
import { NpcShip } from "@/domain/NpcShip";
import { NpcSimulator } from "@/systems/npc/NpcSimulator";
import { StarType, NpcRole, NpcState } from "@/types";
import { Faction } from "@/types/faction";
import { FactionType } from "@/types";

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
  return new Galaxy("galaxy_battle", [sysA, sysB], new Overmind(), [], []);
}

let shipSeq = 0;
function makeShip(
  systemId: string,
  opts: {
    hostile?: boolean;
    faction?: Faction;
    role?: NpcRole;
    state?: NpcState;
  } = {},
): NpcShip {
  shipSeq += 1;
  return new NpcShip({
    id: `ship_${shipSeq}`,
    name: `Ship ${shipSeq}`,
    race: FactionType.OUTLANDERS,
    faction: opts.faction ?? Faction.INDEPENDENT,
    role: opts.role ?? NpcRole.PATROL,
    hullHP: 100,
    maxHull: 100,
    shields: 0,
    speed: 5,
    damage: 10,
    currentSystemId: systemId,
    state: opts.state ?? NpcState.IDLE,
    goal: null,
    destinationSystemId: null,
    daysToArrival: 0,
    credits: 0,
    reputation: 0,
    hostile: opts.hostile ?? false,
  });
}

describe("NpcSimulator.battleSystemIds", () => {
  it("flags a system holding both a hostile and a friendly ship", () => {
    const galaxy = makeGalaxy();
    galaxy.npcShips.push(
      makeShip("sys_a", { hostile: true, role: NpcRole.PIRATE }),
      makeShip("sys_a", { hostile: false, role: NpcRole.RANGER }),
    );

    const sim = new NpcSimulator();
    expect(sim.battleSystemIds(galaxy)).toEqual(new Set(["sys_a"]));
  });

  it("treats an Overmind ship as the hostile side even if not flagged hostile", () => {
    const galaxy = makeGalaxy();
    galaxy.npcShips.push(
      makeShip("sys_a", { hostile: false, faction: Faction.OVERMIND }),
      makeShip("sys_a", { hostile: false, role: NpcRole.RANGER }),
    );

    const sim = new NpcSimulator();
    expect(sim.battleSystemIds(galaxy)).toEqual(new Set(["sys_a"]));
  });

  it("treats a regular (unflagged) PIRATE-role ship as the hostile side", () => {
    const galaxy = makeGalaxy();
    galaxy.npcShips.push(
      // Wandering pirate spawned via spawnOne: hostile defaults to false.
      makeShip("sys_a", { hostile: false, role: NpcRole.PIRATE }),
      makeShip("sys_a", { hostile: false, role: NpcRole.RANGER }),
    );

    const sim = new NpcSimulator();
    expect(sim.battleSystemIds(galaxy)).toEqual(new Set(["sys_a"]));
  });

  it("returns no battle when only hostiles are present", () => {
    const galaxy = makeGalaxy();
    galaxy.npcShips.push(
      makeShip("sys_a", { hostile: true, role: NpcRole.PIRATE }),
      makeShip("sys_a", { hostile: true, faction: Faction.OVERMIND }),
    );

    const sim = new NpcSimulator();
    expect(sim.battleSystemIds(galaxy)).toEqual(new Set());
  });

  it("returns no battle when only friendlies are present", () => {
    const galaxy = makeGalaxy();
    galaxy.npcShips.push(
      makeShip("sys_a", { hostile: false, role: NpcRole.RANGER }),
      makeShip("sys_a", { hostile: false, role: NpcRole.TRADER }),
    );

    const sim = new NpcSimulator();
    expect(sim.battleSystemIds(galaxy)).toEqual(new Set());
  });

  it("returns an empty set for an empty galaxy", () => {
    const galaxy = makeGalaxy();
    const sim = new NpcSimulator();
    expect(sim.battleSystemIds(galaxy)).toEqual(new Set());
  });

  it("ignores ships in transit (TRAVELING) — they are not present in the system", () => {
    const galaxy = makeGalaxy();
    galaxy.npcShips.push(
      // Hostile merely passing through sys_a (in transit): not a live fight.
      makeShip("sys_a", {
        hostile: true,
        role: NpcRole.PIRATE,
        state: NpcState.TRAVELING,
      }),
      makeShip("sys_a", { hostile: false, role: NpcRole.RANGER }),
    );

    const sim = new NpcSimulator();
    expect(sim.battleSystemIds(galaxy)).toEqual(new Set());
  });

  it("ignores destroyed (DEAD) ships", () => {
    const galaxy = makeGalaxy();
    galaxy.npcShips.push(
      makeShip("sys_a", {
        hostile: true,
        role: NpcRole.PIRATE,
        state: NpcState.DEAD,
      }),
      makeShip("sys_a", { hostile: false, role: NpcRole.RANGER }),
    );

    const sim = new NpcSimulator();
    expect(sim.battleSystemIds(galaxy)).toEqual(new Set());
  });

  it("detects battles per-system independently", () => {
    const galaxy = makeGalaxy();
    galaxy.npcShips.push(
      // sys_a: live fight
      makeShip("sys_a", { hostile: true, role: NpcRole.PIRATE }),
      makeShip("sys_a", { hostile: false, role: NpcRole.RANGER }),
      // sys_b: only friendlies — no fight
      makeShip("sys_b", { hostile: false, role: NpcRole.TRADER }),
    );

    const sim = new NpcSimulator();
    expect(sim.battleSystemIds(galaxy)).toEqual(new Set(["sys_a"]));
  });
});
